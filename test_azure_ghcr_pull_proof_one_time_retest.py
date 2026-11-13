"""Offline tests only. No live Azure calls or secrets."""
import contextlib
import importlib.util
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from test_azure_ghcr_pull_proof_job_operator import Cloud, UAI, ENV, SUB, JOB_ID, VAULT, SECRET, PRINCIPAL, ROLE, ASSIGN

PATH=Path("scripts/azure-ghcr-pull-proof-one-time-retest.py")
spec=importlib.util.spec_from_file_location("ghcr_retest",PATH)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class RetestTests(unittest.TestCase):
    def sample(self):
        cloud=Cloud()
        cloud.doc={"id":JOB_ID,"location":"Malaysia West",
                   **m.proof.assemble(UAI,ENV,m.EXPECTED_OWNER)}
        cloud.doc["properties"]["template"]["containers"][0]["resources"]["ephemeralStorage"]=""
        cloud.jobs=[{"name":m.proof.JOB},{"name":"campuspool-ghcr-auth-probe"}]
        cloud.executions=[{"name":m.EXPECTED_ORIGINAL,
                           "properties":{"status":"Failed"}}]
        cloud.starts=0
        return cloud

    def call(self,cloud,mode,phrase="",ambiguous=False):
        def fake_az(*args):
            if args[:3]==("containerapp","job","start"):
                cloud.starts+=1
                if ambiguous:
                    raise m.proof.plan.Stop("SYNTHETIC_TIMEOUT")
                cloud.executions.append({"name":"synthetic-second-execution",
                                         "properties":{"status":"Running"}})
                return ""
            return cloud.az(*args)
        out=io.StringIO()
        with patch.object(m.proof.plan.operator,"check_context",
                          return_value=(VAULT,SECRET,PRINCIPAL,ROLE,ASSIGN)),\
             patch.object(m.proof.plan.operator,"assignment_status",return_value=True),\
             patch.object(m.proof.plan,"az",side_effect=fake_az),\
             patch.object(sys,"argv",["retest",mode]),\
             patch("builtins.input",return_value=phrase),\
             contextlib.redirect_stdout(out):
            try:
                m.main()
                result="PASS"
            except m.Stop as exc:
                result=str(exc)
        return result,out.getvalue()

    def test_readonly_check_has_exact_config_no_start(self):
        c=self.sample()
        status,out=self.call(c,"--check")
        self.assertEqual(status,"PASS",out)
        self.assertIn("GHCR_PULL_RETEST_ONLY_ONE_PRIOR_FAILED_EXECUTION=YES",out)
        self.assertIn("NO_AZURE_WRITE_OR_JOB_START=YES",out)
        self.assertEqual(c.starts,0)

    def test_owner_confirmation_required(self):
        c=self.sample()
        result,out=self.call(c,"--start-once","")
        self.assertEqual(result,"OWNER_CONFIRMATION_REQUIRED")
        self.assertEqual(c.starts,0)

    def test_single_start_only_and_repeat_is_refused(self):
        c=self.sample()
        result,out=self.call(c,"--start-once",m.CONFIRM)
        self.assertEqual(result,"PASS",out)
        self.assertIn("GHCR_PULL_RETEST_START_REQUEST_ACCEPTED=YES",out)
        self.assertEqual(c.starts,1)
        self.assertEqual(self.call(c,"--start-once",m.CONFIRM)[0],
                         "EXECUTION_HISTORY_CHANGED_NO_RETEST")
        self.assertEqual(c.starts,1)

    def test_ambiguous_start_never_auto_retries(self):
        c=self.sample()
        result,out=self.call(c,"--start-once",m.CONFIRM,ambiguous=True)
        self.assertEqual(result,"START_OUTCOME_UNKNOWN_CHECK_HISTORY_DO_NOT_RETRY")
        self.assertEqual(c.starts,1)
        self.assertNotIn("GHCR_PULL_RETEST_START_REQUEST_ACCEPTED=YES",out)

    def test_other_status_or_prior_execution_blocks(self):
        for entries in (
            [],[{"name":m.EXPECTED_ORIGINAL,"properties":{"status":"Running"}}],
            [{"name":m.EXPECTED_ORIGINAL,"properties":{"status":"Succeeded"}}],
            [{"name":"wrong","properties":{"status":"Failed"}}],
            [{"name":m.EXPECTED_ORIGINAL,"properties":{"status":"Failed"}},
             {"name":"extra","properties":{"status":"Failed"}}],
        ):
            c=self.sample()
            c.executions=entries
            self.assertEqual(self.call(c,"--start-once",m.CONFIRM)[0],
                             "EXECUTION_HISTORY_CHANGED_NO_RETEST")
            self.assertEqual(c.starts,0)

    def test_no_db_entrypoint_or_unapproved_container_fields(self):
        c=self.sample()
        c.doc["properties"]["template"]["containers"][0]["command"]=["node","backup.js"]
        self.assertEqual(self.call(c,"--start-once",m.CONFIRM)[0],
                         "PROOF_PREFLIGHT_JOB_NON_DATABASE_SMOKE_CONFIG_CHANGED")
        c=self.sample()
        c.doc["properties"]["template"]["containers"][0]["volumeMounts"]=[{"path":"/secret"}]
        self.assertEqual(self.call(c,"--start-once",m.CONFIRM)[0],
                         "UNREVIEWED_CONTAINER_FIELDS")
        c=self.sample()
        c.doc["properties"]["template"]["containers"][0]["resources"]["ephemeralStorage"]="10Gi"
        self.assertEqual(self.call(c,"--start-once",m.CONFIRM)[0],
                         "UNREVIEWED_RESOURCE_FIELDS")

    def test_registry_or_secret_drift_blocks(self):
        c=self.sample()
        c.doc["properties"]["configuration"]["registries"][0]["passwordSecretRef"]="OTHER"
        self.assertEqual(self.call(c,"--start-once",m.CONFIRM)[0],
                         "PROOF_PREFLIGHT_JOB_REGISTRY_AUTH_METADATA_INVALID")
        c=self.sample()
        c.doc["properties"]["configuration"]["registries"][0]["username"]="other"
        self.assertEqual(self.call(c,"--start-once",m.CONFIRM)[0],
                         "REGISTRY_USERNAME_CHANGED")
        c=self.sample()
        c.doc["properties"]["configuration"]["secrets"][0]["value"]="SENSITIVE_SYNTHETIC_TEST"
        result,out=self.call(c,"--start-once",m.CONFIRM)
        self.assertEqual(result,"PROOF_PREFLIGHT_JOB_GHCR_SECRET_REFERENCE_INVALID")
        self.assertNotIn("SENSITIVE_SYNTHETIC_TEST",out)

if __name__=="__main__":
    unittest.main()
