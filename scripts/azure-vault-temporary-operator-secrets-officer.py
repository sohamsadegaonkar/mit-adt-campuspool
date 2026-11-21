#!/usr/bin/env python3
"""Owner-run temporary Vault Secrets Officer grant/revoke, exact Vault scope only.

--plan reads Azure; --grant and --revoke require explicit typed confirmation.
Never prints Azure identifiers, role IDs, emails, secret data or raw errors.
"""
import json
import re
import subprocess
import sys
import uuid
from urllib.parse import quote

VAULT="campuspool-backup-kv-01"
RG="campuspool-backup-rg"
ROLE_GUID="b86a8fe4-44ce-4948-aee5-eccb2c155cd7"
UUID=r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
ID_RE=re.compile(rf"^/subscriptions/({UUID})/resourceGroups/{RG}/providers/Microsoft\.KeyVault/vaults/{VAULT}$",re.I)
OID_RE=re.compile(rf"^{UUID}$",re.I)
ROOT="https://management.azure.com"

class Stop(Exception):
    pass

def az(*args):
    try:
        result=subprocess.run(["az",*args],capture_output=True,text=True,timeout=45)
    except (OSError,subprocess.TimeoutExpired):
        raise Stop("AZURE_CLI_UNAVAILABLE")
    if result.returncode:
        msg=(result.stderr+result.stdout).lower()
        if "authorizationfailed" in msg or "403" in msg or "forbidden" in msg:
            raise Stop("AZURE_RBAC_DENIED")
        if "az login" in msg or "expired" in msg or "401" in msg:
            raise Stop("AZURE_LOGIN_REQUIRED")
        raise Stop("AZURE_REQUEST_FAILED")
    return result.stdout.strip()

def arm(method,path,body=None):
    args=["rest","--method",method.lower(),"--url",ROOT+path,"--only-show-errors","-o","json"]
    if body is not None:
        args+=["--body",json.dumps(body,separators=(",",":"))]
    out=az(*args)
    if not out and method.upper()=="DELETE":
        return {}
    try:
        data=json.loads(out)
        if not isinstance(data,dict): raise ValueError("nonobject")
        return data
    except ValueError:
        raise Stop("ARM_RESPONSE_INVALID")

def prepare():
    if az("account","show","--query","name","-o","tsv")!="Azure for Students":
        raise Stop("WRONG_SUBSCRIPTION")
    if az("account","show","--query","user.type","-o","tsv")!="user":
        raise Stop("NOT_SIGNED_IN_USER")
    if az("group","show","-n",RG,"--query","location","-o","tsv")!="malaysiawest":
        raise Stop("WRONG_REGION")
    for query,expected,code in (
        ("properties.enableRbacAuthorization","true","VAULT_NOT_RBAC"),
        ("properties.enablePurgeProtection","true","VAULT_NOT_PURGE_PROTECTED"),
        ("location","malaysiawest","VAULT_NOT_MALAYSIA_WEST"),
    ):
        if az("keyvault","show","-g",RG,"-n",VAULT,"--query",query,"-o","tsv")!=expected:
            raise Stop(code)
    scope=az("keyvault","show","-g",RG,"-n",VAULT,"--query","id","-o","tsv")
    m=ID_RE.fullmatch(scope)
    if not m: raise Stop("VAULT_SCOPE_UNEXPECTED")
    subject=az("ad","signed-in-user","show","--query","id","-o","tsv").lower()
    if not OID_RE.fullmatch(subject): raise Stop("OPERATOR_PRINCIPAL_UNVERIFIED")
    sub=m.group(1).lower()
    role_id=f"/subscriptions/{sub}/providers/Microsoft.Authorization/roleDefinitions/{ROLE_GUID}"
    name=str(uuid.uuid5(uuid.NAMESPACE_URL,"campuspool:temp-kv-secrets-officer:"+scope.lower()+":"+subject))
    resource=f"{scope}/providers/Microsoft.Authorization/roleAssignments/{name}"
    data=arm("GET",scope+"/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&%24filter="+quote("atScope()",safe="()"))
    if data.get("nextLink"): raise Stop("ROLE_ASSIGNMENTS_PAGINATED")
    items=data.get("value")
    if not isinstance(items,list): raise Stop("ASSIGNMENTS_UNVERIFIED")
    ours=None
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get("properties"),dict):
            raise Stop("ASSIGNMENT_RESPONSE_INVALID")
        props=item["properties"]
        if str(props.get("principalId","")).lower()!=subject: continue
        if str(props.get("roleDefinitionId","")).lower().endswith("/"+ROLE_GUID):
            if str(item.get("id","")).lower()==resource.lower() and str(props.get("scope","")).lower()==scope.lower():
                if ours is not None: raise Stop("DUPLICATE_MANAGED_ASSIGNMENT")
                ours=item
            else:
                raise Stop("UNMANAGED_SECRET_WRITER_ROLE_REVIEW_REQUIRED")
    return scope,subject,role_id,resource,ours

