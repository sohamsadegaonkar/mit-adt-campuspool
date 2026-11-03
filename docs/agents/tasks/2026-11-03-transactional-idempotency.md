# Task: Transactional request idempotency across Rides and mobility

- **Task ID / file:** `2026-11-03-transactional-idempotency`
- **Status:** in review — latest-head GitHub CI passed; code review and staging rollout gate still open
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
- 2026-11-03 UTC — Opened draft [PR #11](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/11). Initial idempotency, SQLite security, secrets and documentation checks passed; an existing mobility duplicate-conflict test exposed a crash caused by returning a rejected Promise without awaiting inside the HTTP handler.
- 2026-11-03 UTC — Corrected three unawaited mutation-return paths in `server.js`; subsequent full PostgreSQL/PostGIS and other CI checks passed at commit `026607d734f8`.
- 2026-11-03 UTC — Strengthened the design with a separate concurrent PG transaction test and bounded PG/SQLite receipt pruning; extended `prune:otp` for full PG expired receipt cleanup. **Latest CI revalidation passed** on `a2e231b96d30dad33c7b1e6a9ce1d6d5dec262e6`.
- 2026-11-03 UTC — Rechecked exact PR #11 head `a2e231b96d30` and four GitHub Actions workflows: PostgreSQL/PostGIS OTP integration (#41582822457), security smoke (#41582822448), secret hygiene (#41582822449), agent-doc contract (#41582822439) all succeeded. This verifies CI, not staging or production.
- 2026-11-03 UTC — Static review found that the shared IP rate limiter executes **before** authenticated idempotency receipt lookup in `server.js`; a completed-key retry can receive transient HTTP 429 under throttling. Exactly-once-per-key *SQL business effects* still hold, but unconditional HTTP replay under rate limiting is not guaranteed. Follow-up design/test needed before advertising stronger semantics.
- 2026-11-03 UTC — Implemented a bounded, read-only completed-receipt recovery path when the shared HTTP mutation limit returns 429: 12 replay probes/IP/minute, same session/CSRF/actor/key/payload scope, no new writes; added SQLite and PG HTTP regression tests. **GitHub CI verification pending on new code head.**
- 2026-11-03 UTC — No database migration applied to live Supabase, no Render service modified.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| JavaScript syntax | GitHub source syntax checks and parser on changed snippets | PASS on exact PR head `a2e231b` in GitHub CI |
| SQLite transaction tests | `npm run test:idempotency` (isolated tempfile) | PASS on exact PR head `a2e231b` in isolated GitHub CI |
| Legacy auth + SQLite API | `npm run test:security` | PASS on exact PR head `a2e231b` in isolated GitHub CI |
| PostgreSQL booking+ride replay | `npm run test:rides-http` (disposable PostGIS) | PASS on exact PR head `a2e231b` in isolated GitHub CI |
| Mobility retry and rate limiting | `npm run test:mobility-http` (disposable PostGIS) | PASS on exact PR head `a2e231b` in isolated GitHub CI |
| PostgreSQL two-client concurrency | \`npm run test:idempotency-pg\` (disposable PostGIS) | PASS on exact PR head `a2e231b` in isolated GitHub CI |\n| Live staging | No staging migration/deploy allowed by this task | Not performed |
| Live production | No production migration/deploy allowed by this task | Not performed |

## Risks and decisions

- PostgreSQL migration 008 must be applied in isolated staging **before** switching on a build that requires the idempotency table; server startup fails closed otherwise.
- SQLite still lacks production durability on free Render disks, even though local keyed transactions are atomic.
- Key expiry is 24h; bounded opportunistic pruning is implemented and `prune:otp` can fully clean old receipts; no live scheduled task has been configured. Existing mobile/browser clients must be upgraded because covered mutation routes require `Idempotency-Key`.
- Provider OTP sends and payment webhooks need their own transactional outbox / event-ID model. No "full exactly once" claim for such external effects.
- User row lock serializes concurrent **same-user** booking eligibility in PG. Booking capacity still uses its original ride row lock.
- Cached successful receipt contains booking/user details; data is stored in server-only private tables, not shared HTTP caches.
- The shared IP-based HTTP mutation limiter remains authoritative for *new writes*. Completed results can be fetched read-only with a second capped budget of 12 probes/IP/minute after session/CSRF validation; excess probes, new/expired keys and blocked attempts still return 429. This is best-effort bounded recovery, not unconditional HTTP replay.
- See `docs/agents/DECISIONS.md` A-010 and `IDEMPOTENCY_CONTRACT.md`.

## Next steps — exact handoff

1. **Next action:** Verify new code head CI, review read-only throttled replay query/budget, and check session/CSRF/cross-user behavior under load. Then independently review PostgreSQL migration permissions and browser retry lifecycle before declaring review complete.
2. **Who may do it:** engineering reviewer or next agent; staging migration/deploy requires separate explicit permission.
3. **Prerequisites and blockers:** no live data mutation; use disposable PG/PostGIS and temporary SQLite only. If a workflow is red, copy *sanitized* failure cause into this record.
4. **Evidence now available:** exact-head successful CI run IDs 41582822457 (PostGIS), 41582822448 (security), 41582822449 (secrets), 41582822439 (agent docs). **Still required:** independent code review, controlled staging-only migration approval/backups, browser/restart/concurrency QA. No tests were executed locally in this handoff environment.
5. **Production impact:** none; new code and migration are branch-local until independently approved and deployed.

## Links and files changed

- Branch: `security/transactional-idempotency-2026-11-03`; [draft PR #11](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/11).
- New: `idempotency.js`, `test_idempotency.js`, `IDEMPOTENCY_CONTRACT.md`, `stage1-otp/migrations/008_transactional_idempotency.sql`.
- Modified: `server.js`, `database.js`, `index.html`, `stage1-otp/rides-store.js`, `stage1-otp/mobility-store.js`, `stage1-otp/migrate.js`, HTTP tests, CI, agent docs.
- Last observed staging deployment: `cceadbf6251f`; production `63ae5510bbe2` (from previous verified status, reconfirm before future deployment).
