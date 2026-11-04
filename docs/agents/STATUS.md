# CampusPool — current engineering status

**Last independently checked:** 2026-11-03 (UTC). **GitHub baseline:** `main@0345b6aeff8631cbb2a55d09b9bb745ae4dbb93b`. This snapshot reflects the repository and reported deployment state before the agent-documentation PR; refresh SHA and dates when merging subsequent implementation work.

**Overall:** secure backend foundations and PostGIS mobility matching are developed; production migration and student-facing launch are **NOT APPROVED**. A passing CI test is not evidence of a deployed feature.

## State matrix

| Area | Code and automated tests | Deployment / operational truth | Remaining gap |
|---|---|---|---|
| Node backend + existing single-page UI | On `main`, Node.js HTTP service, static HTML/CSS/JS | Production Render still runs an older build | No production release of latest source |
| Secret hygiene + hardening | Consolidated in `main`; current hygiene CI green | Historic public Git commits remain; revocation not verified | Account owner must confirm Gmail App Password revocation and rotated OTP secret |
| PostgreSQL OTP, sessions and identity | Implemented, tested against isolated Postgres in CI | Staging PostgreSQL configuration exists | Real controlled email/SMS OTP end-to-end delivery not verified |
| PostgreSQL Rides and bookings | Implemented and CI-tested behind `RIDES_BACKEND=postgres` | Production still on legacy SQLite behavior; no audited migration | Backup/restore, reconciled data import, rollout/rollback |
| Hyperlocal travel-intent matching | PostGIS, private intent/geometry, indexed radius/time search and API tests in `main` | Staging-only feature flag documented; no production activation | Student UI, real road-routing/detour checks, privacy/retention review |
| Errands marketplace | Standalone responsive demo in `prototypes/campuspool-2/` | No live errands backend or real payment processing | Auth-integrated backend, transactions, fraud/refunds, tested marketplace model |
| Payments and settlements | Unverified client-reported success intentionally blocked | Real provider settlement not enabled | Authorized provider, verified webhooks, reconciliation and compliance approval |
| Redis, H3, Kafka, independent microservices | Not adopted; existing grid/time + PostGIS and PostgreSQL shared limits | No additional infrastructure provisioned for them | Benchmark-driven decision rather than speculative complexity |

## Verified GitHub baseline

- Single long-lived branch: `main`; no open PRs when checked 2026-11-03.
- Latest implementation commit: `0345b6aeff86` — PostgreSQL mobility search rate-limit/cancellation behavior.
- Latest PostgreSQL OTP/PostGIS workflow on that commit: **success**; latest credential/secret-hygiene workflow: **success**.
- Root `README.md`, `MOBILITY_MATCHING_ROLLOUT.md`, `RIDES_POSTGRES_ROLLOUT.md` and `PRODUCTION_RELEASE_GATE.md` contain the detailed application notes. Some older runbooks reference closed PR chains and must not be treated as newer evidence.

## Verified Render deployment baseline

- Production: `mit-adt-campuspool`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `63ae5510bbe2` (from 2026-10-31). **Not** the current `main`.
- Staging: `mit-adt-campuspool-staging`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `cceadbf6251f` (from 2026-11-02). **Not** the current `main` SHA.
- This is service/deploy metadata verification; it does **not** by itself prove a particular user flow, provider delivery, migration or database state is healthy today.
- Dedicated staging Supabase PostgreSQL is documented. Do not reuse other application databases or test against production.

## Security and release blockers (must not be silently waived)

1. Confirm historical Gmail App Password was revoked and all exposed signing secrets rotated. Do not assume removing files from latest Git history did this.
2. Verify real Resend/MSG91 delivery with controlled student accounts and no OTP bypasses.
3. Backup, cold-restore test and reconcile legacy SQLite Rides/bookings into a durable production database before switching.
4. Run browser/mobile E2E QA of auth, matched rides, seat contention, cancellation, ownership, CSRF and failure paths.
5. Review location retention, student safety, abuse controls and legal/payment provider requirements.
6. Obtain explicit production release approval, verify deploy SHA, monitor and retain rollback capability.

