import contextlib
import copy
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT=Path("scripts/azure-ghcr-pull-proof-job-operator.py")
spec=importlib.util.spec_from_file_location("ghcr_job_op",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SUB="00000000-0000-0000-0000-000000000001"
VAULT=f"/subscriptions/{SUB}/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
SECRET=VAULT+"/secrets/ghcr-pull-token"
PRINCIPAL="11111111-1111-1111-1111-111111111111"
ROLE=f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6"
ASSIGN=SECRET+"/providers/Microsoft.Authorization/roleAssignments/22222222-2222-2222-2222-222222222222"
UAI=f"/subscriptions/{SUB}/resourceGroups/{m.RG}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/{m.plan.MANAGED_IDENTITY}"
ENV=f"/subscriptions/{SUB}/resourceGroups/{m.RG}/providers/Microsoft.App/managedEnvironments/{m.plan.ENVIRONMENT}"
JOB_ID=m.job_id(SUB)

class Cloud:
    def __init__(self):
        self.calls=[]
        self.jobs=[]
        self.doc=None
        self.executions=[]
        self.denied=False
        self.role=True
        self.return_wrong_id=False
        self.username="sohamsadegaonkar"
        self.manifest=None
    def az(self,*args):
        self.calls.append(args)
        if self.denied:raise m.plan.Stop("AZURE_RBAC_READ_DENIED")
        if args[:2]==("identity","show"):return UAI
        if args[:3]==("containerapp","env","show"):
            return {"id":ENV,"location":"Malaysia West","properties.provisioningState":"Succeeded"}[args[args.index("--query")+1]]
        if args[:3]==("containerapp","job","list"):
            return json.dumps(self.jobs)
        if args[:4]==("containerapp","job","execution","list"):
            return json.dumps(self.executions)
        if args[0]=="rest":
            method=args[args.index("--method")+1]
            url=args[args.index("--url")+1]
            assert url==m.REST+JOB_ID+"?api-version="+m.API
            if method=="put":
                assert "--body" in args
                self.manifest=json.loads(args[args.index("--body")+1])
                assert "ghp_" not in json.dumps(self.manifest)
                assert "password" not in json.dumps(self.manifest).replace("passwordSecretRef","")
                self.doc={"id":JOB_ID,"location":"malaysiawest",**self.manifest}
                self.jobs=[{"name":m.JOB}]
                return json.dumps({"id":"wrong-id" if self.return_wrong_id else JOB_ID})
            if method=="get":
                if self.doc is None:raise AssertionError("No job")
                return json.dumps(self.doc)
            if method=="delete":
                self.jobs=[]
                self.doc=None
                return ""
        raise AssertionError("Unexpected request "+str(args))

class OperatorTests(unittest.TestCase):
    def run_job(self,cloud,action,phrase="",username=None):
        out=io.StringIO()
        with patch.object(m.plan.operator,"check_context",return_value=(VAULT,SECRET,PRINCIPAL,ROLE,ASSIGN)),\
             patch.object(m.plan.operator,"assignment_status",return_value=cloud.role),\
             patch.object(m.plan,"az",side_effect=cloud.az),\
             patch.object(sys,"argv",["cli",action]),\
             patch.object(m,"read_username",return_value=username or cloud.username),\
             patch("builtins.input",return_value=phrase),\
             contextlib.redirect_stdout(out):
            try:m.main();state="PASS"
            except (m.Stop,m.plan.Stop) as error:state=str(error)
        return state,out.getvalue()
    def test_create_only_then_independent_verify_and_delete(self):
        c=Cloud()
        state,out=self.run_job(c,"--create",m.CONFIRM_CREATE)
        self.assertEqual(state,"PASS",out)
        self.assertIn("GHCR_PROOF_JOB_CREATE_REQUEST_ACCEPTED=YES",out)
        self.assertIn("JOB_EXECUTION_STARTED=NO_BY_THIS_SCRIPT",out)
        self.assertEqual(c.jobs,[{"name":m.JOB}])
        self.assertEqual(c.manifest["properties"]["configuration"]["triggerType"],"Manual")
        self.assertEqual(c.manifest["properties"]["configuration"]["replicaRetryLimit"],0)
        self.assertEqual(c.manifest["properties"]["configuration"]["secrets"][0],
            {"name":m.SECRET,"keyVaultUrl":m.VAULT_URL,"identity":UAI})
        self.assertEqual(c.manifest["properties"]["configuration"]["registries"][0],
            {"server":"ghcr.io","username":"sohamsadegaonkar","passwordSecretRef":"ghcr-pull-token"})
        self.assertEqual(c.manifest["properties"]["template"]["containers"][0]["command"],["node","-e"])
        self.assertEqual(c.manifest["properties"]["template"]["containers"][0]["args"],m.ARGS)
        self.assertEqual(c.manifest["properties"]["template"]["containers"][0]["env"],[])
        self.assertEqual(c.manifest["identity"]["userAssignedIdentities"],{UAI:{}})
        state,out=self.run_job(c,"--verify")
        self.assertEqual(state,"PASS",out)
        self.assertIn("GHCR_PULL_PROOF_READY_FOR_SEPARATE_MANUAL_START_REVIEW=YES",out)
        self.assertIn("GHCR_PROOF_JOB_EXECUTIONS=0",out)
        self.assertNotIn(PRINCIPAL,out)
        self.assertNotIn(UAI,out)
        self.assertNotIn(SUB,out)
        self.assertEqual(self.run_job(c,"--delete")[0],"OWNER_CONFIRMATION_REQUIRED")
        self.assertEqual(self.run_job(c,"--delete",m.CONFIRM_DELETE)[0],"PASS")
        self.assertEqual(c.jobs,[])
        self.assertFalse(any("start" in a for args in c.calls for a in args))
    def test_create_denies_without_exact_approval(self):
        c=Cloud()
        self.assertEqual(self.run_job(c,"--create")[0],"OWNER_CONFIRMATION_REQUIRED")
        self.assertIsNone(c.doc)
        self.assertFalse(any(args[0]=="rest" and "put" in args for args in c.calls))
    def test_preflight_requires_ghcr_reader_role(self):
        c=Cloud();c.role=False
        self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],"GHCR_TOKEN_SECRET_ONLY_ROLE_MISSING")
        self.assertEqual(c.jobs,[])
    def test_existing_job_fail_closed_before_create(self):
        c=Cloud();c.jobs=[{"name":"other"}]
        self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],"JOBS_ALREADY_PRESENT_REVIEW")
    def test_bad_pat_username_refused(self):
        for username in ("","a"*40,"bad--name","-owner","owner-","not_a_user"):
            with self.subTest(username=username):
                with self.assertRaises(m.Stop):m.assemble(UAI,ENV,username)
    def test_create_ambiguous_ack_never_retries_blindly(self):
        c=Cloud();c.return_wrong_id=True
        self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],
                         "JOB_CREATE_RESPONSE_ID_UNEXPECTED_REVIEW_WITH_VERIFY")
        self.assertIsNotNone(c.doc)
    def test_verify_rejects_secret_inline_value(self):
        c=Cloud();self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],"PASS")
        c.doc["properties"]["configuration"]["secrets"][0]["value"]="GHCR_SENSITIVE_VALUE"
        status,out=self.run_job(c,"--verify")
        self.assertEqual(status,"JOB_GHCR_SECRET_REFERENCE_INVALID")
        self.assertNotIn("GHCR_SENSITIVE_VALUE",out)
    def test_verify_rejects_backup_entrypoint(self):
        c=Cloud();self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],"PASS")
        c.doc["properties"]["template"]["containers"][0]["command"]=["node","scripts/azure-blob-backup.js"]
        self.assertEqual(self.run_job(c,"--verify")[0],"JOB_NON_DATABASE_SMOKE_CONFIG_CHANGED")
    def test_verify_rejects_schedule_and_unsafe_retries(self):
        c=Cloud();self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],"PASS")
        c.doc["properties"]["configuration"]["scheduleTriggerConfig"]={"cronExpression":"* * * * *"}
        self.assertEqual(self.run_job(c,"--verify")[0],"JOB_AUTOMATIC_TRIGGERS_FOUND")
        del c.doc["properties"]["configuration"]["scheduleTriggerConfig"]
        c.doc["properties"]["configuration"]["replicaRetryLimit"]=9
        self.assertEqual(self.run_job(c,"--verify")[0],"JOB_REPLICA_GUARDS_MISMATCH")
    def test_no_reused_job_when_execution_exists(self):
        c=Cloud();self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],"PASS")
        c.executions=[{"name":"execution1"}]
        self.assertEqual(self.run_job(c,"--verify")[0],"JOB_ALREADY_EXECUTED_OR_EXECUTION_PRESENT_REVIEW")
        self.assertEqual(self.run_job(c,"--delete",m.CONFIRM_DELETE)[0],"ACTIVE_OR_UNKNOWN_JOB_EXECUTION_REVIEW")
        c.executions=[{"name":"execution1","properties":{"status":"Succeeded"}}]
        self.assertEqual(self.run_job(c,"--delete",m.CONFIRM_DELETE)[0],"PASS")
        self.assertEqual(c.jobs,[])
    def test_wrong_identity_and_registry_fail(self):
        c=Cloud();self.assertEqual(self.run_job(c,"--create",m.CONFIRM_CREATE)[0],"PASS")
        c.doc["identity"]["type"]="SystemAssigned"
        self.assertEqual(self.run_job(c,"--verify")[0],"WRONG_JOB_IDENTITY")
        c.doc["identity"]["type"]="UserAssigned"
        c.doc["properties"]["configuration"]["registries"][0]["identity"]=UAI
        self.assertEqual(self.run_job(c,"--verify")[0],"JOB_REGISTRY_AUTH_METADATA_INVALID")
    def test_existing_region_drift_fail_closed(self):
        c=Cloud()
        def drift(*args):
            if args[:3]==("containerapp","env","show") and "location" in args:
                return "eastus"
            return c.az(*args)
        with patch.object(m.plan,"az",side_effect=drift),\
             patch.object(m.plan.operator,"check_context",return_value=(VAULT,SECRET,PRINCIPAL,ROLE,ASSIGN)),\
             patch.object(m.plan.operator,"assignment_status",return_value=True):
            with self.assertRaises(m.Stop):m.trusted_resources()
    def test_source_has_no_start_or_secret_read(self):
        source=SCRIPT.read_text()
        self.assertNotIn('job","start"',source)
        self.assertNotIn('secret","show"',source)
        self.assertNotIn("ghp_",source)
        self.assertNotIn("az containerapp job start",source)
        self.assertIn('confirm(CONFIRM_CREATE)',source)
        self.assertIn('confirm(CONFIRM_DELETE)',source)

if __name__=="__main__":unittest.main()
