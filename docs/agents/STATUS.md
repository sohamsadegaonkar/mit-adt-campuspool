# CampusPool — current engineering status

**Last independently checked:** 2026-11-03 (UTC). **GitHub baseline:** `main@3ee1f4a12e984cb6aecbf8ea09150d1e79556c87`. This snapshot records verified main and deployment baseline; pending branch work is explicitly described as unmerged.

**Overall:** secure backend foundations and PostGIS mobility matching are developed; production migration and student-facing launch are **NOT APPROVED**. A passing CI test is not evidence of a deployed feature.

## State matrix

| Area | Code and automated tests | Deployment / operational truth | Remaining gap |
|---|---|---|---|
| Node backend + existing single-page UI | On `main`, Node.js HTTP service, static HTML/CSS/JS | Production Render still runs an older build | No production release of latest source |
| Secret hygiene + hardening | Consolidated in `main`; current hygiene CI green | Historic public Git commits remain; revocation not verified | Account owner must confirm Gmail App Password revocation and rotated OTP secret |
| PostgreSQL OTP, sessions and identity | Implemented, tested against isolated Postgres in CI | Staging PostgreSQL configuration exists | Real controlled email/SMS OTP end-to-end delivery not verified |
| PostgreSQL Rides and bookings | Implemented and CI-tested behind `RIDES_BACKEND=postgres` | Production still on legacy SQLite behavior; no audited migration | Backup/restore, reconciled data import, rollout/rollback |
| Hyperlocal travel-intent matching | PostGIS, private intent/geometry, indexed radius/time search and API tests in `main` | Staging-only feature flag documented; no production activation | Student UI, real road-routing/detour checks, privacy/retention review |
| Authenticated domain request idempotency | **Unmerged branch** `security/transactional-idempotency-2026-11-03`: atomic SQL receipts for ride/booking/intent create and cancel in PG/SQLite; exact-head GitHub CI green, independent code review pending | Neither environment has this branch or PG migration 008 deployed | Verify CI and plan staging-only migration before promotion; OTP/provider/GPS/payment are separate semantics |
| Errands marketplace | Standalone responsive demo in `prototypes/campuspool-2/` | No live errands backend or real payment processing | Auth-integrated backend, transactions, fraud/refunds, tested marketplace model |
| Payments and settlements | Unverified client-reported success intentionally blocked | Real provider settlement not enabled | Authorized provider, verified webhooks, reconciliation and compliance approval |
| Redis, H3, Kafka, independent microservices | Not adopted; existing grid/time + PostGIS and PostgreSQL shared limits | No additional infrastructure provisioned for them | Benchmark-driven decision rather than speculative complexity |

## Verified GitHub baseline

- Baseline `main` contains merged multi-agent documentation contract `3ee1f4a12e98`. Draft idempotency [PR #11](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/11) remains **unmerged** at reviewed head `a2e231b96d30` (2026-11-03 UTC). Four workflow runs succeeded: 41582822457, 41582822448, 41582822449 and 41582822439. No staging/production deployment was verified from this review.
- Latest underlying application implementation on `main`: `0345b6aeff86` — mobility search rate-limit/cancellation behavior; later docs-only commit `3ee1f4a12e98`.
- Latest PostgreSQL OTP/PostGIS workflow on that commit: **success**; latest credential/secret-hygiene workflow: **success**.
- Root `README.md`, `MOBILITY_MATCHING_ROLLOUT.md`, `RIDES_POSTGRES_ROLLOUT.md` and `PRODUCTION_RELEASE_GATE.md` contain the detailed application notes. Some older runbooks reference closed PR chains and must not be treated as newer evidence.

## Verified Render deployment baseline

- Production: `mit-adt-campuspool`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `63ae5510bbe2` (from 2026-10-31). **Not** the current `main`.
- Staging: `mit-adt-campuspool-staging`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `cceadbf6251f` (from 2026-11-02). **Not** the current `main` SHA.
- This is service/deploy metadata verification; it does **not** by itself prove a particular user flow, provider delivery, migration or database state is healthy today.
- Dedicated staging Supabase PostgreSQL is documented. Do not reuse other application databases or test against production.

## In-progress engineering task

- [Transactional idempotency, 2026-11-03](tasks/2026-11-03-transactional-idempotency.md) — branch-local receipts, API keys and green isolated CI; static review identified possible transient `429` before receipt replay. Not deployed, merged or approved. [Contract](../../IDEMPOTENCY_CONTRACT.md).

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
