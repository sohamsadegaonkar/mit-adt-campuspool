#!/usr/bin/env python3
"""One-shot, owner-authorized GHCR pull token import into CampusPool Azure Vault.

- No secret values passed in subprocess arguments, environment variables, disk,
  logs or stdout. Token entered with hidden TTY getpass, kept in process memory.
- Exact Azure student subscription, Vault scope and human identity reused from
  guarded independent operator IAM helper.
- Deterministic Vault-only Secrets Officer ARM grant, then Key Vault REST write,
  then exact grant revocation in a finally block, with readback verification.
- No GHCR PAT creation, token validation against GitHub, worker deployment,
  other secret imports, managed-identity access grants, Blob writes or DB calls.
- Not durable against SIGKILL, host crash, CLI abort while granting permissions;
  manual --revoke recovery path must be followed if cleanup is not confirmed.
"""
import getpass
import importlib.util
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location(
    "vault_writer", HERE/"azure-vault-temporary-operator-secrets-officer.py")
writer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)

VAULT="campuspool-backup-kv-01"
SECRET_NAME="ghcr-pull-token"
BASE=f"https://{VAULT}.vault.azure.net"
API="7.4"
RESOURCE="https://vault.azure.net"
MAX_RESPONSE=65536
MAX_TOKEN=256
RBAC_RETRY_ATTEMPTS=16
RBAC_RETRY_INTERVAL_SECONDS=20
MAX_ERROR_BYTES=8192
VERSION_ID=re.compile(rf"^{re.escape(BASE)}/secrets/{SECRET_NAME}/[0-9a-f]{{32}}$",re.I)
META_ID=re.compile(rf"^{re.escape(BASE)}/secrets/[A-Za-z0-9-]+$",re.I)

class Block(Exception):
    pass

def read_json_response(response):
    raw=response.read(MAX_RESPONSE+1)
    if len(raw)>MAX_RESPONSE:
        raise Block("VAULT_RESPONSE_TOO_LARGE")
    try:
        body=json.loads(raw)
        if not isinstance(body,dict):
            raise ValueError("not object")
        return body
    except (TypeError,ValueError,UnicodeDecodeError):
        raise Block("VAULT_RESPONSE_INVALID")

def kv_request(method,path,access_token,payload=None):
    if not isinstance(access_token,str) or not (100<len(access_token)<20000):
        raise Block("VAULT_AAD_TOKEN_INVALID")
    if method not in ("GET","PUT") or path not in (
        f"/secrets?api-version={API}",
        f"/secrets/{SECRET_NAME}?api-version={API}",
    ):
        raise Block("VAULT_OPERATION_NOT_ALLOWLISTED")
    if method=="GET" and payload is not None:
        raise Block("VAULT_GET_WITH_BODY_BLOCKED")
    data=None if payload is None else json.dumps(payload,separators=(",",":")).encode("utf-8")
    req=urllib.request.Request(BASE+path,data=data,method=method,
        headers={"Authorization":"Bearer "+access_token,
                 "Accept":"application/json",
                 **({"Content-Type":"application/json; charset=utf-8"} if data is not None else {})})
    # Disable ambient HTTP(S)_PROXY overrides: credential material must be sent
    # only over system-TLS-verified HTTPS directly to this pinned Vault hostname.
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req,timeout=20) as response:
            if response.status!=200:
                raise Block("VAULT_NON_SUCCESS_STATUS")
            return read_json_response(response)
    except urllib.error.HTTPError as error:
        if error.code==403:
            # Azure error messages can contain principal IDs, IP addresses,
            # and resource paths. Read bounded JSON but emit only fixed codes.
            try:
                raw=error.read(MAX_ERROR_BYTES+1)
                if len(raw)>MAX_ERROR_BYTES: raise ValueError("oversized")
                envelope=json.loads(raw)
                detail=envelope.get("error",{})
                codes=[]
                if isinstance(detail,dict):
                    codes.append(detail.get("code"))
                    inner=detail.get("innererror",detail.get("innerError",{}))
                    if isinstance(inner,dict): codes.append(inner.get("code"))
                    # Some Key Vault 403 responses place InnerError text
                    # within the message instead of a structured field.
                    # Inspect for fixed codes only. Never print the message,
                    # which may include IP addresses or Azure object IDs.
                    message=detail.get("message","")
                    if isinstance(message,str):
                        for code in ("ForbiddenByFirewall","ForbiddenByConnection",
                                     "ForbiddenByRbac"):
                            if code in message: codes.append(code)
                if "ForbiddenByFirewall" in codes or "ForbiddenByConnection" in codes:
                    raise Block("VAULT_FIREWALL_DENIED")
                if "ForbiddenByRbac" in codes:
                    raise Block("VAULT_RBAC_PROPAGATION_PENDING")
            except Block:
                raise
            except (ValueError,TypeError,UnicodeDecodeError,OSError,AttributeError):
                pass
            raise Block("VAULT_403_UNCLASSIFIED_NO_RETRY")
        if error.code==401: raise Block("VAULT_AAD_LOGIN_REQUIRED")
        if error.code==429: raise Block("VAULT_RATE_LIMITED")
        raise Block("VAULT_HTTP_ERROR")
    except (urllib.error.URLError,TimeoutError,ValueError,OSError):
        raise Block("VAULT_NETWORK_OR_TLS_FAILED")

