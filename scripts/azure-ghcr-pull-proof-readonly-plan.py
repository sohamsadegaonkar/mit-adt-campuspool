#!/usr/bin/env python3
"""Read-only preflight for a future manual-only GHCR image-pull smoke job.

No Azure create/modify/start operations; no Key Vault data-plane secret read;
no PAT retrieval or GHCR credential use, no DB/storage connections.
Uses the existing, independently verified exact single-secret IAM operator.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "ghcr_scope_operator",HERE/"azure-ghcr-secret-scope-rbac-operator.py")
operator=importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)

RG="campuspool-backup-rg"
ENVIRONMENT="campuspool-backup-env"
MANAGED_IDENTITY="campuspool-ghcr-vault-reader"
TEST_JOB="campuspool-ghcr-pull-proof"
EXPECTED_IMAGE=("ghcr.io/sohamsadegaonkar/campuspool-backup-worker@"
    "sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2")
REGION="malaysiawest"
UUID=operator.preflight.UUID
ENV_RE=re.compile(
    rf"^/subscriptions/({UUID})/resourceGroups/{RG}/providers/Microsoft\.App/managedEnvironments/{ENVIRONMENT}$",
    re.I)
IDENT_RE=re.compile(
    rf"^/subscriptions/({UUID})/resourceGroups/{RG}/providers/Microsoft\.ManagedIdentity/userAssignedIdentities/{MANAGED_IDENTITY}$",
    re.I)

class Stop(Exception):pass

# Azure Express environments reject Microsoft.App/jobs/write regardless of
# healthy provisioning state or an apparent Consumption profile in a CLI view.
# Fail closed before claiming the GHCR proof job is deployable.
def require_jobs_compatible_environment_mode(value):
    if not isinstance(value,str):
        raise Stop("CONTAINER_APPS_ENVIRONMENT_MODE_UNVERIFIED")
    mode=value.strip().casefold()
    if mode=="express":
        raise Stop("CONTAINER_APPS_EXPRESS_JOBS_UNSUPPORTED")
    if mode not in ("workloadprofiles","consumptiononly"):
        raise Stop("CONTAINER_APPS_ENVIRONMENT_MODE_UNVERIFIED")
    return mode


def az(*args):
    try:return operator.preflight.az(*args)
    except operator.preflight.Stop as err:raise Stop(str(err))

def main():
    if sys.argv[1:]!=["--plan"]:
        raise Stop("USAGE_PLAN_ONLY")
    try:
        vault,secret,principal,role,assignment=operator.check_context()
        present=operator.assignment_status(vault,secret,principal,role,assignment)
    except (operator.Stop,operator.preflight.Stop) as e:
        raise Stop("GHCR_SECRET_ROLE_PRECHECK_"+str(e))
    if not present:raise Stop("GHCR_TOKEN_SECRET_READER_ROLE_ABSENT")

    identity_id=az("identity","show","-g",RG,"-n",MANAGED_IDENTITY,
                   "--query","id","-o","tsv")
    m=IDENT_RE.fullmatch(identity_id)
    if not m or m.group(1).lower()!=vault.split("/")[2].lower():
        raise Stop("GHCR_UAI_SCOPE_MISMATCH")

    env_id=az("containerapp","env","show","-g",RG,"-n",ENVIRONMENT,
              "--query","id","-o","tsv")
    env_m=ENV_RE.fullmatch(env_id)
    if not env_m or env_m.group(1).lower()!=m.group(1).lower():
        raise Stop("CONTAINER_APPS_ENVIRONMENT_SCOPE_MISMATCH")
    location=az("containerapp","env","show","-g",RG,"-n",ENVIRONMENT,
                "--query","location","-o","tsv")
    if re.sub(r"\s+","",location).casefold()!=REGION:
        raise Stop("CONTAINER_APPS_REGION_CHANGED")
    state=az("containerapp","env","show","-g",RG,"-n",ENVIRONMENT,
             "--query","properties.provisioningState","-o","tsv")
    if state.casefold()!="succeeded":
        raise Stop("CONTAINER_APPS_ENVIRONMENT_NOT_READY")

    mode=az("containerapp","env","show","-g",RG,"-n",ENVIRONMENT,
            "--query","properties.environmentMode","-o","tsv")
    require_jobs_compatible_environment_mode(mode)

    jobs_raw=az("containerapp","job","list","-g",RG,"-o","json")
    try:
        jobs=json.loads(jobs_raw)
        if not isinstance(jobs,list):raise ValueError("not list")
        for job in jobs:
            if not isinstance(job,dict) or not isinstance(job.get("name"),str):
                raise ValueError("malformed")
    except (ValueError,TypeError):
        raise Stop("CONTAINER_APPS_JOBS_INVENTORY_INVALID")
    if any(j["name"].casefold()==TEST_JOB for j in jobs):
        raise Stop("GHCR_PULL_TEST_JOB_ALREADY_EXISTS_REVIEW")
    if jobs:raise Stop("OTHER_CONTAINER_APPS_JOBS_PRESENT_REVIEW")

    print("AZURE_STUDENT_GHCR_SECRET_SCOPED_ROLE_VERIFIED=YES")
    print("GHCR_READER_IDENTITY_ARM_RESOURCE_VERIFIED=YES")
    print("CONTAINER_APPS_ENVIRONMENT_READY=YES")
    print("CONTAINER_APPS_ENVIRONMENT_JOB_COMPATIBLE=YES")
    print("ENVIRONMENT_REGION=MALAYSIA_WEST")
    print("EXISTING_CONTAINER_APPS_JOBS=0")
    print("PROPOSED_JOB=campuspool-ghcr-pull-proof")
    print("PROPOSED_TRIGGER=MANUAL_ONLY")
    print("PROPOSED_REGISTRY=GHCR_PRIVATE_IMAGE")
    print("PROPOSED_IMAGE_PINNED_BY_SHA256=YES")
    print("PROPOSED_IMAGE_COMMAND=NON_DATABASE_NODE_SMOKE_ONLY")
    print("PROPOSED_CA_DB_BLOB_PERMISSIONS=NONE")
    print("PROPOSED_JOB_SECRETS=KEY_VAULT_GHCR_TOKEN_REFERENCE_ONLY")
    print("GHCR_PAT_ACCESS_AND_PACKAGE_PULL_NOT_YET_TESTED=YES")
    print("GHCR_PAT_OWNER_USERNAME_STILL_NEEDED_FOR_REGISTRY_AUTH=YES")
    print("CONTAINER_APPS_EXECUTION_MAY_INCUR_AZURE_CHARGES=YES")
    print("NO_AZURE_WRITE_OR_JOB_START=YES")
    print("GHCR_PRIVATE_PULL_JOB_PLAN_COMPLETE=YES")
    print("NEXT=REVIEW_COST_AND_MANUAL_ONLY_JOB_MANIFEST_BEFORE_CREATE_OR_START")

if __name__=="__main__":
    try:main()
    except Stop as err:
        print("STOP_"+str(err))
        sys.exit(3)
