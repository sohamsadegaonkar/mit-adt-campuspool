import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT=Path("scripts/azure-ghcr-secret-scope-rbac-operator.py")
spec=importlib.util.spec_from_file_location("ghcr_secret_rbac_operator",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

SUB="00000000-0000-0000-0000-000000000001"
PRINCIPAL="11111111-1111-1111-1111-111111111111"
VAULT=f"/subscriptions/{SUB}/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
SECRET=VAULT+"/secrets/ghcr-pull-token"
ROLE=f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/{m.ROLE_GUID}"

class FakeAzure:
    def __init__(self):
        self.calls=[]
        self.present=False
        self.wrong_sub=False
        self.missing_secret=False
        self.broad_role=False
        self.deny_write=False
        self.bad_put_scope=False
        self.no_readback=False
        self.malformed_secret_value=False
        self.resource=None
    def assignment(self,scope=None):
        return {"id":self.resource,"properties":{
            "scope":scope or SECRET,
            "principalId":PRINCIPAL,
            "roleDefinitionId":ROLE,
            "principalType":"ServicePrincipal",
            "condition":None,
        }}
    def az(self,*args):
        self.calls.append(args)
        if args[:2]==("account","show"):
            return "Personal subscription" if self.wrong_sub else "Azure for Students"
        if args[:2]==("group","show"):return "malaysiawest"
        if args[:2]==("keyvault","show"):
            return "true" if "properties.enableRbacAuthorization" in args else VAULT
        if args[:2]==("identity","show"):return PRINCIPAL
        if args[:1]==("rest",):
            method=args[args.index("--method")+1]
            url=args[args.index("--url")+1]
            assert url.startswith(m.preflight.ARM+VAULT)
            if "/roleAssignments/" in url and "?" in url and method!="get":
                self.resource=url[len(m.preflight.ARM):].split("?")[0]
                if self.deny_write:raise m.preflight.Stop("AZURE_RBAC_READ_DENIED")
                if method=="put":
                    body=json.loads(args[args.index("--body")+1])
                    assert body=={"properties":{"roleDefinitionId":ROLE,
                        "principalId":PRINCIPAL,"principalType":"ServicePrincipal"}}
                    self.present=True
                    return json.dumps(self.assignment(scope=VAULT if self.bad_put_scope else SECRET))
                if method=="delete":
                    self.present=False
                    return ""
            if method=="get" and "/secrets/ghcr-pull-token?" in url:
                if self.missing_secret:raise m.preflight.Stop("AZURE_READ_REQUEST_FAILED")
                props={"attributes":{"enabled":True}}
                if self.malformed_secret_value:props["value"]="SHOULD_NEVER_BE_SEEN"
                return json.dumps({"id":SECRET,"properties":props})
            if method=="get" and "/roleAssignments?" in url:
                rows=[]
                if self.broad_role and "/secrets/" not in url:
                    rows=[{"id":VAULT+"/providers/Microsoft.Authorization/roleAssignments/33333333-3333-3333-3333-333333333333",
                        "properties":{"scope":VAULT,"roleDefinitionId":ROLE,"principalId":PRINCIPAL}}]
                if self.present and not self.no_readback and "/secrets/" in url:
                    rows.append(self.assignment())
                return json.dumps({"value":rows})
        raise AssertionError("Unexpected az request "+str(args))

class GrantTests(unittest.TestCase):
    def operation(self,cloud,mode,phrase=""):
        out=io.StringIO()
        with patch.object(m.preflight,"az",cloud.az),\
             patch.object(sys,"argv",["cli",mode]),\
             patch("builtins.input",return_value=phrase),\
             contextlib.redirect_stdout(out):
            try:
                m.main()
                status="PASS"
            except m.Stop as e:
                status="STOP_"+str(e)
        return status,out.getvalue()
    def test_plan_no_mutations(self):
        cloud=FakeAzure()
        status,out=self.operation(cloud,"--plan")
        self.assertEqual(status,"PASS")
        self.assertIn("GHCR_SECRET_READER_PLAN_COMPLETE=YES",out)
        self.assertIn("ASSIGNMENT_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY",out)
        self.assertIn("NO_AZURE_CHANGES=YES",out)
        self.assertNotIn(SUB,out)
        self.assertNotIn(PRINCIPAL,out)
        self.assertFalse(any(a[a.index("--method")+1] in ("put","delete")
             for a in cloud.calls if "--method" in a))
    def test_owner_must_consent_before_grant(self):
        cloud=FakeAzure()
        status,_=self.operation(cloud,"--grant")
        self.assertEqual(status,"STOP_EXPLICIT_OWNER_CONFIRMATION_REQUIRED")
        self.assertFalse(cloud.present)
    def test_exact_scope_grant_verify_revoke(self):
        cloud=FakeAzure()
        status,out=self.operation(cloud,"--grant",m.CONFIRM_GRANT)
        self.assertEqual(status,"PASS",out)
        self.assertIn("GHCR_SECRET_ONLY_READER_ROLE_GRANTED_AND_READBACK_VERIFIED=YES",out)
        self.assertTrue(cloud.present)
        self.assertIn("GHCR_SECRET_ONLY_UAI_ROLE_ASSIGNMENT_VERIFIED=YES",
                      self.operation(cloud,"--verify")[1])
        self.assertIn("GHCR_SECRET_READER_ALREADY_PRESENT_NO_CHANGE=YES",
                      self.operation(cloud,"--grant")[1])
        status,_=self.operation(cloud,"--revoke")
        self.assertEqual(status,"STOP_EXPLICIT_OWNER_CONFIRMATION_REQUIRED")
        self.assertTrue(cloud.present)
        status,out=self.operation(cloud,"--revoke",m.CONFIRM_REVOKE)
        self.assertEqual(status,"PASS")
        self.assertIn("GHCR_SECRET_ONLY_READER_ROLE_REVOKED_AND_VERIFIED=YES",out)
        self.assertFalse(cloud.present)
        self.assertIn("GHCR_SECRET_READER_ALREADY_ABSENT_NO_CHANGE=YES",
                      self.operation(cloud,"--revoke")[1])
    def test_broad_existing_access_not_ignored(self):
        cloud=FakeAzure();cloud.broad_role=True
        status,_=self.operation(cloud,"--grant",m.CONFIRM_GRANT)
        self.assertEqual(status,"STOP_UNEXPECTED_UAI_ROLE_ASSIGNMENT_REVIEW")
        self.assertFalse(cloud.present)
    def test_wrong_subscription_stops(self):
        cloud=FakeAzure();cloud.wrong_sub=True
        status,_=self.operation(cloud,"--grant",m.CONFIRM_GRANT)
        self.assertEqual(status,"STOP_WRONG_SUBSCRIPTION")
    def test_secret_missing_stops(self):
        cloud=FakeAzure();cloud.missing_secret=True
        status,_=self.operation(cloud,"--grant",m.CONFIRM_GRANT)
        self.assertEqual(status,"STOP_AZURE_READ_REQUEST_FAILED")
    def test_secret_value_never_returned_or_printed(self):
        cloud=FakeAzure();cloud.malformed_secret_value=True
        status,out=self.operation(cloud,"--plan")
        self.assertEqual(status,"STOP_SECRET_METADATA_RESPONSE_INVALID")
        self.assertNotIn("SHOULD_NEVER_BE_SEEN",out)
    def test_iam_write_denied_not_masked(self):
        cloud=FakeAzure();cloud.deny_write=True
        status,out=self.operation(cloud,"--grant",m.CONFIRM_GRANT)
        self.assertEqual(status,"STOP_AZURE_RBAC_WRITE_DENIED_OR_FAILED")
        self.assertFalse(cloud.present)
        self.assertNotIn(PRINCIPAL,out)
    def test_grant_response_unexpected_scope_stops(self):
        cloud=FakeAzure();cloud.bad_put_scope=True
        status,_=self.operation(cloud,"--grant",m.CONFIRM_GRANT)
        self.assertEqual(status,"STOP_EXACT_ROLE_ASSIGNMENT_MISMATCH_REVIEW")
        self.assertTrue(cloud.present)
    def test_readback_not_visible_stops(self):
        cloud=FakeAzure();cloud.no_readback=True
        status,_=self.operation(cloud,"--grant",m.CONFIRM_GRANT)
        self.assertEqual(status,"STOP_GRANT_ACCEPTED_BUT_READBACK_NOT_YET_VISIBLE")
        self.assertTrue(cloud.present)
    def test_only_expected_mutations_and_no_secret_value_calls(self):
        source=SCRIPT.read_text()
        for word in ("keyvault secret show","getSecret/action","ghp_",
                     "az storage","--assignee-object-id"):
            self.assertNotIn(word,source)
        self.assertIn('principalType":"ServicePrincipal"',source)
        self.assertIn('require(CONFIRM_GRANT)',source)
        self.assertIn('require(CONFIRM_REVOKE)',source)

if __name__=="__main__":
    unittest.main()
