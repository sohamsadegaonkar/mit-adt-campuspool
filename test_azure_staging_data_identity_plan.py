"""Offline regression of the Azure identity operator's read-only boolean handling.

Synthetic Azure CLI stub only; absolutely no Azure subscriptions or secrets.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
SCRIPT = ROOT / "ops" / "cloud-backup" / "azure-staging-data-identity-operator.sh"

AZ_STUB = r'''#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
query = args[args.index("--query")+1] if "--query" in args else ""
out = args[args.index("-o")+1] if "-o" in args else ""
if args[:2]==["account","show"]:
    if query=="name": print("Azure for Students")
    elif query=="state": print("Enabled")
    else: sys.exit(11)
elif args[:2]==["keyvault","show"]:
    if query=="properties.enableRbacAuthorization" and out=="json":
        print(os.getenv("MOCK_RBAC","true"))
    else: sys.exit(12)
elif args[:3]==["storage","account","show"]:
    if query=="allowSharedKeyAccess" and out=="json":
        print(os.getenv("MOCK_SHARED_KEY","false"))
    else: sys.exit(13)
elif args[:2]==["identity","show"]:
    sys.exit(3)  # No identity exists; the plan must report NO, no creation.
else:
    print("UNEXPECTED_WRITE_OR_REQUEST",file=sys.stderr)
    sys.exit(14)
'''


class IdentityOperatorPlanTests(unittest.TestCase):
    def invoke(self, **flags):
        with tempfile.TemporaryDirectory() as tmp:
            az = pathlib.Path(tmp) / "az"
            az.write_text(AZ_STUB, encoding="utf-8")
            az.chmod(0o700)
            env = {**os.environ, "PATH": tmp + os.pathsep + os.environ.get("PATH", "")}
            env.update(flags)
            return subprocess.run(
                ["bash", str(SCRIPT), "--plan"],
                env=env, capture_output=True, text=True, timeout=15, check=False
            )

    def test_true_false_json_flags_allow_read_only_plan(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("BACKUP_DATA_IDENTITY_ALREADY_EXISTS=NO", result.stdout)
        self.assertIn("NO_CLOUD_WRITES_OR_IAM_CHANGES=YES", result.stdout)

    def test_non_rbac_vault_halts_before_identity_creation(self):
        result = self.invoke(MOCK_RBAC="false")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STOP_EXPECTED_RBAC_VAULT_MISSING", result.stderr)
        self.assertNotIn("NO_CLOUD_WRITES_OR_IAM_CHANGES=YES", result.stdout)

    def test_shared_key_enabled_halts_before_identity_creation(self):
        result = self.invoke(MOCK_SHARED_KEY="true")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STOP_EXPECTED_PRIVATE_ACCOUNT_MISSING", result.stderr)

    def test_unknown_rbac_flag_halts(self):
        result = self.invoke(MOCK_RBAC="null")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STOP_EXPECTED_RBAC_VAULT_MISSING", result.stderr)


if __name__ == "__main__":
    unittest.main()
