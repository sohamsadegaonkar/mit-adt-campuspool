"""Mocked no-Azure regression tests for staging CA-only reader IAM."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest import mock

SRC = Path(__file__).parent / "scripts" / "azure-staging-ca-reader-operator.py"
spec = importlib.util.spec_from_file_location("staging_ca_reader", SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CTX = {
    "scope": "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/"
             "campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/"
             "campuspool-backup-kv-01/secrets/staging-pg-root-ca",
    "data": {"Principal": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
    "pull": {"Principal": "ffffffff-1111-2222-3333-444444444444"}
}


def exact_entry():
    return {
        "principalId": CTX["data"]["Principal"],
        "scope": CTX["scope"],
        "roleDefinitionId": "/providers/Microsoft.Authorization/roleDefinitions/" + m.ROLE_GUID,
        "name": m.known_assignment_id(CTX),
        "condition": None,
    }


class ReaderGuardTests(unittest.TestCase):
    def test_plan_read_only(self):
        with mock.patch.object(m, "check_context", return_value=CTX), \
             mock.patch.object(m, "classify", return_value="ABSENT"), \
             mock.patch.object(m, "az", side_effect=AssertionError("No write")):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                m.plan()
            self.assertIn("NO_AZURE_WRITES_OR_SECRET_VALUE_READ=YES", buf.getvalue())
            self.assertIn("DATA_ID_CA_EXACT_READER=ABSENT", buf.getvalue())

    def test_wrong_account_fails_closed(self):
        account = {"Name": "Other", "State": "Enabled", "Id": "11111111-2222-3333-4444-555555555555"}
        with mock.patch.object(m, "az_json", return_value=account):
            with self.assertRaisesRegex(m.Stop, "SUBSCRIPTION_NOT_ALLOWLISTED"):
                m.check_context()

    def test_disabled_ca_fails_closed(self):
        account = {"Name": "Azure for Students", "State": "Enabled", "Id": "11111111-2222-3333-4444-555555555555"}
        vault = {"Id": CTX["scope"].split("/secrets/")[0], "Name": m.VAULT, "Rbac": True}
        ca = {"Name":m.CA_SECRET, "Enabled":False}
        with mock.patch.object(m,"az_json",side_effect=[account,vault,ca]):
            with self.assertRaisesRegex(m.Stop,"CA_SECRET_MISSING_OR_DISABLED"):
                m.check_context()

    def test_ghcr_has_ca_assignment_stops(self):
        with mock.patch.object(m,"read_assignments",return_value=[exact_entry()]):
            with self.assertRaisesRegex(m.Stop,"GHCR_PULL_IDENTITY_HAS_CA_SCOPE_ASSIGNMENT"):
                m.classify(CTX)

    def test_unknown_role_is_rejected(self):
        e = exact_entry()
        e["roleDefinitionId"] = e["roleDefinitionId"].replace(m.ROLE_GUID,"aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb")
        with mock.patch.object(m,"read_assignments",side_effect=[[],[e]]):
            with self.assertRaisesRegex(m.Stop,"DATA_IDENTITY_CA_ASSIGNMENT_NOT_EXACT"):
                m.classify(CTX)

    def test_vault_scope_is_rejected(self):
        e = exact_entry()
        e["scope"] = e["scope"].rsplit("/secrets/",1)[0]
        with mock.patch.object(m,"read_assignments",side_effect=[[],[e]]):
            with self.assertRaisesRegex(m.Stop,"DATA_IDENTITY_CA_ASSIGNMENT_NOT_EXACT"):
                m.classify(CTX)

    def test_exact_existing_grant(self):
        with mock.patch.object(m,"read_assignments",side_effect=[[],[exact_entry()]]):
            self.assertEqual(m.classify(CTX),"EXACT_VERIFIED")

    def test_existing_grant_not_duplicated(self):
        with mock.patch.object(m,"plan",return_value=(CTX,"EXACT_VERIFIED")), \
             mock.patch.object(m,"az",side_effect=AssertionError("Duplicate grant")):
            with self.assertRaisesRegex(m.Stop,"EXISTING_ASSIGNMENT_NO_DUPLICATE_GRANT"):
                m.grant_once()

    def test_grant_requires_explicit_approval(self):
        with mock.patch.object(m,"plan",return_value=(CTX,"ABSENT")), \
             mock.patch.object(m,"approve",side_effect=m.Stop("EXPLICIT_OWNER_CONFIRMATION_MISSING")), \
             mock.patch.object(m,"az",side_effect=AssertionError("No write")):
            with self.assertRaisesRegex(m.Stop,"EXPLICIT_OWNER_CONFIRMATION_MISSING"):
                m.grant_once()

    def test_grant_exact_scope_only(self):
        with mock.patch.object(m,"plan",return_value=(CTX,"ABSENT")), \
             mock.patch.object(m,"approve") as approve, \
             mock.patch.object(m,"az",return_value=subprocess.CompletedProcess([],0)) as az, \
             mock.patch.object(m,"classify",return_value="EXACT_VERIFIED"):
            with contextlib.redirect_stdout(io.StringIO()):
                m.grant_once()
            approve.assert_called_once_with("GRANT_ONLY_STAGING_CA_READER_TO_DATA_IDENTITY")
            az.assert_called_once()
            args=az.call_args.args
            self.assertEqual(args[:3],("role","assignment","create"))
            self.assertEqual(args[args.index("--scope")+1],CTX["scope"])
            self.assertEqual(args[args.index("--role")+1],m.ROLE_GUID)
            self.assertEqual(args[args.index("--assignee-object-id")+1],CTX["data"]["Principal"])
            self.assertNotIn("Key Vault Secrets Officer",args)

    def test_failed_grant_no_retry(self):
        with mock.patch.object(m,"plan",return_value=(CTX,"ABSENT")), \
             mock.patch.object(m,"approve"), \
             mock.patch.object(m,"az",return_value=subprocess.CompletedProcess([],1)) as az:
            with self.assertRaisesRegex(m.Stop,"GRANT_RESULT_UNCERTAIN"):
                m.grant_once()
            az.assert_called_once()

    def test_revoke_only_our_exact_assignment(self):
        with mock.patch.object(m,"plan",return_value=(CTX,"EXACT_VERIFIED")), \
             mock.patch.object(m,"approve"), \
             mock.patch.object(m,"az",return_value=subprocess.CompletedProcess([],0)) as az, \
             mock.patch.object(m,"classify",return_value="ABSENT"):
            with contextlib.redirect_stdout(io.StringIO()):
                m.revoke_once()
            args=az.call_args.args
            self.assertEqual(args[:3],("role","assignment","delete"))
            self.assertTrue(args[args.index("--ids")+1].endswith("/"+m.known_assignment_id(CTX)))

    def test_no_revocation_of_other_assignments(self):
        with mock.patch.object(m,"plan",return_value=(CTX,"ABSENT")), \
             mock.patch.object(m,"az",side_effect=AssertionError("No revoke")):
            with contextlib.redirect_stdout(io.StringIO()):
                m.revoke_once()


if __name__ == "__main__":
    unittest.main()
