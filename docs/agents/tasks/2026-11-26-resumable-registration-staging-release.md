# Issue #80 — staging registration release preparation

- **Task ID:** 2026-11-26-resumable-registration-staging-release
- **Date:** 2026-11-26
- **State:** PREPARED IN SOURCE / LIVE NO-GO; draft PR #81
- **Target:** only https://mit-adt-campuspool-staging.onrender.com, Render srv-dbjof8fb9u1s73eks0bg, Supabase tnitksrlntrdxbvznxzf.
- **Protected source:** main cc1602cd4673760dab7dd46a07e3089b752cdd5d; previously green registration head 4fb199cebac9053fed779d6f5b904e7d551d9fd3.
- **Out of scope:** production, real provider changes, live migration execution, credentials, new scheduled jobs, billing.

## Goal and acceptance criteria

Enable resumable registration on isolated staging after an approved retention policy, exact ordered schema reconciliation, new encrypted preimage and verified recovery, exact-artifact rollback readiness and healthy flag-off deployment. Keep both contact verification mandatory. No production enablement.

## Current state

Main contains 001–008 only. PR #70, still open, contains 009 free ride pilot, 010 driver-reported journey, 011 boarding PIN, 012 pickup cases, 013 private responses and 014 reviewer/appeals. Its pinned source 026c46a57adf8efffeb6ee3d94268f86cd5101cc is a rehearsal reference, NOT an approval or merge. PR #81 is ahead of main with no divergence at observation. Preserve version 015; do not relabel it 009 or skip 009–014. The ordinary migrate.js remains unchanged; it is not an approved live migration/ledger tool. The owner must decide whether to land the ordered chain first or explicitly approve a separately designed independent-version migration strategy. This runbook uses ordered chain only.

Prior evidence: all nine CI workflows passed on 4fb199c; 11 PostgreSQL and 2 real HTTPS Chromium registration tests passed. Prior protected staging recovery run 45608112105 artifact 15018832232 is not expired (expires 2026-12-09 11:52:39 UTC), but covers pre-008 state, not the present data. Prior rollback dep-dc3f99rm8hqs73901dhg rehearsed same SHA, not cross-version rollback. No live metadata read in this task; last recorded staging ledger 001–008 and last recorded healthy artifact cc1602cd are historical and must be reverified.

## Plan

### Gate A — policy and source
- [ ] Owner approves proposed 7 days (604800 seconds) hard expiry for incomplete registration; no sliding TTL. Explicit retention remains required, not default. Completed drafts cannot be resumed; current cleanup removes expired drafts in bounded batches. Recommend an hourly bounded cleanup with monitoring, only after separately approved scheduling; expiry rejects access immediately, actual physical deletion follows successful cleanup. Decide whether consumed drafts need earlier deletion and backup retention separately. No background job currently enabled. Do not deploy without an approved tested deletion mechanism.
- [ ] Reconcile 009–014 into reviewed main, preserve version order, resolve overlapping changes and re-run exact integrated-head CI. Evaluate each pending domain feature under its own release approval; do not enable features merely to satisfy migration numbering.
- [ ] New synthetic rehearsal validates ordered candidate 001–015 chain, preimage restore, old runtime compatibility, restricted role and exact sequential synthetic ledger. Pinned references must be replaced/reverified against actual approved integrated release. Broader browser/mobile coverage and recovery edge cases remain release review items.

