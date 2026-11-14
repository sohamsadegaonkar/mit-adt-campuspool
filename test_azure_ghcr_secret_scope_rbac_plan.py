import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT=Path("scripts/azure-ghcr-secret-scope-rbac-plan.py")
spec=importlib.util.spec_from_file_location("ghcr_scope_plan",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SUB="00000000-0000-0000-0000-000000000001"
PID="11111111-1111-1111-1111-111111111111"
VAULT=f"/subscriptions/{SUB}/resourceGroups/{m.RG}/providers/Microsoft.KeyVault/vaults/{m.VAULT}"
SECRET=VAULT+"/secrets/"+m.SECRET

class FakeArm:
    def __init__(self):
        self.calls=[]
        self.secret_exists=True
        self.secret_has_value=False
        self.assignments=[]
        self.inherited=[]
        self.wrong_sub=False
        self.secret_disabled=False
        self.pagination=False
        self.deny_read=False
    def az(self,*args):
        self.calls.append(args)
        if args[:2]==("account","show"):
            return "Another Subscription" if self.wrong_sub else m.EXPECTED_SUB
        if args[:2]==("group","show"): return "malaysiawest"
        if args[:2]==("keyvault","show"):
            return "true" if "properties.enableRbacAuthorization" in args else VAULT
        if args[:2]==("identity","show"):return PID
        if args[:1]==("rest",):
            self.assert_safe(args)
            url=args[args.index("--url")+1]
            if self.deny_read:raise m.Stop("AZURE_RBAC_READ_DENIED")
            if "/secrets/ghcr-pull-token?api-version=" in url:
                if not self.secret_exists: raise m.Stop("AZURE_READ_REQUEST_FAILED")
                props={"attributes":{"enabled":not self.secret_disabled}}
                if self.secret_has_value:props["value"]="NEVER_DISPLAY_ME"
                return json.dumps({"id":SECRET,"properties":props})
            if "/roleAssignments?" in url:
                attrs=self.inherited if "/secrets/" not in url else self.assignments
                data={"value":attrs}
                if self.pagination:data["nextLink"]="https://management.azure.com/next"
                return json.dumps(data)
            raise AssertionError(url)
        raise AssertionError(args)
    def assert_safe(self,args):
        assert args[args.index("--method")+1]=="get"
        assert args[args.index("--url")+1].startswith(m.ARM+VAULT)
        assert "--body" not in args

class PlanTests(unittest.TestCase):
    def run_plan(self,cloud):
        buf=io.StringIO()
        with patch.object(m,"az",cloud.az),patch.object(sys,"argv",["plan","--plan"]),contextlib.redirect_stdout(buf):
            try:m.main();result="PASS"
            except m.Stop as e:result=str(e)
        return result,buf.getvalue()
    def test_clean_plan_without_secret_values_or_writes(self):
        cloud=FakeArm()
        status,out=self.run_plan(cloud)
        self.assertEqual(status,"PASS")
        self.assertIn("GHCR_PULL_TOKEN_ARM_METADATA_PRESENT=YES",out)
        self.assertIn("PROPOSED_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY",out)
        self.assertIn("AZURE_ROLE_GRANTS_OR_SECRET_VALUES_CHANGED=NO",out)
        self.assertIn("GHCR_SECRET_SCOPE_RBAC_PLAN_COMPLETE=YES",out)
        self.assertNotIn(PID,out)
        self.assertNotIn(SUB,out)
        self.assertTrue(all(a[a.index("--method")+1]=="get" for a in cloud.calls if "--method" in a))
    def test_missing_secret_stops(self):
        cloud=FakeArm();cloud.secret_exists=False
        self.assertEqual(self.run_plan(cloud)[0],"AZURE_READ_REQUEST_FAILED")
    def test_secret_value_unexpected_stops_and_never_displays(self):
        cloud=FakeArm();cloud.secret_has_value=True
        status,out=self.run_plan(cloud)
        self.assertEqual(status,"UNEXPECTED_SECRET_VALUE_IN_ARM_RESPONSE")
        self.assertNotIn("NEVER_DISPLAY_ME",out)
    def test_identity_with_existing_vault_role_requires_review(self):
        cloud=FakeArm()
        cloud.inherited=[{"properties":{"principalId":PID,"scope":VAULT,"roleDefinitionId":"some-role-id"}}]
        status,_=self.run_plan(cloud)
        self.assertEqual(status,"UAI_HAS_EXISTING_ROLE_ASSIGNMENTS_REVIEW_PRIVATELY")
    def test_identity_with_existing_secret_role_requires_review(self):
        cloud=FakeArm()
        cloud.assignments=[{"properties":{"principalId":PID,"scope":SECRET,"roleDefinitionId":"some-role-id"}}]
        status,_=self.run_plan(cloud)
        self.assertEqual(status,"UAI_HAS_EXISTING_ROLE_ASSIGNMENTS_REVIEW_PRIVATELY")
    def test_other_principals_not_mistaken_for_reader(self):
        cloud=FakeArm()
        cloud.assignments=[{"properties":{"principalId":"22222222-2222-2222-2222-222222222222",
                                          "scope":VAULT,"roleDefinitionId":"some-role"}}]
        self.assertEqual(self.run_plan(cloud)[0],"PASS")
    def test_wrong_subscription_denied_before_secret_metadata(self):
        cloud=FakeArm();cloud.wrong_sub=True
        status,_=self.run_plan(cloud)
        self.assertEqual(status,"WRONG_SUBSCRIPTION")
        self.assertNotIn("rest", [x[0] for x in cloud.calls])
    def test_secret_disabled_denied(self):
        cloud=FakeArm();cloud.secret_disabled=True
        self.assertEqual(self.run_plan(cloud)[0],"GHCR_SECRET_DISABLED_OR_INVALID")
    def test_rbac_pagination_fail_closed(self):
        cloud=FakeArm();cloud.pagination=True
        self.assertEqual(self.run_plan(cloud)[0],"RBAC_ASSIGNMENTS_PAGINATED_NEEDS_REVIEW")
    def test_rbac_read_denial_fail_closed(self):
        cloud=FakeArm();cloud.deny_read=True
        self.assertEqual(self.run_plan(cloud)[0],"AZURE_RBAC_READ_DENIED")

if __name__=="__main__":unittest.main()
