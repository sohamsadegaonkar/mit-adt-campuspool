#!/usr/bin/env python3
"""Safe read-only Azure diagnosis after an ambiguous GHCR proof job PUT.

Only existing job presence, selected non-secret ARM metadata and recent Activity
Log job-write statuses/codes. No raw events, correlation IDs, paths, user info,
error messages, Key Vault values, job secrets, writes or job starts.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "ghcr_job", HERE/"azure-ghcr-pull-proof-job-operator.py")
job=importlib.util.module_from_spec(spec)
spec.loader.exec_module(job)

class Stop(Exception):pass
MAX_ACTIVITY_EVENTS=50
SAFE_STATES={"Succeeded","Failed","Canceled","Cancelled","InProgress",
             "Creating","Updating","Deleting","Accepted","Pending"}
SAFE_TRIGGER={"Manual","Event","Schedule"}
SAFE_ACTIVITY_STATUS={"Started","Succeeded","Failed","Accepted"}
SAFE_SUBSTATUS={"OK","Created","Accepted","BadRequest","Forbidden","Unauthorized",
                "Conflict","TooManyRequests","InternalServerError",
                "ServiceUnavailable","GatewayTimeout","NoContent"}
CLASSIFIERS=(
 ("AZURE_JOB_KEY_VAULT_REFERENCE_FETCH","unable to get value using managed identity"),
 ("AZURE_JOB_KEY_VAULT_REFERENCE_FETCH","unable to fetch secret"),
 ("AZURE_JOB_INVALID_CONTAINER_TEMPLATE","invalidparametervalueincontainertemplate"),
 ("AZURE_JOB_AUTHORIZATION_DENIED","authorizationfailed"),
 ("AZURE_JOB_MANAGED_IDENTITY_DENIED","managedidentitynotconfigured"),
 ("AZURE_JOB_REGISTRY_AUTH_FAILURE","unauthorized"),
 ("AZURE_JOB_PROVIDER_NOT_REGISTERED","missingsubscriptionregistration"),
 ("AZURE_JOB_QUOTA_DENIED","quotaexceeded"),
 ("AZURE_JOB_IMAGE_PULL_FAILURE","imagepullbackoff"),
 ("AZURE_JOB_API_VERSION_UNSUPPORTED","invalidapiversionparameter"),
 ("AZURE_JOB_CONFLICT","anotheroperationinprogress"),
)

def read_az(*args):
    try:return job.az(*args)
    except (job.Stop,job.plan.Stop) as exc:
        raise Stop("AZURE_READ_DENIED_OR_UNAVAILABLE")

def activity_classification(properties):
    if not isinstance(properties,dict):
        return "NOT_AVAILABLE"
    try:
        detail=json.dumps(properties,ensure_ascii=True).casefold()
    except (ValueError,TypeError):
        return "NOT_AVAILABLE"
    for name,needle in CLASSIFIERS:
        if needle in detail:
            return name
    return "NOT_CLASSIFIED"

# Strictly bounded structural metadata for cases where the Activity Log contains
# a generic BadRequest but no recognized explanation. Never relay provider text.
SAFE_PROVIDER_ERROR_CODES={
    "BadRequest":"GENERIC_BAD_REQUEST",
    "InvalidParameter":"INVALID_PARAMETER",
    "InvalidParameterValue":"INVALID_PARAMETER",
    "InvalidResource":"INVALID_RESOURCE",
    "InvalidTemplate":"INVALID_TEMPLATE",
    "InvalidTemplateDeployment":"INVALID_TEMPLATE",
    "InvalidRequestContent":"INVALID_REQUEST_CONTENT",
    "UnsupportedApiVersion":"UNSUPPORTED_API_VERSION",
    "InvalidApiVersionParameter":"UNSUPPORTED_API_VERSION",
    "AuthorizationFailed":"AUTHORIZATION",
    "ResourceNotFound":"RESOURCE_NOT_FOUND",
    "ContainerAppOperationError":"GENERIC_CONTAINER_APP_ERROR",
    "ManagedIdentityNotConfigured":"MANAGED_IDENTITY",
    "MissingSubscriptionRegistration":"PROVIDER_NOT_REGISTERED",
    "QuotaExceeded":"QUOTA",
}

# Azure's machine-readable error.code is usually a static symbolic identifier.
# When our fixed taxonomy misses it, disclose ONLY a tightly validated symbol,
# never error.message, property paths, JSON objects, runtime IDs or arbitrary text.
# Reject the whole value if it looks remotely like credential/user metadata.
SAFE_SYMBOL_PATTERN=re.compile(r"^[A-Z][A-Za-z0-9]{2,63}$")
SAFE_SYMBOL_PREFIXES=(
    "Invalid", "ContainerApp", "ContainerApps", "ManagedEnvironment",
    "ManagedIdentity", "Resource", "Deployment", "Authorization",
    "Operation", "Registry", "KeyVault", "Quota", "Unsupported",
    "Missing", "Environment", "Subscription", "Job", "BadRequest",
)
SENSITIVE_SYMBOL_FRAGMENTS=(
    "ghp", "github_pat", "token", "password", "credential", "bearer",
    "connectionstring", "secretvalue", "privatekey", "apikey",
    "accesskey", "sas", "email", "principalid", "tenantid", "userid",
)
def safe_error_symbol(code):
    if not isinstance(code,str) or not SAFE_SYMBOL_PATTERN.fullmatch(code):
        return "SUPPRESSED"
    if not code.startswith(SAFE_SYMBOL_PREFIXES):
        return "SUPPRESSED"
    lower=code.casefold()
    if any(part in lower for part in SENSITIVE_SYMBOL_FRAGMENTS):
        return "SUPPRESSED"
    return code

def safe_error_symbol_from_properties(properties):
    if not isinstance(properties,dict):
        return "SUPPRESSED"
    raw=properties.get("statusMessage")
    try:
        parsed=json.loads(raw) if isinstance(raw,str) else raw
    except (ValueError,TypeError):
        return "SUPPRESSED"
    if not isinstance(parsed,dict):
        return "SUPPRESSED"
    err=parsed.get("error")
    if not isinstance(err,dict): err=parsed
    return safe_error_symbol(err.get("code"))

def safe_error_detail(properties):
    """Return only fixed safe enum values; no provider message, IDs or tokens."""
    if not isinstance(properties,dict):
        return "NO_PROPERTIES","NO_CODE"
    message=properties.get("statusMessage")
    if message is None:
        return "ABSENT","NO_CODE"
    parsed=message
    if isinstance(message,str):
        try: parsed=json.loads(message)
        except (ValueError,TypeError): return "TEXT","NO_CODE"
    if not isinstance(parsed,dict):
        return "OTHER","NO_CODE"
    error=parsed.get("error")
    if not isinstance(error,dict): error=parsed
    code=error.get("code")
    if not isinstance(code,str):
        return "JSON_OBJECT","NO_CODE"
    return "JSON_OBJECT",SAFE_PROVIDER_ERROR_CODES.get(code,"UNRECOGNIZED_CODE")

def main():
    if sys.argv[1:]!=["--inspect"]:
        raise Stop("USAGE_INSPECT_ONLY")
    try:
        vault,secret,principal,role,assignment=job.plan.operator.check_context()
        permitted=job.plan.operator.assignment_status(vault,secret,principal,role,assignment)
    except (job.plan.operator.Stop,job.plan.operator.preflight.Stop) as exc:
        raise Stop("GHCR_IDENTITY_PRECHECK_FAILED")
    if not permitted:raise Stop("GHCR_SECRET_ONLY_ROLE_MISSING")
    sub=vault.split("/")[2]
    job_resource=job.job_id(sub)
    if not job.plan.operator.preflight.RE_VAULT.fullmatch(vault):
        raise Stop("WRONG_VAULT_SCOPE")
    try:
        entries=job.job_inventory()
    except (job.Stop,job.plan.Stop):
        raise Stop("JOB_INVENTORY_UNAVAILABLE")
    existing=[e for e in entries if e.get("name","").casefold()==job.JOB]
    if len(existing)>1:raise Stop("DUPLICATE_JOBS_INVENTORY_UNEXPECTED")
    if existing:
        info_raw=read_az("containerapp","job","show","-g",job.RG,
            "-n",job.JOB,"--query",
            "{name:name,state:properties.provisioningState,trigger:properties.configuration.triggerType}",
            "-o","json")
        try:
            info=json.loads(info_raw)
            if not isinstance(info,dict) or info.get("name")!=job.JOB:
                raise ValueError("wrong resource")
            state=info.get("state")
            trigger=info.get("trigger")
            if state not in SAFE_STATES or trigger not in SAFE_TRIGGER:
                raise ValueError("unexpected status")
        except (ValueError,TypeError):
            raise Stop("JOB_METADATA_REQUIRES_PRIVATE_REVIEW")
        print("GHCR_PULL_PROOF_JOB_EXISTS=YES")
        print("GHCR_PULL_PROOF_JOB_PROVISIONING_STATE="+state.upper())
        print("GHCR_PULL_PROOF_JOB_TRIGGER="+trigger.upper())
        print("NEXT=RUN_GUARDED_VERIFY_NO_CREATE_RETRY")
    else:
        print("GHCR_PULL_PROOF_JOB_EXISTS=NO")
        print("NEXT=REVIEW_ACTIVITY_ERROR_BEFORE_ANY_RETRY")
    raw=read_az("monitor","activity-log","list",
                "--resource-id",job_resource,"--offset","24h",
                "--max-events",str(MAX_ACTIVITY_EVENTS),
                "--only-show-errors","-o","json")
    try:
        events=json.loads(raw)
        if not isinstance(events,list):raise ValueError("event list required")
        if len(events)>MAX_ACTIVITY_EVENTS:raise ValueError("unexpected length")
    except (ValueError,TypeError):
        raise Stop("ACTIVITY_LOG_RESPONSE_INVALID")
    matched=[]
    for e in events:
        if not isinstance(e,dict):raise Stop("ACTIVITY_LOG_ENTRY_INVALID")
        resource=e.get("resourceId","")
        operation=e.get("operationName",{})
        if not isinstance(operation,dict):raise Stop("ACTIVITY_LOG_OPERATION_INVALID")
        if str(resource).casefold()!=job_resource.casefold() or \
           str(operation.get("value","")).casefold()!="microsoft.app/jobs/write":
            continue
        stat=e.get("status") or {}
        substat=e.get("subStatus") or {}
        if not isinstance(stat,dict) or not isinstance(substat,dict):
            raise Stop("ACTIVITY_LOG_STATUS_INVALID")
        status=stat.get("value","")
        substatus=substat.get("value","")
        if status not in SAFE_ACTIVITY_STATUS:status="OTHER"
        if substatus not in SAFE_SUBSTATUS:substatus="OTHER"
        classification=activity_classification(e.get("properties",{}))
        detail_shape,provider_code=safe_error_detail(e.get("properties",{}))
        symbol=safe_error_symbol_from_properties(e.get("properties",{}))
        matched.append((status,substatus,classification,detail_shape,provider_code,symbol))
    print("RECENT_PROOF_JOB_WRITE_EVENTS="+str(len(matched)))
    if len(matched)==0:
        print("ACTIVITY_LOG_CAUSE=NOT_YET_AVAILABLE")
    else:
        # Never relay raw Azure event contents or correlation IDs.
        for i,(status,substatus,reason,detail_shape,provider_code,symbol) in enumerate(matched[:5],1):
            print(f"WRITE_EVENT_{i}_STATUS="+status.upper())
            print(f"WRITE_EVENT_{i}_SUBSTATUS="+substatus.upper())
            print(f"WRITE_EVENT_{i}_CLASSIFICATION="+reason)
            print(f"WRITE_EVENT_{i}_DETAIL_SHAPE="+detail_shape)
            print(f"WRITE_EVENT_{i}_PROVIDER_ERROR_CODE_CATEGORY="+provider_code)
            print(f"WRITE_EVENT_{i}_SAFE_PROVIDER_ERROR_SYMBOL="+symbol)
    print("RAW_AZURE_ERRORS_SECRET_VALUES_IDS_AND_TOKENS_PRINTED=NO")
    print("NO_AZURE_WRITE_OR_JOB_START=YES")
    print("GHCR_PULL_PROOF_CREATE_FAILURE_DIAGNOSTIC_COMPLETE=YES")
    print("NEXT=DO_NOT_RETRY_CREATE_UNTIL_PRESENCE_AND_CAUSE_REVIEWED")

if __name__=="__main__":
    try:main()
    except Stop as error:
        print("STOP_"+str(error))
        sys.exit(3)
