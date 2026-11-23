# Task: Staging migration 008 — protected encrypted preimage and restore gate

- **Task ID / file:** `2026-11-23-staging-008-recovery-workflow`
- **Status:** in review; **live backup not run**
- **Agent / owner:** CampusPool engineering / operator (reviewer unassigned)
- **Last updated:** 2026-11-23 UTC
- **Baseline:** `main@202330a8166674d86a428e1f90ab8ed857d1313d`
- **Scope:** only dedicated staging Supabase `tnitksrlntrdxbvznxzf`; no production, Azure job, Render mutation, billing or migrations.
- **Dependencies:** [source-only staging QA PR #76](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/76), [G1 independent backup PR #70](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/70).

## Goal and acceptance criteria

Owner approved **staging-only migration 008 conditional on backup/rollback evidence**. Provide an owner-reviewed route to export a pre-008 copy, encrypt it before storage, independently retrieve/decrypt and restore the selected staging application schemas in a wholly isolated PostgreSQL 17/PostGIS database, compare migration ledger/table presence/emptiness, RLS and reconstructed server/API grants; migration 008 must remain unapplied until review of that actual proof.

## Current state (verified vs assumed)

On 2026-11-23 the connected Supabase organization is **Free**, staging project `campuspool-staging-db` ACTIVE_HEALTHY on PG17.11. Migration ledger has entries 001–007, migration 008 receipt table is absent, and the nine app public tables have **zero rows**. Read-only catalog confirms app role's restricted CRUD and server-only RLS policies, no Supabase API grants. Two new Render staging deployments of `main@202330a8` fail on `42P01` because `public.campus_idempotency_keys` does not exist; previously live staging commit remains `cceadbf6251f70634320e50b8288530ba77513c3`, branch main, auto-deploy OFF. Production unchanged. Supabase [backup documentation](https://supabase.com/docs/guides/platform/backups) does not promise automated restorable backups on Free.

Existing [`scripts/staging-migration-preflight.js`](https://github.com/sohamsadegaonkar/mit-adt-campuspool/blob/main/scripts/staging-migration-preflight.js) tests exact staging project and catalog for before/after 008; it **does not** create a backup. Old Azure manual worker succeeded at a preflight, but never proved live export/restore.

## Plan

1. Guard **one** staging-only backup run with exact Supabase hostname/ref, `postgres` database, verified TLS+CA pinned to SHA-256 `807025AD…B72E6CAFA`, approved backend/app credential identity, zero app rows, ledger count 7, RLS/grants and record of existing rollback code SHA. Reject arbitrary URLs, admin backup credential unless separately acknowledged and any nonempty source tables.
2. From manually dispatched **protected GitHub environment** `staging-008-backup` on reviewed main only, use PostgreSQL 17 `pg_dump -Fc` restricted to `public` and `supabase_migrations`, streaming directly into AGE (no plaintext file), create SHA-256 manifest and upload only encrypted ciphertext, retain 14 days.
3. In **separate runner and environment** `staging-008-restore`, independently download, validate SHA, decrypt via private AGE identity **only in the restore job**, pipe into ephemeral PG17/PostGIS scratch database, reconstruct the limited dedicated role grants from reviewed migration 005 (scratch only), verify exactly seven ledger records, nine original application tables, empty data, RLS/server policies and no API role privileges. No source DB credential available to the restore job.
4. Human reviewer checks actual workflow evidence, confirms backup retention and source freeze. **Separately approved** migration 008 may then be applied via Supabase migrations under an explicit change window. Revalidate table/index/role/RLS/ledger afterwards and coordinate distinct authorized staging Render deployment.
5. **Do not** treat this narrow application-scope recovery as a complete G1 Supabase project recovery: auth, storage, other managed schemas, global roles, objects, custom role passwords and other externally held data are not included.

## Progress log

- **2026-11-23:** Verified isolated staging Supabase Free, 001–007 migrated, no CampusPool app rows, 008 table absent. Reviewed exact source migration and rollback/runbook.
- **2026-11-23:** Added `scripts/staging-008-backup-guard.js` with strict staging URL/role and pinned CA validation, read-only catalog checks, zero-row/7-ledger guard, and tests including admin-role opt-in rejection.
- **2026-11-23:** Added **manual-only** `.github/workflows/staging-008-recovery-proof.yml` with separate GitHub environments, encrypted-only GitHub Actions artifact and independently verified scratch restore. Added **offline-only** `.github/workflows/staging-008-recovery-contract.yml`. Neither has executed an actual staging backup, produced an encrypted artifact or applied migration 008.
- **2026-11-23:** Ready for exact-head CI and independent workflow/security review. No GitHub secret was configured in this work.

## Verification

| Test/check | Evidence | Result / limitations |
|---|---|---|
| Staging project and ledger | Supabase project and migrations readback, 2026-11-23 | PASS / app data 0; ledger 7 |
| Before-008 RLS/grants | Read-only SQL, existing preflight `checkSnapshot` criteria | PASS |
| Offline target/CA-policy tests | `node --test test_staging_008_backup_guard.js` | Pending GitHub CI |
| Actual encrypted preimage | Manual `staging-008-recovery-proof.yml` | **NOT EXECUTED** |
| Independent AGE decrypt/PG17 restore | Distinct environment runner | **NOT EXECUTED** |
| 008 applied and post-checks | Supabase migration list and catalog | **NOT EXECUTED** |
| Staging Render deploy and browser QA | Exact commit + protected auth test | **NOT EXECUTED** |
| Production G1 full recovery | Independent all-schema/global-role proof | **BLOCKED** |

## Risks and decisions

- Supabase **Free** does not provide a confirmed daily recoverable backup. An encrypted copy is necessary before applying schema DDL even when application tables are empty.
- Existing `campuspool_staging_app` credential may lack `SELECT` on `supabase_migrations`; do not widen its live role grants merely to allow a dump. If so, use an owner-approved **staging-only** privileged export credential in the separately protected `staging-008-backup` environment, with `STAGING_008_BACKUP_ADMIN_ACK=OWNER_APPROVED_STAGING_BACKUP_ADMIN_READ_ONLY_EXPORT`. This is a privilege-bearing secret: a reviewed security decision is required before configuring it. No such secret was created here.
- Before merging/dispatch: configure **two distinct GitHub environments with required reviewers and main-branch restriction**. Environment names in YAML alone do not enforce required approvals. Secrets/variables: `STAGING_BACKUP_DATABASE_URL` (admin only on separately approved route, exact project), `STAGING_BACKUP_CA_PEM_B64`, `STAGING_008_BACKUP_ADMIN_ACK` (if admin), public variable `STAGING_BACKUP_AGE_RECIPIENT`, and separate restore-only secret `STAGING_008_AGE_IDENTITY`. Never paste any in a chat, PR or file.
- GitHub Actions ciphertext artifact has **14-day retention**; consider an additional approved independent store with longer retention before any lasting release. The current workflow only provides a time-limited preimage for migration 008, not durable disaster-recovery coverage.
- A snapshot cannot guarantee rollback of changes after it was taken. Freeze staging app writes during capture/migration and agree data-loss window; never restore into the live staging database automatically.
- A passing manual workflow does not certify app deployment, complete Supabase/global-role restoration, RPO/RTO, genuine OTP delivery, student data parity or production release.

## Next steps — exact handoff

1. **Next action:** Review source PR, run exact-head offline CI and fix failures; independently assess encrypted workflow, API isolation, GitHub environment protection and source role/CA prerequisites. **Do not merge/dispatch before review.**
2. **Who may do it:** repository reviewer/operator with explicit GitHub environment and Supabase staging permissions; no agent may silently create secrets or migrate data.
3. **Prerequisites and blockers:** approved `staging-008-backup` and `staging-008-restore` secrets/protection, exact staging data target and privileged backup role decision. Without evidence, G1 migration conditional gate stays CLOSED.
4. **Expected evidence:** SHA256 of encrypted archive, exact source/ledger 007, independent decryption and clean scratch restore with nine original tables, grants/RLS, zero data and 7 ledger entries. Review and preserve secure artifact until explicit rollback window closes.
5. **Production impact:** none. No Render, Azure, database export/migration, payment/penalty or production change performed in this task.

## Links and files changed

- Branch: `ops/staging-008-encrypted-recovery-gate-2026-11-23`
- `scripts/staging-008-backup-guard.js`, `test_staging_008_backup_guard.js`
- `.github/workflows/staging-008-recovery-proof.yml`, `.github/workflows/staging-008-recovery-contract.yml`
- `docs/agents/STATUS.md`, `docs/agents/NEXT_STEPS.md`
- Prior staging live SHA: `cceadbf6251f70634320e50b8288530ba77513c3`

**PRECONDITION STATUS: NOT SATISFIED — do not apply 008, deploy staging or production.**
