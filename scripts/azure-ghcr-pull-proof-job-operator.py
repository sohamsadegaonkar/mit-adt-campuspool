#!/usr/bin/env python3
"""Owner-gated Azure Container Apps *manual* GHCR-only image-pull proof job.

--plan: pure read-only (delegates to the previously tested proof preflight).
--create: exact new job only, no starts, no tokens, no DB/Blob credentials.
--verify: read-only verify exact job configuration and zero job executions.
--delete: owner-confirmed removal of verified proof job only.

IMPORTANT: someone with jobs/start/action can override a job's template to
exfiltrate job-accessible secrets. Limit Start permissions accordingly.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("ghcr_pull_plan",
    HERE/"azure-ghcr-pull-proof-readonly-plan.py")
plan=importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)

RG=plan.RG
JOB=plan.TEST_JOB
API="2026-01-01"
REST=plan.operator.preflight.ARM
LOCATION="malaysiawest"
IMAGE=plan.EXPECTED_IMAGE
COMMAND=["node","-e"]
ARGS=["process.stdout.write('GHCR_PRIVATE_IMAGE_PULL_SMOKE_PASS\\n')"]
GHCR_SERVER="ghcr.io"
SECRET="ghcr-pull-token"
VAULT_URL="https://campuspool-backup-kv-01.vault.azure.net/secrets/ghcr-pull-token"
CONFIRM_CREATE="CREATE_MANUAL_GHCR_PULL_PROOF_JOB_NO_START"
CONFIRM_DELETE="DELETE_ONLY_CAMPUSPOOL_GHCR_PULL_PROOF_JOB"
GITHUB_USERNAME=re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
class Stop(Exception):pass

def az(*args):
    try:return plan.az(*args)
    except plan.Stop as err:raise Stop(str(err))

def trusted_resources():
    try:
        vault,secret,principal,role,assignment=plan.operator.check_context()
        present=plan.operator.assignment_status(vault,secret,principal,role,assignment)
    except (plan.operator.Stop,plan.operator.preflight.Stop) as err:
        raise Stop("GHCR_IDENTITY_SCOPE_VERIFY_"+str(err))
    if not present: raise Stop("GHCR_TOKEN_SECRET_ONLY_ROLE_MISSING")
    uai=az("identity","show","-g",RG,"-n",plan.MANAGED_IDENTITY,
           "--query","id","-o","tsv")
    im=plan.IDENT_RE.fullmatch(uai)
    if not im or im.group(1).lower()!=vault.split("/")[2].lower():
        raise Stop("UAI_RESOURCE_CHANGED")
    env=az("containerapp","env","show","-g",RG,"-n",plan.ENVIRONMENT,
           "--query","id","-o","tsv")
    em=plan.ENV_RE.fullmatch(env)
    if not em or em.group(1).lower()!=im.group(1).lower():
        raise Stop("ENVIRONMENT_RESOURCE_CHANGED")
    region=az("containerapp","env","show","-g",RG,"-n",plan.ENVIRONMENT,
              "--query","location","-o","tsv")
    state=az("containerapp","env","show","-g",RG,"-n",plan.ENVIRONMENT,
              "--query","properties.provisioningState","-o","tsv")
    if re.sub(r"\s+","",region).casefold()!=LOCATION or state.casefold()!="succeeded":
        raise Stop("ENVIRONMENT_NOT_READY")
    return uai,env,im.group(1)

def job_id(sub):
    return f"/subscriptions/{sub}/resourceGroups/{RG}/providers/Microsoft.App/jobs/{JOB}"

def job_inventory():
    raw=az("containerapp","job","list","-g",RG,"-o","json")
    try:
        data=json.loads(raw)
        if not isinstance(data,list) or any(not isinstance(x,dict) or
                not isinstance(x.get("name"),str) for x in data):
            raise ValueError("invalid")
        return data
    except (TypeError,ValueError):
        raise Stop("JOB_INVENTORY_INVALID")

def job_resource(method,path,body=None):
    if method not in ("get","put","delete"):
        raise Stop("UNSUPPORTED_JOB_OPERATION")
    args=["rest","--method",method,"--url",REST+path+"?api-version="+API,
          "--only-show-errors","-o","json"]
    if body is not None:
        if method!="put":raise Stop("UNEXPECTED_JOB_REST_BODY")
        args+=["--body",json.dumps(body,separators=(",",":"))]
    output=az(*args)
    if not output and method in ("delete","put"):
        return {}
    try:
        data=json.loads(output)
        if not isinstance(data,dict):raise ValueError("object required")
        return data
    except (TypeError,ValueError):
        raise Stop("JOB_REST_RESPONSE_INVALID")

def assemble(uai,env,username):
    if not GITHUB_USERNAME.fullmatch(username) or "--" in username:
        raise Stop("GITHUB_USERNAME_INVALID")
    return {
        "location":LOCATION,
        "identity":{"type":"UserAssigned","userAssignedIdentities":{uai:{}}},
        "tags":{"project":"campuspool","purpose":"ghcr-pull-proof-only",
                "stage":"staging","no-database":"true","manual":"true"},
        "properties":{
            "environmentId":env,
            "workloadProfileName":"Consumption",
            "configuration":{
                "triggerType":"Manual",
                "manualTriggerConfig":{"parallelism":1,"replicaCompletionCount":1},
                "replicaTimeout":120,
                "replicaRetryLimit":0,
                "registries":[{
                    "server":GHCR_SERVER,
                    "username":username,
                    "passwordSecretRef":SECRET
                }],
                "secrets":[{
                    "name":SECRET,
                    "keyVaultUrl":VAULT_URL,
                    "identity":uai
                }]
            },
            "template":{
                "containers":[{
                    "name":"pull-proof",
                    "image":IMAGE,
                    "command":COMMAND,
                    "args":ARGS,
                    "resources":{"cpu":0.25,"memory":"0.5Gi"},
                    "env":[],
                }],
                "initContainers":[],
                "volumes":[]
            }
        }
    }

def verify_document(doc,uai,env,sub):
    if not isinstance(doc,dict) or str(doc.get("id","")).casefold()!=job_id(sub).casefold():
        raise Stop("WRONG_JOB_ID")
    if str(doc.get("location","")).casefold()!=LOCATION:
        raise Stop("WRONG_JOB_LOCATION")
    ident=doc.get("identity",{})
    if not isinstance(ident,dict) or ident.get("type")!="UserAssigned" or \
       list((ident.get("userAssignedIdentities") or {}).keys())!=[uai]:
        raise Stop("WRONG_JOB_IDENTITY")
    props=doc.get("properties",{})
    if not isinstance(props,dict) or str(props.get("environmentId","")).casefold()!=env.casefold():
        raise Stop("WRONG_JOB_ENVIRONMENT")
    if props.get("workloadProfileName") not in (None,"Consumption"):
        raise Stop("WRONG_JOB_WORKLOAD_PROFILE")
    config=props.get("configuration",{})
    if not isinstance(config,dict) or config.get("triggerType")!="Manual":
        raise Stop("WRONG_JOB_TRIGGER")
    if config.get("scheduleTriggerConfig") or config.get("eventTriggerConfig"):
        raise Stop("JOB_AUTOMATIC_TRIGGERS_FOUND")
    manual=config.get("manualTriggerConfig",{})
    if not isinstance(manual,dict) or manual.get("parallelism")!=1 or \
       manual.get("replicaCompletionCount")!=1 or \
       config.get("replicaTimeout")!=120 or config.get("replicaRetryLimit")!=0:
        raise Stop("JOB_REPLICA_GUARDS_MISMATCH")
    secrets=config.get("secrets")
    if not isinstance(secrets,list) or len(secrets)!=1 or not isinstance(secrets[0],dict):
        raise Stop("JOB_SECRETS_NOT_EXACTLY_ONE")
    if secrets[0].get("name")!=SECRET or secrets[0].get("keyVaultUrl")!=VAULT_URL or \
       secrets[0].get("identity")!=uai or "value" in secrets[0]:
        raise Stop("JOB_GHCR_SECRET_REFERENCE_INVALID")
    registries=config.get("registries")
    if not isinstance(registries,list) or len(registries)!=1 or not isinstance(registries[0],dict):
        raise Stop("JOB_PRIVATE_REGISTRY_INVALID")
    r=registries[0]
    username=r.get("username","")
    if r.get("server")!=GHCR_SERVER or r.get("passwordSecretRef")!=SECRET or \
       r.get("identity") not in (None,"") or \
       not isinstance(username,str) or not GITHUB_USERNAME.fullmatch(username) or \
       "--" in username:
        raise Stop("JOB_REGISTRY_AUTH_METADATA_INVALID")
    template=props.get("template",{})
    if not isinstance(template,dict) or template.get("initContainers") not in ([],None) or \
       template.get("volumes") not in ([],None):
        raise Stop("JOB_UNEXPECTED_INIT_OR_VOLUME")
    containers=template.get("containers")
    if not isinstance(containers,list) or len(containers)!=1 or \
       not isinstance(containers[0],dict):
        raise Stop("JOB_CONTAINER_INVENTORY_INVALID")
    c=containers[0]
    resources=c.get("resources",{})
    if c.get("name")!="pull-proof" or c.get("image")!=IMAGE or \
       c.get("command")!=COMMAND or c.get("args")!=ARGS or \
       c.get("env") not in ([],None) or \
       not isinstance(resources,dict) or resources.get("cpu")!=0.25 or \
       resources.get("memory")!="0.5Gi":
        raise Stop("JOB_NON_DATABASE_SMOKE_CONFIG_CHANGED")
    tags=doc.get("tags",{})
    if not isinstance(tags,dict) or tags.get("purpose")!="ghcr-pull-proof-only" or \
       tags.get("manual")!="true":
        raise Stop("JOB_GUARD_TAGS_MISSING")
    return True

def execution_count():
    raw=az("containerapp","job","execution","list","-n",JOB,"-g",RG,"-o","json")
    try:
        entries=json.loads(raw)
        if not isinstance(entries,list):raise ValueError("nonlist")
        return len(entries)
    except (ValueError,TypeError):
        raise Stop("JOB_EXECUTIONS_UNVERIFIED")

def confirm(text):
    try:response=input("Type "+text+" to authorize exact Azure operation: ").strip()
    except EOFError:response=""
    if response!=text:raise Stop("OWNER_CONFIRMATION_REQUIRED")

def read_username():
    try: username=input("GitHub username that owns the *already imported* GHCR PAT: ").strip()
    except EOFError:username=""
    if not GITHUB_USERNAME.fullmatch(username) or "--" in username:
        raise Stop("PAT_OWNER_GITHUB_USERNAME_INVALID")
    return username

def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("--plan","--create","--verify","--delete"):
        raise Stop("USAGE_PLAN_CREATE_VERIFY_DELETE")
    action=sys.argv[1]
    if action=="--plan":
        plan.main()
        return
    uai,env,sub=trusted_resources()
    path=job_id(sub)
    jobs=job_inventory()
    print("GHCR_SECRET_ONLY_UAI_ROLE_VERIFIED=YES")
    print("PROOF_JOB_NAME="+JOB)
    print("PROOF_JOB_INTENT=PRIVATE_GHCR_IMAGE_PULL_ONLY")
    print("PROOF_JOB_REGISTRY_SECRET=KEY_VAULT_REFERENCE_NO_RAW_PAT")
    print("PROOF_JOB_NO_DB_OR_BLOB_ACCESS_CONFIGURED=YES")
    if action=="--create":
        if jobs:raise Stop("JOBS_ALREADY_PRESENT_REVIEW")
        username=read_username()
        manifest=assemble(uai,env,username)
        print("WARNING=JOB_START_PERMISSION_CAN_EXPOSE_ATTACHED_SECRETS")
        print("WARNING=JOB_WILL_HAVE_GHCR_SECRET_ACCESS_UNTIL_DELETED")
        print("WARNING=CREATING_JOB_DOES_NOT_TRIGGER_ANY_EXECUTION")
        print("WARNING=RESOURCE_OR_LATER_EXECUTION_MAY_INCUR_AZURE_CHARGES")
        confirm(CONFIRM_CREATE)
        try:
            response=job_resource("put",path,manifest)
        except Stop:
            raise Stop("JOB_CREATE_OUTCOME_UNKNOWN_REVIEW_WITH_VERIFY_BEFORE_RETRY")
        if response and str(response.get("id","")).casefold()!=path.casefold():
            raise Stop("JOB_CREATE_RESPONSE_ID_UNEXPECTED_REVIEW_WITH_VERIFY")
        print("GHCR_PROOF_JOB_CREATE_REQUEST_ACCEPTED=YES")
        print("JOB_EXECUTION_STARTED=NO_BY_THIS_SCRIPT")
        print("NEXT=RUN_VERIFY_READ_ONLY_BEFORE_SEPARATE_START_APPROVAL")
        return
    if len(jobs)!=1 or jobs[0]["name"]!=JOB:
        raise Stop("JOB_INVENTORY_CHANGED_REVIEW")
    doc=job_resource("get",path)
    verify_document(doc,uai,env,sub)
    count=execution_count()
    if count:raise Stop("JOB_ALREADY_EXECUTED_OR_EXECUTION_PRESENT_REVIEW")
    print("GHCR_PROOF_JOB_EXACT_MANUAL_CONFIG_VERIFIED=YES")
    print("GHCR_PROOF_JOB_EXECUTIONS=0")
    print("NO_GHCR_SECRET_VALUES_QUERIED=YES")
    if action=="--verify":
        print("NO_AZURE_CHANGES_OR_JOB_START=YES")
        print("GHCR_PULL_PROOF_READY_FOR_SEPARATE_MANUAL_START_REVIEW=YES")
        return
    print("WARNING=DELETE_REMOVES_ONLY_PROOF_JOB_NOT_VAULT_TOKEN_OR_IAM")
    confirm(CONFIRM_DELETE)
    try: job_resource("delete",path)
    except Stop:raise Stop("DELETE_UNCONFIRMED_REVIEW_PRIVATELY")
    if any(j["name"]==JOB for j in job_inventory()):
        raise Stop("DELETE_NOT_YET_VISIBLE_REVERIFY")
    print("GHCR_PROOF_JOB_DELETED_AND_READBACK_VERIFIED=YES")
    print("KEY_VAULT_SECRET_AND_SCOPED_ROLE_LEFT_UNCHANGED=YES")

if __name__=="__main__":
    try: main()
    except Stop as err:
        print("STOP_"+str(err))
        sys.exit(3)
    except plan.Stop as err:
        print("STOP_"+str(err))
        sys.exit(3)
