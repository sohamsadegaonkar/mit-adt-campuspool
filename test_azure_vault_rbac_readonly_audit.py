import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path("ops/cloud-backup/azure-vault-rbac-readonly-audit.sh").resolve()

MOCK = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
state=json.loads(Path(os.environ["MOCK_STATE"]).read_text())
with Path(os.environ["MOCK_CALLS"]).open("a") as f: f.write(" ".join(args)+"\\n")
def out(v):
 print(v);sys.exit(0)
q = args[args.index("--query")+1] if "--query" in args else ""
if args[:2]==["account","show"]: out(state.get("subscription","Azure for Students"))
if args[:2]==["group","show"]: out("malaysiawest")
if args[:3]==["containerapp","env","show"]: out("Succeeded")
if args[:2]==["keyvault","show"]:
 if q=="properties.enableRbacAuthorization":out(state.get("rbac","true"))
 if q=="properties.enablePurgeProtection":out("true")
 if q=="location":out("malaysiawest")
if args[:2]==["identity","show"]:
 if q=="location":out("malaysiawest")
 if q=="principalId":out("00000000-0000-0000-0000-000000000001")
if args[:3]==["storage","account","show"]:out("false")
if args[:3]==["storage","container-rm","show"]:out(state.get("container","campuspool-staging-backups"))
if args[:3]==["role","assignment","list"]:out(json.dumps(state.get("assignments",[])))
if args[:3]==["containerapp","job","list"]:out(state.get("jobs","0"))
sys.exit(98)
'''

class SafeReadOnlyAudit(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.addCleanup(self.tmp.cleanup)
  root=Path(self.tmp.name)
  bindir=root/"bin";bindir.mkdir()
  az=bindir/"az";az.write_text(MOCK);az.chmod(0o700)
  self.state=root/"state.json";self.calls=root/"calls.log";self.calls.write_text("")
  self.env={**os.environ,"PATH":str(bindir)+os.pathsep+os.environ.get("PATH",""),
   "MOCK_STATE":str(self.state),"MOCK_CALLS":str(self.calls)}
  self.config({})
 def config(self,state):self.state.write_text(json.dumps(state))
 def run_audit(self):
  return subprocess.run(["bash",str(SCRIPT)],text=True,capture_output=True,env=self.env,timeout=15)
 def test_success_sanitized_and_no_mutations(self):
  run=self.run_audit()
  self.assertEqual(run.returncode,0,run.stderr)
  self.assertIn("GHCR_READER_EXISTING_ROLE_ASSIGNMENTS=0",run.stdout)
  self.assertIn("AZURE_CONTAINER_APPS_JOB_COUNT=0",run.stdout)
  self.assertIn("READY_FOR_SEPARATE_SECRET_SCOPE_RBAC_DESIGN=YES",run.stdout)
  self.assertNotIn("00000000-0000-0000-0000-000000000001",run.stdout)
  calls=self.calls.read_text()
  for forbidden in (" create"," update"," delete"," set"," upload"," start"," list-keys"):
   self.assertNotIn(forbidden,calls)
 def test_wrong_subscription_stops(self):
  self.config({"subscription":"Wrong account"})
  run=self.run_audit()
  self.assertNotEqual(run.returncode,0)
  self.assertIn("STOP_SUBSCRIPTION_MISMATCH",run.stderr)
 def test_missing_container_stops(self):
  self.config({"container":"unrelated"})
  run=self.run_audit()
  self.assertIn("STOP_BACKUP_CONTAINER_NOT_FOUND",run.stderr)
 def test_existing_uai_assignment_requires_review(self):
  self.config({"assignments":[{"scope":"/subscriptions/FAKE","roleDefinitionName":"Owner"}]})
  run=self.run_audit()
  self.assertEqual(run.returncode,4)
  self.assertIn("GHCR_READER_EXISTING_ROLE_ASSIGNMENTS=1",run.stdout)
  self.assertIn("STOP_GHCR_READER_ALREADY_HAS_UNREVIEWED_ROLES",run.stderr)
  self.assertNotIn("/subscriptions/FAKE",run.stdout)
 def test_existing_job_blocks(self):
  self.config({"jobs":"1"})
  run=self.run_audit()
  self.assertEqual(run.returncode,4)
  self.assertIn("STOP_JOB_INVENTORY_CHANGED",run.stderr)
 def test_invalid_roles_not_treated_as_zero(self):
  self.config({"assignments":"not a list"})
  run=self.run_audit()
  self.assertIn("STOP_IDENTITY_RBAC_AUDIT_PARSE_FAILED",run.stderr)
 def test_no_cloud_mutations_in_script(self):
  s=SCRIPT.read_text()
  for x in ("az role assignment create","az keyvault secret set","az containerapp job start",
    "az storage blob upload","az storage account keys list","az storage account show-connection-string",
    "az provider register","az identity create","az keyvault create"):
   self.assertNotIn(x,s)
  self.assertIn("--assignee-object-id",s)
  self.assertIn("az storage container-rm show",s)
  self.assertIn("NO_SECRETS_ROLE_GRANTS_KEYS_OR_DATABASE_ACCESS=YES",s)

if __name__=="__main__":
 unittest.main()
