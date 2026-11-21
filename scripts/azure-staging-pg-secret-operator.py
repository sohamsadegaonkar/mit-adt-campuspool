#!/usr/bin/env python3
"""CampusPool staging-only PG password credential operator.

--check: read-only Azure ARM metadata inspection. No secret values.
--set-once: owner-controlled, explicitly confirmed creation of *existing*
staging database password via a private tmpfs file. NEVER a backup run.

Credential verification performs only SELECT 1 with TLS verify-full and a private
RAM-backed passfile. Secret provisioning now REQUIRES this exact password check.
No database writes, identity grants, blob writes, job creation, or schedules.
"""

import argparse
import getpass
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

RESOURCE_GROUP = "campuspool-backup-rg"
SUBSCRIPTION = "Azure for Students"
VAULT = "campuspool-backup-kv-01"
SECRET = "campuspool-staging-pg-password"
ARM_API = "2024-11-01"
MAX_PASSWORD_LEN = 2048  # Matches scripts/cloud-backup-vault-bootstrap.js.
STAGING_REF = "tnitksrlntrdxbvznxzf"
PG_USER = "postgres." + STAGING_REF
PG_HOST = re.compile(r"^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$")
CONFIRM_PHRASE = "CREATE_ONLY_STAGING_PG_SECRET_NO_BACKUP"
STAGING_CONFIRM_PHRASE = "STAGING_ACCOUNT_PASSWORD_VERIFIED_NOT_PRODUCTION"


class Blocked(Exception):
    """Expected fail-closed error; never includes external command text."""


