# CampusPool staging: encrypted streaming backups to private Cloudflare R2

**Status: optional candidate, branch-only; not a release-certified restore.** Do not use for production student data or treat an uploaded file as an independently recovered database. This approach does not mutate the staging database or require local plaintext SQL files.

## What is protected

This tool runs a **single** PostgreSQL 17 `pg_dump --format=custom --schema=public --schema=supabase_migrations`, pipes the archive directly into AGE and then uploads the ciphertext using rclone `rcat` to a **private R2 Standard bucket**. The one-dump snapshot is internally consistent even with ongoing application writes. On upload success, it reads the encrypted object back and compares SHA-256 of those encrypted bytes. No plaintext archive is written to C:, D:, or the repository.

**Scope limitation:** PostgreSQL global roles are NOT part of `pg_dump`; Supabase managed auth/storage/other schemas, provider metadata, externally stored files, privileged role credentials, extension prerequisites, role grants and migrations outside these two schemas need separate recovery verification. A successful ciphertext round-trip is **NOT** proof of cold restore. The older five-file, operator-only `scripts/staging-secure-backup.sh` remains a separate option on the parent PR and is not automatically replaced.

## 1. Set up the private R2 bucket

1. Visit [Cloudflare dashboard](https://dash.cloudflare.com/) → **Storage & databases → R2 Object Storage**. Enable R2 only after reading any billing or payment-method prompts. R2 Standard includes free-tier allowances, but usage beyond them can incur charges.
2. Create **`campuspool-staging-backups`**, with **Standard** storage class; leave Public Development URL and custom public domain **OFF**. Do not use a public bucket or an existing shared bucket.
3. Under R2 → **Manage API Tokens**, create an **Object Read & Write** token **restricted to this bucket only**. Record Access Key ID and Secret Access Key in a trusted password manager. Do **not** paste either here or commit them.
4. Keep the Cloudflare account ID separately; it forms the non-secret S3 API endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

Cloudflare setup: https://developers.cloudflare.com/r2/get-started/s3/ and https://developers.cloudflare.com/r2/examples/rclone/.

## 2. Ubuntu-D tools, no plaintext configuration files

The operator already verified Node 22, PostgreSQL 17.11, AGE and five previous recovery tests on Ubuntu-D. Install and verify **rclone 1.59+** using the OS package manager (review package version first). The following environment-only setup avoids storing R2 credentials in `~/.config/rclone/rclone.conf` on unencrypted Windows/WSL drives:

```bash
# In Ubuntu-D. No real backup yet.
cd ~/campuspool-staging-recovery
git fetch origin
# Avoid changing the existing detached worktree: use a second separate worktree.
git worktree add --detach ~/campuspool-r2-worktree origin/ops/cloudflare-r2-stream-backup-2026-11-04
cd ~/campuspool-r2-worktree

rclone version
node --test test_r2_stream_backup.js

export R2_BACKUP_REMOTE=campuspoolr2
export R2_BACKUP_BUCKET=campuspool-staging-backups
export RCLONE_CONFIG_CAMPUSPOOLR2_TYPE=s3
export RCLONE_CONFIG_CAMPUSPOOLR2_PROVIDER=Cloudflare
export RCLONE_CONFIG_CAMPUSPOOLR2_REGION=auto
export RCLONE_CONFIG_CAMPUSPOOLR2_ACL=private

# Replace account ID with your real Cloudflare account ID. No secret required.
read -r -p 'Cloudflare account ID (32 hex chars): ' account_id
export RCLONE_CONFIG_CAMPUSPOOLR2_ENDPOINT="https://${account_id}.r2.cloudflarestorage.com"
unset account_id

# Interactive secret inputs: values are not echoed or stored in shell history.
read -r -s -p 'R2 access key ID: ' r2_key; echo
export RCLONE_CONFIG_CAMPUSPOOLR2_ACCESS_KEY_ID="$r2_key"; unset r2_key
read -r -s -p 'R2 secret access key: ' r2_secret; echo
export RCLONE_CONFIG_CAMPUSPOOLR2_SECRET_ACCESS_KEY="$r2_secret"; unset r2_secret
```

Do not enable `set -x`, `env`, `printenv`, verbose rclone debug logging, upload shell session recordings, or run `rclone config show` while credentials are in memory.

Verify the bucket belongs to your account and remains private in the Cloudflare dashboard. Only after that, set `export R2_PRIVATE_BUCKET_CONFIRMED=YES` in this session. A safe, read-only remote check is `rclone lsf campuspoolr2:campuspool-staging-backups` (will be empty for a new bucket).

## 3. Database source and encryption recipient

Operator must supply privately **only** the known dedicated staging database ref, verified Supabase Session Pooler host and password. `PGPASSWORD` remains in the current trusted Linux process environment and never appears on a command line or in Git. The `PGUSER` is **hardcoded below** to the staging project:

```bash
export PGUSER='postgres.tnitksrlntrdxbvznxzf'
export PGDATABASE=postgres
export PGPORT=5432
export PGSSLMODE=verify-full
# Use the exact host from Supabase staging Dashboard -> Connect -> Session Pooler.
read -r -p 'Verified staging session pooler host: ' PGHOST
export PGHOST
read -r -s -p 'Staging DB password: ' PGPASSWORD; echo
export PGPASSWORD

# AGE_RECIPIENT is a PUBLIC age1... value. Generate its private
# identity and store that identity safely OUTSIDE C:/D: and GitHub.
read -r -p 'AGE public recipient (age1...): ' AGE_RECIPIENT
export AGE_RECIPIENT

node scripts/r2-stream-backup.js --preflight
```

For proper server certificate verification, `PGSSLMODE=verify-full` is mandatory. If your PG17 client requires a private trust anchor, configure a verified `PGSSLROOTCERT` path without weakening TLS. Never fall back to `PGSSLMODE=disable`.

**Preflight does not connect to Supabase or Cloudflare.** It validates presence, known staging identity, private R2 config and installed CLI tool versions. It does not certify authentication or authorization.

## 4. Real export: separately authorized operator action

Only when preflight, exact source identity and private-bucket access have been independently verified, the owner may run:

```bash
export R2_EXECUTE_CONFIRMED=YES
node scripts/r2-stream-backup.js --execute
unset R2_EXECUTE_CONFIRMED
```

The command is read-only for Supabase; R2 is written with a **new unique** `staging/<time>-<random>.pgdump.age` object. It then reads the encrypted object back for SHA-256 comparison. It prints only a safe object key, encrypted byte count and ciphertext SHA-256; the password, student records, token, AGE secret identity and database URL never print.

**Important:** rclone `rcat` cannot retry an entire unknown-length stream after a transport failure; a failed job may leave a partial R2 object. Do **not** claim success when any of the dump/encrypt/upload/readback stages fails. Do not delete old backups automatically. Backup bucket storage and requests can be billable outside free allowances.

## 5. Independent restore — required before release

1. Independently download the ciphertext to a **separate protected recovery environment** using read-only credentials, verify SHA-256 against the operator's recorded upload receipt, then decrypt using the AGE **private identity** in restricted volatile/encrypted memory.
2. Independently provision an isolated empty **PostgreSQL 17 + PostGIS/Supabase-compatible** target, with owner-approved cost and distinct project ID. Prepare required restricted roles, extensions and platform-managed prerequisites separately. The custom-format archive can be inspected using `pg_restore --list`.
3. Restore **only to the verified distinct target** using carefully reviewed `pg_restore`; require exit-on-error and preserve an audit log without sensitive records. Check grants, RLS, migration ledger and all table metadata. Never use `--clean`, `--create` or a live source URL by default.
4. Compare actual source/restore schema, counts and row-content fingerprints using the guarded `scripts/staging-restore-compare.js` and verify the previous Render deployment is still rollback-eligible. The restore checker currently expects role and metadata parity and an independent Supabase target; do not weaken it to make a partial archive pass.
5. Only after evidence-backed cold restore, provider-auth QA, reviewer approvals and the release runbook gates may staging migration 008 or a new Render deployment be reconsidered.

**Current status:** Tooling implemented/tested in synthetic isolation; real Cloudflare account, bucket, token, remote object, actual source backup, independent restore and rollback are **NOT YET VERIFIED**.

References: [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [rclone environment config](https://rclone.org/docs/), [rclone streaming caveat](https://rclone.org/commands/rclone_rcat/), [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