### Gate B — fresh recovery
- [ ] Confirm exact Render workspace/service, staging-only database identity, TLS root, privileged read/export approvals, protected environment settings, and existing release SHA/artifact. No access to production configuration.
- [ ] After 009–014 approval and application, read exact 001–014 ledger and catalog using scripts/staging-registration-release-preflight.js before (explicit read-only authorization, approved credentials through environment only, pinned CA). It checks schema, RLS, app grants, ledger and OTP purpose. Never infer a live schema from file names.
- [ ] Arrange owner-approved maintenance window; stop writes, preserve original per-table and sequence grants including SELECT-only reviewer grants and append-only case tables, disable app login, drain app connections, confirm external/privileged writers paused. Run preflight frozen. This proves only app-role freeze; require separate attestation for other writers.
- [ ] Build/review a NEW protected manual encrypted preimage and independent restore workflow for exact live 014, with actual nonempty row digests/counts and complete scoped ledger, grants, policies, constraints, indexes, extensions and sequences. Existing staging-008 workflow intentionally rejects later or nonempty schema. Do not reuse it or relax its guard. Separate backup and restore environments/credentials; pinned CA; AGE public/private pair checked; encryption streamed, no plaintext artifact; independently download, decrypt, restore in isolated PG17/PostGIS and compare. Archive scope public + supabase_migrations plus required extension dependency metadata; managed schemas/globals excluded unless separately covered. No Azure offsite proof claim. Record fresh archive/hash/recovery/CI identities and timestamp during same freeze.
- [ ] Confirm retained exact healthy Render release artifact, autoDeploy off on both environments, rollback eligibility and approved maintenance window. Do not proceed on stale/failed evidence.

### Gate C — schema and release
- [ ] Obtain explicit staging-only migration authorization for reviewed exact SQL checksum/head and verified fresh recovery. Apply 015 once with reviewed migration tool/transaction that atomically records the exact version in the real migration ledger. Candidate SQL currently has BEGIN/COMMIT; do not nest it blindly or separately stamp ledger without review. This operator procedure is NOT implemented/authorized yet. Freeze stays in place until schema/ledger/grant verification; after 015 introduces new table, revoke its app write grants if keeping freeze active.
- [ ] Verify schema/ledger and expected restricted grants; restore recorded login/DML/sequence permissions, only then enable application connectivity and run after preflight. Confirm no API role exposure; no user-data output.
- [ ] Deploy reviewed exact SHA to staging only with REGISTRATION_RESUME_ENABLED=false. Confirm /healthz, homepage, existing sign-in, PostgreSQL-backed session and legacy registration (controlled test). Keep autoDeploy off. Verify feature config returns enabled:false.
- [ ] After explicit approval and policy/cleanup checks, configure only staging: REGISTRATION_RESUME_ENABLED=true, REGISTRATION_ORIGIN=https://mit-adt-campuspool-staging.onrender.com, REGISTRATION_RETENTION_SECONDS=approved value. No new credentials; do not expose secrets. Exact SHA redeploy then verify feature config enabled:true, secure cookie attributes, guest/partial session denied, verified email preserved when SMS fails, reopening/cross-device recovery using approved real test contact only. Do not send real SMS or email without separate authorized test recipients. Never simulate success on live routes.
- [ ] If feature fails, turn flag off and redeploy approved artifact; if code fails, rollback to retained healthy SHA. Keep expanded additive schema; do not DROP table or narrow OTP constraint. Pending users cannot resume while flag is off, but their unexpired verification state remains stored. Recheck legacy login and existing sessions. If database integrity is suspect, freeze, use isolated recovery and owner-approved repair; never overwrite live database automatically.

## Progress log

- 26 Nov 2026: source branch unchanged by main; migration inventory reconciled, older preimage confirmed still retained but stale for this release. Added isolated PG17 ordered 001–015 test, real pg_dump/pg_restore scratch preimage and legacy runtime compatibility, read-only staging guard with frozen/before/after checks. No live connection, migration, merge, deployment, scheduling or secret access.

## Verification

[Prior green CI](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45829342370) is on earlier source. New synthetic release workflow and preflight SQL require exact-head CI; no local run or live recovery claim. Rehearsal uses same disposable cluster with distinct restore DB and in-memory AES-GCM tamper test; not independent live AGE restore or Azure DR. The guard is read-only, does not establish global freeze or release readiness. Live backup workflow and atomic migration/ledger operator path require additional implementation/review; no live approval implied by this document.

## Next steps

Approve retention; reconcile parent PRs and migrate 009–014 only with their respective gates; finish new protected 014 recovery workflow and atomic 015 migration runner; verify actual staging and exact rollback target; execute only after owner GO.