def access_token():
    token=writer.az("account","get-access-token","--resource",RESOURCE,
                    "--query","accessToken","-o","tsv")
    if not isinstance(token,str) or len(token)<100 or len(token)>20000 or \
       any(c in token for c in "\r\n\t "):
        raise Block("VAULT_AAD_TOKEN_INVALID")
    return token

def assert_secret_absent(token):
    data=kv_request("GET",f"/secrets?api-version={API}",token)
    items=data.get("value")
    if not isinstance(items,list) or data.get("nextLink"):
        # A paginated secret list is not evidence that this name is absent.
        raise Block("VAULT_SECRET_INVENTORY_INCOMPLETE")
    for item in items:
        if not isinstance(item,dict) or not isinstance(item.get("id"),str):
            raise Block("VAULT_SECRET_METADATA_INVALID")
        sid=item["id"].rstrip("/")
        if not META_ID.fullmatch(sid):
            raise Block("VAULT_SECRET_METADATA_UNEXPECTED")
        if sid.casefold()==(BASE+"/secrets/"+SECRET_NAME).casefold():
            raise Block("GHCR_TOKEN_SECRET_ALREADY_PRESENT")
    return len(items)

def wait_for_secret_inventory(access):
    """Retry only metadata LIST on explicit RBAC propagation, never secret PUT."""
    for attempt in range(RBAC_RETRY_ATTEMPTS):
        try:
            count=assert_secret_absent(access)
            print("VAULT_SECRET_METADATA_READ_AUTHORIZED=YES")
            print("GHCR_TOKEN_SECRET_PREEXISTING=NO")
            return count
        except Block as error:
            if str(error)!="VAULT_RBAC_PROPAGATION_PENDING": raise
            if attempt==0: print("VAULT_RBAC_PROPAGATION_WAIT_BOUNDED=YES")
            if attempt==RBAC_RETRY_ATTEMPTS-1:
                raise Block("VAULT_RBAC_PROPAGATION_TIMEOUT")
            time.sleep(RBAC_RETRY_INTERVAL_SECONDS)
    raise Block("VAULT_RBAC_PROPAGATION_TIMEOUT")

def validate_ghcr_token(value):
    # GitHub Packages requires a classic PAT, not fine-grained github_pat_*.
    # Scope 'read:packages' is chosen in GitHub UI and cannot be proven here.
    if not isinstance(value,str) or len(value)>MAX_TOKEN or len(value)<30 or \
       not value.startswith("ghp_") or any(not (32<=ord(c)<=126) for c in value) or \
       any(c.isspace() for c in value):
        raise Block("GHCR_CLASSIC_TOKEN_FORMAT_INVALID")
    return value

def import_secret(token,value):
    payload={"value":value,"contentType":"application/vnd.github.ghcr-pull-token"}
    data=kv_request("PUT",f"/secrets/{SECRET_NAME}?api-version={API}",token,payload)
    if not VERSION_ID.fullmatch(str(data.get("id",""))) or \
       not isinstance(data.get("attributes"),dict) or \
       data["attributes"].get("enabled") is not True:
        raise Block("GHCR_SECRET_WRITE_RESPONSE_INVALID")
    # Never read back secret values. The PUT response can echo them: keep local.
    return True

def require_operator_phrase():
    expected="IMPORT_GHCR_TOKEN_AND_REVOKE_VAULT_WRITER"
    print("WARNING=ONE_SHOT_GRANT_VAULT_SECRET_OFFICER_IMPORT_REVOKE")
    print("WARNING=ALL_VAULT_SECRETS_ACCESS_DURING_IMPORT_NO_AUTOMATIC_EXPIRY")
    print("WARNING=IF_INTERRUPTED_MANUALLY_REVOKE_TEMP_SECRET_WRITER")
    try:
        response=input("Type "+expected+" to authorize this exact workflow: ").strip()
    except EOFError:
        response=""
    if response!=expected:
        raise Block("OWNER_CONFIRMATION_REQUIRED")

def hidden_pat():
    if not sys.stdin.isatty():
        raise Block("INTERACTIVE_TERMINAL_REQUIRED")
    print("Enter a NEW GitHub PAT (classic) with ONLY read:packages.")
    print("Token input is hidden; do not paste it into chat, scripts, command args or files.")
    try:
        value=getpass.getpass("GHCR read-only PAT (hidden input): ")
    except (EOFError, KeyboardInterrupt):
        raise Block("TOKEN_ENTRY_INTERRUPTED")
    return validate_ghcr_token(value)

