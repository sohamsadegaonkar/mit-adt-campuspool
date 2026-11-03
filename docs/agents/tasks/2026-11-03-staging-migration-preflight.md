# Task: Read-only staging migration 008 preflight and fail-closed checks

- **Task ID / file:** `2026-11-03-staging-migration-preflight`
- **Status:** in review — implementation committed, isolated CI verification pending
- **Agent / owner:** ChatGPT engineering agent
- **Last updated:** 2026-11-03 UTC
- **Baseline:** `main@3ee1f4a12e98`; draft [PR #11](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/11) `security/transactional-idempotency-2026-11-03`, parent `d128437`
- **Scope:** read-only inspection of stage-only PG permissions and before/after migration 008 state, CI tests, runbook and agent docs. No schema changes, no Render action, no production, no database backup performed.
- **Dependencies / related tasks:** [staging rollout blockers](2026-11-03-staging-permissions-browser-retry.md); `stage1-otp/migrations/008_transactional_idempotency.sql`, `STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md`.

## Goal and acceptance criteria

Provide an executable, safe PostgreSQL staging preflight to verify the exact dedicated project URL before connecting; inspect roles, grants, RLS, API-client denial and 008 table/index/policy in a **READ ONLY** transaction. Test denial and positive cases in isolated CI. Never mistake readiness of schema for approval to migrate.

## Current state (verified vs assumed)

Prior review verified staging project `tnitksrlntrdxbvznxzf`: PostgreSQL 17.11, migrations 001–007, no 008, backend role restricted, core tables RLS-protected and empty. Staging off-site backup and cold restore remain unverified; Render workspace/rollback SHA not confirmed. `stage1-otp/migrate.js` runs all 001–008 files unconditionally and has **no local migration-version ledger**, so avoid using it against staging as an ad hoc migration command. Supabase MCP has a separate migration history for its own migrations.

## Plan

1. Audit current runner and 008 SQL plus staging release gates.
2. Add exact-project URL allowlist and read-only before/after inspection.
3. Add unit tests of wrong target, privileged role, missing policies, before/after states and an isolated PostGIS integration test.
4. Wire GitHub security and PostGIS workflows; record results.
5. Leave production/staging unchanged until backup+restore and operator release approvals are documented.

## Progress log

- 2026-11-03 UTC — Read current PR #11 and migration runner. The runner executes every SQL file unconditionally; this tool is deliberately separate and **does not** adopt any new DB migration ledger on live staging.
- 2026-11-03 UTC — Prepared `scripts/staging-migration-preflight.js` and `test_staging_migration_preflight.js`: exact staging ref verification, READ ONLY transaction, pre/post-008 table/role/RLS/grant tests, safe no-URL diagnostic JSON, no migration writes.
- 2026-11-03 UTC — Updated npm scripts, CI coverage, staging runbook and agent handoff. **Exact-head CI evidence to be appended after runs finish.**

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Safe connection target + failure cases | `npm run test:staging-preflight` in CI | Pending |
| Disposable PostGIS actual role and RLS posture | `npm run test:staging-preflight` with local `OTP_DATABASE_URL`, following `test:idempotency-pg` | Pending |
| Staging live before-008 check | `npm run check:staging-migration -- --mode=before` with private env, on authorized operator machine | Not run; no credentials supplied here |
| Off-site backup and scratch restore | staging release runbook | BLOCKED / NOT VERIFIED |
| Render staging rollback target | workspace selection | BLOCKED / NOT VERIFIED |
| Production | excluded | NOT TOUCHED |

## Risks and decisions

- The command refuses unexpected DB URLs and requires `APP_ENV=staging`, TLS and only `--mode=before|after`. Its output is sanitized schema/permissions status; DB connection strings never logged.
- A clean before-mode schema is **not** backup proof and never authorizes deployment; `releaseReady` is always false.
- Existing `migrate.js` remains CI/local test tool. Aligning Supabase migration history and an application migration ledger is a **separate later architectural task**; no unreviewed shadow ledger is introduced today.
- The dedicated backend role can read private rows: keep connection info in operator private environment, not chat or CI logs.

## Next steps — exact handoff

1. **Next action:** confirm new-head CI green; inspect any failing tests, correct and document failures; then schedule safe staging backup + independent restore and select the exact Render workspace with owner.
2. **Who may do it:** engineering reviewer for code/CI; authorized owner for backup and Render selection.
3. **Prerequisites and blockers:** cryptographically protected off-site dump, scratch restore report, confirmed Render service/deploy SHA and scoped stage approval before applying 008.
4. **Expected evidence:** GitHub Actions exact SHA PASS, before-mode sanitized preflight output, dump hash + restore confirmation, verified rollback deployment ref; then after-mode output only after authorized migration.
5. **Production impact:** none; no staging DB writes, backups or deploys by this task.

## Links and files changed

- Draft PR #11: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/11
- `scripts/staging-migration-preflight.js`, `test_staging_migration_preflight.js`, `package.json`, `.github/workflows/stage1-otp.yml`, `.github/workflows/security-smoke.yml`, `STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md` and handoff docs.
