# 14 November 2026 — Staging PostgreSQL Key Vault credential provisioning (prepared; NOT executed)

## Scope and evidence

Source preparation complete. The owner said "let's start" after requesting preparation of a staging-only Key Vault credential; this is **not** approval for a live database export, job creation, password change, RBAC change, automated schedule, Supabase project reactivation or production OTP deployment.

Source branch: ops/backup-three-gates-evidence-2026-11-06.
- Operator: scripts/azure-staging-pg-secret-operator.py
- Offline tests: test_azure_staging_pg_secret_operator.py (8 synthetic cases)
- Offline CI: .github/workflows/azure-staging-pg-secret-offline-ci.yml
- Existing runtime bootstrap: scripts/cloud-backup-vault-bootstrap.js
- Encrypted upload worker: scripts/azure-blob-backup.js

The Azure for Students resource group has the existing RBAC-enabled vault campuspool-backup-kv-01 with soft delete/purge protection. The proposed campuspool-staging-pg-password ARM metadata request was categorized NOT_FOUND, without independently capturing raw HTTP status. Current group has only the two GHCR diagnostic jobs; no real PostgreSQL backup worker is deployed. GHCR private-image pull and fixed stdout marker are verified PASS, **not** a real database backup.

Existing private Blob container campuspool-staging-backups has no anonymous public access, Shared Key access disabled, Blob/container soft-delete 14 days, and no verified versioning/immutability. Storage and Key Vault network defaults are Allow, subject to authentication/RBAC. Do not change their firewall settings without verifying connectivity.

**New read-only Supabase evidence (14 November 2026):** exact source-allowlisted staging project tnitksrlntrdxbvznxzf = campuspool-staging-db, Singapore/ap-southeast-1, PostgreSQL 17.11.0.011, project status INACTIVE. It is not proven reachable. Do not restore/unpause without explicit owner approval and a cost/plan review.

The existing cloud worker source expects a **staging-only password secret** with this exact name, accessed by managed identity; it creates a 0600 file in verified /dev/shm tmpfs and provides only PGPASSFILE to PostgreSQL. A staging secret creation does NOT change a database password or establish that the provided password works.

## First owner action: read-only operator check

Run in Azure Cloud Shell Bash using a clean checkout:

~~~bash
BRANCH="ops/backup-three-gates-evidence-2026-11-06"
DIR="$HOME/campuspool-auth-check"
if [ -d "$DIR/.git" ]; then
  cd "$DIR"
  test -z "$(git status --porcelain)" || { echo STOP_DIRTY_CHECKOUT; exit 1; }
  git fetch origin "$BRANCH" && git switch "$BRANCH" && git merge --ff-only FETCH_HEAD
else
  git clone --single-branch --branch "$BRANCH" \
    https://github.com/sohamsadegaonkar/mit-adt-campuspool.git "$DIR"
  cd "$DIR"
fi
python3 -m unittest -v test_azure_staging_pg_secret_operator.py
python3 scripts/azure-staging-pg-secret-operator.py --check
~~~

Expected: AZURE_STAGING_SECRET_CONTEXT_VERIFIED=YES, STAGING_SECRET_ARM_STATUS with a safe category, and NO_AZURE_WRITE_OR_SECRET_VALUE_READ=YES. STOP on any failed test or unanticipated context.

## Secret creation is a separate explicitly confirmed operation

- First confirm the precise staging database account and existing password from the trusted Supabase operator, and investigate the INACTIVE project state. Never paste the password into chat, Git, scripts, terminal commands/history, or logs. Do not try a guessed password, production credential, or a new password that has not been set on staging.
- Confirm the operator's Key Vault secret-set data-plane permissions without widening roles automatically. Any 403 or error should fail closed.
- When separately approved and stage identity is verified, an authorized owner can run: python3 scripts/azure-staging-pg-secret-operator.py --set-once. It prompts for explicit typed staging-only confirmation and creation confirmation, then uses a hidden double-entry password prompt. It requires genuine /dev/shm tmpfs, writes a temporary 0600 file, uses Azure CLI secret set --file with UTF-8 encoding and captures CLI output to prevent displaying the secret. File is removed in finally, and only ARM Name/Enabled metadata is checked afterward. It does not grant permissions, run database access, create Azure jobs or upload blobs.
- Azure secret set is not atomic create-if-absent and may create a new version if the secret already exists. Script rechecks NOT_FOUND before the one request but a race remains; owner must control concurrency. If a timeout or unknown result occurs, never blindly rerun; investigate via read-only ARM metadata and obtain new approval.
- Tmpfs reduces persistent plaintext exposure but does not erase all process memory or protect against a compromised Cloud Shell login. Operator ownership and workstation hygiene matter. Microsoft CLI reference for --file and --encoding: https://learn.microsoft.com/en-us/cli/azure/keyvault/secret?view=azure-cli-latest

