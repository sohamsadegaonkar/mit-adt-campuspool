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