def run_once():
    scope,principal,role,assignment,existing=writer.prepare()
    if existing is not None:
        raise Block("TEMP_WRITER_ALREADY_ACTIVE_REVOKE_AND_RESTART")
    print("VAULT_SCOPE_AND_OPERATOR_VERIFIED=YES")
    print("TEMP_WRITER_INITIAL_STATUS=ABSENT")
    print("GHCR_SECRET_NAME="+SECRET_NAME)
    print("GHCR_TOKEN_REQUIRED_SCOPE=READ_PACKAGES_ONLY_CLASSIC")
    print("ONE_SHOT_AUTOMATIC_REVOCATION_ATTEMPT=YES")
    print("NO_AUTO_EXPIRY_OR_CRASH_PROOF_GUARANTEE=YES")
    print("NO_GHCR_TOKEN_VALUE_WILL_BE_PRINTED=YES")
    require_operator_phrase()
    # Obtain token before granting powerful role, minimizing grant duration.
    ghcr=hidden_pat()
    granted_or_ambiguous=False
    grant_acknowledged=False
    outcome=None
    revoke_ok=False
    try:
        # If PUT raises after Azure accepts it, the cleanup still attempts
        # DELETE. Never assume a failed PUT means the role is absent.
        granted_or_ambiguous=True
        reply=writer.arm("PUT",assignment+"?api-version=2022-04-01",{
            "properties":{"roleDefinitionId":role,"principalId":principal,
                          "principalType":"User"}
        })
        grant_acknowledged=True
        writer.check_assignment(reply,scope,principal,assignment)
        print("TEMP_VAULT_WRITER_GRANT_ACCEPTED=YES")
        vault_token=access_token()
        wait_for_secret_inventory(vault_token)
        import_secret(vault_token,ghcr)
        print("GHCR_PULL_TOKEN_IMPORTED_TO_KEY_VAULT=YES")
        print("GHCR_TOKEN_SCOPE_NOT_INDEPENDENTLY_VERIFIED=YES")
        outcome="SUCCESS"
    except (Block,writer.Stop) as exc:
        outcome="STOP_"+str(exc)
    finally:
        # Attempt exact-role cleanup even if grant or secret import failed.
        if granted_or_ambiguous:
            try:
                # A successful PUT is authoritative even if list is briefly
                # stale. Always DELETE that deterministic role when PUT ACKs.
                # If PUT failed, read IAM state before deciding to DELETE.
                if grant_acknowledged:
                    writer.arm("DELETE",assignment+"?api-version=2022-04-01")
                else:
                    *_,current=writer.prepare()
                    if current is not None:
                        writer.check_assignment(current,scope,principal,assignment)
                        writer.arm("DELETE",assignment+"?api-version=2022-04-01")
                    elif outcome not in ("STOP_AZURE_RBAC_DENIED",):
                        raise Block("AMBIGUOUS_ROLE_CREATE_NEEDS_MANUAL_REVIEW")
                *_,current=writer.prepare()
                if current is not None:
                    raise Block("TEMP_WRITER_STILL_ASSIGNED")
                revoke_ok=True
                print("TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES")
            except (Block,writer.Stop):
                # Assignment might have been created despite an ambiguous PUT.
                # Do not claim cleanup if RBAC status cannot be verified.
                print("STOP_VAULT_WRITER_REVOKE_NOT_VERIFIED")
                print("RECOVERY=RUN_PYTHON_TEMP_OPERATOR_WRITER_REVOKE_AND_VERIFY")
    if not revoke_ok:
        raise Block("MANUAL_ROLE_REVOKE_REQUIRED_BEFORE_ANY_NEXT_ACTION")
    if outcome!="SUCCESS":
        raise Block(outcome)
    print("ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES")
    print("NO_DB_CREDENTIAL_CA_JOB_BLOB_OR_ROLE_READER_GRANTS_CHANGED=YES")

if __name__=="__main__":
    if len(sys.argv)!=2 or sys.argv[1]!="--run-once":
        print("STOP_USAGE_EXPECT_RUN_ONCE")
        sys.exit(2)
    try:
        run_once()
    except Block as exc:
        message=str(exc)
        print(message if message.startswith("STOP_") else "STOP_"+message)
        sys.exit(3)
    except writer.Stop:
        print("STOP_AZURE_OPERATOR_PERMISSION_CHECK_FAILED")
        sys.exit(3)
    except KeyboardInterrupt:
        # Python finally executes on Ctrl+C during grant/transfer where safe.
        print("STOP_INTERRUPTED_CHECK_VAULT_WRITER_ROLE_PRIVATELY")
        sys.exit(130)
