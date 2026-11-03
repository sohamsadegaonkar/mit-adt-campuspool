# Task: Transactional request idempotency across Rides and mobility

- **Task ID / file:** `2026-11-03-transactional-idempotency`
- **Status:** in progress — branch changes pending independent GitHub CI and reviewer approval
- **Agent / owner:** ChatGPT engineering agent
- **Last updated:** 2026-11-03 UTC
- **Baseline:** `main@3ee1f4a12e984cb6aecbf8ea09150d1e79556c87`
- **Branch:** `security/transactional-idempotency-2026-11-03`
- **Scope:** authenticated ride/booking/mobility mutation idempotency, private PG/SQLite receipt stores, unit/HTTP tests, docs and CI. **No staging/production migration or deployment**, no OTP or payment-provider activation.
- **Dependencies:** AGENTS.md, PostgreSQL Rides/geo migrations 006-007, restricted PG backend role, existing browser apiFetch, isolated PostGIS CI.

## Goal and acceptance criteria

Audit mutation retry safety, prevent duplicate ride/booking/intent effects on retry and concurrent same-key requests, replay original success across shared SQL transactions, require client-generated high-entropy operation keys, reject key-body conflicts and document non-idempotent external workflows.

Criteria: same-key replay returns identical successful resource/status, different-body same key 409, missing key 428, malformed key 400, database failure rolls back effect and key, auth/CSRF remain mandatory, no duplicate seat consumption or restoration, isolated SQLite and PostgreSQL HTTP tests pass, no privileged/staging or production writes.

## Current state (verified vs assumed)

`main@3ee1f4a12e98` has atomic PG ride locks and uniqueness for active bookings, one-active mobility intent, OTP one-time proofs, payment callbacks intentionally disabled. There is no durable keyed mutation receipt in `main`. Production and staging Render live deployed SHAs precede `main` and have auto-deploy disabled. **This branch is not deployed.**

## Plan

1. Inspect every state-changing endpoint and domain store.
2. Introduce a per-user+route+key and canonical-payload idempotency store in PG and SQLite, stored with the business effect atomically.
3. Share the same PG transaction with ride, booking, cancellation and mobility mutations; keep OTP/payment paths outside generic response replay.
4. Require keys on covered APIs and attach retry-stable browser keys.
5. Add rollback, concurrent retry, cross-user scope and HTTP replay tests; integrate tests into GitHub CI.
6. Document migration, guarantee limits, next actions and production no-go; request review before any staging migration.

## Progress log

- 2026-11-03 UTC — Reviewed `AGENTS.md`, status and next steps, `main`, store implementations, read/write routes, tests and release blockers.
- 2026-11-03 UTC — Audit: no keyed response ledger; PG booking uniqueness protects same-ride duplicates but retries fail after successful booking due to settlement guard; ride create can duplicate; cancels fail on retry.
- 2026-11-03 UTC — Added `idempotency.js`, PostgreSQL migration 008, SQLite schema, and shared transaction support in PG rides and mobility stores.
- 2026-11-03 UTC — Integrated keyed receipts into six authenticated write endpoints; PG passenger row lock added to serialize same-user booking eligibility checks. Disabled payment routes remain untouched.
- 2026-11-03 UTC — Updated browser `apiFetch` with operation-key reuse, added SQLite unit and PG/SQLite HTTP replay/rollback tests, wired test scripts and workflow jobs.
- 2026-11-03 UTC — Auth/OTP delivery, GPS update reordering and future payment webhooks explicitly excluded from global replay guarantees; documented in `IDEMPOTENCY_CONTRACT.md`.
- 2026-11-03 UTC — GitHub CI and independent staging verification: **pending**. No database migration applied to live Supabase, no Render service modified.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| JavaScript syntax | GitHub source syntax checks and parser on changed snippets | Partial parse checks, full CI pending |
| SQLite transaction tests | `npm run test:idempotency` (isolated tempfile) | Pending GitHub CI |
| Legacy auth + SQLite API | `npm run test:security` | Pending GitHub CI |
| PostgreSQL booking+ride replay | `npm run test:rides-http` (disposable PostGIS) | Pending GitHub CI |
| Mobility retry and rate limiting | `npm run test:mobility-http` (disposable PostGIS) | Pending GitHub CI |
| Live staging | No staging migration/deploy allowed by this task | Not performed |
| Live production | No production migration/deploy allowed by this task | Not performed |

## Risks and decisions

- PostgreSQL migration 008 must be applied in isolated staging **before** switching on a build that requires the idempotency table; server startup fails closed otherwise.
- SQLite still lacks production durability on free Render disks, even though local keyed transactions are atomic.
- Key expiry is 24h, with periodic deletion still to implement. Existing mobile/browser clients must be upgraded because covered mutation routes require `Idempotency-Key`.
- Provider OTP sends and payment webhooks need their own transactional outbox / event-ID model. No "full exactly once" claim for such external effects.
- User row lock serializes concurrent **same-user** booking eligibility in PG. Booking capacity still uses its original ride row lock.
- Cached successful receipt contains booking/user details; data is stored in server-only private tables, not shared HTTP caches.
- See `docs/agents/DECISIONS.md` A-010 and `IDEMPOTENCY_CONTRACT.md`.

## Next steps — exact handoff

1. **Next action:** Open PR from `security/transactional-idempotency-2026-11-03`, inspect GitHub Actions `Stage 1 PostgreSQL OTP tests`, `CampusPool security smoke tests`, `Credential and secret hygiene`, and `Agent documentation contract`; fix any failed assertions or code issues.
2. **Who may do it:** engineering reviewer or next agent; staging migration/deploy requires separate explicit permission.
3. **Prerequisites and blockers:** no live data mutation; use disposable PG/PostGIS and temporary SQLite only. If a workflow is red, copy *sanitized* failure cause into this record.
4. **Expected evidence:** successful run IDs at exact PR head, tests for collision/replay/rollback, and reviewed idempotency security design.
5. **Production impact:** none; new code and migration are branch-local until independently approved and deployed.

## Links and files changed

- Branch: `security/transactional-idempotency-2026-11-03` (PR link to be added when created).
- New: `idempotency.js`, `test_idempotency.js`, `IDEMPOTENCY_CONTRACT.md`, `stage1-otp/migrations/008_transactional_idempotency.sql`.
- Modified: `server.js`, `database.js`, `index.html`, `stage1-otp/rides-store.js`, `stage1-otp/mobility-store.js`, `stage1-otp/migrate.js`, HTTP tests, CI, agent docs.
- Last observed staging deployment: `cceadbf6251f`; production `63ae5510bbe2` (from previous verified status, reconfirm before future deployment).
