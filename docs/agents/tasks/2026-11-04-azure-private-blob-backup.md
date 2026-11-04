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
| Private Blob container created | NOT YET CONFIRMED |
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
