import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT=Path("scripts/azure-vault-ghcr-token-one-shot-import.py").resolve()
spec=importlib.util.spec_from_file_location("ghcr_import",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

SUB="00000000-0000-0000-0000-000000000001"
SCOPE=f"/subscriptions/{SUB}/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01"
PRINCIPAL="11111111-1111-1111-1111-111111111111"
ASSIGN=SCOPE+"/providers/Microsoft.Authorization/roleAssignments/22222222-2222-2222-2222-222222222222"
ROLE=f"/subscriptions/{SUB}/providers/Microsoft.Authorization/roleDefinitions/{m.writer.ROLE_GUID}"
PAT="ghp_"+"z"*36
TOKEN="stub-azure-tenant-access-token-"+("x"*130)

class FakeCloud:
    def __init__(self):
        self.granted=False
        self.existing=False
        self.reject_grant=False
        self.reject_revoke=False
        self.uploaded=False
        self.access_denied=False
        self.pending_count=0
        self.calls=[]
    def prepare(self):
        self.calls.append("prepare")
        return (SCOPE,PRINCIPAL,ROLE,ASSIGN,
                {"id":ASSIGN,"properties":{"roleDefinitionId":ROLE,"principalId":PRINCIPAL,
                 "scope":SCOPE}} if self.granted else None)
    def arm(self,method,path,body=None):
        self.calls.append(method)
        self.assert_safe_operation(method,path,body)
        if method=="PUT":
            if self.reject_grant:raise m.writer.Stop("AZURE_RBAC_DENIED")
            self.granted=True
            return self.prepare()[-1]
        if method=="DELETE":
            if self.reject_revoke:raise m.writer.Stop("AZURE_RBAC_DENIED")
            self.granted=False
            return {}
        raise ValueError(method)
    def assert_safe_operation(self,method,path,body):
        assert path==ASSIGN+"?api-version=2022-04-01"
        if method=="PUT":
            assert body=={"properties":{"roleDefinitionId":ROLE,
                "principalId":PRINCIPAL,"principalType":"User"}}
    def kv(self,method,path,token,payload=None):
        self.calls.append("KV_"+method)
        assert token==TOKEN
        if self.access_denied:raise m.Block("VAULT_403_UNCLASSIFIED_NO_RETRY")
        if method=="GET" and self.pending_count>0:
            self.pending_count-=1
            raise m.Block("VAULT_RBAC_PROPAGATION_PENDING")
        if method=="GET":
            assert payload is None
            return {"value":[{"id":m.BASE+"/secrets/ghcr-pull-token"}] if self.existing else []}
        if method=="PUT":
            assert path.endswith("/secrets/ghcr-pull-token?api-version=7.4")
            assert payload["value"]==PAT
            self.uploaded=True
            return {"id":m.BASE+"/secrets/ghcr-pull-token/"+"a"*32,
                    "attributes":{"enabled":True},"value":PAT}
        raise AssertionError(method)

class OnceTests(unittest.TestCase):
    def run_once(self,cloud,authorize=True):
        stdout=io.StringIO()
        with patch.object(m.writer,"prepare",side_effect=cloud.prepare),\
             patch.object(m.writer,"arm",side_effect=cloud.arm),\
             patch.object(m.writer,"check_assignment",return_value=None),\
             patch.object(m,"require_operator_phrase",side_effect=(
                 None if authorize else m.Block("OWNER_CONFIRMATION_REQUIRED"))),\
             patch.object(m,"hidden_pat",return_value=PAT),\
             patch.object(m,"access_token",return_value=TOKEN),\
             patch.object(m,"kv_request",side_effect=cloud.kv),\
             patch.object(m.time,"sleep",return_value=None),\
             contextlib.redirect_stdout(stdout):
            try:
                m.run_once()
                result="PASS"
            except m.Block as error:
                result=str(error)
        return result,stdout.getvalue()
    def test_one_shot_success_and_verified_cleanup(self):
        cloud=FakeCloud()
        result,out=self.run_once(cloud)
        self.assertEqual(result,"PASS")
        self.assertTrue(cloud.uploaded)
        self.assertFalse(cloud.granted)
        self.assertIn("ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES",out)
        self.assertIn("TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES",out)
        self.assertEqual(cloud.calls.count("DELETE"),1)
        self.assertNotIn(PAT,out)
        self.assertNotIn(PRINCIPAL,out)
        self.assertNotIn(SUB,out)
        self.assertNotIn(TOKEN,out)
    def test_confirmation_refused_stops_before_grant(self):
        cloud=FakeCloud()
        status,_=self.run_once(cloud,authorize=False)
        self.assertEqual(status,"OWNER_CONFIRMATION_REQUIRED")
        self.assertFalse(cloud.granted)
        self.assertNotIn("PUT",cloud.calls)
    def test_existing_secret_does_not_overwrite_and_revokes(self):
        cloud=FakeCloud();cloud.existing=True
        status,out=self.run_once(cloud)
        self.assertEqual(status,"STOP_GHCR_TOKEN_SECRET_ALREADY_PRESENT")
        self.assertFalse(cloud.uploaded)
        self.assertFalse(cloud.granted)
        self.assertIn("TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES",out)
    def test_data_plane_denial_still_revokes(self):
        cloud=FakeCloud();cloud.access_denied=True
        status,out=self.run_once(cloud)
        self.assertEqual(status,"STOP_VAULT_403_UNCLASSIFIED_NO_RETRY")
        self.assertFalse(cloud.granted)
        self.assertEqual(cloud.calls.count("DELETE"),1)
    def test_rbac_propagation_retries_metadata_only_then_writes_once(self):
        cloud=FakeCloud();cloud.pending_count=3
        status,out=self.run_once(cloud)
        self.assertEqual(status,"PASS",out)
        self.assertIn("VAULT_RBAC_PROPAGATION_WAIT_BOUNDED=YES",out)
        self.assertIn("VAULT_SECRET_METADATA_READ_AUTHORIZED=YES",out)
        self.assertEqual(cloud.calls.count("KV_GET"),4)
        self.assertEqual(cloud.calls.count("KV_PUT"),1)
        self.assertEqual(cloud.calls.count("DELETE"),1)
        self.assertFalse(cloud.granted)
    def test_rbac_delay_exhaustion_does_not_write_token_and_revokes(self):
        cloud=FakeCloud();cloud.pending_count=m.RBAC_RETRY_ATTEMPTS+3
        status,out=self.run_once(cloud)
        self.assertEqual(status,"STOP_VAULT_RBAC_PROPAGATION_TIMEOUT")
        self.assertFalse(cloud.granted)
        self.assertFalse(cloud.uploaded)
        self.assertEqual(cloud.calls.count("KV_GET"),m.RBAC_RETRY_ATTEMPTS)
        self.assertEqual(cloud.calls.count("KV_PUT"),0)
        self.assertEqual(cloud.calls.count("DELETE"),1)
        self.assertIn("TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES",out)
    def test_firewall_403_fails_immediately_and_revokes(self):
        cloud=FakeCloud()
        def deny(method,path,token,payload=None):
            if method=="GET":raise m.Block("VAULT_FIREWALL_DENIED")
            raise AssertionError("No PUT after 403")
        with patch.object(cloud,"kv",side_effect=deny):
            status,out=self.run_once(cloud)
        self.assertEqual(status,"STOP_VAULT_FIREWALL_DENIED")
        self.assertFalse(cloud.granted)
        self.assertFalse(cloud.uploaded)
        self.assertEqual(cloud.calls.count("DELETE"),1)
    def test_http_error_json_is_classified_without_leaks(self):
        import urllib.error
        for code,expected in [
            ("ForbiddenByRbac","VAULT_RBAC_PROPAGATION_PENDING"),
            ("ForbiddenByFirewall","VAULT_FIREWALL_DENIED"),
            ("OtherCode","VAULT_403_UNCLASSIFIED_NO_RETRY")
        ]:
            secret="SENSITIVE-tenant-principal-and-token"
            body=json.dumps({"error":{"code":"Forbidden",
                "message":secret,"innererror":{"code":code}}}).encode("utf-8")
            err=urllib.error.HTTPError(m.BASE+"/secrets",403,"Forbidden",{},io.BytesIO(body))
            class FakeOpener:
                def open(self,request,timeout):
                    raise err
            with patch.object(m.urllib.request,"build_opener",return_value=FakeOpener()):
                with self.assertRaises(m.Block) as raised:
                    m.kv_request("GET","/secrets?api-version=7.4",TOKEN)
                self.assertEqual(str(raised.exception),expected)
                self.assertNotIn(secret,str(raised.exception))
    def test_rejected_grant_verifies_absence_without_delete(self):
        cloud=FakeCloud();cloud.reject_grant=True
        status,out=self.run_once(cloud)
        self.assertEqual(status,"STOP_AZURE_RBAC_DENIED")
        self.assertFalse(cloud.granted)
        self.assertEqual(cloud.calls.count("DELETE"),0)
        self.assertIn("TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES",out)
    def test_revoke_failure_prominently_reported(self):
        cloud=FakeCloud();cloud.reject_revoke=True
        status,out=self.run_once(cloud)
        self.assertEqual(status,"MANUAL_ROLE_REVOKE_REQUIRED_BEFORE_ANY_NEXT_ACTION")
        self.assertTrue(cloud.granted)
        self.assertIn("STOP_VAULT_WRITER_REVOKE_NOT_VERIFIED",out)
        self.assertNotIn("ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES",out)
    def test_existing_temp_role_refused_before_token(self):
        cloud=FakeCloud();cloud.granted=True
        status,_=self.run_once(cloud)
        self.assertEqual(status,"TEMP_WRITER_ALREADY_ACTIVE_REVOKE_AND_RESTART")
        self.assertNotIn("PUT",cloud.calls)
    def test_token_validation_no_leaks(self):
        self.assertEqual(m.validate_ghcr_token(PAT),PAT)
        for value in ["", "github_pat_"+"a"*50, "ghp_bad space", "glpat-"+"x"*40,
                      "ghp_"+"a"*600, "ghp_"+"ä"*40]:
            with self.assertRaises(m.Block):m.validate_ghcr_token(value)
        with patch.object(m,"kv_request",return_value={
              "value":[{"id":m.BASE+"/secrets/ghcr-pull-token"}]}):
            with self.assertRaisesRegex(m.Block,"GHCR_TOKEN_SECRET_ALREADY_PRESENT"):
                m.assert_secret_absent(TOKEN)
        with patch.object(m,"kv_request",return_value={"value":[],"nextLink":"https://evil.example/?"}):
            with self.assertRaisesRegex(m.Block,"VAULT_SECRET_INVENTORY_INCOMPLETE"):
                m.assert_secret_absent(TOKEN)
    def test_unstructured_error_message_rbac_code_is_safe_and_retryable(self):
        import urllib.error
        message="Caller resource /subscriptions/SENSITIVE InnerError: ForbiddenByRbac"
        body=json.dumps({"error":{"code":"Forbidden","message":message}}).encode("utf-8")
        err=urllib.error.HTTPError(m.BASE+"/secrets",403,"Forbidden",{},io.BytesIO(body))
        class FakeOpener:
            def open(self,request,timeout):
                raise err
        with patch.object(m.urllib.request,"build_opener",return_value=FakeOpener()):
            with self.assertRaises(m.Block) as raised:
                m.kv_request("GET","/secrets?api-version=7.4",TOKEN)
        self.assertEqual(str(raised.exception),"VAULT_RBAC_PROPAGATION_PENDING")
        self.assertNotIn("SENSITIVE",str(raised.exception))
    def test_aad_token_command_has_no_secret_arguments(self):
        with patch.object(m.writer,"az",return_value=TOKEN) as az:
            self.assertEqual(m.access_token(),TOKEN)
            az.assert_called_once_with("account","get-access-token","--resource",
                                       "https://vault.azure.net","--query",
                                       "accessToken","-o","tsv")
    def test_noninteractive_terminal_refused(self):
        with patch.object(m.sys,"stdin",type("FakeTerminal",(),{"isatty":lambda self: False})()):
            with self.assertRaisesRegex(m.Block,"INTERACTIVE_TERMINAL_REQUIRED"):
                m.hidden_pat()
    def test_source_no_secret_cli_set(self):
        source=SCRIPT.read_text()
        self.assertIn('getpass.getpass("GHCR read-only PAT (hidden input): ")',source)
        self.assertIn("urllib.request.ProxyHandler({})",source)
        self.assertIn("TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES",source)
        self.assertNotIn("az keyvault secret set",source)
        self.assertNotIn("az rest --method put",source)
        self.assertNotIn("ghp_"+("z"*36),source)
if __name__=="__main__":
    unittest.main()