## Next permissions and deployment design (not authorized yet)

- Do NOT broaden the existing GHCR-only campuspool-ghcr-vault-reader identity for DB and Blob. Use a separate data-plane identity belonging to a manual-only worker, scoped to the exact staging Key Vault secret and private backup Blob container with minimal write/read and no delete where feasible.
- Independently verify published pinned private GHCR worker image actually matches approved signed/scanned source and contains the vault password bootstrap, AGE public recipient encryption, PostgreSQL 17 client, CA-based TLS verify-full and safe logs.
- A future backup worker should be manual-only, one replica, zero retries, finite timeout, default preflight (no export, no AZURE_EXPORT_APPROVED). Creating a job and later starting it require separately reviewed approval.
- Real staging-only encrypted pg_dump upload, remote ciphertext SHA-256, independently decrypted PG17/PostGIS cold restore with data/RLS/roles parity and Render rollback proof remain separately gated, as does production OTP.
- Respect existing combined Azure internal project ceiling of ₹500/month including cost of existing services; confirm pricing and credit before adding billable services. No recurring schedule without explicit owner consent.

No Azure resource/credential/IAM/Blob/DB changes made by this source preparation.


## 2026-11-14 — Updated executable gate: verify SAME password via TLS before writing Vault

**Current live Supabase checks:** exact project `campuspool-staging-db` (`tnitksrlntrdxbvznxzf`) reports `ACTIVE_HEALTHY` on its existing Free plan. Connected Supabase executed only `SELECT 1`, which returned 1, demonstrating database responsiveness **through its connector**. This is **not** verification of a PostgreSQL password in the future Azure worker.

**Source changes:** the credential operator now offers `--verify-credential`, and `--set-once` *requires* a successful read-only PostgreSQL `SELECT 1` with exactly the password it will store. The password is hidden and never placed in argv, a URL, environment variable, chat, or log; the psql subprocess uses a temporary 0600 `/dev/shm` passfile and `PGSSLMODE=verify-full`. Raw stderr/stdout of failed verification is suppressed. `--set-once` still requires two owner confirmation phrases and a second exact ARM NOT_FOUND check. A failed check must not lead to a secret write.

### Step A — refresh verified operator checkout, test offline, inspect Azure read-only state

```bash
(
  set -e
  cd "$HOME/campuspool-auth-check"
  test -z "$(git status --porcelain)" || { echo STOP_DIRTY_REPO; exit 1; }
  git fetch origin ops/backup-three-gates-evidence-2026-11-06
  git switch ops/backup-three-gates-evidence-2026-11-06
  git merge --ff-only FETCH_HEAD
  python3 -m py_compile scripts/azure-staging-pg-secret-operator.py
  python3 -m unittest -v test_azure_staging_pg_secret_operator.py
  bash -n ops/cloud-backup/azure-staging-data-identity-operator.sh
  bash -n ops/cloud-backup/azure-staging-data-identity-rbac.sh
  python3 scripts/azure-staging-pg-secret-operator.py --check
  bash ops/cloud-backup/azure-staging-data-identity-operator.sh --plan
)
```

STOP if tests or context checks fail.

### Step B — privately verify existing staging-only PG credentials, without Azure changes

1. Open the **exact project's Supabase Dashboard → Connect → Session pooler**. Read its host, database and user, confirm user is `postgres.tnitksrlntrdxbvznxzf`, database `postgres`, port `5432`, and that the hostname matches allowlisted `aws-[number]-ap-southeast-1.pooler.supabase.com`. Do not copy any URL that contains a password to ChatGPT, Git, or terminal history.
2. Download that project's **Database Settings → SSL Configuration → certificate** through the dashboard, then upload the CA PEM into Cloud Shell as a user-only file at `$HOME/campuspool-staging-ca.crt`. Verify it belongs to the expected project/trust chain; do not substitute an arbitrary Internet certificate. Supabase official guide: https://supabase.com/docs/guides/database/psql .
3. Use these **nonsecret** environment variables, substituting the verified dashboard host, not a guess:

