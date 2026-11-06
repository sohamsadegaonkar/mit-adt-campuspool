import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

path=Path("scripts/azure-vault-temporary-operator-secrets-officer.py")
spec=importlib.util.spec_from_file_location("writer",path)
w=importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
SUB="00000000-0000-0000-0000-000000000001"
OP="11111111-1111-1111-1111-111111111111"
SCOPE=f"/subscriptions/{SUB}/resourceGroups/{w.RG}/providers/Microsoft.KeyVault/vaults/{w.VAULT}"
ROLE=f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/{w.ROLE_GUID}"

class MockCloud:
    def __init__(self):
        self.roles=[]
        self.operations=[]
        self.wrong_subscription=False
        self.bad_grant=False
    def az(self,*args):
        self.operations.append(args)
        if args[:2]==("account","show"):
            return ("Wrong subscription" if self.wrong_subscription else "Azure for Students") if "name" in args else "user"
        if args[:2]==("group","show"):return "malaysiawest"
        if args[:2]==("keyvault","show"):
            if "properties.enableRbacAuthorization" in args:return "true"
            if "properties.enablePurgeProtection" in args:return "true"
            if "location" in args:return "malaysiawest"
            return SCOPE
        if args[:3]==("ad","signed-in-user","show"):return OP
        if args[:1]==("rest",):
            method=args[args.index("--method")+1]
            url=args[args.index("--url")+1]
            assert url.startswith("https://management.azure.com"+SCOPE+"/providers/Microsoft.Authorization/roleAssignments")
            if method=="get":
                assert "%24filter=atScope()" in url
                return json.dumps({"value":self.roles})
            if method=="put":
                body=json.loads(args[args.index("--body")+1])
                resource=url.replace(w.ROOT,"").split("?")[0]
                item={"id":resource,"properties":{**body["properties"],"scope":SCOPE}}
                if self.bad_grant:item["properties"]["principalId"]="33333333-3333-3333-3333-333333333333"
                self.roles=[item]
                return json.dumps(item)
            if method=="delete":
                self.roles=[]
                return ""
            raise AssertionError("Unexpected REST method")
        raise AssertionError("Unexpected CLI invocation")

class RoleGrantTests(unittest.TestCase):
    def run_action(self,cloud,mode,confirmation=""):
        stream=io.StringIO()
        with patch.object(w,"az",cloud.az),patch.object(sys,"argv",["program",mode]),\
             patch("builtins.input",return_value=confirmation),contextlib.redirect_stdout(stream):
            try:w.main();status="PASS"
            except w.Stop as exc:status="STOP_"+str(exc)
        return status,stream.getvalue()
    def test_plan_no_writes_no_identifier_output(self):
        cloud=MockCloud()
        status,stdout=self.run_action(cloud,"--plan")
        self.assertEqual(status,"PASS")
        self.assertIn("ROLE_PLAN_COMPLETE=YES",stdout)
        self.assertIn("OWNER_ACTION=PLAN_ONLY_NO_AZURE_WRITES",stdout)
        self.assertNotIn(SUB,stdout)
        self.assertNotIn(OP,stdout)
        self.assertFalse(any(a[:1]==("rest",) and a[a.index("--method")+1] in ("put","delete")
                             for a in cloud.operations if "--method" in a))
    def test_grant_and_revoke_requires_confirmation_and_exact_scope(self):
        cloud=MockCloud()
        self.assertEqual(self.run_action(cloud,"--grant")[0],"STOP_OWNER_CONFIRMATION_REQUIRED")
        self.assertFalse(cloud.roles)
        status,stdout=self.run_action(cloud,"--grant","GRANT_CAMPUSPOOL_TEMP_SECRET_WRITER")
        self.assertEqual(status,"PASS")
        self.assertIn("TEMP_SECRET_WRITER_GRANT_ACCEPTED=YES",stdout)
        self.assertEqual(cloud.roles[0]["properties"]["scope"],SCOPE)
        self.assertEqual(cloud.roles[0]["properties"]["roleDefinitionId"],ROLE)
        self.assertEqual(cloud.roles[0]["properties"]["principalType"],"User")
        self.assertIn("TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=YES",
                      self.run_action(cloud,"--plan")[1])
        self.assertIn("TEMP_SECRET_WRITER_ALREADY_PRESENT_NO_CHANGE=YES",
                      self.run_action(cloud,"--grant")[1])
        self.assertEqual(self.run_action(cloud,"--revoke")[0],"STOP_OWNER_CONFIRMATION_REQUIRED")
        status,stdout=self.run_action(cloud,"--revoke","REVOKE_CAMPUSPOOL_TEMP_SECRET_WRITER")
        self.assertEqual(status,"PASS")
        self.assertIn("TEMP_SECRET_WRITER_REVOKED_AND_READBACK_VERIFIED=YES",stdout)
        self.assertEqual(cloud.roles,[])
        self.assertIn("TEMP_SECRET_WRITER_ALREADY_ABSENT_NO_CHANGE=YES",
                      self.run_action(cloud,"--revoke")[1])
    def test_unmanaged_secret_officer_does_not_get_overwritten(self):
        cloud=MockCloud()
        cloud.roles=[{"id":SCOPE+"/providers/Microsoft.Authorization/roleAssignments/22222222-2222-2222-2222-222222222222",
                      "properties":{"principalId":OP,"scope":SCOPE,"roleDefinitionId":ROLE}}]
        status,stdout=self.run_action(cloud,"--grant","GRANT_CAMPUSPOOL_TEMP_SECRET_WRITER")
        self.assertEqual(status,"STOP_UNMANAGED_SECRET_WRITER_ROLE_REVIEW_REQUIRED")
        self.assertNotIn(OP,stdout)
    def test_fail_closed_on_wrong_subscription(self):
        cloud=MockCloud();cloud.wrong_subscription=True
        status,_=self.run_action(cloud,"--grant","GRANT_CAMPUSPOOL_TEMP_SECRET_WRITER")
        self.assertEqual(status,"STOP_WRONG_SUBSCRIPTION")
    def test_corrupted_grant_response_not_accepted(self):
        cloud=MockCloud();cloud.bad_grant=True
        status,_=self.run_action(cloud,"--grant","GRANT_CAMPUSPOOL_TEMP_SECRET_WRITER")
        self.assertEqual(status,"STOP_ROLE_ASSIGNMENT_RESPONSE_MISMATCH_REVIEW_PRIVATELY")
    def test_no_secret_data_operations_in_script(self):
        source=path.read_text()
        self.assertIn("ASSIGNMENT_AUTOMATIC_EXPIRY=NO",source)
        self.assertIn("NO_SECRET_VALUES_TOKENS_OR_DATABASE_ACCESSED=YES",source)
        self.assertIn('confirm("GRANT_CAMPUSPOOL_TEMP_SECRET_WRITER")',source)
        self.assertIn('confirm("REVOKE_CAMPUSPOOL_TEMP_SECRET_WRITER")',source)
        for forbidden in ("az keyvault secret set","az containerapp job start",
                          "az storage blob upload","ghp_","Storage Blob Data Contributor"):
            self.assertNotIn(forbidden,source)

if __name__=="__main__":
    unittest.main()
