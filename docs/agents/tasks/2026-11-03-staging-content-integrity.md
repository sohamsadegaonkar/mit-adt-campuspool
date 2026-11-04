# Task: Detect equal-count data corruption in staging restore checks

- **Task ID / file:** 2026-11-03-staging-content-integrity
- **Status:** ready for independent human review — engineering COMMENT review submitted on PR #13; not merged; actual staging restore still blocked
- **Agent / owner:** ChatGPT engineering agent (code and isolated tests); authorized account operator (actual restoration)
- **Last updated:** 2026-11-03 UTC
- **Baseline:** main@3ee1f4a; idempotency PR #11 at a1a06b7; comparison PR #12 at e45e1db
- **Scope:** read-only staging restore comparison script/tests, release runbook, task/status/next-step documentation. No production, credential, migration, deploy, live database export, live SQL query or student row read.
- **Dependencies / related tasks:** draft PR #12; docs/agents/tasks/2026-11-03-staging-restore-compare.md; existing owner backup/restore gate

## Goal and acceptance criteria

The prior comparator verifies table definitions, permissions and row counts, but a restored table can contain different records with the **same count**. Extend its operator-only snapshot check so that a same-count content mutation fails without transmitting records to Node or printing row content or fingerprints. Keep the existing project allowlist, separate scratch-project requirement, read-only transactions and releaseReady:false safety guarantees.

## Current state (verified vs assumed)

- Draft PR #12 is open and unmerged, based on draft idempotency PR #11. Initial disposable PostgreSQL and security CI for PR #12 passed at code head a0962f2.
- Existing comparison only checks metadata and per-table counts, not per-row values.
- Supabase live staging backup, independent actual-data scratch restore, off-site ciphertext verification and Render rollback-artifact eligibility **remain unverified**; a logical fingerprint cannot establish their validity.

## Plan

1. Add order-independent, duplicate-preserving aggregate SHA-256 fingerprint for every campus application table using PostgreSQL `sha256(bytea)` and normalized `to_jsonb(row)::text`; run it within the same repeatable-read, READ ONLY snapshot as row counts.
2. Fail closed above a modest per-table row cap instead of issuing unbounded aggregation or exposing raw records; preserve sanitized CLI output and never serialize fingerprints into the report.
3. Add synthetic unit checks, overflow rollback checks, and a disposable PostGIS integration test with two datasets having equal row counts but different row contents.
4. Record limitations in runbook/status and keep staged release NO-GO until independent human-approved recovery proof and rollback eligibility.

## Progress log

- 2026-11-03 UTC — Independently reviewed current branch, draft PR #12 and its active safety documentation; identified equal-count corruption detection gap.
- 2026-11-03 UTC — Created branch security/staging-restore-content-digests-2026-11-03 from PR #12.
- 2026-11-03 UTC — Added bounded per-table SHA-256 row-content fingerprints, normalized timezone/date rendering and internal-only comparison; added a same-count/different-record disposable PostgreSQL regression test. GitHub CI subsequently passed: security smoke #41627772559 and disposable PostgreSQL/PostGIS #41627772557 on code+docs commit eb9200f8.

## Verification

- Verified 2026-11-03 UTC: GitHub Actions on eb9200f8: security smoke #41627772559 SUCCESS and disposable PostGIS #41627772557 SUCCESS. These are not actual staging recovery results.

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Syntax and unit | Security smoke GitHub Actions #41627772559 on eb9200f8 | PASS; mock and safety assertions only |
| Real SQL integration | Disposable PostgreSQL/PostGIS GitHub Actions #41627772557 on eb9200f8, including same-count data mutation | PASS; **never targets Supabase** |
| Release-proof actual staging restore | Authorized private staging and separate approved PG17/PostGIS scratch | NOT RUN / owner blocked |
| Secrets or student data read | None authorized | No live credential or database access performed |
| Production/deployment | No tools used | None |

## Risks and decisions

- PostgreSQL 16+ built-in `sha256(bytea)` is used, not a new `pgcrypto` dependency. A SHA-256 digest is **not** a backup signature or authenticated off-site provenance check.
- The logic hashes canonical JSONB row representations and sorts individual hashes to make comparisons order independent while detecting duplicates. The resulting summary stays in process memory and is not printed, committed, logged or exported.
- Fingerprint equivalence is scoped to the same source/restore logical schema and comparable PostgreSQL serialization settings. A database still accepting writes can give a false mismatch; agree on a staging write-free window.
- Maximum 25,000 rows/table: larger datasets deliberately fail closed pending a reviewed streaming or chunked verification design. Statement timeout remains 15s per query. No sampling is used to mask this limit.
- This is stronger content-integrity evidence than counts but **not** an authenticated archival backup, exhaustive Supabase-managed-object verification, role credential recovery test or production release authorization.
- No architecture changes to PostGIS, Redis, H3, messaging or payment domains.

## Next steps — exact handoff

1. **Next action:** Inspect GitHub Actions and fix any isolated PostgreSQL or security failures; review query performance/collation and confirm no digest leaks.
2. **Who may do it:** code reviewer for CI and security; separately authorized account operator for actual database export/restore.
3. **Prerequisites and blockers:** approved encrypted off-site stage export, independently downloaded ciphertext digest and complete independent compatible scratch restore, stage-only owner credentials, Render rollback artifact eligibility.
4. **Expected evidence:** green security/PostGIS CI with equal-count record mutation detected; no digest output; actual operator comparison after independent restore; separately confirmed Render rollback availability.
5. **Production impact:** none; staged migration 008 and deployment remain NO-GO.

## Links and files changed

- Branch: security/staging-restore-content-digests-2026-11-03 (child of draft PR #12, which is child of PR #11)
- Paths: scripts/staging-restore-compare.js, test_staging_restore_compare.js, docs/agents/tasks/2026-11-03-staging-content-integrity.md, docs/agents/{STATUS,NEXT_STEPS}.md, STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md
- Last known staging live SHA (historical): cceadbf6251f; NOT revalidated or redeployed for this task

## Independent review checkpoint — 2026-11-03 UTC

- Reviewed draft PR #13 against its parent PR #12; identified a fail-open case: equal snapshots missing the same required section could compare as matching. A missing migration history on both source and restore was likewise treated as equal, even though recovery evidence was incomplete.
- Hardened the comparison so all required sections must be present, counts and SHA-256 digests must be well-formed, and table/count/digest coverage must agree. Missing or empty migration ledger is a comparison **NO-GO** even when both sides are missing it. Raw digests and private contents still never enter the output.
- Added tests for missing digest fields on both sides, absent migration history, corrupted count/hash, table coverage and null snapshots. The PostgreSQL integration fixture now creates a synthetic migration ledger only on its disposable localhost CI instance; no staging database was contacted.
- Follow-up CI **PASSED** on review-fix code commit `6384a55295f5cf3711771bfa21a175592e0c429f`: security smoke workflow #41629693100 and disposable PostgreSQL/PostGIS workflow #41629693149, both SUCCESS. No actual staging recovery was attempted.
