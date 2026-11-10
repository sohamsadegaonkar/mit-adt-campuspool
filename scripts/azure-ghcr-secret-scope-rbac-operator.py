#!/usr/bin/env python3
"""CampusPool: explicit GHCR-token-secret-only Azure IAM grant / verify / revoke.

The target identity can read only this one Key Vault secret via this assignment.
Never read/print secret values, IDs, role payloads, or raw Azure errors.
Exact-role proof is NOT proof of effective Azure permissions or private GHCR pull.
"""
import importlib.util
import json
import re
import sys
import uuid
from pathlib import Path

SKILL=Path(__file__).resolve().parent/"azure-ghcr-secret-scope-rbac-plan.py"
spec=importlib.util.spec_from_file_location("ghcr_scope_plan",SKILL)
preflight=importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

class Stop(Exception): pass
ROLE_GUID=preflight.SECRET_ROLE_GUID
ASSIGN_API="2022-04-01"
CONFIRM_GRANT="GRANT_GHCR_TOKEN_SECRET_ONLY_TO_CAMPUSPOOL_UAI"
CONFIRM_REVOKE="REVOKE_GHCR_TOKEN_SECRET_ONLY_FROM_CAMPUSPOOL_UAI"

def check_context():
    p=preflight
    if p.az("account","show","--query","name","-o","tsv")!=p.EXPECTED_SUB:
        raise Stop("WRONG_SUBSCRIPTION")
    if p.az("group","show","-n",p.RG,"--query","location","-o","tsv")!="malaysiawest":
        raise Stop("WRONG_RESOURCE_GROUP")
    vault=p.az("keyvault","show","-g",p.RG,"-n",p.VAULT,"--query","id","-o","tsv")
    match=p.RE_VAULT.fullmatch(vault)
    if not match: raise Stop("VAULT_SCOPE_INVALID")
    if p.az("keyvault","show","-g",p.RG,"-n",p.VAULT,
            "--query","properties.enableRbacAuthorization","-o","tsv")!="true":
        raise Stop("VAULT_RBAC_DISABLED")
    principal=p.az("identity","show","-g",p.RG,"-n",p.UAI,"--query","principalId","-o","tsv").lower()
    if not p.RE_UUID.fullmatch(principal): raise Stop("UAI_PRINCIPAL_INVALID")
    secret_id=vault+"/secrets/"+p.SECRET
    secret=p.arm_read(secret_id+"?api-version=2024-11-01")
    if str(secret.get("id","")).casefold()!=secret_id.casefold():
        raise Stop("GHCR_SECRET_METADATA_MISSING")
    props=secret.get("properties")
    if not isinstance(props,dict) or "value" in props:
        raise Stop("SECRET_METADATA_RESPONSE_INVALID")
    attr=props.get("attributes")
    if not isinstance(attr,dict) or attr.get("enabled") is not True:
        raise Stop("GHCR_SECRET_NOT_ENABLED")
    role_id=f"/subscriptions/{match.group(1).lower()}/providers/Microsoft.Authorization/roleDefinitions/{ROLE_GUID}"
    assignment_name=str(uuid.uuid5(uuid.NAMESPACE_URL,
        "campuspool:ghcr-secret-reader:"+secret_id.casefold()+":"+principal+":"+ROLE_GUID))
    assignment_id=secret_id+"/providers/Microsoft.Authorization/roleAssignments/"+assignment_name
    return vault,secret_id,principal,role_id,assignment_id

def check_assignment(item,principal,role,scope,resource):
    if not isinstance(item,dict) or not isinstance(item.get("properties"),dict):
        raise Stop("ROLE_ASSIGNMENT_RESPONSE_INVALID")
    props=item["properties"]
    if str(item.get("id","")).casefold()!=resource.casefold() or \
       str(props.get("principalId","")).casefold()!=principal or \
       str(props.get("roleDefinitionId","")).casefold()!=role.casefold() or \
       str(props.get("scope","")).casefold()!=scope.casefold() or \
       props.get("condition") is not None:
        raise Stop("EXACT_ROLE_ASSIGNMENT_MISMATCH_REVIEW")
    return True

def assignment_status(vault,scope,principal,role,resource):
    # Includes inherited roles in both queries. Repeated matching assignment
    # is deduplicated by id; unexpected UAI roles trigger fail-closed.
    matches={}
    for location in (vault,scope):
        for item in preflight.assignments(location):
            if not isinstance(item,dict) or not isinstance(item.get("properties"),dict):
                raise Stop("ROLE_ASSIGNMENT_ENTRY_INVALID")
            props=item["properties"]
            if str(props.get("principalId","")).casefold()!=principal:
                continue
            assignment_id=str(item.get("id","")).casefold()
            if assignment_id in matches:
                continue
            if assignment_id!=resource.casefold():
                raise Stop("UNEXPECTED_UAI_ROLE_ASSIGNMENT_REVIEW")
            check_assignment(item,principal,role,scope,resource)
            matches[assignment_id]=item
    if len(matches)>1: raise Stop("DUPLICATE_ROLE_ASSIGNMENT_REVIEW")
    return bool(matches)

