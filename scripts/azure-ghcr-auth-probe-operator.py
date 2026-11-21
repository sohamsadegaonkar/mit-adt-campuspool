#!/usr/bin/env python3
"""One-time owner-confirmed Azure-to-GHCR auth probe using the existing scoped KV reader.

NO DB/Blob environment/roles/volumes. No raw PAT, Authorization headers, or HTTP
bodies printed. Does not change existing GHCR smoke job or image digest.

--plan: read-only preflight; --create: creates manual-only job (does not start);
--verify: read-only exact-resource verification; --start: owner-approved ONE start;
--status: read-only execution summaries; --delete: owner-confirmed cleanup.
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "existing_ghcr_proof_operator", HERE / "azure-ghcr-pull-proof-job-operator.py"
)
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)

RG = proof.RG
PROOF_JOB = proof.JOB
JOB = "campuspool-ghcr-auth-probe"
VAULT_SECRET = proof.SECRET
SECRET_URL = proof.VAULT_URL
EXPECTED_DIGEST = "sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2"
# Pinned official Node.js base already reviewed in ops/cloud-backup/Dockerfile.
# Use a public image so the probe is independent of GHCR image-pull authentication.
IMAGE = "docker.io/library/node:22-alpine3.23@sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db"
CONFIRM_CREATE = "CREATE_ONLY_MANUAL_GHCR_AUTH_PROBE_NO_START"
CONFIRM_START = "START_ONE_GHCR_AUTH_PROBE_NO_DB_BLOB"
CONFIRM_DELETE = "DELETE_ONLY_CAMPUSPOOL_GHCR_AUTH_PROBE"

# Fixed HTTPS hosts and paths; no redirections, token/body/header logging,
# database/Blob access, or arbitrary user-supplied code. The GHCR PAT is read
# only from the secretRef environment on the transient Azure job container.
NODE_CODE = r'''"use strict";
const TOKEN_URL="https://ghcr.io/token?service=ghcr.io&scope=repository%3Asohamsadegaonkar%2Fcampuspool-backup-worker%3Apull";
const IMAGE_URL="https://ghcr.io/v2/sohamsadegaonkar/campuspool-backup-worker/manifests/sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2";
const DIGEST="sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2";
function stop(code){process.stdout.write("GHCR_AUTH_PROBE_"+code+"\n");process.exitCode=2;}
async function run(){
  const pat=process.env.GHCR_PROBE_TOKEN;
  if(!pat || pat.length<10 || pat.length>4096){stop("SECRET_UNAVAILABLE");return;}
  const basic=Buffer.from("sohamsadegaonkar:"+pat,"utf8").toString("base64");
  const login=await fetch(TOKEN_URL,{
    method:"GET",redirect:"error",signal:AbortSignal.timeout(10000),
    headers:{Authorization:"Basic "+basic,Accept:"application/json"}
  });
  if(!login.ok){stop("TOKEN_ENDPOINT_HTTP_"+login.status);return;}
  const obj=await login.json();
  const bearer=obj && (obj.token || obj.access_token);
  if(typeof bearer!=="string" || !bearer || bearer.length>10000){stop("SCOPED_BEARER_MISSING");return;}
  const res=await fetch(IMAGE_URL,{
    method:"HEAD",redirect:"error",signal:AbortSignal.timeout(10000),
    headers:{Authorization:"Bearer "+bearer,
      Accept:"application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json"}
  });
  if(!res.ok){stop("MANIFEST_HEAD_HTTP_"+res.status);return;}
  if(res.headers.get("docker-content-digest")!==DIGEST){stop("MANIFEST_DIGEST_MISMATCH_OR_MISSING");return;}
  process.stdout.write("GHCR_AUTH_PROBE_PINNED_MANIFEST_READ_PASS=YES\n");
}
run().catch(()=>stop("NETWORK_OR_RESPONSE_UNVERIFIED"));
'''

class Stop(Exception):
    pass

def az(*args):
    try:
        return proof.az(*args)
    except (proof.Stop, proof.plan.Stop) as e:
        raise Stop(str(e))

def confirm(text):
    try:
        response = input("Type " + text + " to authorize exact Azure action: ").strip()
    except EOFError:
        response = ""
    if response != text:
        raise Stop("EXPLICIT_OWNER_CONFIRMATION_REQUIRED")

def path(sub):
    return f"/subscriptions/{sub}/resourceGroups/{RG}/providers/Microsoft.App/jobs/{JOB}"

def trusted():
    try:
        return proof.trusted_resources()
    except (proof.Stop, proof.plan.Stop) as e:
        raise Stop("AZURE_CONTEXT_" + str(e))

def inventory():
    try:
        names = [item["name"] for item in proof.job_inventory()]
    except (proof.Stop, proof.plan.Stop) as e:
        raise Stop("JOB_INVENTORY_" + str(e))
    if len(names) != len(set(names)) or set(names) not in ({PROOF_JOB}, {PROOF_JOB, JOB}):
        raise Stop("UNEXPECTED_JOB_INVENTORY")
    return set(names)

def executions(name):
    try:
        entries = json.loads(az("containerapp", "job", "execution", "list",
                                "-g", RG, "-n", name, "-o", "json"))
        if not isinstance(entries, list) or any(not isinstance(x, dict) for x in entries):
            raise ValueError("invalid")
        return entries
    except (ValueError, TypeError):
        raise Stop("JOB_EXECUTIONS_INVALID")

def verify_prior_failure():
    entries = executions(PROOF_JOB)
    if not entries:
        raise Stop("ORIGINAL_GHCR_PROOF_EXECUTION_MISSING")
    statuses = [x.get("properties", {}).get("status") for x in entries]
    if any(s not in ("Succeeded", "Failed", "Stopped") for s in statuses):
        raise Stop("ORIGINAL_GHCR_PROOF_ACTIVE_OR_UNKNOWN")
    if "Failed" not in statuses:
        raise Stop("ORIGINAL_GHCR_FAILURE_NOT_FOUND")

def manifest(uai, env):
    return {
        "location": proof.LOCATION,
        "identity": {"type": "UserAssigned", "userAssignedIdentities": {uai: {}}},
        "tags": {"project": "campuspool", "purpose": "ghcr-auth-probe-only",
                 "manual": "true", "no-database": "true"},
        "properties": {
            "environmentId": env, "workloadProfileName": "Consumption",
            "configuration": {
                "triggerType": "Manual",
                "manualTriggerConfig": {"parallelism": 1, "replicaCompletionCount": 1},
                "replicaTimeout": 120, "replicaRetryLimit": 0, "registries": [],
                "secrets": [{"name": VAULT_SECRET, "keyVaultUrl": SECRET_URL,
                             "identity": uai}]
            },
            "template": {
                "containers": [{
                    "name": "ghcr-auth-probe",
                    "image": IMAGE, "command": ["node", "-e"], "args": [NODE_CODE],
                    "resources": {"cpu": 0.25, "memory": "0.5Gi"},
                    "env": [{"name": "GHCR_PROBE_TOKEN", "secretRef": VAULT_SECRET}]
                }],
                "initContainers": [], "volumes": []
            }
        }
    }

def approved_resource_readback(actual, desired):
    """Require exact CPU/memory and strictly allow observed ARM ephemeral defaults.

    Azure returns an empty string for ephemeralStorage on the owner's 0.25-vCPU
    job; the documented capacity is 1Gi. Only those two *literal strings* are
    accepted as an optional, non-requested third field. Reject any different
    field, altered CPU/memory or unexpected type. No Azure mutation.
    """
    if not isinstance(actual, dict):
        return False
    if actual == desired:
        return True
    return (set(actual) == {"cpu", "memory", "ephemeralStorage"}
            and actual.get("cpu") == desired["cpu"]
            and actual.get("memory") == desired["memory"]
            and type(actual.get("ephemeralStorage")) is str
            and actual["ephemeralStorage"] in ("", "1Gi"))


def verify_doc(doc, uai, env, sub):
    expected = manifest(uai, env)
    if str(doc.get("id", "")).casefold() != path(sub).casefold():
        raise Stop("WRONG_PROBE_ID")
    # ARM can report the same region as "Malaysia West" or "malaysiawest".
    # Normalize only whitespace/case, not the geographic value itself.
    if "".join(str(doc.get("location", "")).split()).casefold() != proof.LOCATION.casefold():
        raise Stop("WRONG_PROBE_REGION")
    if (doc.get("identity", {}).get("type") != "UserAssigned" or
            list((doc.get("identity", {}).get("userAssignedIdentities") or {}).keys()) != [uai]):
        raise Stop("WRONG_PROBE_IDENTITY")
    if doc.get("tags") != expected["tags"]:
        raise Stop("PROBE_TAGS_MISMATCH")
    props = doc.get("properties", {})
    target = expected["properties"]
    if (str(props.get("environmentId", "")).casefold() != env.casefold() or
            props.get("workloadProfileName") not in ("Consumption", None)):
        raise Stop("PROBE_ENV_OR_PROFILE_MISMATCH")
    cfg = props.get("configuration", {})
    for name in ("triggerType", "manualTriggerConfig", "replicaTimeout",
                 "replicaRetryLimit", "secrets"):
        if cfg.get(name) != target["configuration"][name]:
            raise Stop("PROBE_CONFIGURATION_" + name.upper() + "_MISMATCH")
    if cfg.get("registries") not in ([], None) or cfg.get("scheduleTriggerConfig") or cfg.get("eventTriggerConfig"):
        raise Stop("PROBE_UNEXPECTED_REGISTRY_OR_TRIGGER")
    template = props.get("template", {})
    containers = template.get("containers") if isinstance(template, dict) else None
    expected_containers = target["template"]["containers"]
    if (not isinstance(containers, list) or len(containers) != 1
            or not isinstance(containers[0], dict)):
        raise Stop("PROBE_TEMPLATE_CHANGED")
    actual_container, expected_container = containers[0], expected_containers[0]
    resources_ok = approved_resource_readback(
        actual_container.get("resources"), expected_container["resources"])
    # Never overlook changed image, inline script, command, GHCR secretRef env
    # or *any* other unexpected container field.
    normalized_container = dict(actual_container)
    if resources_ok:
        normalized_container["resources"] = expected_container["resources"]
    if (not resources_ok or normalized_container != expected_container
            or template.get("initContainers") not in ([], None)
            or template.get("volumes") not in ([], None)):
        raise Stop("PROBE_TEMPLATE_CHANGED")

def diagnose_template(doc, uai, env):
    """Read-only comparison: fixed field names / booleans ONLY, never values.

    Do not print container args, image, inline source, environment contents,
    secret references or the raw Azure resource. This path cannot start a job.
    """
    target = manifest(uai, env)["properties"]["template"]
    props = doc.get("properties", {})
    actual = props.get("template", {}) if isinstance(props, dict) else {}
    if not isinstance(actual, dict):
        actual = {}
    checks = []
    for key in ("initContainers", "volumes"):
        checks.append(("TEMPLATE_" + key.upper(), actual.get(key) in ([], None)))
    want_containers = target["containers"]
    got_containers = actual.get("containers")
    good_shape = (
        isinstance(got_containers, list) and len(got_containers) == 1
        and isinstance(got_containers[0], dict)
    )
    checks.append(("CONTAINER_SHAPE", good_shape))
    if good_shape:
        got, want = got_containers[0], want_containers[0]
        for key in ("name", "image", "command", "args", "resources", "env"):
            match = (approved_resource_readback(got.get(key), want[key])
                     if key == "resources" else got.get(key) == want[key])
            checks.append(("CONTAINER_" + key.upper(), match))
        # Fail closed on extra container properties until reviewed.
        checks.append(("CONTAINER_EXTRA_FIELDS", not bool(set(got) - set(want))))
        if isinstance(got.get("resources"), dict):
            for key in ("cpu", "memory"):
                checks.append(("RESOURCE_" + key.upper(),
                               got["resources"].get(key) == want["resources"][key]))
        else:
            checks.append(("RESOURCE_SHAPE", False))
        if isinstance(got.get("env"), list):
            checks.append(("ENV_SHAPE", len(got["env"]) == 1))
        else:
            checks.append(("ENV_SHAPE", False))
    for name, match in checks:
        # Controlled static marker and yes/no only. No Azure content echoed.
        print("GHCR_AUTH_PROBE_DIAG_" + name + "_MATCH=" + ("YES" if match else "NO"))
    print("GHCR_AUTH_PROBE_DIAG_NO_SECRET_OR_TEMPLATE_VALUES_PRINTED=YES")
    print("NO_AZURE_WRITE_OR_JOB_START=YES")
    return all(matched for _, matched in checks)


def job_get(resource):
    try:
        return proof.job_resource("get", resource)
    except (proof.Stop, proof.plan.Stop) as e:
        raise Stop("PROBE_READ_FAILED_" + str(e))

def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("--plan", "--create", "--verify",
                                                 "--diagnose", "--start", "--status", "--delete"):
        raise Stop("USAGE_PLAN_CREATE_VERIFY_DIAGNOSE_START_STATUS_DELETE")
    action = sys.argv[1]
    uai, env, sub = trusted()
    names = inventory()
    verify_prior_failure()
    if action in ("--plan", "--create"):
        if JOB in names:
            raise Stop("PROBE_ALREADY_EXISTS_NO_RECREATE")
        print("GHCR_AUTH_PROBE_TRUSTED_CONTEXT_VERIFIED=YES")
        print("GHCR_AUTH_PROBE_PUBLIC_IMAGE_PINNED_BY_SHA256=YES")
        print("GHCR_AUTH_PROBE_SINGLE_KV_SECRET_ONLY=YES")
        print("GHCR_AUTH_PROBE_NO_DB_BLOB_OR_RECURRING_TRIGGER=YES")
        if action == "--plan":
            print("GHCR_AUTH_PROBE_PLAN_COMPLETE=YES")
            print("NO_AZURE_WRITE_OR_JOB_START=YES")
            return
        print("WARNING=PAT_ACCESSIBLE_IN_PROBE_PROCESS_MEMORY")
        print("WARNING=START_PERMISSION_CAN_OVERRIDE_CONTAINER_TEMPLATE")
        print("WARNING=AZURE_EXECUTION_CAN_INCUR_COSTS")
        confirm(CONFIRM_CREATE)
        try:
            result = proof.job_resource("put", path(sub), manifest(uai, env))
        except (proof.Stop, proof.plan.Stop):
            raise Stop("CREATE_OUTCOME_UNKNOWN_VERIFY_BEFORE_RETRY")
        if result and str(result.get("id", "")).casefold() != path(sub).casefold():
            raise Stop("CREATE_RESPONSE_UNEXPECTED")
        print("GHCR_AUTH_PROBE_CREATE_ACCEPTED=YES")
        print("GHCR_AUTH_PROBE_EXECUTION_STARTED=NO")
        return
    if JOB not in names:
        raise Stop("PROBE_NOT_CREATED")
    doc = job_get(path(sub))
    if action == "--diagnose":
        diagnose_template(doc, uai, env)
        return
    verify_doc(doc, uai, env, sub)
    ent = executions(JOB)
    print("GHCR_AUTH_PROBE_EXACT_CONFIG_VERIFIED=YES")
    print("GHCR_AUTH_PROBE_EXECUTIONS=" + str(len(ent)))
    if action == "--verify":
        print("NO_AZURE_WRITE_OR_JOB_START=YES")
        return
    if action == "--status":
        for item in ent:
            name = item.get("name")
            status = item.get("properties", {}).get("status")
            if not isinstance(name, str) or not name.startswith(JOB + "-") or not isinstance(status, str):
                raise Stop("UNEXPECTED_PROBE_EXECUTION")
            print("EXECUTION=" + name + " STATUS=" + status)
        print("NO_AZURE_CHANGES=YES")
        return
    if action == "--start":
        if ent:
            raise Stop("PROBE_ALREADY_EXECUTED_NO_REPEAT")
        print("WARNING=ONE_BILLABLE_AZURE_JOB_EXECUTION")
        confirm(CONFIRM_START)
        try:
            az("containerapp", "job", "start", "-g", RG, "-n", JOB,
               "--no-wait", "--only-show-errors", "-o", "none")
        except Stop:
            raise Stop("START_OUTCOME_UNKNOWN_CHECK_STATUS_NO_RETRY")
        print("GHCR_AUTH_PROBE_START_ACCEPTED=YES")
        print("NEXT=READ_ONLY_STATUS_AND_SANITIZED_LOG_CHECK")
        return
    if any(x.get("properties", {}).get("status") not in ("Succeeded", "Failed", "Stopped")
           for x in ent):
        raise Stop("ACTIVE_OR_UNKNOWN_PROBE_EXECUTION_DO_NOT_DELETE")
    confirm(CONFIRM_DELETE)
    try:
        proof.job_resource("delete", path(sub))
    except (proof.Stop, proof.plan.Stop):
        raise Stop("DELETE_OUTCOME_UNKNOWN")
    print("GHCR_AUTH_PROBE_DELETE_REQUEST_ACCEPTED=YES")
    print("ORIGINAL_PROOF_JOB_AND_KV_SECRET_UNTOUCHED=YES")

if __name__ == "__main__":
    try:
        main()
    except Stop as e:
        print("STOP_" + str(e))
        sys.exit(3)
