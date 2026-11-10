# GHCR private image: one-shot, no-file Key Vault token import — November 10, 2026

## Live checkpoint

- Owner's `Azure for Students` Cloud Shell **read-only temp Vault operator plan** returned `AZURE_STUDENT_VAULT_SCOPE_VERIFIED=YES`, `TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=NO`, `ROLE_TO_MANAGE=KEY_VAULT_SECRETS_OFFICER_VAULT_SCOPE_ONLY`, `ROLE_CAPABILITIES=ALL_VAULT_SECRET_OPERATIONS_UNTIL_REVOKED`, `ASSIGNMENT_AUTOMATIC_EXPIRY=NO`, `OWNER_ACTION=PLAN_ONLY_NO_AZURE_WRITES`, `ROLE_PLAN_COMPLETE=YES`. No privilege granted yet.
- Vault `campuspool-backup-kv-01` and UAI `campuspool-ghcr-vault-reader` previously created and verified; private backup Blob container found, UAI no reported assignments, Container Apps backup jobs zero. **No GHCR read token is in the Vault yet**, and the existing temporary publishing PAT was owner-reported revoked.
- Previous operator ARM direct-role audit found 1 potential assignment admin and no confirmed secret writer. No guarantee of effective grant rights or group/PIM/deny authorization.

## Preparation

The new [`scripts/azure-vault-ghcr-token-one-shot-import.py`](../../scripts/azure-vault-ghcr-token-one-shot-import.py) uses the already reviewed Vault operator helper, but **does not leave temporary permissions assigned between independent manual commands**:

1. Rechecks exact Azure subscription, Vault RBAC/purge-protected resource scope, current authenticated human user and **absence of any helper-managed Secrets Officer role**.
2. Explains that Vault-only Secrets Officer temporarily allows **all secret operations across the entire Vault**, not just token creation, and has **no automatic expiry**. Requires exact typed confirmation `IMPORT_GHCR_TOKEN_AND_REVOKE_VAULT_WRITER`; aborts with no Azure mutations if refused.
3. Accepts a *new* GitHub classic personal access token `ghp_...` interactively via Python `getpass` hidden TTY input. **Only `read:packages` should be granted**; token scope **cannot be verified from this script**, and token creation is manual in GitHub. The token never enters shell history, command arguments, environment variables, a file, Git commits, CI logs, ChatGPT, or Notion. Transient Python memory and a normal Vault REST HTTPS request necessarily contain the value.
4. Tries exact, deterministic `Key Vault Secrets Officer` ARM PUT at `campuspool-backup-kv-01` scope, for current operator; there is **no RG-wide/subscription grant**. Uses `az account get-access-token --resource https://vault.azure.net` for a transient bearer token (also kept only in Python memory).
5. Uses pinned Vault HTTPS hostname with system certificate verification, ignores ambient HTTP(S) proxies, calls REST `GET /secrets?api-version=7.4` which returns metadata only, **does not fetch secret values**. Refuses ambiguous pagination or an existing `ghcr-pull-token` (never silently version-overwrites).
6. Uses Python standard library HTTPS `PUT /secrets/ghcr-pull-token?api-version=7.4`, body in memory only, validates the returned secret ID/version and enabled status, and **never prints the JSON response**, since Vault echo contains the token.
7. **In a finally block**, attempts exact helper-managed RBAC DELETE + post-delete ARM GET to confirm absence, whether the import succeeded or failed. A successful PUT of the role is always followed by DELETE even if RBAC listing is momentarily stale. Reports `TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES` on confirmed absence. Other operators' RBAC assignments are never deliberately changed. No managed-identity reader grant, no staging PG/CA secret import, no job or data export.
8. On a hard crash, SIGKILL, Cloud Shell termination or Azure cleanup denial, **automatic revocation cannot be guaranteed**. If `STOP_VAULT_WRITER_REVOKE_NOT_VERIFIED` or `STOP_MANUAL_ROLE_REVOKE_REQUIRED_BEFORE_ANY_NEXT_ACTION`, immediately run the existing standalone `--plan` and reviewed `--revoke` on the exact helper assignment, then verify absence. **Do not proceed with GHCR pull, secrets or backup while the role may remain active.**