def confirm(phrase):
    try:
        value=input("Type "+phrase+" to authorize exact operation: ").strip()
    except EOFError:
        value=""
    if value!=phrase: raise Stop("OWNER_CONFIRMATION_REQUIRED")

def check_assignment(item,scope,subject,resource):
    props=item.get("properties")
    if not isinstance(props,dict) or str(item.get("id","")).lower()!=resource.lower() or \
       str(props.get("scope","")).lower()!=scope.lower() or \
       str(props.get("principalId","")).lower()!=subject or \
       not str(props.get("roleDefinitionId","")).lower().endswith("/"+ROLE_GUID):
        raise Stop("ROLE_ASSIGNMENT_RESPONSE_MISMATCH_REVIEW_PRIVATELY")

def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("--plan","--grant","--revoke"):
        raise Stop("USAGE_PLAN_GRANT_REVOKE")
    mode=sys.argv[1]
    scope,subject,role,resource,existing=prepare()
    print("AZURE_STUDENT_VAULT_SCOPE_VERIFIED=YES")
    print("TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT="+("YES" if existing is not None else "NO"))
    print("ROLE_TO_MANAGE=KEY_VAULT_SECRETS_OFFICER_VAULT_SCOPE_ONLY")
    print("ROLE_CAPABILITIES=ALL_VAULT_SECRET_OPERATIONS_UNTIL_REVOKED")
    print("ASSIGNMENT_AUTOMATIC_EXPIRY=NO")
    if mode=="--plan":
        print("OWNER_ACTION=PLAN_ONLY_NO_AZURE_WRITES")
        print("ROLE_PLAN_COMPLETE=YES")
        return
    if mode=="--grant":
        if existing is not None:
            print("TEMP_SECRET_WRITER_ALREADY_PRESENT_NO_CHANGE=YES")
            return
        print("WARNING=ROLE_CAN_READ_AND_MODIFY_ALL_SECRETS_IN_THIS_VAULT")
        print("WARNING=NO_AUTOMATIC_EXPIRY_REVOKE_AFTER_SECRET_IMPORT")
        confirm("GRANT_CAMPUSPOOL_TEMP_SECRET_WRITER")
        reply=arm("PUT",resource+"?api-version=2022-04-01",{
            "properties":{"roleDefinitionId":role,"principalId":subject,"principalType":"User"}
        })
        check_assignment(reply,scope,subject,resource)
        print("TEMP_SECRET_WRITER_GRANT_ACCEPTED=YES")
        print("ACCESS_PROPAGATION_UNVERIFIED_RECHECK_BEFORE_IMPORT=YES")
        print("NEXT_AFTER_IMPORT=RUN_REVOKE_AND_VERIFY_NO_ASSIGNMENT")
        return
    if existing is None:
        print("TEMP_SECRET_WRITER_ALREADY_ABSENT_NO_CHANGE=YES")
        return
    check_assignment(existing,scope,subject,resource)
    confirm("REVOKE_CAMPUSPOOL_TEMP_SECRET_WRITER")
    arm("DELETE",resource+"?api-version=2022-04-01")
    *_,current=prepare()
    if current is not None:
        raise Stop("REVOKE_NOT_YET_VISIBLE_RECHECK_WITH_PLAN")
    print("TEMP_SECRET_WRITER_REVOKED_AND_READBACK_VERIFIED=YES")
    print("NO_SECRET_VALUES_TOKENS_OR_DATABASE_ACCESSED=YES")

if __name__=="__main__":
    try:
        main()
    except Stop as exc:
        print("STOP_"+str(exc))
        sys.exit(3)
