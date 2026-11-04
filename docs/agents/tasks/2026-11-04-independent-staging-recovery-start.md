# Task: Independent staging backup and cold-restore execution readiness

- **Task ID:** `2026-11-04-independent-staging-recovery-start`
- **Status:** Operator export and restore NOT RUN; source metadata preflight passed; protected backup tool hardening under CI review
- **Agent/owner:** ChatGPT engineering agent for connected metadata checks and guarded script changes; trusted local WSL Ubuntu-D operator for private DB credentials, encrypted off-site storage and separately provisioned recovery target
- **Date:** 2026-11-04, Asia/Kolkata
- **Branch:** `ops/staging-recovery-ledger-2026-11-04`, stacked on security/staging-restore-content-digests-2026-11-03 (PR #13); do not merge directly to main or deploy
- **Scope:** Audit staging metadata/backup availability, harden existing offline export, preserve Supabase migration ledger, prepare independently verified encrypted restore handoff. No live data rows queried or written, no environment changes or Render deploy, no new paid Supabase project, and no WSL filesystem access from this cloud session.

## Goal and acceptance criteria

Actual release GO requires (1) a verified encrypted logical export from the **exact** Supabase staging project `tnitksrlntrdxbvznxzf` with roles, schema, data and migration ledger; (2) a copy on an independent off-site destination; (3) an independently re-downloaded ciphertext SHA-256 match; (4) a cold restore into a **different, empty, Supabase-compatible PostgreSQL 17/PostGIS project** with full permissions and migration history; and (5) the source/restore catalog, role/RLS/grants, migration ledger, row counts and bounded row-content fingerprints comparison on a controlled source snapshot. Never print or upload credentials, raw records, row hashes, database URLs, decrypted files or private AGE identity.

## Current state and verified evidence

- Source metadata preflight at **2026-11-04 08:15:31 UTC** via read-only Supabase SQL: PostgreSQL 17; database `postgres`; **9** application tables and **9** with RLS enabled; `campuspool_staging_app` is not superuser or BYPASSRLS and can log in. Migration 008 table absent. Supabase migration listing contains 001–007 only. No student rows read.
- Supabase projects listing: one healthy named `campuspool-staging-db`, two unrelated inactive projects, **no existing dedicated recovery target** and zero staging development branches. Reusing an unrelated project would be destructive; creating a new one may have costs. None done without separately grounded owner approval.
- Current authorized tools can inspect Supabase metadata and change schema, but **cannot stream a private dump to operator-encrypted off-site storage, securely import a dump into a separate project, or verify filesystem-based backup bytes**. This cloud session cannot access the user's local Ubuntu-D/D drive. Export/restore **not started on the operator's machine**.
- Supabase Free plan does not provide automatic daily backups: [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups), updated 2026-10-29; manual CLI exports required.
- Official [Supabase backup/restore CLI guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) explicitly requires preserving `supabase_migrations` schema and data separately; prior branch's backup script excluded them while the restore-comparison checker requires the ledger. This branch fixes that mismatch.
- Existing `scripts/staging-secure-backup.sh` and `scripts/staging-backup-guard.js` are strictly operator-only with exact staging project allowlist, encrypted private work directory, verified independent off-site mount, recipient encryption, no credential logging, and only temporary plaintext in attested encrypted work volume.
- Added `STAGING_WRITES_PAUSED_CONFIRMED=YES` requirement **before** running sequential export commands; write quiescence is an explicit operator attestation, not something the script can prove. Operator must prevent mutations from the staging service, background workers and manual SQL during the source export/snapshot comparison.
- Added encrypted `history_schema.sql` and `history_data.sql` to archive, along with roles/schema/data, to support the actual PR #13 strict migration-history verifier. Added exclusions for provider-managed vector storage data according to Supabase CLI guidance. Archive remains encrypted with AGE, with a checksum for the remote-mounted ciphertext; **no claim of independent retrieval until tested separately**.
- Render staging still reported the prior `cceadbf` deploy as live; old build rollback artifact availability not verified. No release, migration 008 or production action permitted.

## Execution plan and operator gates

1. **Local prerequisites on Ubuntu-D:** sync repository in a **separate Git worktree** from the active development branch; ensure Node, Docker daemon, PG17 psql, Supabase CLI, AGE, tar, sha256sum and enough space in a **genuinely encrypted** work volume. Run only `--preflight` first; it cannot back up or restore data.
2. **Private configuration, never in chat:** operator supplies source Session Pooler URL for exact `tnitksrlntrdxbvznxzf`, an AGE **public** recipient whose private identity is protected separately, an encrypted scratch folder outside Git and an independently verified off-site mounted destination. Set `STAGING_WORKDIR_ENCRYPTED=YES` and `OFFSITE_MOUNT_VERIFIED=YES` only after personally validating those claims; use read-silent inputs to avoid shell history. Do not use a local D: directory as if it were independent off-site protection.
3. **Write quiescence:** owner verifies no staging writes from service/workers/manual operators while five **separate** Supabase dump commands run and source metadata is captured; then set `STAGING_WRITES_PAUSED_CONFIRMED=YES`. This is required only for `--execute`.
4. **Protected export:** operator runs `bash scripts/staging-secure-backup.sh --execute` on a trusted WSL host with private configuration. Script exports 5 parts, encrypts to an attested off-site mount, checks mounted ciphertext SHA-256 and cleans temporary plaintext. It does **not** prove separately retrieved remote copy, a successful restore or content equality.
5. **Independent transfer:** from a distinct download/read location, download archived `.tar.age` and `.sha256`; verify ciphertext checksum with `sha256sum --check`, decrypt into a separate encrypted restricted workspace using private AGE identity, verify exact 5-part manifest and no mixed backup generations. Never copy plaintext to GitHub/CI/Notion.
6. **Cold restore:** provision a distinct empty and securely isolated PG17 Supabase-compatible scratch project with approved costs, verify its project ref is NOT source, configure PostGIS/required extensions, and restore using documented `psql --single-transaction --set ON_ERROR_STOP=1` for roles/schema/data **and migration ledger**. Verify custom role credentials are reset privately. Supabase manages other schemas/extensions separately; capture incompatibilities rather than ignoring errors. Never use `Supabase.restore_project` on the live source.
7. **Independent comparison:** after the source snapshot is stable and target restored, use the guarded `scripts/staging-restore-compare.js --preflight` then `--compare` with separately confirmed source/target project refs and private connection settings. It must report matching bounded metadata/roles/grants/RLS, migration ledger and row-content digests. Discrepancy => NO-GO, not an instruction to modify source/target blindly.
8. **Owner signoff:** report only exporter status/time, separate checksum verdict, restore completeness/migration count and comparison verdict. Independently check Render previous artifact rollback eligibility before any staging deployment.

## Verification

| Gate | Status |
|---|---|
| Source identity, PG17, app role and RLS metadata | VERIFIED read-only at 2026-11-04 08:15 UTC |
| Migration history 001–007 and 008 absent | VERIFIED |
| Five-part encrypted export tool syntax and synthetic tests | CI pending |
| Actual live staging export | NOT RUN — trusted operator-only URL / encrypted workdir / approved off-site mount unavailable in cloud agent |
| Remote re-download checksum and independent decryption | NOT RUN |
| Separate approved PG17/PostGIS restore | NOT RUN — separate target not provisioned |
| Migration/RLS/role/content comparison of real snapshot | NOT RUN |
| Render retained rollback artifact | NOT VERIFIED |
| Staging release approval | NO-GO |

## Engineering handoff

- **Next action:** CI review of the five-part backup tool; then operator completes the private Ubuntu-D `--preflight` and returns **only non-sensitive PASS/BLOCKED tool names**. After explicit write pause and verified independent off-site storage, execute export. Decide independently whether to provision scratch project or isolated local Supabase stack before restoring any private records.
- **Safety:** do not expose private URL, dump, AGE identity, source/target row content, hashes or credentials to this chat, GitHub Actions, Notion or logs.
- **Related:** PR #11 (backup utility/idempotency), #12 (restored schema comparator), #13 (row fingerprint hardening), this new stacked branch, and [staging runbook](https://github.com/sohamsadegaonkar/mit-adt-campuspool/blob/security/staging-restore-content-digests-2026-11-03/STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md).
