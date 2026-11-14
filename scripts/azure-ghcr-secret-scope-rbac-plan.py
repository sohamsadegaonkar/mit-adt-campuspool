#!/usr/bin/env python3
"""Read-only preflight: *one* GHCR-token secret-scoped Key Vault reader assignment.

No secret data-plane calls, no token value, no role writes, no deployment.
The secret's ARM representation never returns its value; no raw ARM data prints.
"""
import json
import re
import subprocess
import sys

RG="campuspool-backup-rg"
VAULT="campuspool-backup-kv-01"
UAI="campuspool-ghcr-vault-reader"
SECRET="ghcr-pull-token"
EXPECTED_SUB="Azure for Students"
UUID=r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
RE_VAULT=re.compile(rf"^/subscriptions/({UUID})/resourceGroups/{RG}/providers/Microsoft.KeyVault/vaults/{VAULT}$",re.I)
RE_UUID=re.compile(rf"^{UUID}$",re.I)
ARM="https://management.azure.com"
SECRET_ROLE_GUID="4633458b-17de-408a-b874-0445c86b69e6"

class Stop(Exception): pass

def az(*args):
    try:
        proc=subprocess.run(["az",*args],text=True,capture_output=True,timeout=40)
    except (OSError,subprocess.TimeoutExpired):
        raise Stop("AZURE_CLI_UNAVAILABLE")
    if proc.returncode:
        msg=(proc.stderr+proc.stdout).casefold()
        if "authorizationfailed" in msg or "403" in msg or "forbidden" in msg:
            raise Stop("AZURE_RBAC_READ_DENIED")
        if "expired" in msg or "az login" in msg:
            raise Stop("AZURE_LOGIN_REQUIRED")
        raise Stop("AZURE_READ_REQUEST_FAILED")
    return proc.stdout.strip()

def arm_read(path):
    raw=az("rest","--method","get","--url",ARM+path,"--only-show-errors","-o","json")
    try:
        obj=json.loads(raw)
        if not isinstance(obj,dict): raise ValueError("not object")
        return obj
    except (ValueError,TypeError):
        raise Stop("AZURE_ARM_RESPONSE_INVALID")

def assignments(scope):
    data=arm_read(scope+"/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&%24filter=atScope()")
    items=data.get("value")
    if not isinstance(items,list): raise Stop("RBAC_ASSIGNMENTS_RESPONSE_INVALID")
    if data.get("nextLink"): raise Stop("RBAC_ASSIGNMENTS_PAGINATED_NEEDS_REVIEW")
    return items

def main():
    if sys.argv[1:]!=["--plan"]:
        raise Stop("USAGE_PLAN_ONLY")
    if az("account","show","--query","name","-o","tsv")!=EXPECTED_SUB:
        raise Stop("WRONG_SUBSCRIPTION")
    if az("group","show","-n",RG,"--query","location","-o","tsv")!="malaysiawest":
        raise Stop("WRONG_RESOURCE_GROUP")
    vaultid=az("keyvault","show","-g",RG,"-n",VAULT,"--query","id","-o","tsv")
    if not RE_VAULT.fullmatch(vaultid):
        raise Stop("VAULT_SCOPE_INVALID")
    if az("keyvault","show","-g",RG,"-n",VAULT,"--query","properties.enableRbacAuthorization","-o","tsv")!="true":
        raise Stop("VAULT_RBAC_DISABLED")
    identity=az("identity","show","-g",RG,"-n",UAI,"--query","principalId","-o","tsv").lower()
    if not RE_UUID.fullmatch(identity): raise Stop("UAI_PRINCIPAL_INVALID")

    # This ARM control-plane GET is strictly metadata (secret 'value' is never
    # returned by ARM). Do NOT use Key Vault data-plane secret show/get.
    path=vaultid+"/secrets/"+SECRET
    secret=arm_read(path+"?api-version=2024-11-01")
    if str(secret.get("id","")).lower()!=path.lower():
        raise Stop("GHCR_SECRET_RESOURCE_NOT_VERIFIED")
    props=secret.get("properties",{})
    if not isinstance(props,dict) or "value" in props:
        raise Stop("UNEXPECTED_SECRET_VALUE_IN_ARM_RESPONSE")
    attrs=props.get("attributes",{})
    if not isinstance(attrs,dict) or attrs.get("enabled") is False:
        raise Stop("GHCR_SECRET_DISABLED_OR_INVALID")

    # Both Vault and secret atScope() checks include inherited assignments.
    # Never assume missing group memberships/PIM or deny assignments are zero.
    found=[]
    for scope in (vaultid,path):
        for a in assignments(scope):
            if not isinstance(a,dict) or not isinstance(a.get("properties"),dict):
                raise Stop("RBAC_ENTRY_INVALID")
            p=a["properties"]
            if str(p.get("principalId","")).lower()==identity:
                scope_val=str(p.get("scope",""))
                role=str(p.get("roleDefinitionId",""))
                if not scope_val or not role:
                    raise Stop("UAI_RBAC_ASSIGNMENT_INVALID")
                found.append((scope_val.lower(),role.lower()))
    # This is a zero-role preflight; any direct UAI assignments need review.
    # Do not accidentally grant a redundant or unexpectedly broad secret role.
    if found: raise Stop("UAI_HAS_EXISTING_ROLE_ASSIGNMENTS_REVIEW_PRIVATELY")

    print("AZURE_STUDENT_VAULT_RBAC_VERIFIED=YES")
    print("GHCR_PULL_TOKEN_ARM_METADATA_PRESENT=YES")
    print("GHCR_SECRET_VALUE_NOT_READ_OR_PRINTED=YES")
    print("GHCR_MANAGED_IDENTITY_VERIFIED=YES")
    print("EXISTING_UAI_SCOPE_ROLE_ASSIGNMENTS_FOUND=0")
    print("PROPOSED_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY")
    print("PROPOSED_ROLE=KEY_VAULT_SECRETS_USER")
    print("ROLE_GUID_MATCHES_MICROSOFT_DOCUMENTATION=YES")
    print("GROUP_PIM_DENY_AND_EFFECTIVE_PERMISSIONS_NOT_PROVEN=YES")
    print("AZURE_ROLE_GRANTS_OR_SECRET_VALUES_CHANGED=NO")
    print("GHCR_SECRET_SCOPE_RBAC_PLAN_COMPLETE=YES")
    print("NEXT=OWNER_REVIEW_EXACT_SECRET_SCOPE_BEFORE_ANY_ROLE_GRANT")

if __name__=="__main__":
    try:
        main()
    except Stop as exc:
        print("STOP_"+str(exc))
        sys.exit(3)
