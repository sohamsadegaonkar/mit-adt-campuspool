# Task: Backend reliability audit and canonical JSON receipt hardening

- **Task ID / file:** 2026-11-20-idempotency-audit
- **Status:** in progress / CI pending
- **Agent / owner:** ChatGPT engineering agent; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb
- **Scope:** shared idempotency request digest, isolated SQLite and PostgreSQL tests, source audit of rides and bookings. No migration, production data, payment or cloud changes.
- **Dependencies / related tasks:** IDEMPOTENCY_CONTRACT.md; PR #36/#45; independent PG17 readiness PR #46.

## Goal and acceptance criteria

Distinct JSON payloads sharing a key must conflict even when containing a nested own JSON property named __proto__. Reordered equivalent bodies replay; callback executes once. Both backends and read-only receipt lookup covered. Existing normal-payload digests unchanged. Exact-head CI required.

## Current state (verified vs assumed)

Main canonical() uses plain object assignment: __proto__ invokes inherited setter and drops that own key from JSON serialization. Conditional digest alias, not proof of an exploit or duplicate bookings in production. PostgreSQL ride row locking, unique active passenger/ride index, seat bounds, consistent ride-then-booking cancellation locks, receipt+effect transaction and actor-scoped replay are present. Existing integration tests cover last-seat competition, rollback, same-key contention and cross-account denial. Live DB and restart behavior not tested.

Other findings to investigate: payment settlement is intentionally disabled yet pending-booking/commission guards can block later rides; define explicit rides-only pilot policy before changing money semantics. Browser auto-keys use raw serialized JSON and tab-local storage; semantically equivalent reserialization, parallel tabs, stale responses and 24-hour expiration need reconciliation tests. External OTP/GPS/payments do not share the keyed domain contract. Review driver contact/UPI data redaction at HTTP boundaries and load/pool behavior separately.

## Plan

1. Use null-prototype accumulator to preserve all JSON own properties in canonical hash.
2. Regression: exact replay after reordering, distinct nested prototype field and absent field must return 409 across both stores and read-only lookup.
3. Check exact-head isolated CI; test browser stale response, contention/cancellation and pilot settlement policy next. Do not introduce distributed infrastructure without measurements.

## Progress log

- 2026-11-20 IST — inspected source, SQL constraints, routes and existing test coverage; implemented shared digest hardening and regressions.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Prototype property handling | Source inspection | defect identified |
| SQLite regression | npm run test:idempotency | CI pending |
| PostgreSQL regression | npm run test:idempotency-pg | CI pending |
| Rides concurrency and HTTP | existing isolated CI | historical coverage; new exact head pending |
| Live durability, payment and privacy | staging/production | not verified, no live access |

## Risks and decisions

Normal JSON digest remains identical. Historical receipts of prototype-named inputs can have ambiguous legacy hashes; do not claim retroactive repair. Existing production receipt inventory and compatibility/reconciliation policy need review before promotion. No schema changes. Do not bypass payment restrictions; product owner must approve rides-only settlement semantics. Redis/H3 not required for correctness of database transaction.

## Next steps — exact handoff

1. **Next action:** verify exact-head CI; review browser late-response interleavings, different-key logical duplicates, cancellation races and seat invariant tests.
2. **Who may do it:** engineering reviewer; owner for pilot policy and release gates.
3. **Prerequisites and blockers:** source review, real backup/restore, credentials and external OTP verification before live deployment.
4. **Expected evidence:** conflict for distinct nested keys; replay for equivalent payload; one callback per key; green required CI.
5. **Production impact:** none.

## Links and files changed

- Branch: fix/idempotency-canonical-json-2026-11-20
- idempotency.js, test_idempotency.js, test_pg_idempotency.js, STATUS.md, NEXT_STEPS.md, this task.
