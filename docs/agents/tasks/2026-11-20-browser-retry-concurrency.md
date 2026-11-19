# Task: Application engineering audit and browser retry concurrency

- **Task ID / file:** 2026-11-20-browser-retry-concurrency
- **Status:** in progress / CI pending
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb; parent PR #47 at 6d1fa2831491138145d07f795f0dc12983a2654d
- **Scope:** browser request retry bookkeeping, deterministic VM regressions and application audit. Infrastructure/security incident handling/backup/DR belong to the separate workstream. No live database, migration, cloud changes or deployment.
- **Dependencies / related tasks:** PR #47 all 4 checks passed; #45 and #46 each 4/4; #36 10/12, old real-tools failure and browser rerun in progress. #37–44 owned by operations (74/74 reported checks, not release proof). Notion roadmap https://app.notion.com/p/41dca5237af5819ba7d3c3f9bff9b088.

## Goal and acceptance criteria

A late response cannot alter a successor key or clear a replacement session. Concurrent incomplete/uncertain requests must retain a common key until the corresponding outcome is established; definitive isolated 4xx behavior remains as before. Same-tab reload persistence, TTL, explicit keys and no raw payload storage remain unchanged. Actual application source test via VM, then exact-head CI.

## Current state (verified vs assumed)

Main and parent source reviewed; six keyed business routes, atomic PostgreSQL/SQLite receipts, row-locked seats, partial unique passenger/ride index and ride-before-booking cancellation locks implemented. Parent #47 canonicalization regression already green. Browser apiFetch re-reads slot after await; an older response may delete or shorten a new key, or delete a shared key while a sibling request remains in flight. An old-session 401 can clear new state. These are source-level defects, not demonstrated production incidents.

### Seven-priority audit / ordered work queue

| Priority | Source evidence | Remaining gap / next |
|---|---|---|
| 1 idempotency | idempotency.js, migration 008, six routes, parent #47 | Browser race now patched; cross-tab keys, changed serialization, receipt expiry/reconciliation, external outcomes remain |
| 2 transactional backend | PG store row locks, unique partial index, transaction receipt | Mixed booking/cancel race, pool queue/timeouts, rollback/commit ambiguity, restart |
| 3 authentication/OTP | PostgreSQL identity, #36 + #45 verified branch tests | Controlled real provider/email/SMS and device acceptance after gates; no provider calls here |
| 4 rides | rides-store.js, HTTP/store tests, matching | Rides-only pilot settlement policy: pending booking/commission guards can block further actions although settlement is disabled; privacy/contact redaction and race tests |
| 5 Redis/H3 | DECISIONS A-010, 128 calls/512 rides, p95 297.87ms, queue 104 pool24, GiST selected | Synthetic burst not SLA; measure sustained mixed traffic and per-operation queue/lock/DB CPU first, tune pool/index/backpressure before new infra |
| 6 errands | prototypes/campuspool-2 README: localStorage simulation | Separate domain state machine, authorized requester/runner, atomic acceptance/receipt; actual money out of first rides-only pilot |
| 7 responsive UI | main web, optional Flutter stubs, mobility Playwright | Real device, responsive/accessibility, API integration; preserve design |

## Plan

1. Capture dispatched generation and auth context; ignore stale completions.
2. Track overlapping requests in memory; preserve receipt on ambiguous sibling or confirmed response. No changes to persisted token shape.
3. Add deterministic deferred-response tests; do not rebuild parent #47. Open stacked draft against parent for isolated review.
4. After CI, reconcile application release candidate dependencies; continue disposable booking/cancel race tests. G1 remains NO-GO.

## Progress log

- 2026-11-20 IST — refreshed main and all 12 open PR exact heads/CI, read operating agreement, status/next steps, decisions, active app and latest ops handoff, roadmap and prototype docs.
- 2026-11-20 IST — implemented browser request-generation and in-flight guards plus six deterministic regression cases.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Parent digest | PR #47 exact head | 4/4 reported checks PASS |
| Browser retry | npm run test:browser-idempotency | Pending exact-head CI |
| Full disposable application | stage1/PostGIS, mobility browser | Pending exact-head CI |
| Live behavior | staging/production | Not run |

## Risks and decisions

No new infrastructure or schema. Auto-key remains same-tab and raw serialized-body fingerprint; changing fingerprint storage version would need compatibility/reconciliation for outstanding operations. In-flight and confirmed flags are volatile; reload loses them. Sequential 4xx policy unchanged, not universal exactly-once. Old-session response bodies still returned to callers; this patch only guards wrapper state (mobility has separate epoch guard). General UI stale-response audit is pending. Confirmed success grace remains 1.2s; request keys expire after 24h; across tabs/new keys no semantic exactly-once promise. No production claims. Rollback is abandoning isolated branch; do not delete stored receipts.

## Next steps — exact handoff

1. **Next action:** inspect exact-head CI and browser tests; then implement mixed booking/cancel stress tests and invariant assertions on disposable PostgreSQL.
2. **Who may do it:** application engineering; independent PR reviewer unassigned.
3. **Prerequisites and blockers:** application PR #47 parent review; reconcile #36/#45 and #46 separately. No live migration/deploy before G1 and separate approval.
4. **Expected evidence:** six new cases pass, existing retry regressions pass, no stale key mutation/old-session 401 reset; no release gate bypass.
5. **Production impact:** none.

## Links and files changed

- Branch: fix/browser-retry-concurrency-2026-11-20
- Parent PR: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/47
- index.html, test_browser_idempotency.js, IDEMPOTENCY_CONTRACT.md, STATUS.md, NEXT_STEPS.md, this task.