**Incident/release decision remains: NO-GO until the above are evidenced.**

## How to update this file

For every implementation PR: replace outdated evidence, record new commit SHA and CI, distinguish code vs staging vs production, add/remove blockers based on actual verification and link the relevant `tasks/` record. Do not copy optimistic claims from feature PRs into production columns.

## Independent P1 synthetic PostGIS load development — 2026-11-04 UTC

- **BRANCH ONLY / NOT DEPLOYED:** `perf/mobility-load-baseline-2026-11-04` (from `main@3ee1f4a`) implements a new, isolated benchmark for 128 concurrent student matching requests against 512 deterministic synthetic rides and the existing PostGIS matching store. This is independent of draft UI PR #14 and security PRs #11–13.
- Guardrails: requires `BENCH_DISPOSABLE_DB=YES`, localhost PostgreSQL URL, exact dedicated `campuspool_mobility_bench` DB and backend role, empty benchmark tables (server-side Docker bridge address is not an authorization signal), intact spatial indexes; deletes only uniquely owned synthetic fixtures. No real student data, external network, Render/Supabase writes, production migration, or service changes.
- **Measured synthetic CI PASS** at code SHA `da7063a`, GitHub run #41710272878: 128/128 matching searches over 512 rides (p50 **229.11ms**, p95 **297.87ms**, p99 **300.88ms**, burst rate **423.83/s**), pool max24 and peak waiting queue104; 0 sampled lock waiters; EXPLAIN used the PostGIS dropoff GiST index. Same-account rate bucket contention allowed **30** and denied **5**. Four other workflows (PostGIS/backend, security, credentials, agent docs) passed on the same code SHA. This is single-burst **database-layer** evidence, not a production capacity promise.
- **Release status:** NO-GO unchanged. [Task](tasks/2026-11-04-mobility-load-benchmark.md).

## Live merge and Render release audit — verified 2026-11-03 UTC

- **Main updated safely:** User explicitly asked to merge healthy working branches before Render rollout. PR #15 (disposable PostgreSQL/PostGIS load benchmark only; no runtime server or SQL change) was squash-merged into `main@a76eaca895dc0a4df97d9a2d11e26f97441b9fec`. Main push checks PASS: Stage 1 PostGIS #41712374613, secret hygiene #41712374669, agent docs #41712374540. The benchmark's own five PR checks passed before merge.
- **Unmerged dependency/review blockers:** PR #11 (transactional idempotency + migration 008), child draft PR #12 (restore comparator), grandchild PR #13 (content digests), and draft PR #14 (student-facing UI) remain open. Their CI is green, and #14's 30/30 browser QA passed, but **no independent approving reviews are recorded**. Parent PRs must be integrated in order if ever approved; do not infer a child PR's base is `main`.
- **Current deployment metadata, NOT new release:** Render production `mit-adt-campuspool` live SHA `63ae5510bbe2` and isolated staging `mit-adt-campuspool-staging` live SHA `cceadbf6251f`; both follow `main`, auto-deploy OFF. A successful previous Render deploy record is NOT proof that its retained rollback artifact is still eligible.
- **Staging database:** connected Supabase PG17.11 reports `ACTIVE_HEALTHY`, migrations 001–007 listed, 008 absent, security-advisor currently zero lints. This does NOT establish actual encrypted off-site backup, independent restore, account secret revocation, usable Render rollback or real OTP delivery.
- **Release gate: NO-GO** for staging or production. No Render deploy, live SQL, student-data reads/copies, secrets, provider settings or payments were changed during this audit. Owner must produce actual staging encrypted backup/independent PG17 restore proof, prior-artifact rollback eligibility and security/provider evidence before a controlled stage deployment. [Exact audit](tasks/2026-11-04-release-merge-audit.md).

## Proposed read-only Render runtime configuration preflight — 2026-11-04