```bash
cd "$HOME/campuspool-auth-check"
chmod 600 "$HOME/campuspool-staging-ca.crt"
export CAMPUSPOOL_STAGING_PGHOST="REPLACE_WITH_EXACT_STAGING_SESSION_POOLER_HOST"
export CAMPUSPOOL_STAGING_PG_CA_FILE="$HOME/campuspool-staging-ca.crt"
command -v psql >/dev/null || { echo STOP_PSQL_CLIENT_NOT_INSTALLED; exit 1; }
python3 scripts/azure-staging-pg-secret-operator.py --verify-credential
```

The operator prompts for the **existing staging PostgreSQL database password** without echo. A success prints `STAGING_PG_PASSWORD_TLS_VERIFY_FULL_PASS=YES` and `NO_AZURE_WRITE_OR_STAGING_DATA_READ=YES`. It reads no business tables. On TLS, account or authentication failure, it prints only `STOP_STAGING_PG_PASSWORD_OR_TLS_VERIFICATION_FAILED`; do **not** lower `PGSSLMODE` or print credentials to troubleshoot. Resolve the CA, host or original password via owner-controlled Dashboard. The Cloud Shell machine must have network reachability to Supabase pooler. No password may be sent to this conversation.

### Step C — owner-approved exact Key Vault staging password creation

Only after Step B PASSES, re-run the guarded `--set-once`:

```bash
cd "$HOME/campuspool-auth-check"
python3 scripts/azure-staging-pg-secret-operator.py --set-once
```

It asks the owner to type `STAGING_ACCOUNT_PASSWORD_VERIFIED_NOT_PRODUCTION` and `CREATE_ONLY_STAGING_PG_SECRET_NO_BACKUP`, enter the same existing staging-only password twice invisibly, privately re-verify it with `psql` and `verify-full`, then submit **one** `az keyvault secret set --file` request to the existing `campuspool-backup-kv-01` and inspect only ARM enabled metadata. The operator will NOT change the PostgreSQL password. **Do not rerun a failed/uncertain secret-write** until read-only metadata is inspected and explicit owner permission is renewed. If Azure returns 403, do not silently grant the human caller broad Secrets Officer rights; seek scoped review.

### Step D — create the separate identity, then grant narrowly scoped permissions

Only after Stage C has produced `STAGING_SECRET_CREATED_AND_ARM_ENABLED_VERIFIED=YES`:

```bash
cd "$HOME/campuspool-auth-check"
bash ops/cloud-backup/azure-staging-data-identity-operator.sh --plan
bash ops/cloud-backup/azure-staging-data-identity-operator.sh --create-once
bash ops/cloud-backup/azure-staging-data-identity-rbac.sh --plan
bash ops/cloud-backup/azure-staging-data-identity-rbac.sh --grant-once
bash ops/cloud-backup/azure-staging-data-identity-rbac.sh --plan
```

`--create-once` demands typed `CREATE_ONLY_STAGING_BACKUP_DATA_IDENTITY`; it creates only `campuspool-staging-backup-data-id` (distinct from `campuspool-ghcr-vault-reader`). `--grant-once` demands typed `GRANT_ONLY_STAGING_SECRET_AND_NO_DELETE_BLOB`, and grants **Key Vault Secrets User at the exact secret scope** and a **custom Blob create/read/write-no-delete role at the exact private container scope**. The role's `DataActions` are read, write and add only; it excludes delete, move, container mutation and Storage account keys. Azure custom role creation requires sufficient `roleDefinitions/write` permissions and might be unavailable under the subscription. A failure must remain blocked, not trigger subscription-wide Owner/Contributor or built-in Storage Blob Data Contributor grants.

**Residual risk:** Blob `write` is still an ability to overwrite existing ciphertext; the worker must enforce unique object names and `If-None-Match: *` and independent restore validation. The role alone is not WORM immutability. These scripts do **not** attach the identity to a new ACA job or set `AZURE_CLIENT_ID`; that is a later manual worker deployment gate with separate approval and exact source/digest review.

## Scope and current blockers

This is an owner-guided **interactive** Azure Cloud Shell procedure. The assistant has no direct authenticated Azure subscription connector and cannot privately type/verify a password for the owner. No secret or IAM operation is counted as performed until Cloud Shell confirms it. Identity and role changes are NOT necessary for the read-only password check. Existing ₹500/month combined Azure budget and production OTP NO-GO remain. No DB export, Blob data mutation, job creation/start or schedule is authorized by these commands.

Official Azure references: https://learn.microsoft.com/en-us/cli/azure/keyvault/secret ; https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide ; https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles-cli ; https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-cli
