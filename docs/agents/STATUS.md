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

## Flutter UI Phase 1 — branch-only, 2026-11-04 UTC

- **UNMERGED / NOT DEPLOYED:** `feat/flutter-campuspool-figma-ui-2026-11-04` adds an isolated `flutter_app/` scaffold matching the Figma guest landing, desktop style, local ride/errand previews, voluntary tip totals and a collapsed price-details accordion. Existing Node/static web, APIs, databases, feature flags and Render services remain unchanged.
- Contains Dart quote/widget tests and `.github/workflows/flutter-ui.yml`. **CI VERIFIED (source commit `8ff4519`)**: Flutter 3.47.7 `flutter analyze --no-fatal-infos` and **6/6 unit/widget tests PASS** in [run #41790737256](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41790737256). Flutter/Dart SDK unavailable in authoring environment; native/device builds and visual UX QA remain **not verified**.
- **Safety:** no live sign-in, rides, errands, money movement or student data are enabled in the Flutter demo. Production NO-GO remains unchanged. [Handoff](tasks/2026-11-04-flutter-figma-ui.md).

## Flutter Phase 2 state/API boundary — stacked branch only, 2026-11-04 UTC

- **UNMERGED / NOT DEPLOYED:** `feat/flutter-phase2-platform-states-2026-11-04` is stacked on draft Phase 1 PR #17 (head `df65ad1`); it does not exist on `main`. Adds an authenticated-session-gated, read-only ride-feed adapter; restricts UI data to safe summary fields and adds Figma-aligned loading/empty/error/retry states and tests.
- Flutter CI extends to generated Android/iOS/web platform hosts, a Flutter web build and an **unsigned debug APK**, without production signing or release. Do not treat these as native distribution or deployment. **Verified:** Flutter analysis and 19/19 tests pass at `244e06c` in [CI #41793703183](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793703183); web release + Android unsigned debug APK build pass at `2ad2d51` in [CI #41793334499](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793334499). CI-generated iOS/Android/web hosts exist only as ephemeral build output. No physical-device QA, iOS binary, or production release.
- Existing Node authorization/CSRF and production NO-GO are unchanged. [Task handoff](tasks/2026-11-04-flutter-phase2-platform-states.md).