- **Tested in CI on a draft feature branch, not deployed:** `chore/runtime-env-preflight-2026-11-04` based on `main@056cd26` adds a read-only CLI `scripts/check-runtime-config.js` with two explicit profiles: `--target production` validates startup of the **current legacy SQLite** process and `--target staging` checks the PostgreSQL/TLS/private-CA/Resend/staging Basic Auth config. Uses no network calls, no live Render credentials or env mutation. It checks the known-exposed OTP fingerprint and fails short/missing secrets without printing values; status is `CONFIG_CHECKS_PASSED_RELEASE_NOT_APPROVED`, never release GO.
- **Incident addressed by test, not by rollout:** the last attempted production deploy `056cd26` failed at `OTP_SECRET` startup guard; previous `63ae551` still marked live as of last Render check. User reported adding `OTP_SECRET` via **Save only** and updating SMTP settings; content strength, revocation and actual running state **cannot be verified** from masked screenshots.
- **Verified on implementation SHA `33df5499`:** runtime config CI #41792580706 **10/10 PASS**; security #41792580514, secret hygiene #41792580531, PostgreSQL #41792580639, synthetic benchmark #41792580561, and agent docs #41792580707 all PASS. No live Render or provider secrets checked. Existing production launch check `check:release-production` remains completely separate and blocks while real provider delivery, durable PostgreSQL Rides, owner approval, independently restored backup and usable rollback are unverified. [Task](tasks/2026-11-04-runtime-env-preflight.md).

## User-authorized four-step release checkpoint — 2026-11-04 UTC

- **Source merge completed:** read-only Render runtime-preflight PR #18 merged into main as `3561bb54f38a3f5edce4cd17e24267733a196821`. Main's Postgres #41794863177, credential hygiene #41794863065 and agent docs #41794863241 all PASS; the original PR #18 ran six green workflows (10/10 synthetic preflight tests). No application runtime behavior, live secret or Render service was changed.
- **Read-only staging Supabase check completed:** project `tnitksrlntrdxbvznxzf` is healthy on PG17.11; 9/9 application tables enforce RLS, 0 direct SELECT grants to anon/authenticated, backend app role can read 9/9; migration 008 **not applied**; security advisor reported zero current lints. These are metadata checks, not actual recovery evidence.
- **Technical reviews completed, NOT approved for merge/release:** PR #11 (transactional idempotency + migration 008), stacked #12 (restore comparison), #13 (row digests), and #14 (mobility UI) each received a substantive COMMENT review. Their historical CI was green, including #14's 30/30 synthetic browser tests; no independently approved production/staging migration or real device/provider acceptance was evidenced. All four remain unmerged.
- **Staging NO-GO:** no available connector workflow can create, privately download and independently cold-restore the actual encrypted off-site staging backup. No separate restored project or authoritative checksum verdict supplied. Render staging previous deploy `cceadbf` is marked live, but its retained rollback artifact availability cannot be established through the connector. Staging and production were **not deployed or modified**. Production previously failed on `OTP_SECRET`; owner reported Save only, not a new successful rollout.
- **Exact operator handoff:** [Four-step release recovery checkpoint](tasks/2026-11-04-release-recovery-checkpoint.md). User authorization to proceed does not waive confidential data handling, paid resource approval or required recoverability evidence.

## 2026-11-05 — Render production audit: OTP startup guard blocks upgrade

- Read-only Render inspection: production `mit-adt-campuspool` auto-deploy disabled; last live image `63ae551`. Last attempted deploy `056cd26` is `update_failed` (2026-11-03); logs explicitly show `server.js:72`: `OTP_SECRET must be configured as a strong private environment variable`. `server.js` intentionally rejects missing/shorter-than-32 or historically compromised OTP secrets in production.
- Separate staging service is still live on `cceadbf`, auto-deploy disabled. Current main `b83107d` not yet proved deployed or smoke-tested.
- No secret values viewed/changed; no deploy/restart or migration. Owner must configure a fresh strong secret in protected Render environment after review and only then consider release **after** backup/restore/rollback gates. Production fallback SQLite/JSON persistence needs audit.
- [Detailed Render production readiness task](tasks/2026-11-05-render-production-readiness.md). **RELEASE NO-GO.**