def az(*args, timeout=35):
    """Run a fixed Azure CLI command; never forward Azure stdout/stderr to terminal."""
    try:
        proc = subprocess.run(["az", *args], text=True, encoding="utf-8",
                              capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("AZURE_CLI_UNAVAILABLE_OR_TIMEOUT") from None
    return proc


def require_json(proc, label):
    if proc.returncode:
        raise Blocked(label + "_READ_FAILED")
    try:
        value = json.loads(proc.stdout)
        if not isinstance(value, dict):
            raise ValueError("expected object")
        return value
    except (ValueError, TypeError):
        raise Blocked(label + "_INVALID_METADATA") from None


def classify_failure(proc):
    """Conservative categories only; never print the raw error."""
    msg = (proc.stderr or "") + (proc.stdout or "")
    low = msg.lower()
    if "authorizationfailed" in low or "forbidden" in low or "403" in low:
        return "DENIED"
    if "unauthorized" in low or "401" in low:
        return "UNAUTHORIZED"
    if "resourcenotfound" in low or "notfound" in low or "404" in low:
        return "NOT_FOUND"
    return "UNKNOWN"


def read_context():
    sub = require_json(az("account", "show", "--query", "{Name:name,State:state}", "-o", "json"), "SUBSCRIPTION")
    if sub.get("Name") != SUBSCRIPTION or sub.get("State") != "Enabled":
        raise Blocked("UNEXPECTED_SUBSCRIPTION")
    vault = require_json(az("keyvault", "show", "--resource-group", RESOURCE_GROUP,
                            "--name", VAULT,
                            "--query", "{Id:id,Name:name,Rbac:properties.enableRbacAuthorization,"
                            "Purge:properties.enablePurgeProtection,SoftDelete:properties.enableSoftDelete}",
                            "-o", "json"), "VAULT")
    if (vault.get("Name") != VAULT or vault.get("Rbac") is not True or
            vault.get("Purge") is not True or vault.get("SoftDelete") is not True):
        raise Blocked("VAULT_SECURITY_NOT_VERIFIED")
    vault_id = vault.get("Id", "")
    if not isinstance(vault_id, str) or not vault_id.endswith("/vaults/" + VAULT) or "/resourceGroups/" + RESOURCE_GROUP + "/" not in vault_id:
        raise Blocked("VAULT_ARM_ID_UNEXPECTED")
    return vault_id


def secret_metadata(vault_id):
    url = f"https://management.azure.com{vault_id}/secrets/{SECRET}?api-version={ARM_API}"
    proc = az("rest", "--method", "get", "--url", url,
              "--query", "{Name:name,Enabled:properties.attributes.enabled}", "-o", "json")
    if proc.returncode:
        return {"status": classify_failure(proc)}
    metadata = require_json(proc, "SECRET")
    if metadata.get("Name") != SECRET:
        return {"status": "UNKNOWN"}
    enabled = metadata.get("Enabled")
    if enabled not in (True, False, None):
        return {"status": "UNKNOWN"}
    return {"status": "EXISTS", "enabled": enabled}


def check():
    vault_id = read_context()
    status = secret_metadata(vault_id)
    print("AZURE_STAGING_SECRET_CONTEXT_VERIFIED=YES")
    print("STAGING_SECRET_ARM_STATUS=" + status["status"])
    if status["status"] == "EXISTS":
        print("STAGING_SECRET_ENABLED=" + ("YES" if status["enabled"] is True else "NO_OR_UNKNOWN"))
    print("NO_AZURE_WRITE_OR_SECRET_VALUE_READ=YES")
    return status


def tmpfs_is_safe():
    path = Path("/dev/shm")
    if path.is_symlink() or not path.is_dir() or path.resolve() != path:
        return False
    try:
        proc = subprocess.run(["stat", "-f", "-c", "%T", str(path)],
                              capture_output=True, text=True, timeout=5)
        return proc.returncode == 0 and proc.stdout.strip() == "tmpfs"
    except (OSError, subprocess.TimeoutExpired):
        return False


def valid_password(password):
    if not isinstance(password, str) or not password or any(x in password for x in "\r\n\0"):
        return False
    try:
        # Node worker treats strings as UTF-16 code units, not Python codepoints.
        return (len(password.encode("utf-16-le")) // 2 <= MAX_PASSWORD_LEN
                and len(password.encode("utf-8")) <= 4096)
    except UnicodeError:
        return False



def staging_pg_connection():
    """Source-compatible PG17 staging pooler and owner-supplied CA, no credentials."""
    host = os.environ.get("CAMPUSPOOL_STAGING_PGHOST", "")
    ca = os.environ.get("CAMPUSPOOL_STAGING_PG_CA_FILE", "")
    if not PG_HOST.fullmatch(host):
        raise Blocked("STAGING_POOLER_HOST_NOT_ALLOWLISTED")
    candidate = Path(ca)
    try:
        if (not candidate.is_absolute() or candidate.is_symlink() or
                candidate.resolve() != candidate or not candidate.is_file()):
            raise ValueError("not regular trusted file")
        stat = candidate.stat()
        if (stat.st_size < 300 or stat.st_size > 131072 or
                stat.st_mode & 0o022):
            raise ValueError("CA protection invalid")
        pem = candidate.read_text(encoding="ascii")
        if "-----BEGIN CERTIFICATE-----" not in pem or "-----END CERTIFICATE-----" not in pem:
            raise ValueError("invalid PEM")
    except (OSError, ValueError, UnicodeError):
        raise Blocked("STAGING_TLS_CA_NOT_VERIFIED") from None
    return host, str(candidate)


def verify_staging_password(password):
    """Private read-only SELECT 1. No password in argv/env, no CLI output forwarded."""
    if not valid_password(password):
        raise Blocked("STAGING_PASSWORD_INVALID")
    if not tmpfs_is_safe():
        raise Blocked("PRIVATE_TMPFS_REQUIRED")
    host, ca = staging_pg_connection()
    password_for_pgpass = password.replace("\\", "\\\\").replace(":", r"\:")
    row = ":".join((host, "5432", "postgres", PG_USER, password_for_pgpass)) + "\n"
    fd, filename = tempfile.mkstemp(prefix="campuspool-verify-pgpass-", dir="/dev/shm")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", closefd=True) as stream:
            stream.write(row.encode("utf-8"))
        fd = -1
        # Deliberately provide only known libpq settings, not inherited PG vars.
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": os.environ.get("HOME", "/tmp"),
            "LANG": "C",
            "PGHOST": host,
            "PGPORT": "5432",
            "PGDATABASE": "postgres",
            "PGUSER": PG_USER,
            "PGSSLMODE": "verify-full",
            "PGSSLROOTCERT": ca,
            "PGPASSFILE": filename,
            "PGCONNECT_TIMEOUT": "10",
        }
        try:
            result = subprocess.run(
                ["psql", "-X", "-w", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
                 "-c", "SELECT 1;"],
                env=env, capture_output=True, text=True,
                encoding="utf-8", timeout=25, check=False
            )
        except (OSError, subprocess.TimeoutExpired):
            raise Blocked("PSQL_NOT_AVAILABLE_OR_TIMEOUT") from None
        if result.returncode != 0 or result.stdout.strip() != "1":
            # Never display stderr: it can contain TLS or credential details.
            raise Blocked("STAGING_PG_PASSWORD_OR_TLS_VERIFICATION_FAILED")
    finally:
        if fd != -1:
            os.close(fd)
        Path(filename).unlink(missing_ok=True)
    print("STAGING_PG_PASSWORD_TLS_VERIFY_FULL_PASS=YES")


