# RFC-CP-028 — CampusPool staging-first QA loop and controlled automatic OTP fixtures

**Date:** 2026-11-23 IST · **Status:** source changes in draft; no Render deployment, settings change, staging DB migration, real OTP delivery, payment or production action.  
**Branch:** `feature/staging-qa-otp-quality-gates-2026-11-23` (based on `main@202330a8166674d86a428e1f90ab8ed857d1313d`).  
**Task owner:** CampusPool engineering review. **Production verdict: NO-GO.**

## Goal and existing deployment facts

User requested a separately accessible CampusPool staging site, automated OTP testing, continuous bug-fix/test cycles, and deployment to production only when all gates pass.

**The URL already exists** at https://mit-adt-campuspool-staging.onrender.com, Render service `srv-dbjof8fb9u1s73eks0bg`, Singapore, Node runtime, Free plan. Current service is on `main`, auto-deploy **OFF**, last LIVE deployed commit `cceadbf6251f70634320e50b8288530ba77513c3` (2 November). It is **not** this code. Production is separate at https://mit-adt-campuspool.onrender.com, service `srv-dbh51h0473hc739ae7cg`, Docker, auto-deploy **OFF**. Neither was updated.

The real `campuspool-staging-db` Supabase project (Singapore, `tnitksrlntrdxbvznxzf`) was healthy on inspection, but recorded migrations currently stop at **007**. Migrations 008–014 and G1 independent encrypted backup recovery remain unapproved for live application. **Do not run full new journey/reviewer features against the staging DB until a separately authorized schema preflight and protected migration/restore plan exist.**

## Implemented (source only)

1. `stage1-otp/staging-qa-otp.js`: optional `STAGING_QA_OTP_MODE=fixture` transport, **OFF by default** and startup fail-closed for incomplete/unsafe configuration. It requires exact Render staging service ID, hostname and branch `staging`, `NODE_ENV=production`, `APP_ENV=staging`, PostgreSQL identity/rides, TLS, noncluster mode, strong independent QA read token and strong Basic Auth. Only one explicit `qa-...@students.mituniversity.edu.in` fixture email and one reserved fixture phone may be simulated; other targets delegate to real providers and fail closed if not configured. Generated six-digit codes remain ephemeral in one process for no longer than five minutes.
2. `server.js`: staging fixture code receipt available **only when mode is explicitly enabled**, via `POST /api/_staging/qa-otp` behind the existing staging Basic Auth gate, an **independent** secret token header, exact fixture allowlist, a tight rate limit and no-store response. OTPs are never returned to the public login/signup response or UI; no global OTP bypass is added. Standard PostgreSQL challenge issue/verify, expiry, lockout, resend cooldown, proof consumption and session controls remain the authority. `GET /healthz` includes a nonsecret environment marker and exact Render `RENDER_GIT_COMMIT` for deployment-revision checks.
3. `scripts/staging-live-acceptance.js`: read-only, hardcoded-host smoke checks health/environment/exact deployed SHA, public 401 Basic Auth gate, and unauthorized session rejection. Fail closed on a stale commit; no secrets printed and no database writes.
4. `scripts/staging-fixture-acceptance.js`: **only under explicit manual workflow approval**, creates or logs into one isolated QA fixture via normal email/SMS OTP issue/read/verify routes, establishes a real staging session and checks the identity. No external email or SMS is sent for the explicit fixtures, and no real student identity is imported. This workflow may mutate **QA-only staging fixture records**, never the production database.
5. `.github/workflows/staging-quality-cycle.yml`: repeat full disposable PostgreSQL OTP/identity, security, release and QA fixture tests on PR updates and pushes to reviewed `staging` branch. Failure prevents green source QA; **no deploy is triggered by this source workflow**.
6. `.github/workflows/staging-postdeploy-acceptance.yml`: manual-only, GitHub **staging environment** job requiring the exact deployed commit SHA, private Basic Auth secret and (for fixture writes) explicit `ALLOW_STAGING_QA_FIXTURE_ONLY` input plus token. It **cannot** run from a non-staging branch. It never deploys to production.
7. `render-staging.yaml`: future target branch `staging`, QA OTP fixture **OFF**, and private fixture config slots. It is a **source-only Blueprint**, not a Render API update. Keep auto-deploy OFF until branch protections, isolated data, CI, production recovery and staging rollback checks are approved.