def arm_mutation(method,resource,payload=None):
    if method not in ("PUT","DELETE"):raise Stop("OPERATION_NOT_ALLOWED")
    args=["rest","--method",method.lower(),"--url",
          preflight.ARM+resource+"?api-version="+ASSIGN_API,
          "--only-show-errors","-o","json"]
    if payload is not None:
        if method!="PUT":raise Stop("BODY_NOT_ALLOWED")
        args+=["--body",json.dumps(payload,separators=(",",":"))]
    try:
        out=preflight.az(*args)
    except preflight.Stop:
        raise Stop("AZURE_RBAC_WRITE_DENIED_OR_FAILED")
    if not out and method=="DELETE":return {}
    try:
        result=json.loads(out)
        if not isinstance(result,dict):raise ValueError("non-object")
    except (TypeError,ValueError):
        raise Stop("ARM_ROLE_MUTATION_RESPONSE_INVALID")
    return result

def require(phrase):
    try: value=input("Type "+phrase+" to authorize this Azure IAM change: ").strip()
    except EOFError: value=""
    if value!=phrase:raise Stop("EXPLICIT_OWNER_CONFIRMATION_REQUIRED")

def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("--plan","--grant","--verify","--revoke"):
        raise Stop("USAGE_EXPECT_PLAN_GRANT_VERIFY_OR_REVOKE")
    action=sys.argv[1]
    try:
        vault,scope,principal,role,resource=check_context()
        existing=assignment_status(vault,scope,principal,role,resource)
    except preflight.Stop as exc:
        # Use fixed markers without printing raw ARM objects or IDs.
        raise Stop(str(exc))
    print("AZURE_STUDENT_AND_GHCR_SECRET_METADATA_VERIFIED=YES")
    print("IDENTITY=campuspool-ghcr-vault-reader")
    print("ROLE=KEY_VAULT_SECRETS_USER")
    print("ASSIGNMENT_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY")
    print("TARGET_ASSIGNMENT_PRESENT="+("YES" if existing else "NO"))
    print("INHERITED_DIRECT_UAI_ROLES_CHECKED=YES")
    print("GROUP_PIM_DENY_CUSTOM_AND_EFFECTIVE_ACCESS_NOT_PROVEN=YES")
    print("NO_SECRET_VALUES_OR_DATABASE_CREDENTIALS_READ=YES")
    if action=="--plan":
        print("NO_AZURE_CHANGES=YES")
        print("GHCR_SECRET_READER_PLAN_COMPLETE=YES")
        return
    if action=="--verify":
        if not existing:raise Stop("GHCR_SECRET_READER_ASSIGNMENT_NOT_FOUND")
        print("GHCR_SECRET_ONLY_UAI_ROLE_ASSIGNMENT_VERIFIED=YES")
        print("NO_AZURE_CHANGES=YES")
        print("PRIVATE_GHCR_PULL_NOT_TESTED=YES")
        return
    if action=="--grant":
        if existing:
            print("GHCR_SECRET_READER_ALREADY_PRESENT_NO_CHANGE=YES")
            return
        print("WARNING=ROLE_READS_GHCR_TOKEN_SECRET_CONTENTS")
        print("WARNING=ASSIGNMENT_PERSISTENT_UNTIL_REVOKED")
        require(CONFIRM_GRANT)
        result=arm_mutation("PUT",resource,{"properties":{
            "roleDefinitionId":role,
            "principalId":principal,
            "principalType":"ServicePrincipal",
        }})
        check_assignment(result,principal,role,scope,resource)
        try:
            confirmed=assignment_status(vault,scope,principal,role,resource)
        except (Stop,preflight.Stop):
            raise Stop("GRANT_ACCEPTED_BUT_READBACK_UNVERIFIED_REVIEW")
        if not confirmed:raise Stop("GRANT_ACCEPTED_BUT_READBACK_NOT_YET_VISIBLE")
        print("GHCR_SECRET_ONLY_READER_ROLE_GRANTED_AND_READBACK_VERIFIED=YES")
        print("ACTUAL_GHCR_PULL_NOT_VERIFIED=YES")
        return
    if not existing:
        print("GHCR_SECRET_READER_ALREADY_ABSENT_NO_CHANGE=YES")
        return
    print("WARNING=REVOKE_REMOVES_GHCR_TOKEN_READ_FROM_UAI")
    require(CONFIRM_REVOKE)
    arm_mutation("DELETE",resource)
    try:
        still=assignment_status(vault,scope,principal,role,resource)
    except (Stop,preflight.Stop):
        raise Stop("REVOKE_READBACK_FAILED_REVIEW")
    if still:raise Stop("REVOKE_NOT_YET_VISIBLE_RECHECK")
    print("GHCR_SECRET_ONLY_READER_ROLE_REVOKED_AND_VERIFIED=YES")
    print("NO_GHCR_SECRET_DELETED_OR_READ=YES")

if __name__=="__main__":
    try: main()
    except Stop as exc:
        print("STOP_"+str(exc))
        sys.exit(3)
