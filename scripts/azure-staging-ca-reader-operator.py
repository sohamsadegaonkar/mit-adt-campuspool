#!/usr/bin/env python3
"""CampusPool staging public-CA secret: exact-scope, data-UAI-only reader RBAC.

--plan: READ ONLY metadata checks. --grant-once and --revoke-once:
separately owner-confirmed IAM changes. Never reads secret values or starts jobs.
"""
import argparse
import json
import re
import subprocess
import sys
import uuid

SUB = "Azure for Students"
RG = "campuspool-backup-rg"
VAULT = "campuspool-backup-kv-01"
CA_SECRET = "staging-pg-root-ca"
DATA_ID = "campuspool-staging-backup-data-id"
PULL_ID = "campuspool-ghcr-vault-reader"
ROLE_GUID = "4633458b-17de-408a-b874-0445c86b69e6"  # Key Vault Secrets User
UUID = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)


class Stop(Exception):
    pass


def az(*args, timeout=45):
    try:
        return subprocess.run(["az", *args, "--only-show-errors"],
                              capture_output=True, text=True, check=False,
                              timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop("AZURE_CLI_UNAVAILABLE_OR_TIMEOUT") from None


def az_json(*args, label):
    p = az(*args, "-o", "json")
    if p.returncode:
        raise Stop(label + "_READ_FAILED")
    try:
        return json.loads(p.stdout)
    except (TypeError, ValueError):
        raise Stop(label + "_BAD_JSON") from None


def check_context():
    sub = az_json("account", "show", "--query", "{Name:name,State:state,Id:id}",
                  label="SUBSCRIPTION")
    if (sub.get("Name") != SUB or sub.get("State") != "Enabled" or
            not UUID.fullmatch(str(sub.get("Id", "")))):
        raise Stop("SUBSCRIPTION_NOT_ALLOWLISTED")
    vault = az_json("keyvault", "show", "-g", RG, "-n", VAULT,
                    "--query", "{Id:id,Name:name,Rbac:properties.enableRbacAuthorization}",
                    label="VAULT")
    expected = f"/subscriptions/{sub['Id']}/resourceGroups/{RG}/providers/Microsoft.KeyVault/vaults/{VAULT}"
    if (vault.get("Id", "").lower() != expected.lower() or
            vault.get("Name") != VAULT or vault.get("Rbac") is not True):
        raise Stop("VAULT_NOT_VERIFIED")
    ca_scope = expected + "/secrets/" + CA_SECRET
    ca = az_json("rest", "--method", "get",
                 "--url", "https://management.azure.com" + ca_scope + "?api-version=2024-11-01",
                 "--query", "{Name:name,Enabled:properties.attributes.enabled}", label="CA_ARM")
    if ca != {"Name": CA_SECRET, "Enabled": True}:
        raise Stop("CA_SECRET_MISSING_OR_DISABLED")
    identities = {}
    for name in (DATA_ID, PULL_ID):
        obj = az_json("identity", "show", "-g", RG, "-n", name,
                      "--query", "{Name:name,Id:id,Principal:principalId,Client:clientId}",
                      label="IDENTITY")
        expected_id = f"/subscriptions/{sub['Id']}/resourceGroups/{RG}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{name}"
        if (obj.get("Name") != name or
                obj.get("Id", "").lower() != expected_id.lower() or
                not UUID.fullmatch(str(obj.get("Principal", ""))) or
                not UUID.fullmatch(str(obj.get("Client", "")))):
            raise Stop("IDENTITY_NOT_EXACT")
        identities[name] = obj
    return {"scope": ca_scope, "data": identities[DATA_ID], "pull": identities[PULL_ID]}


def known_assignment_id(ctx):
    return str(uuid.uuid5(uuid.NAMESPACE_URL,
                          "campuspool-staging-ca-exact-reader:"
                          + ctx["scope"].lower() + ":" + ctx["data"]["Principal"].lower()))


def read_assignments(ctx, principal):
    entries = az_json("role", "assignment", "list", "--scope", ctx["scope"],
                      "--assignee-object-id", principal,
                      "--fill-principal-name", "false", "--include-inherited",
                      label="ROLE_ASSIGNMENTS")
    if not isinstance(entries, list):
        raise Stop("ASSIGNMENT_LIST_NOT_ARRAY")
    for entry in entries:
        if (not isinstance(entry, dict) or
                entry.get("principalId", "").lower() != principal.lower() or
                not isinstance(entry.get("scope"), str) or
                not isinstance(entry.get("roleDefinitionId"), str)):
            raise Stop("ROLE_ASSIGNMENT_AMBIGUOUS")
    return entries


def classify(ctx):
    # Keep image-pull credentials isolated: NEVER broaden GHCR identity to CA.
    pull = read_assignments(ctx, ctx["pull"]["Principal"])
    if pull:
        raise Stop("GHCR_PULL_IDENTITY_HAS_CA_SCOPE_ASSIGNMENT")
    entries = read_assignments(ctx, ctx["data"]["Principal"])
    if not entries:
        return "ABSENT"
    if len(entries) != 1:
        raise Stop("DATA_IDENTITY_CA_ASSIGNMENT_AMBIGUOUS")
    item = entries[0]
    if (item.get("scope", "").lower() != ctx["scope"].lower() or
            item.get("roleDefinitionId", "").rsplit("/", 1)[-1].lower() != ROLE_GUID or
            item.get("name", "").lower() != known_assignment_id(ctx).lower() or
            item.get("condition") not in (None, "")):
        raise Stop("DATA_IDENTITY_CA_ASSIGNMENT_NOT_EXACT")
    return "EXACT_VERIFIED"


def plan():
    ctx = check_context()
    status = classify(ctx)
    print("SUBSCRIPTION_VAULT_CA_AND_BOTH_IDENTITIES_VERIFIED=YES")
    print("CA_SECRET_ENABLED=YES")
    print("GHCR_PULL_CA_ACCESS=NONE")
    print("DATA_ID_CA_EXACT_READER=" + status)
    print("NO_AZURE_WRITES_OR_SECRET_VALUE_READ=YES")
    return ctx, status


def approve(message):
    if not sys.stdin.isatty():
        raise Stop("INTERACTIVE_TERMINAL_REQUIRED")
    try:
        if input("Type " + message + ": ") != message:
            raise Stop("EXPLICIT_OWNER_CONFIRMATION_MISSING")
    except (EOFError, KeyboardInterrupt):
        raise Stop("OWNER_CANCELLED") from None


def grant_once():
    ctx, state = plan()
    if state != "ABSENT":
        raise Stop("EXISTING_ASSIGNMENT_NO_DUPLICATE_GRANT")
    approve("GRANT_ONLY_STAGING_CA_READER_TO_DATA_IDENTITY")
    ctx, state = plan()
    if state != "ABSENT":
        raise Stop("PREGRANT_STATE_CHANGED")
    p = az("role", "assignment", "create",
           "--name", known_assignment_id(ctx),
           "--assignee-object-id", ctx["data"]["Principal"],
           "--assignee-principal-type", "ServicePrincipal",
           "--role", ROLE_GUID, "--scope", ctx["scope"],
           "-o", "none", timeout=60)
    if p.returncode:
        raise Stop("GRANT_RESULT_UNCERTAIN_RECHECK_PLAN_NO_RETRY")
    if classify(ctx) != "EXACT_VERIFIED":
        raise Stop("GRANT_NOT_READBACK_VERIFIED")
    print("EXACT_CA_READER_GRANT_VERIFIED=YES")
    print("NO_OTHER_VAULT_SECRET_BLOB_DATABASE_OR_JOB_CHANGE=YES")


def revoke_once():
    ctx, state = plan()
    if state == "ABSENT":
        print("NO_CA_READER_ASSIGNMENT_TO_REVOKE=YES")
        return
    if state != "EXACT_VERIFIED":
        raise Stop("NOT_OWNED_EXACT_ASSIGNMENT")
    approve("REVOKE_ONLY_STAGING_CA_READER_FROM_DATA_IDENTITY")
    ctx, state = plan()
    if state != "EXACT_VERIFIED":
        raise Stop("PRE_REVOKE_STATE_CHANGED")
    p = az("role", "assignment", "delete",
           "--ids", ctx["scope"] + "/providers/Microsoft.Authorization/roleAssignments/"
                    + known_assignment_id(ctx),
           "-o", "none", timeout=60)
    if p.returncode:
        raise Stop("REVOKE_RESULT_UNCERTAIN_RECHECK_PLAN_NO_RETRY")
    if classify(ctx) != "ABSENT":
        raise Stop("REVOKE_NOT_READBACK_VERIFIED")
    print("EXACT_CA_READER_ROLE_REVOKED_AND_VERIFIED=YES")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--plan", action="store_true")
    group.add_argument("--grant-once", action="store_true")
    group.add_argument("--revoke-once", action="store_true")
    opts = parser.parse_args()
    try:
        if opts.plan:
            plan()
        elif opts.grant_once:
            grant_once()
        else:
            revoke_once()
        return 0
    except Stop as exc:
        print("STOP_" + str(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
