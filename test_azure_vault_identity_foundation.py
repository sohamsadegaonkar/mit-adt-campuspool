import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

SCRIPT = Path("ops/cloud-backup/azure-vault-identity-foundation.sh").resolve()
VAULT = "campuspool-backup-kv-01"
IDENTITY = "campuspool-ghcr-vault-reader"

AZ_MOCK = r"""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
state_path=Path(os.environ["AZ_MOCK_STATE"])
calls=Path(os.environ["AZ_MOCK_CALLS"])
args=sys.argv[1:]
with calls.open("a") as f: f.write(" ".join(args)+"\n")
state=json.loads(state_path.read_text())
def output(s):
    print(s)
    sys.exit(0)
def query():
    return args[args.index("--query")+1] if "--query" in args else None
def save():
    state_path.write_text(json.dumps(state))
if args[:2]==["account","show"]:
    output(state.get("account","Azure for Students"))
if args[:2]==["group","show"]:
    output("malaysiawest")
if args[:3]==["containerapp","env","show"]:
    output("Succeeded")
if args[:3]==["storage","account","show"]:
    output("false")
if args[:2]==["provider","show"]:
    output(state.get("provider","Registered"))
if args[:2]==["keyvault","list"]:
    output("campuspool-backup-kv-01" if state.get("vault") else "")
if args[:2]==["identity","list"]:
    output("campuspool-ghcr-vault-reader" if state.get("reader") else "")
if args[:2]==["keyvault","check-name"]:
    output(state.get("name_available","true"))
if args[:2]==["keyvault","create"]:
    state["vault"]=True
    save()
    sys.exit(0)
if args[:2]==["identity","create"]:
    state["reader"]=True
    save()
    sys.exit(0)
if args[:2]==["keyvault","show"]:
    if not state.get("vault"): sys.exit(1)
    values={
      "properties.enableRbacAuthorization":"true",
      "location":"malaysiawest",
      "properties.sku.name":"standard",
      "properties.enablePurgeProtection":"true",
      "properties.softDeleteRetentionInDays":"90",
      "properties.publicNetworkAccess":"Enabled",
      "properties.networkAcls.defaultAction":"Allow"
    }
    if state.get("vault_insecure"):
        values["properties.enableRbacAuthorization"]="false"
    output(values.get(query(),""))
if args[:2]==["identity","show"]:
    output("malaysiawest" if state.get("reader") else "")
sys.exit(99)
"""

class FoundationScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        directory = Path(self.tmp.name)
        bindir = directory / "bin"
        bindir.mkdir()
        az = bindir / "az"
        az.write_text(AZ_MOCK)
        az.chmod(0o700)
        self.state = directory / "state.json"
        self.calls = directory / "calls.txt"
        self.calls.write_text("")
        self.env = {
            **os.environ,
            "PATH": str(bindir)+os.pathsep+os.environ.get("PATH", ""),
            "AZ_MOCK_STATE": str(self.state),
            "AZ_MOCK_CALLS": str(self.calls),
        }
        self.set_state({})

    def set_state(self, obj):
        self.state.write_text(json.dumps(obj))

    def run_script(self, mode, confirm=""):
        return subprocess.run(
            ["bash", str(SCRIPT), mode],
            input=confirm,
            text=True,
            capture_output=True,
            env=self.env,
            timeout=20,
        )

    def writes(self):
        lines = self.calls.read_text().splitlines()
        return [x for x in lines if "keyvault create" in x or "identity create" in x]

    def test_plan_no_cloud_writes(self):
        proc = self.run_script("--plan")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("PLAN_MODE_NO_AZURE_WRITES=YES",proc.stdout)
        self.assertEqual(self.writes(),[])

    def test_create_just_two_resources_then_idempotent(self):
        proc=self.run_script("--apply", "CREATE_CAMPUSPOOL_VAULT_AND_READER\n")
        self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertEqual(len(self.writes()),2,self.writes())
        self.assertIn("FOUNDATION_CREATION_PASS=YES",proc.stdout)
        self.assertIn("NO_SECRETS_OR_AZURE_RBAC_GRANTS_CREATED=YES",proc.stdout)
        self.assertIn("NO_JOB_CREATED_OR_STARTED=YES",proc.stdout)
        self.assertTrue(json.loads(self.state.read_text())["vault"])
        self.assertTrue(json.loads(self.state.read_text())["reader"])
        second=self.run_script("--apply", "CREATE_CAMPUSPOOL_VAULT_AND_READER\n")
        self.assertEqual(second.returncode,0,second.stderr)
        self.assertEqual(len(self.writes()),2,"must reuse existing matching resources")

    def test_refusing_confirmation_does_not_create(self):
        proc=self.run_script("--apply", "no\n")
        self.assertNotEqual(proc.returncode,0)
        self.assertIn("STOP_OPERATOR_NOT_CONFIRMED",proc.stderr)
        self.assertEqual(self.writes(),[])

    def test_wrong_subscription_blocks(self):
        self.set_state({"account":"Some other account"})
        proc=self.run_script("--apply", "CREATE_CAMPUSPOOL_VAULT_AND_READER\n")
        self.assertIn("STOP_WRONG_SUBSCRIPTION",proc.stderr)
        self.assertEqual(self.writes(),[])

    def test_provider_block(self):
        self.set_state({"provider":"NotRegistered"})
        proc=self.run_script("--plan")
        self.assertIn("STOP_REQUIRED_PROVIDER_NOT_REGISTERED",proc.stderr)
        self.assertEqual(self.writes(),[])

    def test_collision_blocks(self):
        self.set_state({"name_available":"false"})
        proc=self.run_script("--plan")
        self.assertIn("STOP_GLOBAL_VAULT_NAME_UNAVAILABLE",proc.stderr)
        self.assertEqual(self.writes(),[])

    def test_existing_insecure_vault_blocks_without_modification(self):
        self.set_state({"vault":True,"vault_insecure":True})
        proc=self.run_script("--apply", "CREATE_CAMPUSPOOL_VAULT_AND_READER\n")
        self.assertIn("STOP_VAULT_SECURITY_SETTINGS_MISMATCH",proc.stderr)
        self.assertEqual(self.writes(),[])

    def test_no_forbidden_mutations_in_source(self):
        source=SCRIPT.read_text()
        for forbidden in (
            "az role assignment create",
            "az keyvault secret set",
            "az keyvault update",
            "az containerapp job create",
            "az containerapp job start",
            "az storage blob upload",
            "az acr create",
            "az provider register",
            "PGPASSWORD=",
            "GITHUB_TOKEN=",
            "docker login",
        ):
            self.assertNotIn(forbidden,source)
        self.assertIn("--no-self-perms true",source)
        self.assertIn("--enable-purge-protection true",source)
        self.assertIn("--enable-rbac-authorization true",source)
        self.assertIn("CONFIRM=",source)

if __name__=="__main__":
    unittest.main()