def verify_interactive():
    if not sys.stdin.isatty():
        raise Blocked("INTERACTIVE_TERMINAL_REQUIRED")
    secret = getpass.getpass("Enter existing staging PostgreSQL password (hidden): ")
    verify_staging_password(secret)
    secret = None
    print("NO_AZURE_WRITE_OR_STAGING_DATA_READ=YES")


def provision():
    if not sys.stdin.isatty():
        raise Blocked("INTERACTIVE_TERMINAL_REQUIRED")
    before = check()
    if before["status"] != "NOT_FOUND":
        raise Blocked("SECRET_CREATE_REQUIRES_PROVEN_NOT_FOUND")
    if not tmpfs_is_safe():
        raise Blocked("PRIVATE_TMPFS_REQUIRED")
    print("Only the existing, verified CampusPool STAGING password is permitted. No production credentials.")
    if input("Type " + STAGING_CONFIRM_PHRASE + ": ").strip() != STAGING_CONFIRM_PHRASE:
        raise Blocked("STAGING_ACCOUNT_CONFIRMATION_REQUIRED")
    if input("Type " + CONFIRM_PHRASE + ": ").strip() != CONFIRM_PHRASE:
        raise Blocked("EXPLICIT_CREATION_CONFIRMATION_REQUIRED")
    password = getpass.getpass("Enter existing staging PG password (not echoed): ")
    repeat = getpass.getpass("Confirm staging PG password (not echoed): ")
    if not valid_password(password) or password != repeat:
        raise Blocked("STAGING_PASSWORD_INVALID_OR_MISMATCH")
    # Mandatory proof of the *same password* before it may enter Key Vault.
    verify_staging_password(password)
    # Re-read ARM metadata immediately before the one non-idempotent set request.
    after = secret_metadata(read_context())
    if after["status"] != "NOT_FOUND":
        raise Blocked("SECRET_CHANGED_OR_UNVERIFIED_DO_NOT_WRITE")
    fd, filename = tempfile.mkstemp(prefix="campuspool-staging-credential-", dir="/dev/shm")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", closefd=True) as stream:
            stream.write(password.encode("utf-8"))
        fd = -1
        # --file avoids putting a secret in shell history or argv. Suppress the
        # command's JSON result because it may contain the *secret value*.
        result = az("keyvault", "secret", "set", "--vault-name", VAULT,
                    "--name", SECRET, "--file", filename, "--encoding", "utf-8",
                    "--content-type", "CampusPool staging-only PostgreSQL password",
                    "--only-show-errors", "--output", "none", timeout=50)
    finally:
        if fd != -1:
            os.close(fd)
        try:
            Path(filename).unlink(missing_ok=True)
        except OSError:
            pass
        # Password remains briefly in process memory; process exits immediately.
        password = None
        repeat = None
    if result.returncode:
        # The request may have reached Azure despite a client failure: NEVER retry blindly.
        raise Blocked("SECRET_SET_RESULT_UNCERTAIN_STOP_NO_RETRY")
    check_after = secret_metadata(read_context())
    if check_after.get("status") != "EXISTS" or check_after.get("enabled") is not True:
        raise Blocked("SECRET_SET_RETURNED_SUCCESS_BUT_METADATA_NOT_CONFIRMED")
    print("STAGING_SECRET_CREATED_AND_ARM_ENABLED_VERIFIED=YES")
    print("NO_DATABASE_OR_BLOB_OR_JOB_CHANGE=YES")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="read-only, no secret value access")
    group.add_argument("--set-once", action="store_true", help="separately owner-confirmed secret creation")
    group.add_argument("--verify-credential", action="store_true", help="read-only private PostgreSQL TLS login test")
    args = parser.parse_args()
    try:
        if args.check:
            check()
        elif args.verify_credential:
            verify_interactive()
        else:
            provision()
    except (Blocked, EOFError, KeyboardInterrupt) as exc:
        label = str(exc) if isinstance(exc, Blocked) else "CANCELLED"
        print("STOP_" + label)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
