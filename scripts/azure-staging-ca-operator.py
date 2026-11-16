#!/usr/bin/env python3
"""Owner-gated exact-name CA PEM import to CampusPool staging Key Vault.

--plan: read-only Azure ARM/role metadata and local public CA validation.
--grant-once: independent owner-approved temporary exact-name ABAC role.
--import-once: independent owner-approved CA upload, no secret/role disclosure.
--revoke-once: owner-approved removal of ONLY this temporary CA assignment.

Never reads the existing staging PG password or GHCR token. Never starts jobs.
No retry after uncertain Azure writes: --plan is the recovery diagnostic.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid
import tempfile

SUBSCRIPTION = 'Azure for Students'
RG = 'campuspool-backup-rg'
VAULT = 'campuspool-backup-kv-01'
SECRET = 'staging-pg-root-ca'
ROLE = 'CampusPool Temporary Staging CA SetSecret Exact Name'
ACTION = 'Microsoft.KeyVault/vaults/secrets/setSecret/action'
CONDITION = ("((!(ActionMatches{'Microsoft.KeyVault/vaults/secrets/setSecret/action'})) "
             "OR (@Request[Microsoft.KeyVault/vaults/secrets:name] StringEquals 'staging-pg-root-ca'))")
CA = Path.home() / 'prod-ca-2021.crt'
FINGERPRINT = '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$', re.I)
ARM_VAULT_API = '2024-11-01'
ARM_IAM_API = '2022-04-01'


class Stop(Exception):
    pass


def proc(*args, timeout=45):
    try:
        return subprocess.run(list(args), capture_output=True, text=True,
                              check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop('TOOL_MISSING_OR_TIMEOUT') from None


def az(*args, timeout=45):
    return proc('az', *args, '--only-show-errors', timeout=timeout)


def az_json(*args, label):
    p = az(*args, '-o', 'json')
    if p.returncode:
        raise Stop(label + '_READ_FAILED')
    try:
        return json.loads(p.stdout)
    except (TypeError, ValueError):
        raise Stop(label + '_INVALID_JSON') from None


def az_text(*args, label):
    p = az(*args, '-o', 'tsv')
    if p.returncode:
        raise Stop(label + '_READ_FAILED')
    return p.stdout.strip()


def classify(p):
    s = ((p.stderr or '') + (p.stdout or '')).casefold()
    if any(k in s for k in ('resourcenotfound', 'notfound', '404')):
        return 'NOT_FOUND'
    if any(k in s for k in ('403', 'forbidden', 'authorizationfailed')):
        return 'DENIED'
    return 'UNKNOWN'


def certificate():
    try:
        st = CA.lstat()
        if CA.is_symlink() or not CA.is_file() or not (300 <= st.st_size <= 131072) or st.st_mode & 0o022:
            raise Stop('CA_FILE_UNTRUSTED')
        data = CA.read_bytes()
    except (OSError, ValueError):
        raise Stop('CA_FILE_NOT_AVAILABLE') from None
    # Require exactly one PEM certificate and no appended material.
    if not re.fullmatch(rb'\s*-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\r\n]+'
                        rb'-----END CERTIFICATE-----\s*', data):
        raise Stop('CA_PEM_FORMAT_UNEXPECTED')
    fp = proc('openssl', 'x509', '-in', str(CA), '-noout', '-fingerprint', '-sha256')
    if fp.returncode:
        raise Stop('CA_FINGERPRINT_READ_FAILED')
    actual = fp.stdout.strip().partition('=')[2].replace(':', '').upper()
    if actual != FINGERPRINT:
        raise Stop('CA_FINGERPRINT_MISMATCH')
    ext = proc('openssl', 'x509', '-in', str(CA), '-noout', '-ext', 'basicConstraints,keyUsage')
    if ext.returncode or 'CA:TRUE' not in ext.stdout or 'Certificate Sign' not in ext.stdout:
        raise Stop('CA_CONSTRAINTS_MISMATCH')
    valid = proc('openssl', 'x509', '-in', str(CA), '-noout', '-checkend', '0')
    verify = proc('openssl', 'verify', '-CAfile', str(CA), str(CA))
    if valid.returncode or verify.returncode or ': OK' not in verify.stdout:
        raise Stop('CA_VALIDITY_OR_ROOT_VERIFICATION_FAILED')
    return True


def context():
    sub = az_json('account', 'show', '--query', '{Name:name,State:state,Id:id}', label='ACCOUNT')
    if sub.get('Name') != SUBSCRIPTION or sub.get('State') != 'Enabled' or not UUID.fullmatch(str(sub.get('Id', ''))):
        raise Stop('UNEXPECTED_SUBSCRIPTION')
    vault = az_json('keyvault', 'show', '-g', RG, '-n', VAULT,
                    '--query', '{Id:id,Name:name,Rbac:properties.enableRbacAuthorization,'
                               'Purge:properties.enablePurgeProtection,SoftDelete:properties.enableSoftDelete}',
                    label='VAULT')
    vid = vault.get('Id')
    expected = '/subscriptions/{}/resourceGroups/{}/providers/Microsoft.KeyVault/vaults/{}'.format(sub['Id'], RG, VAULT)
    if (not isinstance(vid, str) or vid.casefold() != expected.casefold() or
        vault.get('Name') != VAULT or vault.get('Rbac') is not True or
        vault.get('Purge') is not True or vault.get('SoftDelete') is not True):
        raise Stop('VAULT_SECURITY_SCOPE_UNEXPECTED')
    caller = az_text('ad', 'signed-in-user', 'show', '--query', 'id', label='HUMAN_CALLER')
    if not UUID.fullmatch(caller):
        raise Stop('HUMAN_CALLER_UNVERIFIED')
    aid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'campuspool-ca-setsecret-abac:' + vid.casefold() + ':' + caller.casefold()))
    return {'vault': vid, 'rg': '/subscriptions/{}/resourceGroups/{}'.format(sub['Id'], RG),
            'caller': caller, 'assignment_uuid': aid,
            'assignment_url': vid + '/providers/Microsoft.Authorization/roleAssignments/' + aid}


def secret_status(ctx):
    url = 'https://management.azure.com{}/secrets/{}?api-version={}'.format(ctx['vault'], SECRET, ARM_VAULT_API)
    p = az('rest', '--method', 'get', '--url', url, '-o', 'json')
    if p.returncode:
        return classify(p)
    try:
        obj = json.loads(p.stdout)
        if obj.get('name', '').casefold() != SECRET:
            return 'UNKNOWN'
        enabled = obj['properties']['attributes']['enabled']
        return 'EXISTS_ENABLED' if enabled is True else 'EXISTS_NOT_ENABLED'
    except (ValueError, TypeError, KeyError, AttributeError):
        return 'UNKNOWN'


def role_definition(ctx):
    r = az_json('role', 'definition', 'list', '--name', ROLE, label='CUSTOM_ROLE')
    if not isinstance(r, list) or len(r) > 1:
        raise Stop('CUSTOM_ROLE_AMBIGUOUS')
    if not r:
        return None
    d = r[0]
    p = d.get('permissions') or []
    if (d.get('roleName') != ROLE or d.get('roleType') != 'CustomRole' or
        len(p) != 1 or set(s.casefold() for s in d.get('assignableScopes', [])) != {ctx['rg'].casefold()} or
        p[0].get('actions', []) != [] or p[0].get('notActions', []) != [] or
        p[0].get('dataActions', []) != [ACTION] or p[0].get('notDataActions', []) != [] or
        not UUID.fullmatch(str(d.get('name', '')))):
        raise Stop('CUSTOM_ROLE_UNEXPECTED_PRIVILEGES')
    return d['name']


def assignment(ctx, role_id):
    url = 'https://management.azure.com{}?api-version={}'.format(ctx['assignment_url'], ARM_IAM_API)
    p = az('rest', '--method', 'get', '--url', url, '-o', 'json')
    if p.returncode:
        if classify(p) == 'NOT_FOUND':
            return 'ABSENT'
        raise Stop('ROLE_ASSIGNMENT_READ_DENIED_OR_UNKNOWN')
    if not role_id:
        raise Stop('ASSIGNMENT_WITHOUT_ROLE_DEFINITION')
    try:
        doc = json.loads(p.stdout)
        props = doc['properties']
        normalized = lambda s: re.sub(r'\s+', '', str(s))
        if (doc['name'].casefold() != ctx['assignment_uuid'].casefold() or
            props['scope'].casefold() != ctx['vault'].casefold() or
            props['principalId'].casefold() != ctx['caller'].casefold() or
            props['roleDefinitionId'].rsplit('/', 1)[-1].casefold() != role_id.casefold() or
            props.get('conditionVersion') != '2.0' or
            normalized(props.get('condition')) != normalized(CONDITION)):
            raise Stop('ROLE_ASSIGNMENT_BROADER_OR_CHANGED')
    except (KeyError, AttributeError, TypeError, ValueError):
        raise Stop('ROLE_ASSIGNMENT_MALFORMED') from None
    return 'EXACT_VERIFIED'


def plan(validate_certificate=True):
    if validate_certificate:
        certificate()
    ctx = context()
    role = role_definition(ctx)
    grant = assignment(ctx, role)
    secret = secret_status(ctx)
    if validate_certificate:
        print('CLOUD_SHELL_CA_FINGERPRINT_AND_CONSTRAINTS_VERIFIED=YES')
    else:
        print('CA_FILE_CHECK_SKIPPED_FOR_GRANT_CLEANUP=YES')
    print('EXPECTED_VAULT_AND_HUMAN_VERIFIED=YES')
    print('STAGING_CA_ARM_STATUS=' + secret)
    print('TEMP_CA_SETSECRET_ROLE_EXISTS=' + ('YES' if role else 'NO'))
    print('TEMP_CA_EXACT_ABAC_ASSIGNMENT=' + grant)
    print('NO_AZURE_WRITES_OR_SECRET_VALUE_READ=YES')
    return ctx, role, grant, secret


def approval(phrase):
    if not sys.stdin.isatty():
        raise Stop('INTERACTIVE_TTY_REQUIRED')
    try:
        typed = input('Type ' + phrase + ': ')
    except (EOFError, KeyboardInterrupt):
        raise Stop('OWNER_CONFIRMATION_CANCELLED') from None
    if typed != phrase:
        raise Stop('OWNER_CONFIRMATION_MISSING')


def grant_once():
    ctx, role, state, secret = plan()
    if state != 'ABSENT' or secret != 'NOT_FOUND':
        raise Stop('EXACT_ABSENT_CA_AND_NO_GRANT_REQUIRED')
    approval('GRANT_TEMP_STAGING_CA_SETSECRET_ONLY')
    ctx, role, state, secret = plan()
    if state != 'ABSENT' or secret != 'NOT_FOUND':
        raise Stop('PREWRITE_STATE_CHANGED')
    if not role:
        # Role schema contains *no* CA value and is written only to RAM-backed tmpfs.
        doc = {'Name': ROLE, 'IsCustom': True,
               'Description': 'Temporary exact CA-name setSecret with mandatory ABAC condition',
               'Actions': [], 'NotActions': [], 'DataActions': [ACTION],
               'NotDataActions': [], 'AssignableScopes': [ctx['rg']]}
        tmpfs = Path('/dev/shm')
        if tmpfs.is_symlink() or proc('stat', '-f', '-c', '%T', str(tmpfs)).stdout.strip() != 'tmpfs':
            raise Stop('ROLE_TEMPFILE_MUST_BE_TMPFS')
        fd, fname = tempfile.mkstemp(prefix='campuspool-ca-role-', suffix='.json', dir='/dev/shm')
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as writer:
                json.dump(doc, writer)
            fd = -1
            p = az('role', 'definition', 'create', '--role-definition', fname, '-o', 'none', timeout=60)
        finally:
            if fd != -1:
                os.close(fd)
            Path(fname).unlink(missing_ok=True)
        if p.returncode:
            raise Stop('ROLE_CREATE_OUTCOME_UNKNOWN_RECHECK_NO_RETRY')
        role = role_definition(ctx)
        if not role:
            raise Stop('ROLE_NOT_VERIFIED_NO_GRANT')
    p = az('role', 'assignment', 'create', '--name', ctx['assignment_uuid'],
           '--assignee-object-id', ctx['caller'], '--assignee-principal-type', 'User',
           '--role', role, '--scope', ctx['vault'], '--condition', CONDITION,
           '--condition-version', '2.0', '-o', 'none', timeout=60)
    if p.returncode:
        raise Stop('ROLE_GRANT_OUTCOME_UNKNOWN_RECHECK_NO_RETRY')
    if assignment(ctx, role) != 'EXACT_VERIFIED':
        raise Stop('ROLE_GRANT_NOT_READBACK_VERIFIED')
    print('TEMP_EXACT_CA_SETSECRET_ABAC_GRANT_VERIFIED=YES')
    print('NO_CA_IMPORT_OR_OTHER_SECRET_OPERATION=YES')
    print('REVOKE_TEMP_GRANT_AFTER_IMPORT_OR_ABANDONMENT=REQUIRED')


def import_once():
    ctx, role, state, secret = plan()
    if not role or state != 'EXACT_VERIFIED' or secret != 'NOT_FOUND':
        raise Stop('CA_IMPORT_REQUIRE_VERIFIED_TEMP_GRANT_AND_ABSENCE')
    approval('IMPORT_ONLY_VALIDATED_PUBLIC_STAGING_CA_ONCE')
    ctx, role, state, secret = plan()
    if state != 'EXACT_VERIFIED' or secret != 'NOT_FOUND':
        raise Stop('PREIMPORT_STATE_CHANGED')
    p = az('keyvault', 'secret', 'set', '--vault-name', VAULT, '--name', SECRET,
           '--file', str(CA), '--encoding', 'utf-8',
           '--content-type', 'CampusPool public Supabase Root 2021 CA PEM',
           '-o', 'none', timeout=60)
    if p.returncode:
        raise Stop('CA_IMPORT_RESULT_UNKNOWN_RECHECK_NO_RETRY')
    if secret_status(ctx) != 'EXISTS_ENABLED':
        raise Stop('CA_IMPORT_NOT_CONFIRMED_CHECK_READONLY')
    print('STAGING_CA_IMPORTED_AND_ARM_ENABLED=YES')
    print('NO_DATABASE_BLOB_JOB_OR_OTHER_SECRET_CHANGES=YES')
    print('NEXT=REVOKE_EXACT_TEMP_CA_IMPORT_ROLE')


def revoke_once():
    # Cleanup must work even when the public CA file was removed or expired.
    ctx, role, state, _ = plan(validate_certificate=False)
    if state == 'ABSENT':
        print('TEMP_CA_GRANT_ALREADY_ABSENT=YES')
        return
    if not role or state != 'EXACT_VERIFIED':
        raise Stop('NOT_OUR_EXACT_GRANT')
    approval('REVOKE_TEMP_STAGING_CA_SETSECRET_GRANT')
    ctx, role, state, _ = plan(validate_certificate=False)
    if state != 'EXACT_VERIFIED':
        raise Stop('PREDELETE_STATE_CHANGED')
    p = az('role', 'assignment', 'delete', '--ids', ctx['assignment_url'], '-o', 'none', timeout=60)
    if p.returncode:
        raise Stop('CA_ROLE_REVOKE_UNKNOWN_RECHECK_NO_RETRY')
    if assignment(ctx, role) != 'ABSENT':
        raise Stop('CA_ROLE_REVOKE_NOT_VERIFIED')
    print('TEMP_CA_EXACT_ABAC_GRANT_REVOKED_AND_READBACK_VERIFIED=YES')
    print('NO_CA_VALUE_OR_OTHER_RESOURCE_CHANGES=YES')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    for action in ('plan', 'grant-once', 'import-once', 'revoke-once'):
        group.add_argument('--' + action, action='store_true')
    args = parser.parse_args()
    try:
        if args.plan:
            plan()
        elif args.grant_once:
            grant_once()
        elif args.import_once:
            import_once()
        else:
            revoke_once()
    except Stop as e:
        print('STOP_' + str(e))
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
