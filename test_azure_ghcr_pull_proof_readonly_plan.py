import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT=Path("scripts/azure-ghcr-pull-proof-readonly-plan.py")
spec=importlib.util.spec_from_file_location("pull_plan",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SUB="00000000-0000-0000-0000-000000000001"
VAULT=f"/subscriptions/{SUB}/resourceGroups/{m.RG}/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
SECRET=VAULT+"/secrets/ghcr-pull-token"
IDENT=f"/subscriptions/{SUB}/resourceGroups/{m.RG}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{m.MANAGED_IDENTITY}"
ENV=f"/subscriptions/{SUB}/resourceGroups/{m.RG}/providers/Microsoft.App/managedEnvironments/{m.ENVIRONMENT}"
ROLE=f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6"

class Cloud:
    def __init__(self):
        self.calls=[]
        self.secret_role=True
        self.env_state="Succeeded"
        self.env_region="Malaysia West"
        self.env_mode="WorkloadProfiles"
        self.env_id=ENV
        self.uai_id=IDENT
        self.jobs=[]
        self.bad_jobs_json=False
        self.deny=False
    def az(self,*args):
        self.calls.append(args)
        if self.deny:raise m.operator.preflight.Stop("AZURE_RBAC_READ_DENIED")
        if args[:2]==("identity","show"):return self.uai_id
        if args[:3]==("containerapp","env","show"):
            query=args[args.index("--query")+1]
            return {"id":self.env_id,"location":self.env_region,
                    "properties.provisioningState":self.env_state}[query]
        if args[0]=="rest":
            assert args[args.index("--method")+1]=="get"
            assert args[args.index("--url")+1]==(
                m.operator.preflight.ARM+self.env_id+"?api-version=2026-07-01")
            assert args[args.index("--query")+1]=="properties.environmentMode"
            return self.env_mode
        if args[:3]==("containerapp","job","list"):
            return "not json" if self.bad_jobs_json else json.dumps(self.jobs)
        raise AssertionError("Unexpected Azure CLI "+str(args))

class ReadOnlyPlan(unittest.TestCase):
    def run_plan(self,cloud,mode="--plan"):
        out=io.StringIO()
        with patch.object(m.operator,"check_context",
             return_value=(VAULT,SECRET,"11111111-1111-1111-1111-111111111111",ROLE,
                 SECRET+"/providers/Microsoft.Authorization/roleAssignments/44444444-4444-4444-4444-444444444444")),\
             patch.object(m.operator,"assignment_status",return_value=cloud.secret_role),\
             patch.object(m.operator.preflight,"az",side_effect=cloud.az),\
             patch.object(sys,"argv",["plan",mode]),contextlib.redirect_stdout(out):
            try:m.main();status="PASS"
            except m.Stop as err:status=str(err)
        return status,out.getvalue()
    def test_clean_plan_no_mutations(self):
        c=Cloud()
        result,out=self.run_plan(c)
        self.assertEqual(result,"PASS",out)
        self.assertIn("GHCR_PRIVATE_PULL_JOB_PLAN_COMPLETE=YES",out)
        self.assertIn("NO_AZURE_WRITE_OR_JOB_START=YES",out)
        self.assertIn("PROPOSED_CA_DB_BLOB_PERMISSIONS=NONE",out)
        self.assertNotIn(SUB,out)
        self.assertNotIn(IDENT,out)
        self.assertTrue(all(args[0] in ("identity","containerapp") or
                            (args[0]=="rest" and
                             args[args.index("--method")+1]=="get")
                            for args in c.calls))
        self.assertFalse(any("start" in args or "create" in args or "set" in args for args in c.calls))
    def test_no_role_stops_early(self):
        c=Cloud();c.secret_role=False
        status,_=self.run_plan(c)
        self.assertEqual(status,"GHCR_TOKEN_SECRET_READER_ROLE_ABSENT")
        self.assertEqual(len(c.calls),0)
    def test_wrong_identity_stops(self):
        c=Cloud();c.uai_id=c.uai_id.replace(m.MANAGED_IDENTITY,"different-identity")
        self.assertEqual(self.run_plan(c)[0],"GHCR_UAI_SCOPE_MISMATCH")
    def test_wrong_environment_stops(self):
        c=Cloud();c.env_id=c.env_id.replace(m.ENVIRONMENT,"another-env")
        self.assertEqual(self.run_plan(c)[0],"CONTAINER_APPS_ENVIRONMENT_SCOPE_MISMATCH")
    def test_wrong_region_stops(self):
        c=Cloud();c.env_region="eastus"
        self.assertEqual(self.run_plan(c)[0],"CONTAINER_APPS_REGION_CHANGED")
    def test_not_ready_environment_stops(self):
        c=Cloud();c.env_state="Updating"
        self.assertEqual(self.run_plan(c)[0],"CONTAINER_APPS_ENVIRONMENT_NOT_READY")
    def test_mode_read_is_arm_get_not_null_cli_projection(self):
        c=Cloud()
        status,out=self.run_plan(c)
        self.assertEqual(status,"PASS",out)
        self.assertTrue(any(args[0]=="rest" and args[args.index("--method")+1]=="get"
                            for args in c.calls))
        self.assertFalse(any("properties.environmentMode" in args
                            for args in c.calls if args[:3]==("containerapp","env","show")))
    def test_express_mode_rejected_before_job_inventory(self):
        c=Cloud();c.env_mode="Express"
        status,out=self.run_plan(c)
        self.assertEqual(status,"CONTAINER_APPS_EXPRESS_JOBS_UNSUPPORTED")
        self.assertNotIn("GHCR_PRIVATE_PULL_JOB_PLAN_COMPLETE=YES",out)
        self.assertFalse(any(args[:3]==("containerapp","job","list") for args in c.calls))
    def test_unknown_mode_is_fail_closed(self):
        for value in ("", "None", "Archived", "Unknown"):
            c=Cloud();c.env_mode=value
            self.assertEqual(self.run_plan(c)[0],
                             "CONTAINER_APPS_ENVIRONMENT_MODE_UNVERIFIED")
    def test_legacy_consumption_only_mode_is_accepted(self):
        c=Cloud();c.env_mode="ConsumptionOnly"
        status,out=self.run_plan(c)
        self.assertEqual(status,"PASS",out)
        self.assertIn("CONTAINER_APPS_ENVIRONMENT_JOB_COMPATIBLE=YES",out)
    def test_existing_target_job_stops(self):
        c=Cloud();c.jobs=[{"name":m.TEST_JOB}]
        self.assertEqual(self.run_plan(c)[0],"GHCR_PULL_TEST_JOB_ALREADY_EXISTS_REVIEW")
    def test_other_job_stops(self):
        c=Cloud();c.jobs=[{"name":"unrelated-job"}]
        self.assertEqual(self.run_plan(c)[0],"OTHER_CONTAINER_APPS_JOBS_PRESENT_REVIEW")
    def test_invalid_inventory_stops(self):
        c=Cloud();c.bad_jobs_json=True
        self.assertEqual(self.run_plan(c)[0],"CONTAINER_APPS_JOBS_INVENTORY_INVALID")
    def test_azure_auth_denial_stops(self):
        c=Cloud();c.deny=True
        self.assertEqual(self.run_plan(c)[0],"AZURE_RBAC_READ_DENIED")
    def test_arguments_do_not_allow_grant_or_start(self):
        c=Cloud()
        self.assertEqual(self.run_plan(c,"--apply")[0],"USAGE_PLAN_ONLY")
        self.assertEqual(len(c.calls),0)
    def test_image_digest_pinned(self):
        self.assertEqual(m.EXPECTED_IMAGE,
          "ghcr.io/sohamsadegaonkar/campuspool-backup-worker@"
          "sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2")
        self.assertNotIn("az containerapp job start",SCRIPT.read_text())
        self.assertNotIn("az keyvault secret show",SCRIPT.read_text())

if __name__=="__main__": unittest.main()
