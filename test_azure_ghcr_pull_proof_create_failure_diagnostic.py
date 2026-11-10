import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT=Path("scripts/azure-ghcr-pull-proof-create-failure-diagnostic.py")
spec=importlib.util.spec_from_file_location("ghcr_job_diagnose",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SUB="00000000-0000-0000-0000-000000000001"
VAULT=f"/subscriptions/{SUB}/resourceGroups/{m.job.RG}/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
SECRET=VAULT+"/secrets/ghcr-pull-token"
PRINCIPAL="11111111-1111-1111-1111-111111111111"
ROLE=f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6"
ASSIGN=SECRET+"/providers/Microsoft.Authorization/roleAssignments/22222222-2222-2222-2222-222222222222"
RESOURCE=m.job.job_id(SUB)

class Fake:
    def __init__(self):
        self.calls=[]
        self.job_present=False
        self.job_state="Succeeded"
        self.job_trigger="Manual"
        self.log_events=[]
        self.denied=False
        self.iam_present=True
    def az(self,*args):
        self.calls.append(args)
        if self.denied:
            raise m.job.Stop("AZURE_READ_REQUEST_FAILED")
        if args[:3]==("containerapp","job","list"):
            return json.dumps([{"name":m.job.JOB}] if self.job_present else [])
        if args[:3]==("containerapp","job","show"):
            return json.dumps({"name":m.job.JOB,"state":self.job_state,
                               "trigger":self.job_trigger})
        if args[:3]==("monitor","activity-log","list"):
            assert args[args.index("--resource-id")+1]==RESOURCE
            assert args[args.index("--offset")+1]=="24h"
            return json.dumps(self.log_events)
        raise AssertionError("Unexpected action "+str(args))
    def event(self,kind="Failed",sub="BadRequest",message=""):
        return {"resourceId":RESOURCE,"operationName":{"value":"Microsoft.App/jobs/write"},
                "status":{"value":kind},"subStatus":{"value":sub},
                "properties":{"statusMessage":message}}

class Tests(unittest.TestCase):
    def do(self,f,mode="--inspect"):
        capture=io.StringIO()
        with patch.object(m.job.plan.operator,"check_context",return_value=(
                    VAULT,SECRET,PRINCIPAL,ROLE,ASSIGN)),\
             patch.object(m.job.plan.operator,"assignment_status",return_value=f.iam_present),\
             patch.object(m.job,"az",side_effect=f.az),\
             patch.object(sys,"argv",["diagnostic",mode]),\
             contextlib.redirect_stdout(capture):
            try:m.main();code="PASS"
            except m.Stop as e:code=str(e)
        return code,capture.getvalue()
    def test_absent_job_log_classification_only(self):
        f=Fake()
        sensitive="GHCR_SECRET_VALUE_FAKE USER_GUID_ABC"
        f.log_events=[f.event(message='InvalidParameterValueInContainerTemplate: '+sensitive+
                ' Unable to get value using Managed identity')]
        status,out=self.do(f)
        self.assertEqual(status,"PASS",out)
        self.assertIn("GHCR_PULL_PROOF_JOB_EXISTS=NO",out)
        self.assertIn("WRITE_EVENT_1_CLASSIFICATION=AZURE_JOB_KEY_VAULT_REFERENCE_FETCH",out)
        self.assertNotIn(sensitive,out)
        self.assertNotIn(SUB,out)
        self.assertNotIn(PRINCIPAL,out)
        self.assertIn("NO_AZURE_WRITE_OR_JOB_START=YES",out)
        self.assertTrue(all(a[:3] in (("containerapp","job","list"),
                    ("monitor","activity-log","list")) for a in f.calls))
    def test_job_present_never_recreate(self):
        f=Fake();f.job_present=True
        code,out=self.do(f)
        self.assertEqual(code,"PASS",out)
        self.assertIn("GHCR_PULL_PROOF_JOB_EXISTS=YES",out)
        self.assertIn("GHCR_PULL_PROOF_JOB_PROVISIONING_STATE=SUCCEEDED",out)
        self.assertIn("NEXT=RUN_GUARDED_VERIFY_NO_CREATE_RETRY",out)
    def test_no_log_cause_not_claimed(self):
        f=Fake()
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("ACTIVITY_LOG_CAUSE=NOT_YET_AVAILABLE",out)
    def test_unrelated_operations_ignored(self):
        f=Fake()
        e=f.event()
        e["resourceId"]=RESOURCE.replace("pull-proof","backup-job")
        f.log_events=[e,{"resourceId":RESOURCE,
            "operationName":{"value":"Microsoft.App/jobs/read"},
            "status":{"value":"Succeeded"},"subStatus":{"value":"OK"}}]
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("RECENT_PROOF_JOB_WRITE_EVENTS=0",out)
    def test_failed_azure_query_fails_closed(self):
        f=Fake();f.denied=True
        self.assertEqual(self.do(f)[0],"JOB_INVENTORY_UNAVAILABLE")
    def test_missing_role_fails_early(self):
        f=Fake();f.iam_present=False
        self.assertEqual(self.do(f)[0],"GHCR_SECRET_ONLY_ROLE_MISSING")
        self.assertEqual(f.calls,[])
    def test_unsafe_job_metadata_not_echoed(self):
        f=Fake();f.job_present=True;f.job_trigger="Schedule"
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("GHCR_PULL_PROOF_JOB_TRIGGER=SCHEDULE",out)
        self.assertNotIn("GHCR_PULL_PROOF_JOB_EXACT_MANUAL_CONFIG_VERIFIED",out)
    def test_raw_sensitive_activity_never_printed(self):
        f=Fake()
        sensitive="Bearer x SECRET-ghp_YYYY"
        f.log_events=[f.event(message=sensitive)]
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("NOT_CLASSIFIED",out)
        self.assertNotIn(sensitive,out)
    def test_structured_provider_code_is_allowlisted(self):
        f=Fake()
        payload={"error":{"code":"InvalidParameterValue","message":"confidential foo ghp_SECRET_123"}}
        f.log_events=[f.event(message=json.dumps(payload))]
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("WRITE_EVENT_1_DETAIL_SHAPE=JSON_OBJECT",out)
        self.assertIn("WRITE_EVENT_1_PROVIDER_ERROR_CODE_CATEGORY=INVALID_PARAMETER",out)
        self.assertNotIn("ghp_SECRET_123",out)
        self.assertNotIn("confidential",out)
    def test_unrecognized_provider_code_is_not_repeated(self):
        f=Fake()
        payload={"error":{"code":"secret:ghp_BUT_NOT_SAFE","message":"owner email or secret"}}
        f.log_events=[f.event(message=json.dumps(payload))]
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("WRITE_EVENT_1_PROVIDER_ERROR_CODE_CATEGORY=UNRECOGNIZED_CODE",out)
        self.assertNotIn("ghp_BUT_NOT_SAFE",out)
        self.assertNotIn("owner email",out)
    def test_provider_message_text_never_rendered(self):
        f=Fake()
        f.log_events=[f.event(message="Bearer secret-cannot-print")]
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("WRITE_EVENT_1_DETAIL_SHAPE=TEXT",out)
        self.assertIn("WRITE_EVENT_1_PROVIDER_ERROR_CODE_CATEGORY=NO_CODE",out)
        self.assertNotIn("secret-cannot-print",out)
    def test_missing_provider_detail_is_safe(self):
        f=Fake()
        event=f.event()
        event["properties"]={}
        f.log_events=[event]
        code,out=self.do(f)
        self.assertEqual(code,"PASS")
        self.assertIn("WRITE_EVENT_1_DETAIL_SHAPE=ABSENT",out)
        self.assertIn("WRITE_EVENT_1_PROVIDER_ERROR_CODE_CATEGORY=NO_CODE",out)
    def test_refuse_mutating_flags(self):
        f=Fake()
        self.assertEqual(self.do(f,"--create")[0],"USAGE_INSPECT_ONLY")
        self.assertEqual(f.calls,[])
    def test_no_mutations_in_source(self):
        source=SCRIPT.read_text()
        self.assertNotIn('"put"',source)
        self.assertNotIn('"delete"',source)
        self.assertNotIn('job","start"',source)
        self.assertNotIn('secret","show"',source)

if __name__=="__main__":unittest.main()
