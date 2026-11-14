#!/usr/bin/env python3
"""Owner-authorized ONE retest of existing manual/no-DB/Blob GHCR image-pull job.

Separate from the deliberately start-free job creator and verifier.
--check: GET-only exact configuration and known single FAILED execution.
--start-once: same checks twice (including after confirmation) then ONE Azure start.

Do not retry after any unknown start outcome; always inspect execution history.
"""
import importlib.util
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "ghcr_pull_only_operator", HERE/"azure-ghcr-pull-proof-job-operator.py")
proof=importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)

EXPECTED_ORIGINAL="campuspool-ghcr-pull-proof-wln5uv8"
EXPECTED_OWNER="sohamsadegaonkar"
CONFIRM="START_ONE_ORIGINAL_GHCR_IMAGE_PULL_PROOF_NO_DB_BLOB"

class Stop(Exception):
    pass

def check():
    """Fail closed on config drift, unexpected execution or another active run."""
    try:
        uai,env,sub=proof.trusted_resources()
        jobs=proof.job_inventory()
        if len([j for j in jobs if j.get("name")==proof.JOB])!=1:
            raise Stop("EXACT_ORIGINAL_JOB_NOT_PRESENT")
        doc=proof.job_resource("get",proof.job_id(sub))
        proof.verify_document(doc,uai,env,sub)
        config=doc["properties"]["configuration"]
        container=doc["properties"]["template"]["containers"][0]
        registry=config["registries"][0]
        if registry.get("username")!=EXPECTED_OWNER:
            raise Stop("REGISTRY_USERNAME_CHANGED")
        if set(registry)-{"server","username","passwordSecretRef","identity"}:
            raise Stop("REGISTRY_EXTRA_FIELDS")
        if set(container)-{"name","image","command","args","resources","env"}:
            raise Stop("UNREVIEWED_CONTAINER_FIELDS")
        if (not isinstance(container["resources"],dict)
                or set(container["resources"])-{"cpu","memory","ephemeralStorage"}
                or ("ephemeralStorage" in container["resources"]
                    and container["resources"]["ephemeralStorage"] not in ("","1Gi"))):
            raise Stop("UNREVIEWED_RESOURCE_FIELDS")
        entries=proof.execution_history()
        if (len(entries)!=1 or entries[0].get("name")!=EXPECTED_ORIGINAL
                or not isinstance(entries[0].get("properties"),dict)
                or entries[0]["properties"].get("status")!="Failed"):
            raise Stop("EXECUTION_HISTORY_CHANGED_NO_RETEST")
    except (proof.Stop,proof.plan.Stop) as exc:
        raise Stop("PROOF_PREFLIGHT_"+str(exc))
    return True

def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("--check","--start-once"):
        raise Stop("USAGE_CHECK_OR_START_ONCE")
    action=sys.argv[1]
    check()
    print("GHCR_PULL_RETEST_EXACT_MANUAL_CONFIG_VERIFIED=YES")
    print("GHCR_PULL_RETEST_ONLY_ONE_PRIOR_FAILED_EXECUTION=YES")
    print("GHCR_PULL_RETEST_NO_DB_OR_BLOB=YES")
    print("GHCR_PULL_RETEST_NO_TOKEN_VALUE_READ=YES")
    if action=="--check":
        print("NO_AZURE_WRITE_OR_JOB_START=YES")
        return
    print("WARNING=ONE_MANUAL_AZURE_JOB_EXECUTION_MAY_INCUR_CHARGES")
    print("WARNING=DO_NOT_RETRY_START_IF_RESULT_IS_UNKNOWN")
    try:
        approval=input("Type "+CONFIRM+" to authorize one start: ").strip()
    except EOFError:
        approval=""
    if approval!=CONFIRM:
        raise Stop("OWNER_CONFIRMATION_REQUIRED")
    # Re-read immediately before the only start request. Refuse if another
    # execution appeared while owner was entering confirmation.
    check()
    try:
        proof.az("containerapp","job","start","-g",proof.RG,
                 "-n",proof.JOB,"--only-show-errors","-o","none")
    except (proof.Stop,proof.plan.Stop) as exc:
        raise Stop("START_OUTCOME_UNKNOWN_CHECK_HISTORY_DO_NOT_RETRY")
    print("GHCR_PULL_RETEST_START_REQUEST_ACCEPTED=YES")
    print("GHCR_PULL_RETEST_DO_NOT_START_AGAIN=YES")
    print("NEXT=INSPECT_JOB_EXECUTION_HISTORY_READ_ONLY")

if __name__=="__main__":
    try:
        main()
    except Stop as exc:
        print("STOP_"+str(exc))
        sys.exit(3)
