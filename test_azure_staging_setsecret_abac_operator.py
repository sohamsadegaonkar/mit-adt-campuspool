"""Synthetic only: no Azure calls, no credentials, no role grants."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

PATH=Path(__file__).parent/"scripts"/"azure-staging-setsecret-abac-operator.py"
spec=importlib.util.spec_from_file_location("staging_setsecret_abac_operator",PATH)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
RG="/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/campuspool-backup-rg"
VAULT=RG+"/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
CALLER="00000000-0000-4000-8000-000000000002"
ROLE_ID="00000000-0000-4000-8000-000000000003"
ASSIGN_ID="00000000-0000-4000-8000-000000000004"
CTX={"rg_id":RG,"vault_id":VAULT,"caller":CALLER,"assignment_uuid":ASSIGN_ID,
     "assignment_id":VAULT+"/providers/Microsoft.Authorization/roleAssignments/"+ASSIGN_ID}


def ok(o):
    return types.SimpleNamespace(returncode=0,stdout=json.dumps(o),stderr="")


class TemporarySetSecretTests(unittest.TestCase):
    def test_custom_role_has_only_setsecret_data_action(self):
        doc=m.expected_role_document(CTX)
        self.assertEqual(doc["Actions"],[])
        self.assertEqual(doc["DataActions"],[m.DATA_ACTION])
        self.assertEqual(doc["NotDataActions"],[])
        self.assertEqual(doc["AssignableScopes"],[RG])
        self.assertNotIn("delete",str(doc).lower())
        self.assertNotIn("getSecret",str(doc))

    def test_preview_condition_only_names_exact_stage_secret(self):
        self.assertIn("setSecret/action",m.CONDITION)
        self.assertIn("@Request[Microsoft.KeyVault/vaults/secrets:name]",m.CONDITION)
        self.assertIn("StringEquals 'campuspool-staging-pg-password'",m.CONDITION)
        self.assertNotIn("StringStartsWith",m.CONDITION)
        self.assertNotIn("StringLike",m.CONDITION)

    def test_role_rejects_any_broad_permission(self):
        role={"roleName":m.ROLE,"roleType":"CustomRole","name":ROLE_ID,
              "assignableScopes":[RG],
              "permissions":[{"actions":[],"notActions":[],"dataActions":[m.DATA_ACTION,
                          "Microsoft.KeyVault/vaults/secrets/getSecret/action"],
                          "notDataActions":[]}]}
        with patch.object(m,"json_az",return_value=[role]):
            with self.assertRaisesRegex(m.Stop,"EXISTING_CUSTOM_ROLE_HAS_UNEXPECTED_PERMISSIONS"):
                m.role_info(CTX)

    def test_role_exact_metadata_accepted(self):
        role={"roleName":m.ROLE,"roleType":"CustomRole","name":ROLE_ID,
              "assignableScopes":[RG],
              "permissions":[{"actions":[],"notActions":[],"dataActions":[m.DATA_ACTION],
                          "notDataActions":[]}]}
        with patch.object(m,"json_az",return_value=[role]):
            self.assertEqual(m.role_info(CTX),ROLE_ID)

    def test_missing_azure_abac_condition_is_not_accepted(self):
        for bad in ("",None,"true",
           "((!(ActionMatches{'Microsoft.KeyVault/vaults/secrets/setSecret/action'})) OR "
           "(@Request[Microsoft.KeyVault/vaults/secrets:name] StringStartsWith 'campuspool'))"):
            doc={"name":ASSIGN_ID,"properties":{
                "scope":VAULT,"principalId":CALLER,"roleDefinitionId":
                "/subscriptions/abc/providers/Microsoft.Authorization/roleDefinitions/"+ROLE_ID,
                "conditionVersion":"2.0","condition":bad}}
            with patch.object(m,"run_az",return_value=ok(doc)):
                with self.assertRaises(m.Stop):
                    m.assignment_info(CTX,ROLE_ID)

    def test_assignment_checks_exact_principal_scope_role_and_abac(self):
        doc={"name":ASSIGN_ID,"properties":{
            "scope":VAULT,"principalId":CALLER,"roleDefinitionId":
            "/subscriptions/abc/providers/Microsoft.Authorization/roleDefinitions/"+ROLE_ID,
            "conditionVersion":"2.0","condition":m.CONDITION}}
        with patch.object(m,"run_az",return_value=ok(doc)):
            self.assertEqual(m.assignment_info(CTX,ROLE_ID),"EXACT_VERIFIED")
        for key,val in (("principalId","other"),("scope",RG),("conditionVersion","1.0")):
            broken=json.loads(json.dumps(doc))
            broken["properties"][key]=val
            with patch.object(m,"run_az",return_value=ok(broken)):
                with self.assertRaises(m.Stop):
                    m.assignment_info(CTX,ROLE_ID)

    def test_grant_halts_when_secret_already_exists_no_writes(self):
        with patch.object(m,"status",return_value=(None,"ABSENT","EXISTS")),\
             patch.object(m,"confirm") as ask,patch.object(m,"run_az") as cmd:
            with self.assertRaisesRegex(m.Stop,"SECRET_ABSENCE_NOT_PROVEN"):
                m.grant(CTX)
            ask.assert_not_called()
            cmd.assert_not_called()

    def test_grant_requests_exact_conditional_assignment_only(self):
        captures=[]
        def az(*args,**kwargs):
            captures.append(args)
            return types.SimpleNamespace(returncode=0,stdout="",stderr="")
        with patch.object(m,"status",return_value=(ROLE_ID,"ABSENT","NOT_FOUND")),\
             patch.object(m,"confirm",return_value=None),\
             patch.object(m,"run_az",side_effect=az),\
             patch.object(m,"assignment_info",return_value="EXACT_VERIFIED"),\
             contextlib.redirect_stdout(io.StringIO()):
            m.grant(CTX)
        self.assertEqual(len(captures),1)
        args=captures[0]
        self.assertEqual(args[:3],("role","assignment","create"))
        self.assertEqual(args[args.index("--role")+1],ROLE_ID)
        self.assertEqual(args[args.index("--scope")+1],VAULT)
        self.assertEqual(args[args.index("--condition")+1],m.CONDITION)
        self.assertEqual(args[args.index("--condition-version")+1],"2.0")
        self.assertEqual(args[args.index("--assignee-object-id")+1],CALLER)
        self.assertNotIn("Secrets Officer",args)

    def test_revoke_only_precisely_identified_assignment(self):
        calls=[]
        def az(*args,**kwargs):
            calls.append(args)
            return types.SimpleNamespace(returncode=0,stdout="",stderr="")
        with patch.object(m,"status",return_value=(ROLE_ID,"EXACT_VERIFIED","EXISTS")),\
             patch.object(m,"confirm",return_value=None),\
             patch.object(m,"run_az",side_effect=az),\
             patch.object(m,"assignment_info",return_value="ABSENT"),\
             contextlib.redirect_stdout(io.StringIO()):
            m.revoke(CTX)
        self.assertEqual(len(calls),1)
        args=calls[0]
        self.assertEqual(args[:3],("role","assignment","delete"))
        self.assertEqual(args[args.index("--ids")+1],CTX["assignment_id"])

    def test_no_revoke_if_assignment_has_unexpected_condition(self):
        with patch.object(m,"status",return_value=(ROLE_ID,"UNVERIFIED","EXISTS")),\
             patch.object(m,"run_az") as cmd:
            with self.assertRaisesRegex(m.Stop,"NOT_OUR_EXACT_ROLE_ASSIGNMENT"):
                m.revoke(CTX)
            cmd.assert_not_called()


if __name__=="__main__":
    unittest.main()
