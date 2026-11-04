# Task: Azure Blob private encrypted staging backup

- **Task ID:** `2026-11-04-azure-private-blob-backup`
- **Agent:** ChatGPT engineering agent; Azure account owner for private container/RBAC and trust validation
- **Date:** 2026-11-04 UTC
- **State:** implemented and tested in isolated CI (**6/6 synthetic Azure backup tests passing**); real data export and independent restore **NOT PERFORMED**
- **Baseline:** `ops/staging-recovery-ledger-2026-11-04` commit `460be03f7fb6be267fa4e94fde14cb0347745509`, stacked after PR #22 → #13 → #12 → #11
- **Branch:** `ops/azure-blob-stream-backup-2026-11-04` (separate from Cloudflare R2 draft #25, which remains untouched)
- **Scope:** optional Azure-specific operator backup implementation, unit tests, CI and runbook; no credential retrieval, Azure resource creation, PostgreSQL changes, production interaction, staging migration, Render deploy or billing action

## Evidence and architecture

- Owner supplied screenshot and portal configuration for Azure for Students, resource group `campuspool-backup-rg`, Malaysia West, Standard LRS, account `011campuspoolbackup` and subsequently confirmed account creation. **Creation is owner-reported, not independently checked via Azure API**. Container `campuspool-staging-backups` still requires private/no-anonymous-access creation and permission verification.
- Both C: and D: were verified Windows BitLocker Off. Azure CLI credential cache must stay under a user-private **Linux tmpfs /dev/shm/** directory and never be stored persistently on unencrypted drives.
- Source is exclusively the exact `tnitksrlntrdxbvznxzf` staging project in the exact Supabase Session Pooler PGUSER, using PG17 `pg_dump` with `PGSSLMODE=verify-full`. One `pg_dump --format=custom --schema=public --schema=supabase_migrations` transaction gives consistent selected-schema snapshot even when service writes occur. Neither global roles nor all provider-managed schemas/media are included.
- `scripts/azure-blob-backup.js`: explicit `--preflight|--execute`, source and destination allowlist, private container attestation, safe subprocess env allowlists, AGE recipient encryption `pg_dump → age → Azure Blob SDK uploadStream` with unique randomized key and if-none-match, and full ciphertext independent Azure readback SHA-256 check. No local decrypted dump. Prints only ciphertext size, path and digest on success. No secrets in GitHub.
- SDK authentication uses Microsoft Entra `AzureCliCredential` and container-scoped Blob Data Contributor RBAC, with `@azure/storage-blob` and `@azure/identity` installed privately outside project repo. No account key or SAS tokens.
- No storage-lifecycle schedule created. Azure for Students credits, account lifespan, price/transaction fees, cross-border student data controls must be reviewed by account owner before first upload.
- `test_azure_blob_backup.js`: synthetic process/client fakes for staging allowlists, verified TLS, private RAM-backed Azure token cache, encryption pipeline, readback tampering, cloud failures, subprocess secret separation, and operator explicit consent. No Azure cloud/DB network access.
- Reference: [docs/ops/AZURE_BLOB_BACKUP.md](../../ops/AZURE_BLOB_BACKUP.md).

## Hard recovery release gates

1. Private container created and Azure account-key/anonymous-access restrictions confirmed by owner.
2. Azure for Students billing/quotas/credit and Malaysia data-region transfer review accepted by owner.
3. Local unit tests and GitHub CI pass; owner installs Azure CLI and Node SDK in Ubuntu-D and confirms RBAC.
4. Owner completes harmless synthetic encrypted upload/download privately; no live Supabase yet.
5. Real staging backup uploaded via AGE-protected stream, independent second Azure retrieval and ciphertext hash match.
6. Decrypt in a secure **different** environment and cold restore to distinct PG17/PostGIS target; prepare global roles/managed schemas separately, validate row data, grants/RLS, migration ledger and content digests.
7. Confirm Render previous artifact rollback and reviewer signoff before migration 008 or any staging deploy.

## Acceptance / verification

| Check | Status |
|---|---|
| Owner reported Azure for Students Standard LRS account created | USER-REPORTED |
| Private Blob container created | OWNER-CONFIRMED 2026-11-04; private ACL, network firewall and RBAC NOT YET INDEPENDENTLY VERIFIED |
| Exact staging and Azure destination guards written | IMPLEMENTED; 6/6 Azure synthetic tests PASS #41825931989 |
| Encrypted stream mock, readback corruption, subprocess secret isolation tests | CI PASS, 6/6 #41825931989 at `d9f2938` |
| Live staging export to Azure | **NOT RUN** |
| Verified independent cold restore | **NOT RUN** |
| Staging migration, production modification, deployment | **NONE** |

## Next exact operator handoff

1. In Azure portal go to storage account `011campuspoolbackup` → **Data storage → Containers → + Container**, create `campuspool-staging-backups`, **Anonymous access = Private**.
2. Send confirmation of container presence and private access **only**; no keys, tenant/subscription IDs, passwords or signed URLs.
3. Review PR/CI and execute private Ubuntu-D setup from [Azure Blob operator guide](../../ops/AZURE_BLOB_BACKUP.md), then report safe local PASS/BLOCKED results.
4. Do **not** treat cloud archive round-trip as sufficient to approve release until independent PostgreSQL restore, role/RLS/grant/data and rollback evidence exists.

## Tested checkpoint — November 4, 2026 UTC

- PR #26 synthetic Azure Blob backup GitHub Action [#41825931989](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41825931989) **PASS** — 6 mock unit tests, 0 failures. Demonstrated private tmpfs auth guard, source/destination allowlist, verified TLS guard, pg_dump → AGE → Blob stream checksum readback, tamper detection, cloud failure, credential isolation and explicit operator consent.
- First CI on original test mocked an incomplete child process (`kill` missing); fixed in test fixture commit `d9f293816f4977485b5b75b23f3c8572b1288af1`, rerun GREEN. No actual Azure/Supabase network access, student records, real secrets, resource writes or deployments.
- Security smoke run [#41825932006](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41825932006) **PASS** on same code. Other parent-branch workflow result should be checked separately before merge.
- Actual storage-account creation is owner-reported; private Blob container and RBAC remain unverified. No encrypted blob receipt or cold restore yet.

## Owner IAM checkpoint — November 4, 2026 (reported)

- Owner confirmed assigning **Storage Blob Data Contributor** to their own Microsoft Entra user at exact container scope `011campuspoolbackup/campuspool-staging-backups` through Azure portal, no conditions. This is **owner-reported, not API-verified**; role propagation and actual data-plane permissions remain untested.
- Before any remote blob write, operator must confirm `az account show` is Azure for Students/Enabled, and run `az storage container show --account-name 011campuspoolbackup --name campuspool-staging-backups --auth-mode login` from Ubuntu-D with Azure CLI token cache on verified private `/dev/shm` tmpfs. Expect private/no anonymous access. A 403 or network policy error is a STOP rather than permission to use shared storage account keys.
- The operator can then run a **synthetic, AGE-encrypted sample** upload/download test, not the real staging export. Real source data transfer, separate PG17/PostGIS cold restore and Render rollback remain unverified.

## Operator cloud access checkpoint — November 4, 2026 (verified by user-supplied CLI output)

- From Ubuntu-D WSL, owner ran `az storage container show --account-name 011campuspoolbackup --name campuspool-staging-backups --auth-mode login --query "{name:name,publicAccess:properties.publicAccess}" --output json` and returned `{"name":"campuspool-staging-backups","publicAccess":null}`. This confirms successful authenticated data-plane read access and **no anonymous public container access**. This is not independent access to Azure connector; verification is based on user-supplied command output.
- Azure CLI installation and `AZURE_CONFIG_DIR` under `/dev/shm` were operator-led. Full login-cache path protection, account-wide anonymous access, read/write/delete RBAC, firewall rules and data sovereignty compliance remain unverified.
- Next: a unique synthetic non-student payload encrypted with a one-off AGE public recipient/private identity confined to `/dev/shm`; Entra-authenticated blob upload, download, byte comparison, decrypt and removal of only test object. This tests actual data-plane **write** permission. Never run a real staging export before this and explicit review of live-data transfer gates.

## Encrypted test blob round-trip — November 4, 2026 (operator-confirmed)

- The owner executed the explicit ephemeral AGE smoke test using `/dev/shm` on Ubuntu-D, Entra ID `az storage blob upload` and `download` with `--auth-mode login`, ciphertext `cmp`, AGE decryption and deletion of the uniquely named `smoke/...` test blob.
- Operator returned these exact **non-sensitive status lines**: `PASS: Encrypted upload, download and decryption verified` and `PASS: Test blob deleted`.
- This confirms an authenticated Azure data-plane **write + read + delete** path and AGE decryption for **synthetic text only**, based on operator output (no independent Azure cloud connector available). It does not verify a staging PostgreSQL backup, proper preservation of AGE decryption keys, remote disaster resilience or any independent restore.
- Remaining before any real student data is exported across India/Singapore → Malaysia: durable AGE recipient and securely segregated decryption private key, billing/retention review, applicable data-transfer/privacy approval, local Azure JS SDK and PG17 backup preflight, and full recovery plan with a separate compatible restore target. Production data/staging migrations and Render deployments untouched.
- **Next safe local action**: install Node Azure SDK outside checkout and run `node --test test_azure_blob_backup.js` in isolated Azure PR branch before preparing source-only credentials in a private WSL terminal.
