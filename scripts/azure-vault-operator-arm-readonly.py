#!/usr/bin/env python3
"""CampusPool owner Azure Key Vault operator role audit via Azure ARM REST.

Read-only. Never print email, principal IDs, subscription IDs, role assignment
payloads, secret names/values, or raw Azure CLI errors. Unlike 'az role
assignment list', the REST call does not invoke Graph name enrichment.
"""
import json
import re
import subprocess
import sys
from urllib.parse import quote

VAULT="campuspool-backup-kv-01"
RG="campuspool-backup-rg"
UUID=r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
VAULT_ID_RE=re.compile(
    rf"^/subscriptions/{UUID}/resourceGroups/{RG}/providers/Microsoft\.KeyVault/vaults/{VAULT}$",
    re.I,
)
ROLE_ID_RE=re.compile(
    rf"^/(?:subscriptions/{UUID}/)?providers/Microsoft\.Authorization/roleDefinitions/{UUID}$",
    re.I,
)
ADMINS=frozenset({
    "owner","user access administrator","role based access control administrator",
    "key vault data access administrator",
})
SECRET_WRITERS=frozenset({"key vault secrets officer","key vault administrator"})
ARM="https://management.azure.com"

class AuditStop(Exception):
    pass

def safe_error(raw):
    s=(raw or "").casefold()
    if "unrecognized arguments" in s or "unrecognized argument" in s or "not recognized" in s:
        return "CLI_ARGUMENT_UNSUPPORTED"
    if "authorizationfailed" in s or "roleassignments/read" in s or "does not have authorization" in s or "403" in s or "forbidden" in s:
        return "AZURE_RBAC_DENIED"
    if "graph.microsoft.com" in s or "graph.windows.net" in s or "insufficient privileges" in s:
        return "GRAPH_ACCESS_RESTRICTED"
    if "az login" in s or "expired" in s or "interactionrequired" in s or "401" in s:
        return "AZURE_LOGIN_REQUIRED"
    return "UNCLASSIFIED"

def run_az(*args):
    # run_az is replaced by an offline mock in unit tests.
    try:
        process=subprocess.run(["az",*args],capture_output=True,text=True,timeout=35)
    except (OSError,subprocess.TimeoutExpired):
        raise AuditStop("AZURE_CLI_UNAVAILABLE")
    if process.returncode:
        raise AuditStop("AZURE_API_"+safe_error(process.stderr+"\n"+process.stdout))
    return process.stdout.strip()

def rest_json(path_and_query):
    out=run_az("rest","--method","get","--url",ARM+path_and_query,
               "--only-show-errors","--output","json")
    try:
        data=json.loads(out)
    except (ValueError,TypeError):
        raise AuditStop("AZURE_ARM_JSON_INVALID")
    if not isinstance(data,dict):
        raise AuditStop("AZURE_ARM_RESPONSE_INVALID")
    return data

def audit():
    if run_az("account","show","--query","name","-o","tsv")!="Azure for Students":
        raise AuditStop("WRONG_SUBSCRIPTION")
    if run_az("group","show","-n",RG,"--query","location","-o","tsv")!="malaysiawest":
        raise AuditStop("WRONG_RESOURCE_GROUP")
    if run_az("keyvault","show","-g",RG,"-n",VAULT,
              "--query","properties.enableRbacAuthorization","-o","tsv")!="true":
        raise AuditStop("VAULT_NOT_RBAC")
    vault_id=run_az("keyvault","show","-g",RG,"-n",VAULT,
                    "--query","id","-o","tsv")
    if not VAULT_ID_RE.fullmatch(vault_id):
        raise AuditStop("VAULT_SCOPE_INVALID")
    operator_id=run_az("ad","signed-in-user","show","--query","id","-o","tsv").lower()
    if not re.fullmatch(UUID,operator_id):
        raise AuditStop("SIGNED_IN_USER_UNVERIFIED")

    # The ARM REST atScope() filter returns assignments at this Vault and above.
    # No --assignee-object-id CLI option (which is supported on CREATE, not LIST).
    # No Microsoft Graph principal display-name enrichment.
    filt=quote("atScope()",safe="()")
    url=vault_id+"/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&%24filter="+filt
    data=rest_json(url)
    if "nextLink" in data and data["nextLink"]:
        # Never silently discard paginated IAM results.
        raise AuditStop("ROLE_ASSIGNMENT_PAGINATION_REQUIRES_REVIEW")
    if not isinstance(data.get("value"),list):
        raise AuditStop("ROLE_ASSIGNMENT_ARRAY_INVALID")
    direct=[]
    for assignment in data["value"]:
        if not isinstance(assignment,dict) or not isinstance(assignment.get("properties"),dict):
            raise AuditStop("ROLE_ASSIGNMENT_ENTRY_INVALID")
        item=assignment["properties"]
        if not isinstance(item.get("principalId"),str):
            raise AuditStop("ROLE_PRINCIPAL_INVALID")
        if item["principalId"].lower()!=operator_id:
            continue
        roleid=item.get("roleDefinitionId")
        if not isinstance(roleid,str) or not ROLE_ID_RE.fullmatch(roleid):
            raise AuditStop("ROLE_DEFINITION_ID_INVALID")
        direct.append((roleid,item.get("condition")))
    if len(direct)>24:
        raise AuditStop("TOO_MANY_DIRECT_ASSIGNMENTS_TO_CLASSIFY")

    names=[]
    for rid, _ in direct:
        # This ARM endpoint returns a role definition by immutable identifier.
        definition=rest_json(rid+"?api-version=2022-04-01")
        role=definition.get("properties")
        if not isinstance(role,dict) or not isinstance(role.get("roleName"),str):
            raise AuditStop("ROLE_DEFINITION_UNAVAILABLE")
        names.append(role["roleName"].casefold().strip())

    print("AZURE_OPERATOR_ROLE_ARM_REST_AUDIT=PASS")
    print("DIRECT_OPERATOR_ROLE_ASSIGNMENTS="+str(len(direct)))
    print("DIRECT_ROLE_ASSIGNMENT_ADMIN_CANDIDATE="+
          ("YES" if any(n in ADMINS for n in names) else "NO_OR_UNKNOWN"))
    print("DIRECT_SECRET_WRITER_CANDIDATE="+
          ("YES" if any(n in SECRET_WRITERS for n in names) else "NO_OR_UNKNOWN"))
    print("CONDITIONAL_ASSIGNMENT_REVIEW_NEEDED="+
          ("YES" if any(condition is not None for _,condition in direct) else "NO"))
    print("GROUP_TRANSITIVE_PIM_DENY_AND_CUSTOM_PERMISSIONS_NOT_VERIFIED=YES")
    print("CANDIDATES_NOT_EFFECTIVE_PERMISSION_PROOF=YES")
    print("NO_AZURE_WRITES_SECRETS_OR_DATABASE_ACCESS=YES")
    print("NEXT=REVIEW_OPERATOR_VAULT_ACCESS_BEFORE_SECRET_GRANTS")

if __name__=="__main__":
    if sys.argv[1:]:
        print("STOP_USAGE")
        sys.exit(2)
    try:
        audit()
    except AuditStop as e:
        print("STOP_"+str(e))
        sys.exit(3)
