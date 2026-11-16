"""Offline fail-closed regression for staging backup RBAC Bash operator.

Mocks Azure CLI in PATH. No account credentials, Azure calls, or write operations.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parent
OPERATOR = ROOT / "ops" / "cloud-backup" / "azure-staging-data-identity-rbac.sh"
AZ_MOCK = r'''#!/usr/bin/env python3
import json,os,sys

a=sys.argv[1:]
scenario=os.environ.get("RBAC_TEST_SCENARIO","clean")
rg="/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/campuspool-backup-rg"
vault=rg+"/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
storage=rg+"/providers/Microsoft.Storage/storageAccounts/011campuspoolbackup"
secret=vault+"/secrets/campuspool-staging-pg-password"
principal="00000000-0000-4000-8000-000000000002"

def arg(name,default=""):
    return a[a.index(name)+1] if name in a else default
def answer(value):
    print(value)
    sys.exit(0)

if a[:2]==["account","show"]:
    answer({"name":"Azure for Students","state":"Enabled"}.get(arg("--query"),""))
if a[:2]==["keyvault","show"]:
    q=arg("--query")
    answer({"id":vault,"properties.enableRbacAuthorization":"true"}.get(q,""))
if a[:3]==["storage","account","show"]:
    q=arg("--query")
    answer({"id":storage,"allowSharedKeyAccess":"false",
            "allowBlobPublicAccess":"false"}.get(q,""))
if a[:2]==["identity","show"]:
    answer(principal if arg("--query")=="principalId" else "")
if a[:3]==["role","definition","list"]:
    if scenario=="bad_role":
        answer(json.dumps([{
            "roleType":"CustomRole",
            "roleName":"CampusPool Staging Backup Blob Writer No Delete",
            "assignableScopes":[storage],
            "permissions":[{
                "actions":["Microsoft.Storage/storageAccounts/blobServices/containers/read"],
                "notActions":[],
                "dataActions":["Microsoft.Storage/storageAccounts/blobServices/containers/blobs/delete"],
                "notDataActions":[]
            }]
        }]))
    answer("[]")
if a[:2]==["rest","--method"]:
    answer("true")
if a[:3]==["role","assignment","list"]:
    if scenario=="bad_secret_grant" and arg("--scope")==secret:
        answer(json.dumps([{"Role":"Owner","Scope":secret}]))
    if scenario=="bad_blob_scope" and "/containers/" in arg("--scope"):
        answer(json.dumps([{"Role":"CampusPool Staging Backup Blob Writer No Delete","Scope":storage}]))
    answer("[]")
print("MOCK_AZ_NON_READ_OPERATION_BLOCKED",file=sys.stderr)
sys.exit(98)
'''


class RBACPlanSafetyTests(unittest.TestCase):
    def execute(self,scenario):
        with tempfile.TemporaryDirectory() as folder:
            binary=Path(folder)/"az"
            binary.write_text(AZ_MOCK,encoding="utf-8")
            binary.chmod(0o700)
            env=dict(os.environ)
            env["PATH"]=folder+os.pathsep+env.get("PATH","")
            env["RBAC_TEST_SCENARIO"]=scenario
            return subprocess.run(
                ["bash",str(OPERATOR),"--plan"],
                cwd=ROOT,env=env,stdin=subprocess.DEVNULL,
                capture_output=True,text=True,timeout=25,check=False
            )

    def test_clean_read_only_plan(self):
        p=self.execute("clean")
        self.assertEqual(p.returncode,0,(p.stdout,p.stderr))
        self.assertIn("NO_DELETE_CUSTOM_ROLE_EXISTS=NO",p.stdout)
        self.assertIn("EXACT_STAGING_SECRET_ENABLED=true",p.stdout)
        self.assertIn("EXACT_SECRET_GRANT_EXISTS=NO",p.stdout)
        self.assertIn("EXACT_BLOB_GRANT_EXISTS=NO",p.stdout)
        self.assertIn("NO_AZURE_WRITES=YES",p.stdout)
        self.assertNotIn("IndentationError",p.stderr)
        self.assertNotIn("Traceback",p.stderr)

    def test_existing_role_with_delete_action_fails_closed(self):
        p=self.execute("bad_role")
        self.assertEqual(p.returncode,2,(p.stdout,p.stderr))
        self.assertIn("STOP_CUSTOM_ROLE_UNEXPECTED_PERMISSIONS",p.stderr)
        self.assertNotIn("NO_AZURE_WRITES=YES",p.stdout)

    def test_unexpected_key_vault_role_fails_closed(self):
        p=self.execute("bad_secret_grant")
        self.assertEqual(p.returncode,2,(p.stdout,p.stderr))
        self.assertIn("STOP_UNEXPECTED_OR_TOO_BROAD_EXISTING_SCOPED_GRANT",p.stderr)
        self.assertNotIn("NO_AZURE_WRITES=YES",p.stdout)

    def test_unexpected_blob_scope_fails_closed(self):
        p=self.execute("bad_blob_scope")
        self.assertEqual(p.returncode,2,(p.stdout,p.stderr))
        self.assertIn("STOP_UNEXPECTED_OR_TOO_BROAD_EXISTING_SCOPED_GRANT",p.stderr)
        self.assertNotIn("NO_AZURE_WRITES=YES",p.stdout)


if __name__=="__main__":
    unittest.main()
