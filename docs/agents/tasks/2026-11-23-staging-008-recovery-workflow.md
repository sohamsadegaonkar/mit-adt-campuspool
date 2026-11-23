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
- **2026-11-23:** Source-only CI green on exact implementation head `53d200f62c633a5448e8fe7ed71e536c888883ce`. [Offline 008 policy and synthetic AGE/PG17 restore run #45138252885](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45138252885) PASS (both policy and isolated synthetic age restore jobs). [Stage 1 PostgreSQL #45138252715](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45138252715), [secret hygiene #45138252787](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45138252787), and [agent documentation #45138252834](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45138252834) PASS. This is only local/source CI evidence; **no Supabase backup, AGE plaintext, new migration, live restore or deployment executed**.
- **2026-11-23:** After review, strengthened the manual restore gate to compare **exact migration names 001–007**, sum of all nine source-app rows (zero), nine RLS policies, reconstructed backend grants, and zero client API grants; added negative regression tests to catch malformed restore assertions before merging. The live workflow remains manual/draft and cannot run until an independently reviewed `main` merge plus owner-protected GitHub environments and secrets.

## Verification

| Test/check | Evidence | Result / limitations |
|---|---|---|
| Staging project and ledger | Supabase project and migrations readback, 2026-11-23 | PASS / app data 0; ledger 7 |
| Before-008 RLS/grants | Read-only SQL, existing preflight `checkSnapshot` criteria | PASS |
| Offline target/CA-policy tests | [Actions #45138252885](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45138252885) | PASS; isolated tests only |
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


## 2026-11-23 — Independent security review: reconstruction fix + full 007 synthetic restore

- **Concrete bug fixed:** `has_table_privilege(role, table, 'SELECT,INSERT,UPDATE,DELETE')` returns true if **ANY** of those four permissions is granted, not all. The manual isolated restore originally used that form to declare all nine tables' backend CRUD restored. It now checks **each of SELECT, INSERT, UPDATE, DELETE independently**, with a real PG17 synthetic negative/positive regression (only SELECT must fail the all-four predicate; all-four grants must pass).
- **Concrete restore gap fixed:** `pg_dump --no-acl` / `pg_restore --no-acl` does not restore source ACLs. Replaying migration 005 restored only the original five application-table grants, not four added by migrations 006/007. Shared `scripts/staging-008-scratch-grants.sql` reconstructs those four tables' backend-only CRUD plus `extensions` schema USAGE on **new isolated restore DB only**. All eight canonical result assertions are now in `scripts/staging-008-scratch-assertions.sql` and are reused by the manual recovery workflow and disposable regression. No live staging SQL applied.
- **Manual workflow fail-closed guard strengthened:** manual `workflow_dispatch` now requires separate typed `STAGING_008_WRITE_FREEZE_CONFIRMED` as well as `STAGING_008_PREIMAGE_ONLY` and `main` ref. This is an **operator attestation, NOT a technical freeze**, so owner still must establish and document an actual write-freeze/change window. GitHub checkout/setup-node/upload/download artifact actions pinned to immutable commits validated against GitHub v4 tags. No automatic triggers or migration commands added.
- **Full synthetic migration fidelity CI:** added `scripts/staging-008-synthetic-007-restore.sh`, which applies **actual SQL migrations 001–007** and seven synthetic migration ledger entries on disposable PG17/PostGIS, streams selected `public` + `supabase_migrations` PGDMP into AGE encryption, decrypts/restores into a **second new scratch database**, replays exactly the shared 005 plus 006–007 backend grants and checks the same eight SQL assertions (nine RLS-enabled tables, backend-only policies/grants, zero rows, 001–007 ledger, absent 008 table, no client-table rights). It contains **no Supabase/Render/Azure credentials and no source DB connection**. It is not an independent operator/isolated cloud recovery certificate.
- **Verification:** [staging-008 recovery contract CI #45142150202](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45142150202) **SUCCESS 3/3 jobs**, including `synthetic-full-007-cold-restore`, `synthetic-age-roundtrip` (demonstrated ANY-vs-ALL privilege semantics) and source-policy. The full synthetic job log explicitly printed `SYNTHETIC_ACTUAL_007_SCOPED_AGE_COLD_RESTORE_WITH_RLS_GRANTS=PASS`, `REAL_STAGING_BACKUP_CREATED=NO`, `OFFSITE_INDEPENDENT_RESTORE_VERIFIED=NO` and `STAGING_008_MIGRATION_AUTHORIZED=NO`.
- **Real operational acceptance STILL BLOCKED:** GitHub environments `staging-008-backup` / `staging-008-restore` must have owner-verified branch restrictions, required **different human reviewers**, separate scoped secrets, admin backup role/CA approval and distinct AGE decrypt identity; workflow YAML does not prove protection settings exist. Current manual workflow's `postgres:17-bookworm` and `postgis/postgis:17-3.5` Docker references are mutable tags; pin reviewed immutable runtime digests before real manual execution. No actual ciphertext export/object retention verification, off-host retrieval, independently operated AGE cold restore, measured write-freeze/RPO/RTO, staging DDL or Render deploy. A short-retention GitHub ciphertext artifact is NOT full Supabase project disaster recovery.
- **Decision:** **source-only preflight code corrected / synthetic application recovery PASS; operational approval for live staging backup + 008 remains NO-GO until separate protected environment review and genuine independent preimage/restore evidence.** This PR stays DRAFT / unmerged; no actual staging migration or production change authorized by code/CI alone.


## 2026-11-23 — Environment/export/CA/OCI/freeze readback

- The owner requested verifying two protected GitHub environments, approval of staging export identity and CA, immutable image pins, and a real write freeze. This source-only engineering pass does NOT execute backups, runtime freeze, Render, Azure, DB DDL or migration 008. [Operator evidence](../../ops/STAGING_008_OPERATIONS_APPROVAL.md).
- Authenticated GitHub backup-environment settings page readback: required reviewers ON, only repository owner listed, prevent self-review ON, no branch restriction, administrator bypass allowed. Only STAGING_BACKUP_DATABASE_URL secret name present, no listed CA or AGE recipient. UI showed an error banner, so these controls are NOT independently certified persisted. Restore-environment settings could not be read; do not infer protections from a YAML environment name. Changing access or sharing awaits explicit user approval.
- Live READ ONLY staging Supabase metadata: PostgreSQL 17.11, migrations 001–007; campuspool_staging_app has LOGIN and all four CRUD grants on 9 RLS-protected app tables, but no SELECT/USAGE on supabase_migrations ledger. postgres can read that ledger but has broad administrative permissions and BYPASSRLS. No authorization was granted to export with postgres; no credential contents exposed or altered. Server SSL on, API query uses TLS; actual protected runner CA secret is missing, and successful verify-full using pinned DER cert hash 807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA remains unverified.
- The live staging application role was not frozen: can LOGIN, write 9/9 tables and increment campus_identity_audit_id_seq. It had zero sessions at the read instant; that does not prevent future writes. Render staging service unsuspended. Added read-only scripts/staging-008-freeze-verify.js checks for NOLOGIN, zero app-role sessions, no table DML and no public writable sequences; the protected manual preimage guard now refuses backup when not frozen. This is an application role check, NOT database-wide freeze or proof privileged admin writers are controlled. It does not alter the database.
- Pin verified OCI multiarch index digests from official Docker Hub tag API: postgres 17-bookworm sha256:837bed18782820fe967067cb5328b02b0d9992c1be9a37ee0c9c492cfc03af3b; postgis/postgis 17-3.5 sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6. Applied to manual + synthetic service images and docker ancestor filters, not just documentation.
- [Pinned-image + freeze-guard CI #45149228881](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45149228881) success, plus Stage 1 #45149228863 and source/docs/security workflows success on code head. App freeze negative regression 8/8 passed, synthetic 001–007 AGE recovery stayed green. These proofs do NOT establish real encrypted export or restore.
- Next gate: independent approval and readback of BOTH protected GitHub environments and separate reviewer identities; privately approve limited-time export credential and valid pinned CA + AGE recipient, and establish a reversible owner-approved staging maintenance/write freeze with all writers drained. Then separately approve one real encrypted scoped staging backup, independent PG17/PostGIS restore and rollback evidence before migration 008. G1 and production remain NO-GO.