GitHub officially documents a classic PAT with `read:packages` and package read permission for private GHCR; access tokens might need SSO authorization, depending on GitHub owner. Prefer a limited lifetime (for example, **30 days**) with an explicit token rotation plan before it expires; do not enable `write:packages`, `delete:packages`, or `repo` just to make a pull work. Confirm GitHub identity has package read access.

## Owner instructions

**Review [PR #44](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/44) and CI before real Azure execution.** The owner has approved the Vault-only read-only plan; execution of the new one-shot role/token workflow still requires *separate explicit typed operator authorization*.

In **Azure Cloud Shell Bash**, from the correct checkout (clone the draft PR branch if ephemeral home was reset):

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
python3 scripts/azure-vault-ghcr-token-one-shot-import.py --run-once
```

The script will show `VAULT_SCOPE_AND_OPERATOR_VERIFIED=YES`, `TEMP_WRITER_INITIAL_STATUS=ABSENT`, and a strong warning. Only if accepting exact scope and transient operator grant enter `IMPORT_GHCR_TOKEN_AND_REVOKE_VAULT_WRITER`, then paste the **new classic `read:packages` token directly into the hidden prompt** in Cloud Shell (never into chat, Git or shell command). Do not post the token or script's internal objects.

Expected success:

```text
TEMP_VAULT_WRITER_GRANT_ACCEPTED=YES
GHCR_PULL_TOKEN_IMPORTED_TO_KEY_VAULT=YES
GHCR_TOKEN_SCOPE_NOT_INDEPENDENTLY_VERIFIED=YES
TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES
ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES
NO_DB_CREDENTIAL_CA_JOB_BLOB_OR_ROLE_READER_GRANTS_CHANGED=YES
```

If `VAULT_ACCESS_DENIED_OR_PROPAGATION`, Azure RBAC may not have propagated; this workflow still attempts cleanup and will print an explicit STOP. Do **not** leave Secrets Officer in place waiting for propagation. Check role absence, then try again only after reviewing the error and token state. If response is uncertain, use Azure Portal **secret metadata only**, never inspect/copy the token value into chat. If new PAT creation succeeded but import failed, promptly revoke it on GitHub unless the import status and Vault role cleanup can be confirmed.

**Recovery commands after any ambiguous failure:**

```bash
python3 scripts/azure-vault-temporary-operator-secrets-officer.py --plan
# Only if TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=YES:
python3 scripts/azure-vault-temporary-operator-secrets-officer.py --revoke
python3 scripts/azure-vault-temporary-operator-secrets-officer.py --plan
```

`--revoke` requires a separate explicit confirmation `REVOKE_CAMPUSPOOL_TEMP_SECRET_WRITER`. Never run generic role deletion commands on unrelated Azure roles.

## Next gates after verified import

- Read-only verify GHCR token **metadata exists** and helper operator Secrets Officer assignment absent; do not print token value.
- Provision **only two individual secret-level** `Key Vault Secrets User` assignments for GHCR pull token and verified staging root CA to `campuspool-ghcr-vault-reader` (CA is still not imported). Never expose staging PostgreSQL password to UAI.
- Create separate manual job system identity and minimal staging PG password secret read role, plus container-scoped Blob writer role without delete. Verify runtime TLS, CA, signature/provenance and explicit manual-only configuration before any real AGE/SHA-256 backup and independent PG17/PostGIS cold restore.
- Existing Vault public endpoint protected by TLS/RBAC is **not** private-network, aggregate Azure cost ceiling ₹500/month remains unverified/deferred; production OTP release remains gated.

Sources: [Microsoft Set Secret REST](https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/set-secret/set-secret?view=rest-keyvault-secrets-2025-07-01), [List Secrets metadata only](https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secrets/get-secrets?view=rest-keyvault-secrets-2025-07-01), [GitHub GHCR authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [Key Vault secret-level RBAC limitations](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide).
