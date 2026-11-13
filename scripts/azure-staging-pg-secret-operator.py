#!/usr/bin/env python3
"""CampusPool staging-only PG password credential operator.

--check: read-only Azure ARM metadata inspection. No secret values.
--set-once: owner-controlled, explicitly confirmed creation of *existing*
staging database password via a private tmpfs file. NEVER a backup run.

No database connections, identity grants, blob writes, job creation, or schedules.
"""

import argparse
import getpass
import json
import os
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
    args = parser.parse_args()
    try:
        if args.check:
            check()
        else:
            provision()
    except (Blocked, EOFError, KeyboardInterrupt) as exc:
        label = str(exc) if isinstance(exc, Blocked) else "CANCELLED"
        print("STOP_" + label)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
