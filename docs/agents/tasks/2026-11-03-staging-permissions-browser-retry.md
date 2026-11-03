# Task: staging PostgreSQL role review, browser retry continuity and controlled rollout

- **Task ID / file:** `2026-11-03-staging-permissions-browser-retry`
- **Status:** blocked on staging backup/restore and Render target confirmation; development fixes tested
- **Agent / owner:** ChatGPT engineering review agent
- **Last updated:** 2026-11-03 UTC
- **Baseline:** `main@3ee1f4a12e98`, draft PR #11 `security/transactional-idempotency-2026-11-03`, tested implementation `282df2c`
- **Scope:** staging read-only role review, browser retry-key reliability, tests/CI, staged backup/rollback planning; NO production, NO live SQL migration or deployment.
- **Dependencies / related tasks:** [idempotency task](2026-11-03-transactional-idempotency.md), [staging runbook](../../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md)

## Goal and acceptance criteria

Verify table grants and RLS under impersonated PostgreSQL roles, preserve retry key across same-tab browser reload without persisting student PII, and stage only after proven backup+restore and a repeatable rollback to a known deployment SHA.

## Current state (verified vs assumed)

- Supabase project `tnitksrlntrdxbvznxzf`, PostgreSQL 17.11, active/healthy; migrations 001–007, not 008.
- Backend role `campuspool_staging_app`: LOGIN, not SUPERUSER or BYPASSRLS; USAGE but no CREATE on public/extensions schemas. Nine app tables have RLS; anon/authenticated denied direct SELECT; backend CRUD authorized. Advisor had no security lints.
- Exact counts: 0 users, sessions, OTP challenges, rides, bookings, trip intents and ride geo. Does **not** prove full backup/restore.
- Render connector cannot proceed without confirmed workspace selection. Exact stage service branch, deployed SHA and rollback artifact were not reverified.
- Supabase Free has no automatic daily backup. No off-site dump or scratch restore evidence exists.

## Plan

1. Inspect migration 005–008 and review current Supabase roles/policies read-only.
2. Implement tab-scoped retry-token persistence (only hashed slot/key/expiry), clear on logout and 401, minimize post-success grace.
3. Test browser reload, HTTP failure, 429 retry, 4xx discard, actor isolation, explicit keys, expiry and role isolation in disposable CI.
4. Gate additive migration 008 on secure off-site export, independent restore and confirmed Render rollback artifact.
5. After authorized staging rollout, perform synthetic-account browser/phone E2E and restoration rehearsal.

## Progress log

- 2026-11-03 UTC — Queried staging Supabase roles, RLS, policies, grant matrices, migration list and exact aggregate counts **read-only**; discovered Free backup absence and missing 008.
- 2026-11-03 UTC — Updated `index.html` to use SHA-256 actor+route+body operation slots and random tokens in sessionStorage before dispatch; new 1.2-second success grace, 24-hour pending expiry, no raw student payload or identity in storage. Explicit caller keys remain caller-owned.
- 2026-11-03 UTC — Added `test_browser_idempotency.js` and updated CI. Enhanced PostgreSQL test to `SET LOCAL ROLE` under simulated Supabase client roles; corrected CI fixtures and actor-scoped receipt assertions.
- 2026-11-03 UTC — At `282df2c`, CI passed PostGIS #41590954300, security smoke #41590954587, secret hygiene #41590954364 and agent-doc contract #41590954266. **No live DB or Render mutation done.**

## Verification

| Test/check | Evidence | Result |
|---|---|---|
| Existing Supabase RLS/grants | Read-only SQL against staging project | PASS for current nine app tables |
| Live migration 008 | to_regclass and migrations list | NOT INSTALLED |
| Browser key reload and actor separation | `npm run test:browser-idempotency` / GitHub Actions | PASS in isolated CI |
| Anon/auth SQL table denial | `npm run test:idempotency-pg` / disposable PG | PASS in isolated CI |
| Full CI | Runs 41590954300, 41590954587, 41590954364, 41590954266 | PASS at `282df2c` |
| Off-site database dump + scratch restore | Private operator action | **BLOCKED / NOT VERIFIED** |
| Confirmed Render SHA and rollback rehearsal | Workspace/service selection + exact deploy | **BLOCKED / NOT VERIFIED** |
| Live staging migration/deploy/E2E | Controlled follow-up | NOT RUN |

## Risks and decisions

- Staging backend role is powerful within private tables; keep credentials server-side. No access to browser or Supabase anon/authenticated.
- Browser recovery is same-tab only, with capped 64 pending slots/24h TTL; older ambiguous operations must be reconciled by resource reads before generating a new key.
- A Supabase Free project needs a real off-site backup. SQL schema in Git or an empty staging table does not provide a verified restore.
- On rollback, redeploy known-good previous application build and leave additive migration 008 table in place. Don't destroy receipt history during app rollback.

## Next steps — exact handoff

1. **Next action:** Operator confirms Render workspace/service and export path; securely dumps staging DB, records checksum and restores it independently to disposable PostGIS, verifies schema/roles/counts, and records exact current staging deploy SHA + method to redeploy it.
2. **Who may do it:** authorized staging account owner; next agent revalidates and runs stage-only migration after gates clear.
3. **Prerequisites and blockers:** private DB-owner credentials in operator password manager, encrypted off-site destination, isolated restoration target, confirmed Render workspace and release artifact, no production touch.
4. **Expected evidence:** verified dump hash, scratch restore checks, signed-off service rollback reference; staging-only applied 008 and isolated real-browser QA if subsequently approved.
5. **Production impact:** none; NO-GO remains.

## Links and files changed

- PR: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/11
- `index.html`, `test_browser_idempotency.js`, `test_pg_idempotency.js`, `package.json`, two CI workflows, `IDEMPOTENCY_CONTRACT.md`, this task and `STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md`.
- Last staging deploy SHA remains unverified in this checkpoint.
