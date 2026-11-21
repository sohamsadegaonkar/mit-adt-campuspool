#!/usr/bin/env python3
"""CampusPool staging-only temporary Azure Key Vault setSecret ABAC operator.

  --plan         READ ONLY: validate exact Azure and role/assignment metadata.
  --grant-once   OWNER-GATED: create setSecret-only custom role if absent and
                 exact-name ABAC-conditioned assignment for signed-in USER.
  --revoke-once  OWNER-GATED: revoke only this precisely identified assignment.

No secret values, PostgreSQL connections, backup jobs, data exports, or
resource group/subscription-level role assignments. Fail closed on preview
ABAC/role-definition errors. Do not automatically retry uncertain writes.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

SUBSCRIPTION = "Azure for Students"
RESOURCE_GROUP = "campuspool-backup-rg"
VAULT = "campuspool-backup-kv-01"
SECRET = "campuspool-staging-pg-password"
ROLE = "CampusPool Staging Temporary SetSecret Exact Name"
DATA_ACTION = "Microsoft.KeyVault/vaults/secrets/setSecret/action"
CONDITION = (
    "((!(ActionMatches{'Microsoft.KeyVault/vaults/secrets/setSecret/action'}))"
    " OR (@Request[Microsoft.KeyVault/vaults/secrets:name]"
    " StringEquals 'campuspool-staging-pg-password'))"
)
ARM_RBAC_VERSION = "2022-04-01"
ARM_VAULT_VERSION = "2024-11-01"
ROLE_DESCRIPTION = "Temporary staging-only Key Vault setSecret; ABAC exact-name assignment required"
UUID_RE = re.compile(r"^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$")


class Stop(Exception):
    pass


def run_az(*args, timeout=40):
    """Never forward raw Azure output or errors, which can contain identifiers."""
    try:
        return subprocess.run(
            ["az", *args], capture_output=True, text=True, encoding="utf-8",
            check=False, timeout=timeout
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Stop("AZURE_CLI_UNAVAILABLE_OR_TIMEOUT") from None


def require_success(proc, category):
    if proc.returncode != 0:
        raise Stop(category)
    return proc


def json_az(*args, category):
    proc = require_success(run_az(*args, "-o", "json", "--only-show-errors"), category)
    try:
        return json.loads(proc.stdout)
    except (json.JSONDecodeError, TypeError, ValueError):
        raise Stop(category + "_INVALID_JSON") from None


def tsv_az(*args, category):
    proc = require_success(run_az(*args, "-o", "tsv", "--only-show-errors"), category)
    return proc.stdout.strip()


def context():
    account = json_az("account", "show",
        "--query", "{Name:name,State:state,Id:id}", category="SUBSCRIPTION_READ_FAILED")
    if (account.get("Name") != SUBSCRIPTION or account.get("State") != "Enabled" or
            not UUID_RE.fullmatch(str(account.get("Id","")))):
        raise Stop("SUBSCRIPTION_NOT_ALLOWLISTED")

    vault = json_az("keyvault", "show", "-g", RESOURCE_GROUP, "-n", VAULT,
        "--query", "{Id:id,Name:name,Rbac:properties.enableRbacAuthorization,"
                   "Purge:properties.enablePurgeProtection,SoftDelete:properties.enableSoftDelete}",
        category="VAULT_READ_FAILED")
    vault_id = vault.get("Id")
    rg_id = f"/subscriptions/{account['Id']}/resourceGroups/{RESOURCE_GROUP}"
    expected = f"{rg_id}/providers/Microsoft.KeyVault/vaults/{VAULT}"
    if (not isinstance(vault_id, str) or vault_id.lower()!=expected.lower() or
            vault.get("Name") != VAULT or vault.get("Rbac") is not True or
            vault.get("Purge") is not True or vault.get("SoftDelete") is not True):
        raise Stop("VAULT_SECURITY_OR_ID_NOT_VERIFIED")

    caller = tsv_az("ad", "signed-in-user", "show", "--query", "id",
        category="SIGNED_IN_HUMAN_NOT_VERIFIED")
    if not UUID_RE.fullmatch(caller):
        raise Stop("SIGNED_IN_HUMAN_NOT_VERIFIED")
    assignment_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL,
        "campuspool-staging-setsecret-abac:" + vault_id.lower() + ":" + caller.lower()))
    return {"vault_id":vault_id,"rg_id":rg_id,"caller":caller,
            "assignment_id":f"{vault_id}/providers/Microsoft.Authorization/roleAssignments/{assignment_uuid}",
            "assignment_uuid":assignment_uuid}


def secret_arm_state(ctx):
    url = (f"https://management.azure.com{ctx['vault_id']}/secrets/{SECRET}"
           f"?api-version={ARM_VAULT_VERSION}")
    proc = run_az("rest","--method","get","--url",url,"-o","json","--only-show-errors")
    if proc.returncode != 0:
        msg = ((proc.stderr or "")+" "+(proc.stdout or "")).lower()
        if "resourcenotfound" in msg or "notfound" in msg or "404" in msg:
            return "NOT_FOUND"
        return "UNKNOWN_OR_DENIED"
    try:
        result = json.loads(proc.stdout)
        if str(result.get("name", "")).lower()!=SECRET.lower():
            return "UNKNOWN_OR_DENIED"
        return "EXISTS"
    except (ValueError, TypeError, AttributeError):
        return "UNKNOWN_OR_DENIED"


def expected_role_document(ctx):
    return {
        "Name":ROLE, "IsCustom":True, "Description":ROLE_DESCRIPTION,
        "Actions":[], "NotActions":[],
        "DataActions":[DATA_ACTION], "NotDataActions":[],
        "AssignableScopes":[ctx["rg_id"]],
    }


def role_info(ctx):
    result=json_az("role","definition","list","--name",ROLE,
        category="ROLE_DEFINITION_READ_FAILED")
    if not isinstance(result,list) or len(result)>1:
        raise Stop("ROLE_DEFINITION_AMBIGUOUS")
    if not result:
        return None
    d=result[0]
    perms=d.get("permissions") or []
    wanted=expected_role_document(ctx)
    if (d.get("roleName")!=ROLE or d.get("roleType")!="CustomRole" or
        len(perms)!=1 or
        {x.lower() for x in d.get("assignableScopes",[])}!={ctx["rg_id"].lower()} or
        perms[0].get("actions",[])!=[] or perms[0].get("notActions",[])!=[] or
        perms[0].get("dataActions",[])!=wanted["DataActions"] or
        perms[0].get("notDataActions",[])!=[]):
        raise Stop("EXISTING_CUSTOM_ROLE_HAS_UNEXPECTED_PERMISSIONS")
    role_id=str(d.get("name",""))
    if not UUID_RE.fullmatch(role_id):
        raise Stop("ROLE_ID_INVALID")
    return role_id


def assignment_info(ctx,role_id):
    url = (f"https://management.azure.com{ctx['assignment_id']}"
           f"?api-version={ARM_RBAC_VERSION}")
    proc = run_az("rest","--method","get","--url",url,"-o","json","--only-show-errors")
    if proc.returncode:
        msg=((proc.stderr or "")+" "+(proc.stdout or "")).lower()
        if "resourcenotfound" in msg or "notfound" in msg or "404" in msg:
            return "ABSENT"
        raise Stop("ROLE_ASSIGNMENT_METADATA_UNREADABLE")
    if role_id is None:
        raise Stop("ASSIGNMENT_EXISTS_WITHOUT_VERIFIED_ROLE_DEFINITION")
    try:
        doc=json.loads(proc.stdout)
        p=doc["properties"]
        stored=str(p.get("condition",""))
        # Only whitespace outside literal values may differ; our exact secret
        # name has no spaces. Never accept missing or a broader condition.
        clean=lambda value:re.sub(r"\s+","",str(value))
        if (str(p.get("principalId","")).lower()!=ctx["caller"].lower() or
            str(p.get("scope","")).lower()!=ctx["vault_id"].lower() or
            str(p.get("roleDefinitionId","")).lower().split("/")[-1]!=role_id.lower() or
            p.get("conditionVersion")!="2.0" or
            clean(stored)!=clean(CONDITION) or
            str(doc.get("name","")).lower()!=ctx["assignment_uuid"].lower()):
            raise Stop("ROLE_ASSIGNMENT_NOT_EXACT_OR_ABAC_MISSING")
        return "EXACT_VERIFIED"
    except (ValueError,KeyError,TypeError,AttributeError):
        raise Stop("ROLE_ASSIGNMENT_INVALID_METADATA") from None


def private_tmpfs():
    path=Path("/dev/shm")
    if path.is_symlink() or not path.is_dir() or path.resolve()!=path:
        raise Stop("PRIVATE_TMPFS_REQUIRED")
    try:
        s=subprocess.run(["stat","-f","-c","%T",str(path)],
            capture_output=True,text=True,timeout=5)
        if s.returncode or s.stdout.strip()!="tmpfs":
            raise Stop("PRIVATE_TMPFS_REQUIRED")
    except (OSError,subprocess.TimeoutExpired):
        raise Stop("PRIVATE_TMPFS_REQUIRED") from None


def create_role(ctx):
    private_tmpfs()
    fd,name=tempfile.mkstemp(prefix="campuspool-setsecret-role-",suffix=".json",dir="/dev/shm")
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"w",encoding="utf-8") as stream:
            json.dump(expected_role_document(ctx),stream)
        fd=-1
        result=run_az("role","definition","create","--role-definition",name,
            "-o","none","--only-show-errors")
    finally:
        if fd!=-1:
            os.close(fd)
        Path(name).unlink(missing_ok=True)
    if result.returncode:
        raise Stop("CUSTOM_ROLE_CREATE_UNCERTAIN_STOP_RECHECK")
    print("SETSECRET_CUSTOM_ROLE_CREATE_RETURNED_SUCCESS=YES")


def confirm(phrase):
    if not sys.stdin.isatty():
        raise Stop("INTERACTIVE_TERMINAL_REQUIRED")
    try:
        answer=input("Type "+phrase+": ")
    except (EOFError,KeyboardInterrupt):
        raise Stop("USER_CANCELLED") from None
    if answer.strip()!=phrase:
        raise Stop("EXPLICIT_CONFIRMATION_MISSING")


def status(ctx):
    role=role_info(ctx)
    assignment=assignment_info(ctx,role)
    secret=secret_arm_state(ctx)
    print("EXPECTED_VAULT_AND_SIGNED_IN_USER_VERIFIED=YES")
    print("STAGING_SECRET_ARM_STATUS="+secret)
    print("TEMP_SETSECRET_ONLY_ROLE_EXISTS="+("YES" if role else "NO"))
    print("TEMP_EXACT_ABAC_ASSIGNMENT="+assignment)
    print("NO_AZURE_WRITES_OR_SECRET_VALUE_READ=YES")
    return role,assignment,secret


def grant(ctx):
    role,assignment,secret=status(ctx)
    if secret!="NOT_FOUND":
        raise Stop("SECRET_ABSENCE_NOT_PROVEN_NO_NEW_GRANT")
    if assignment!="ABSENT":
        raise Stop("EXISTING_ASSIGNMENT_NO_DUPLICATE_GRANT")
    confirm("GRANT_EXACT_STAGING_SETSECRET_ONLY_TEMPORARILY")
    # Owner approved this exact IAM grant. Re-check just before mutation.
    role,assignment,secret=status(ctx)
    if secret!="NOT_FOUND" or assignment!="ABSENT":
        raise Stop("PREWRITE_STATE_CHANGED")

    if not role:
        create_role(ctx)
        role=role_info(ctx)
        if not role:
            raise Stop("CUSTOM_ROLE_NOT_VERIFIED_NO_ASSIGNMENT")
    result=run_az(
        "role","assignment","create","--name",ctx["assignment_uuid"],
        "--assignee-object-id",ctx["caller"],"--assignee-principal-type","User",
        "--role",role,"--scope",ctx["vault_id"],
        "--condition",CONDITION,"--condition-version","2.0",
        "-o","none","--only-show-errors",timeout=60)
    if result.returncode:
        raise Stop("ABAC_ROLE_GRANT_UNCERTAIN_STOP_NO_RETRY")
    if assignment_info(ctx,role)!="EXACT_VERIFIED":
        raise Stop("ABAC_GRANT_NOT_YET_VERIFIED_STOP_NO_RETRY")
    print("EXACT_STAGING_SETSECRET_ABAC_GRANT_VERIFIED=YES")
    print("NO_SECRET_VALUE_OR_DATABASE_OR_BLOB_OPERATION=YES")
    print("REVOKE_AFTER_ONE_VERIFIED_SECRET_WRITE=REQUIRED")


def revoke(ctx):
    role,assignment,_=status(ctx)
    if assignment=="ABSENT":
        print("NO_ACTIVE_TEMP_STAGING_SETSECRET_GRANT=YES")
        return
    if not role or assignment!="EXACT_VERIFIED":
        raise Stop("NOT_OUR_EXACT_ROLE_ASSIGNMENT")
    confirm("REVOKE_EXACT_STAGING_SETSECRET_TEMP_GRANT")
    result=run_az("role","assignment","delete","--ids",ctx["assignment_id"],
        "-o","none","--only-show-errors",timeout=60)
    if result.returncode:
        raise Stop("REVOKE_UNCERTAIN_STOP_RECHECK")
    if assignment_info(ctx,role)!="ABSENT":
        raise Stop("REVOKE_READBACK_UNCONFIRMED")
    print("EXACT_TEMP_STAGING_SETSECRET_GRANT_REVOKED=YES")
    print("NO_KEYVAULT_SECRET_VALUE_OR_OTHER_ROLE_CHANGED=YES")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--plan",action="store_true",help="read-only status")
    group.add_argument("--grant-once",action="store_true",help="owner-confirmed exact ABAC grant")
    group.add_argument("--revoke-once",action="store_true",help="owner-confirmed exact grant revoke")
    args=parser.parse_args()
    try:
        ctx=context()
        if args.plan:
            status(ctx)
        elif args.grant_once:
            grant(ctx)
        else:
            revoke(ctx)
        return 0
    except Stop as e:
        print("STOP_"+str(e))
        return 2


if __name__=="__main__":
    sys.exit(main())
