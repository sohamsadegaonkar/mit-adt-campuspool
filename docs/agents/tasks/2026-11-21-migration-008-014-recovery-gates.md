# RFC-CP-024 — Migrations 008–014 forward, restore-as-rollback and independent backup evidence gates

**Date:** 2026-11-21 IST · **Branch:** `test/migration-008-014-recovery-gates-2026-11-21` · **Parent:** reviewer-onboarding draft PR #69, above #68/#67/#66/#64 and earlier stack  
**Task class:** strictly isolated release preflight and recovery test, **NOT live migration approval**.  
**Initial release decision:** **NO-GO**. No Supabase staging connection, no Azure job execution, no production/Render change, no billing/sanctions or student data access.

## What previously existed and what this milestone tests

- `stage1-otp/migrate.js` already applies schema 001–014 sequentially during normal test setup. Its success alone does **not** prove real staging is at version 007, nor that separate changes can be rolled back without loss.
- Existing Stage 1 synthetic `test_pg_backup_restore.js` demonstrates a local PostgreSQL custom archive, authenticated encryption and independent scratch restore of a small legacy table set. Earlier [backup stdout incident](https://app.notion.com/p/40eca5237af58178a24def1da87a9005) shows why this must not be confused with genuine secured off-site recovery or a production-ready backup.
- New `scripts/migration-008-014-preflight.js`: read-only PostgreSQL catalog reconciliation of explicit **007/008/009/010/011/012/013/014** expected boundaries, validated constraints, indexes, new columns, per-table RLS, Supabase anon/auth/PUBLIC exposure and precise app role permissions. Does **not** mutate, migrate or rollback. `releaseReady:false` is hardcoded in all results; only a schema-shape match is returned.
- New `test_migration_008_014_preflight.js`: offline before/after version matrix, missing/premature artifacts, unvalidated constraints, unexpected RLS, broad client grants, reviewer role escalation, invalid source manifest, unapproved target and read-only SQL. Optional local 014 catalog readback requires an **explicit** isolated test flag.
- New `test_pg_migration_recovery_drill.js`: three new **randomized scratch databases**, all under Docker's **loopback** `campuspool_stage1_ci` and never Supabase. Apply 001–007 to scratch, seed synthetic active/cancelled legacy Pending and verified identities, take an in-memory **PGDMP** custom archive; AES-256-GCM authenticate/decrypt it (tamper test); restore 007 into a **separate** scratch database. Apply 008→014 *one by one* to source scratch while verifying source legacy rows are preserved and each stage's private schema/constraints/privileges match. Seed synthetic case, responses, reviewer grant, review, appeal and appeal review; take a **second** encrypted archive and restore it to a second isolated scratch target. Compare all key table row counts + SHA-independent row-content digests, constraints/RLS/grants, and verify prior 007 snapshot is still separate and unmodified. CI cleanup deletes **only randomly named scratch databases** and no actual user data.
- New workflow `.github/workflows/schema-recovery-drill.yml` runs the above with disposable PostgreSQL/PostGIS16 and container-bundled `pg_dump`/`pg_restore`; no production secrets, Azure credentials or outside network target. Explicit output `OFFSITE_RESTORE_G1_VERIFIED=NO`.

## Version-by-version safety matrix

| Version | Additive shape / notable invariant | Independent preflight / rollback consequence |
| --- | --- | --- |
| **007 baseline** | Verified identities, Rides/Bookings, PostGIS private match tables | **Not confirmed on live staging.** Prior-version archive must be retained and independently restored |
| 008 idempotency | `campus_idempotency_keys`, expiry index, RLS + backend CRUD | No duplicate write/replay receipt lost; prior snapshot integrity |
| 009 free pilot | `payment_mode` on rides/bookings, checks and FK, old payment-status CHECK removed | Free pilot `NoPaymentRequired` not a legacy debt; **old DB schema cannot simply accept arbitrary new 009 rows**. No blind down SQL |
| 010 journey | Driver-reported milestones and CHECK | Arrival timestamps are self-reports, not absolute GPS/boarding proof |
| 011 boarding | Passenger PIN nonce/attempts/boarded timestamps + CHECK | Never leak PIN/nonce, never alter boarded evidence for rollback convenience |
| 012 pickup cases | Two private tables, immutable case events, RLS INSERT-only app | Interrupted rides are allegations, no auto fines/ban |
| 013 participant responses | One reply per participant, FK-restricted, INSERT-only | Participant right-of-reply survives cancellation and flag rollback |
| 014 reviewer appeals | Independent grants SELECT-only to app; review/appeal append-only evidence | No self-promotion; review/appeal data must survive restoration; no financial effects |

**Important limitations:** The migration filenames and their source SHA-256 hashes are inventoried at test time, **not an operator-signed approved baseline**. The application does **not** currently maintain a canonical 008–014 migration execution ledger for this series. Inferring version from object presence may be wrong after partial/manual/legacy changes and is intentionally classified as advisory, not approval. The live staging major PostgreSQL/PostGIS versions, object/role catalogs, data counts, ownership, migration history and backup coverage were **not read or verified** in this task.

## Rollback is recovery, not destructive DOWN

The only rehearsed rollback is restoring a **pre-upgrade, independently authenticated archive** into a **new isolated database** and comparing snapshot contents/roles/schema. It does not run `DROP COLUMN`, `DROP TABLE`, payment-status rewrites or partial reversion in a live database.

**Do not restore an old backup over a database that accepted new real traffic** without an explicitly authorized maintenance/write freeze, reconciled write-ahead/change-log gap, approved recovery-point objective and a documented data-loss impact. If students booked after a snapshot, an unplanned cold rollback will erase valid new bookings; forward-fix may be safer and requires separate review. A CI rollback to 007 proves *technical restore semantics for synthetic data*, not production RTO/RPO, data recovery, or that new 014 apps can run against 007. Old and new app feature flags and deployment SHA must be pinned to the chosen DB schema and checked for compatibility.

## G1 independent Azure off-site backup-recovery evidence contract (OPEN)

A release approver must independently collect all of the following; **none is provided by this isolated task**:

1. **Image provenance:** exact backup-worker `ghcr.io/...@sha256:...` digest, verified Cosign OIDC identity/issuer and trusted build; private package pull/registry grant and job definition readback. A signed code commit, synthetic worker and earlier accepted GHCR auth probe are not evidence that the backup image was verified.
2. **Independent backup export:** approved staging-only source, deployed worker digest, immutable sanitized Azure execution ID + success, PostgreSQL major and TLS chain, complete `PGDMP` archive validation **before encrypt**, nonzero encrypted Azure blob version/size and cryptographic checksum, appropriate Key Vault/managed-identity access, confirmed **no plaintext stdout/file spillage**. Never paste DB URL, passwords, phone/email/user IDs or archive bytes into logs.
3. **Independent retrieval:** different approved recovery operator/identity retrieves encrypted blob from private off-site storage, verifies digest, decrypts **outside** original worker, validates archive with PostgreSQL tools matching actual staging major, and restores into an **isolated approved recovery target, not staging/production**.
4. **Data parity:** snapshot source and restored target with read-only transactions and consistent recovery point; counts and row-content digests for identity, sessions where appropriate, active and cancelled bookings, legacy `Pending`, free `NoPaymentRequired`, Rides, geo, idempotency receipts, pickup cases, events, responses, reviewer grants, decisions, appeals, appeal decisions, plus validated FK/CHECK, all RLS and app/anon/auth grants, role eligibility, PostGIS extension and migration history. Any deliberate exclusions (short-lived OTP/session keys) must be documented and expected.
5. **Operational recovery:** actual restore time, chosen RPO/RTO, verified owned write freeze/failover, updated app/data version pairing, safe rollback and post-restore smoke checks under explicit approval; independent reviewer signoff. No real user's data may be used for unapproved recovery drills.
6. **Incident disposition:** original unencrypted-host/plaintext-dump incident, previously invalid 200-byte archive, conditional G1 3 gates, exact access-grant scope and Key Vault role/revocation must be reconciled. Historical `PRELIGHT_START_REQUEST_ACCEPTED` and successful **preflight job** do not establish an independently retrieved, decryptable off-site backup.

**Evidence status per 2026-11-21:** software drill only. Actual independently verified off-site restore **NOT CONFIRMED**. Backup signature verification in prior checkpoint was **NOT_CONFIRMED** and subsequent private signer workflow ACL repairs must be verified separately. No source/schema G1 release approval inferred.

## Guardrails, ownership and next action

- Source and CI branch is draft and unmerged; never execute migration 008–014, schema upgrade, rollback, backup export or restore against live Supabase, Azure or Render from this task.
- Before any staging READ: owner-authorized read scope, precise dedicated target and protective opt-in; the new CLI rejects production/nonlocal/wrong project and defaults to **no connection**. Before any WRITE: explicit independent G1, backup snapshot and rollback approval, owner signoff and maintenance/traffic handling.
- **Outstanding:** operator-signed version manifest and canonical migration ledger, tested staging snapshots and true 014 row parity, real PostgreSQL-major compatibility, independently recovered Azure backup, physical Android/TalkBack/parked-driver safety, security and product acceptance and stacked PR review.
- **Release remains NO-GO** even if all synthetic CI checks are green. Real payment and sanctions remain OFF.

Sources: [backup incident record](https://app.notion.com/p/40eca5237af58178a24def1da87a9005) · [CampusPool launch roadmap](https://app.notion.com/p/41dca5237af5819ba7d3c3f9bff9b088) · [reviewer onboarding PR #69](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/69).


## CI evidence — verified on the exact code SHA (2026-11-21)

**Tested source commit:** `609d517f49d5b44a03e5094c6b49ac62044b69f7`, prior to documentation-only updates. Both GitHub Actions workflows completed **SUCCESS**:

- [008–014 Disposable Schema Recovery Drill #44899608141](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44899608141): actual `CAMPUS_MIGRATION_RECOVERY_RESULT` confirms **007 baseline → sequential 008–014**, protected active and cancelled legacy `Pending` data, **two independent scratch DB restores** (pre-upgrade and final), authenticated AES-256-GCM PGDMP encryption + tamper detection, case/reviewer/appeal content parity, RLS/private grants, and cleanup; **no in-place DOWN**, `azureBackupVerified:false`, `offsiteRestoreVerified:false`, `releaseReady:false`.
- Same recovery job’s read-only schema CLI reported **expectedStage=14, detectedStage=14, catalogMatches=true, failures=[]**, yet `migrationLedgerVerified:false` and `offsiteBackupVerified:false` by construction. A separate real-PG catalog integration test passed, including both PostgreSQL name[] role-array formats and misconfigured PUBLIC policy rejection.
- [Stage 1 PostgreSQL OTP tests #44899608147](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44899608147): **SUCCESS** across source syntax, migration-state offline guards and existing OTP, rides, idempotency, private mobility and security regressions. No real target.
- Earlier red CI attempts were triaged, not hidden: (1) typo matching `08_` instead of actual `008_` filename; (2) new scratch workflow omitted the existing **CI-only** PostGIS extension relocation; (3) node-postgres returned `pg_policies.roles` as a PostgreSQL `{role}` string rather than a native JS array. These are test harness/catalog parsing issues; all addressed without relaxing role/row security or modifying migration DDL.
- **Actual Azure image signing, encrypted offsite blob and an independent recovery operator are NOT verified.** The 014 schema and authorized historical data on actual staging were not queried. Synthetic PostgreSQL 16/PostGIS cannot prove real PostgreSQL major-version compatibility or recovery of any student record.

**Release verdict remains NO-GO.** Do not close G1 or authorize staging/production migration based on this CI, and do not silently apply schema DOWN in a database containing newer bookings. No cloud/database/student/payment/reviewer provisioning writes happened. Operational recovery and approval require the separate contract above.

## 2026-11-21 — Independent G1 evidence reconciliation and stricter migration source parity

- [Private signer verification run #44906606631, attempt 2](https://github.com/sohamsadegaonkar/campuspool-backup-signer/actions/runs/44906606631) was independently read: trusted signer control digest 35e37da… had `CONTROL_SIGNATURE=VERIFIED`; exact Azure-configured digest 694e39… had `AZURE_SIGNATURE=NOT_CONFIRMED`, `AZURE_EXIT_CODE=12`, `AZURE_ERROR=REVIEW_REQUIRED`. The job failed closed. No claim of image compromise/absolute unsignedness. Await independent review of [private signer PR #3](https://github.com/sohamsadegaonkar/campuspool-backup-signer/pull/3) before considering any Azure job repin; NO Azure writes or backup job runs authorized.
- Added `scripts/recovery-g1-evidence-preflight.js`, offline regression `test_recovery_g1_evidence_preflight.js` and [operator runbook](../../ops/RECOVERY_G1_EVIDENCE_PRECHECK.md). They compare only sanitized operator-reported evidence for provenance, ciphertext integrity, independent cold restore, PostgreSQL compatibility, row content/RLS/grants, ledger and write-safe rollback. They cannot verify external facts or authorize G1: all verdicts keep `releaseReady:false`; CLI always exits nonzero.
- Corrected `checkCatalog` so complete 008–014 manifest filename/version/hash parity with local source is REQUIRED, not just any 64-character checksum; spoofed/reordered hashes fail. Still no authenticated owner-approved migration manifest or executed ledger.
- Disposable CI now exercises PostgreSQL 16 and 17 in independent isolated databases (PostGIS 3.4/3.5); there is still no actual staging PostgreSQL major/version readback, no restored real off-site archive and no signed release gate. Review exact-head CI before interpreting any result.
- The existing 007 baseline restoration into independent scratch and post-014 restoration with legacy Pending rows and reviewer/appeal parity remain **synthetic only**. No in-place DOWN is authorized. A pre-upgrade snapshot cannot be restored over later student bookings without reconciled writes, owner-approved RPO/RTO and application/schema pairing.
