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

## New branch-only P1 mobility matching UI — 2026-11-03 UTC

- **Implemented but UNMERGED / NOT DEPLOYED:** `feature/mobility-intent-ui-2026-11-03` adds a responsive, labelled travel-intent form inside the existing Available Rides tab. UI stays hidden unless the user has a verified server session and `GET /api/mobility/intent` responds 200; it hides on logout/session expiry or disabled backend. Users can select points with explicit map interaction or enter coordinates manually and control a future departure window.
- The browser submits only the intended private pickup/dropoff and timing JSON over the same-origin API with CSRF and idempotency header; no raw coordinates are stored in local/session storage or URL query parameters. Matching returns only privacy-safe candidate metadata and rounded endpoint distances. Candidates are **not** reserved seats or verified road routes; booking handoff goes through the existing application checks.
- The feature adds `mobility-ui.js` to an explicit static asset allowlist with revalidation caching; pure validation/privacy tests and security CI PASSED on PR #14 code/docs commit e31d644a: security smoke #41636232397, PostgreSQL/PostGIS #41636232259, credential hygiene #41636232152 and agent-doc contract #41636232165. **No new infrastructure, SQL migration, live staging or production deployment, real student data, or payment action** has occurred. Existing mobility backend stays feature-flagged and disabled by default.
- **Verification pending:** first PR CI and real responsive/browser QA with synthetic users on separately approved staging. Separate staging recovery/migration 008 and historical credentials remain NO-GO. [Task](tasks/2026-11-03-mobility-intent-ui.md).