## Required deployment sequence (not executed)

1. Reconcile the current mainline with the **draft** application feature stack (including schema 008–014) and pending backup/source PRs. Never merge unrelated drafts blindly. Establish a protected `staging` integration branch with review rules; test all code and migrations on **disposable** PostGIS before any live stage migration.
2. Protect GitHub environment `staging` with reviewers and branch restriction `staging`, and securely set repository/environment secrets `STAGING_BASIC_AUTH_PASSWORD`, `STAGING_QA_READ_TOKEN` plus QA fixture email/phone variables. Use owner-approved, **non-real**, reserved phone and QA email, not an actual student's contact. Never reuse production keys. The private fixture reader must not be exposed to browsers or public JS.
3. Review Render staging service configuration/secret file, PostgreSQL TLS CA, unique credentials and current data. Keep `APP_ENV=staging`, no production DB, Basic Auth and payment actions disabled. **Separate operational authorization required** to change the existing service's branch to `staging` and deploy; verify it reports the expected SHA. No live database schema mutation is authorized by this PR.
4. With the approved staging branch and protected test data, enable `STAGING_QA_OTP_MODE=fixture` on the **staging service only**. Unit and API tests may retrieve fixture OTP via private CI token, **not** user-facing bypass. Real provider delivery to consenting inbox/handset remains an independent mandatory test before any public launch.
5. Iterate on each feature/bug-fix PR: disposable tests → reviewed merge to staging → (later, after explicit approval) Render deploy **After CI Checks Pass** → separate post-deploy smoke/fixture test → actual browser/mobile QA → defect fix and repeat. Do not make the live post-deploy acceptance job a prerequisite for Render's pre-deploy CI checks (that would cause a deploy deadlock).
6. Only after all review/tests are green **and** G1 authentic backup recovery, migration parity and rollback, secrets rotation, real OTP provider delivery, privacy/security and product acceptance are signed off may an owner explicitly approve production promotion of the **same reviewed source revision**. Keep Render production auto-deploy OFF; no workflow here writes to it. Monitor rollback after a separately authorized production deploy.

## Verification evidence and unresolved risk

- Source CI tests must run after this PR is opened; **not yet claimed green in this task file**.
- No browser/mobile E2E, synthetic QA fixture live dispatch, Render staging revision alignment or real staged 008–014 migration has been tested.
- A reserved fixture phone may be reachable by a real person if chosen carelessly; owner must supply a controlled non-real staging fixture. The QA transport should never be activated without verifying account isolation and protected secrets.
- GitHub Actions secrets on public repositories must not be exposed to untrusted PRs; post-deploy workflow is manual, branch-restricted and needs an environment review rule. Never use an unrestricted workflow-run with production credentials.
- No infinite retry loop is acceptable: every new commit triggers a deterministic quality check, failure creates actionable evidence and blocks promotion. Tests must not auto-approve their own failures.
- No prod payments, penalties or bans; no student records or secrets are copied into staging; staging/provider/DB mutations need separate operational review. **Production NO-GO until G1 independent restore and explicit owner GO.**

## Exact next actions

- Review this PR and exact-head CI first; repair failures.
- Approve a protected staging branch strategy and access/secrets after validating the live Render settings. Do not change the existing service branch or auto-deploy yet.
- Run the manual staging post-deploy workflow with a reviewed SHA (read-only first; fixture separately), preserve sanitized results and begin browser/mobile regressions.
- Coordinate with [PR #70 schema recovery](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/70), [PR #74 backup source](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/74) and [PR #75 image provenance](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/75).

**Status labels:** implementation pending CI, staging deployment NOT performed, production deployment NOT authorized.
