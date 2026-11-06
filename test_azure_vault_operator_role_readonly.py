import json, os, subprocess, tempfile, unittest
from pathlib import Path

SCRIPT = Path("ops/cloud-backup/azure-vault-operator-role-readonly.sh").resolve()
MOCK = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
state=json.loads(Path(os.environ["MOCK_STATE"]).read_text())
with Path(os.environ["MOCK_CALLS"]).open("a") as f:
 f.write(" ".join(args)+"\\n")
q=args[args.index("--query")+1] if "--query" in args else ""
def out(x):print(x);sys.exit(0)
if args[:2]==["account","show"]:
 if q=="name":out(state.get("subscription","Azure for Students"))
 if q=="user.type":out(state.get("user_type","user"))
if args[:2]==["group","show"]:out("malaysiawest")
if args[:2]==["keyvault","show"]:
 if q=="id":out("/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01")
 if q=="properties.enableRbacAuthorization":out(state.get("rbac","true"))
if args[:3]==["ad","signed-in-user","show"]:
 if state.get("graph_denied"):sys.exit(1)
 out("11111111-1111-1111-1111-111111111111")
if args[:3]==["role","assignment","list"]:
 if state.get("roles_denied"):sys.exit(1)
 out(json.dumps(state.get("roles",[])))
sys.exit(97)
"""
class OperatorAuditTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  root=Path(self.tmp.name);b=root/"bin";b.mkdir()
  cli=b/"az";cli.write_text(MOCK);cli.chmod(0o700)
  self.state=root/"state";self.calls=root/"calls";self.calls.write_text("")
  self.env={**os.environ,"PATH":str(b)+os.pathsep+os.environ.get("PATH",""),
            "MOCK_STATE":str(self.state),"MOCK_CALLS":str(self.calls)}
  self.config({})
 def config(self,data):self.state.write_text(json.dumps(data))
 def run_cli(self):
  return subprocess.run(["bash",str(SCRIPT)],env=self.env,text=True,capture_output=True,timeout=15)
 def test_zero_role_account_audit(self):
  x=self.run_cli()
  self.assertEqual(x.returncode,0,x.stderr)
  self.assertIn("AZURE_OPERATOR_RELATED_ROLE_ASSIGNMENTS=0",x.stdout)
  self.assertIn("SECRET_WRITE_ROLE_CANDIDATE=NO_OR_CUSTOM_ROLE",x.stdout)
  self.assertIn("ROLE_ASSIGNMENT_ADMIN_CANDIDATE=NO_OR_CUSTOM_ROLE",x.stdout)
  self.assertIn("ROLE_CANDIDATES_ARE_NOT_EFFECTIVE_PERMISSION_PROOF=YES",x.stdout)
  for id_value in ("00000000-0000-0000-0000-000000000001","11111111-1111-1111-1111-111111111111"):
   self.assertNotIn(id_value,x.stdout+x.stderr)
 def test_detect_expected_roles_without_details(self):
  self.config({"roles":[{"scope":"/subscriptions/00000000","roleDefinitionName":"Owner"},
                        {"scope":"/subscriptions/00000000","roleDefinitionName":"Key Vault Secrets Officer"}]})
  x=self.run_cli()
  self.assertEqual(x.returncode,0,x.stderr)
  self.assertIn("ROLE_ASSIGNMENT_ADMIN_CANDIDATE=YES",x.stdout)
  self.assertIn("SECRET_WRITE_ROLE_CANDIDATE=YES",x.stdout)
  self.assertNotIn("Owner",x.stdout)
 def test_wrong_sub(self):
  self.config({"subscription":"Production"})
  x=self.run_cli()
  self.assertIn("STOP_WRONG_SUBSCRIPTION",x.stderr)
 def test_graph_denied_fail_closed(self):
  self.config({"graph_denied":True})
  x=self.run_cli()
  self.assertIn("STOP_SIGNED_IN_USER_LOOKUP_DENIED",x.stderr)
 def test_role_denied_fail_closed(self):
  self.config({"roles_denied":True})
  x=self.run_cli()
  self.assertIn("STOP_OPERATOR_ROLE_ENUMERATION_DENIED",x.stderr)
 def test_missing_object_fields_fail_closed(self):
  self.config({"roles":[{"scope":"x"}]})
  x=self.run_cli()
  self.assertIn("STOP_OPERATOR_ROLE_RESPONSE_INVALID",x.stderr)
 def test_no_writes(self):
  x=self.run_cli()
  self.assertEqual(x.returncode,0,x.stderr)
  log=self.calls.read_text()
  for forbidden in (" create"," update"," delete"," set"," upload"," start"," list-keys"):
   self.assertNotIn(forbidden,log)
  self.assertIn("role assignment list",log)
  self.assertIn("ad signed-in-user show",log)
if __name__=="__main__":unittest.main()
