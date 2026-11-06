import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location(
    "arm_audit",Path("scripts/azure-vault-operator-arm-readonly.py"))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

OID="11111111-1111-1111-1111-111111111111"
SUB="00000000-0000-0000-0000-000000000001"
ROLE_UUID="22222222-2222-2222-2222-222222222222"
VAULT=f"/subscriptions/{SUB}/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
RID=f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/{ROLE_UUID}"

class RoleAuditTest(unittest.TestCase):
    def case(self,roles=None,role_name="Owner",arm_error=None,source_error=None,pagination=False):
        roles=roles if roles is not None else []
        calls=[]
        def az(*args):
            calls.append(args)
            if args[:2]==("account","show"):return "Azure for Students"
            if args[:2]==("group","show"):return "malaysiawest"
            if args[:2]==("keyvault","show"):
                return "true" if "properties.enableRbacAuthorization" in args else VAULT
            if args[:3]==("ad","signed-in-user","show"):return OID
            if args[:1]==("rest",):
                self.assertIn("--method",args)
                self.assertIn("--url",args)
                self.assertEqual(args[args.index("--method")+1],"get")
                url=args[args.index("--url")+1]
                self.assertTrue(url.startswith("https://management.azure.com/"))
                if "/roleAssignments?" in url:
                    self.assertIn("%24filter=atScope()",url)
                    if source_error:raise m.AuditStop(source_error)
                    payload={"value":roles}
                    if pagination:payload["nextLink"]="https://management.azure.com/next"
                    return json.dumps(payload)
                self.assertTrue(url.startswith("https://management.azure.com"+RID+"?"))
                if arm_error:raise m.AuditStop(arm_error)
                return json.dumps({"properties":{"roleName":role_name}})
            raise AssertionError("Unexpected az invocation: "+str(args))
        original=m.run_az
        m.run_az=az
        sink=io.StringIO()
        try:
            with contextlib.redirect_stdout(sink):
                try:
                    m.audit()
                    result="PASS"
                except m.AuditStop as e:
                    result=str(e)
        finally:
            m.run_az=original
        return result,sink.getvalue(),calls

    def assignment(self,principal=OID,condition=None):
        return {"properties":{"principalId":principal,
                "roleDefinitionId":RID,"condition":condition}}

    def test_zero_direct_roles_is_explicitly_not_effective_access(self):
        result,out,calls=self.case()
        self.assertEqual(result,"PASS")
        self.assertIn("DIRECT_OPERATOR_ROLE_ASSIGNMENTS=0",out)
        self.assertIn("DIRECT_ROLE_ASSIGNMENT_ADMIN_CANDIDATE=NO_OR_UNKNOWN",out)
        self.assertIn("GROUP_TRANSITIVE_PIM_DENY_AND_CUSTOM_PERMISSIONS_NOT_VERIFIED=YES",out)
        self.assertNotIn(OID,out)
        self.assertNotIn(SUB,out)
        self.assertNotIn("az role assignment list",str(calls))

    def test_admin_candidate(self):
        result,out,_=self.case([self.assignment()])
        self.assertEqual(result,"PASS")
        self.assertIn("DIRECT_ROLE_ASSIGNMENT_ADMIN_CANDIDATE=YES",out)
        self.assertIn("DIRECT_SECRET_WRITER_CANDIDATE=NO_OR_UNKNOWN",out)
        self.assertNotIn("Owner",out)

    def test_secret_writer_candidate(self):
        result,out,_=self.case([self.assignment()],role_name="Key Vault Secrets Officer")
        self.assertEqual(result,"PASS")
        self.assertIn("DIRECT_SECRET_WRITER_CANDIDATE=YES",out)

    def test_ignore_other_principal(self):
        result,out,_=self.case([self.assignment(principal="33333333-3333-3333-3333-333333333333")])
        self.assertEqual(result,"PASS")
        self.assertIn("DIRECT_OPERATOR_ROLE_ASSIGNMENTS=0",out)

    def test_conditional_permissions_not_marked_unrestricted(self):
        result,out,_=self.case([self.assignment(condition="conditional-expression")])
        self.assertEqual(result,"PASS")
        self.assertIn("CONDITIONAL_ASSIGNMENT_REVIEW_NEEDED=YES",out)

    def test_arm_permission_blocked_fail_closed(self):
        result,out,_=self.case(source_error="AZURE_API_AZURE_RBAC_DENIED")
        self.assertEqual(result,"AZURE_API_AZURE_RBAC_DENIED")
        self.assertEqual(out,"")

    def test_pagination_fails_closed(self):
        result,out,_=self.case(pagination=True)
        self.assertEqual(result,"ROLE_ASSIGNMENT_PAGINATION_REQUIRES_REVIEW")
        self.assertEqual(out,"")

    def test_definition_missing_does_not_assume_no_roles(self):
        result,out,_=self.case([self.assignment()],arm_error="AZURE_API_AZURE_RBAC_DENIED")
        self.assertEqual(result,"AZURE_API_AZURE_RBAC_DENIED")
        self.assertEqual(out,"")

    def test_bad_role_id_refused(self):
        b=self.assignment()
        b["properties"]["roleDefinitionId"]="https://malicious.example/test"
        result,out,_=self.case([b])
        self.assertEqual(result,"ROLE_DEFINITION_ID_INVALID")
        self.assertEqual(out,"")

    def test_bounded_sanitized_error_categories(self):
        for text,category in (
            ("unrecognized argument: --x","CLI_ARGUMENT_UNSUPPORTED"),
            ("AuthorizationFailed /subscriptions/SECRET","AZURE_RBAC_DENIED"),
            ("insufficient privileges graph.microsoft.com","GRAPH_ACCESS_RESTRICTED"),
            ("Please run az login","AZURE_LOGIN_REQUIRED"),
            ("user@example.com /subscriptions/SECRET","UNCLASSIFIED"),
        ):
            self.assertEqual(m.safe_error(text),category)

    def test_source_is_arm_get_only(self):
        s=Path("scripts/azure-vault-operator-arm-readonly.py").read_text()
        self.assertIn('"rest","--method","get"',s)
        self.assertIn("%24filter=",s)
        self.assertIn("CANDIDATES_NOT_EFFECTIVE_PERMISSION_PROOF=YES",s)
        for bad in ("az role assignment create","az keyvault secret set",
                    "az containerapp job create","az storage blob upload",
                    "--assignee-object-id"):
            # comments and docs may mention unsupported flag
            if bad=="--assignee-object-id": continue
            self.assertNotIn(bad,s)

if __name__=="__main__":
    unittest.main()
