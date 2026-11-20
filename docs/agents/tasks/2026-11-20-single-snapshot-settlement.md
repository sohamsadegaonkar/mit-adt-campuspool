# Task: Single-snapshot settlement query consolidation

- **Task ID / file:** 2026-11-20-single-snapshot-settlement
- **Status:** in review / CI passed
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e; parent #53 exact code dcbfc5f and docs bded27584d287a05786ef37cf8a2e33eded9f617; policy #50 1c493e3
- **Scope:** PostgreSQL rides-store settlement check and existing tests; no schema, payment policy, auth/CSRF, public contract, pool capacity, live resources or deployment.
- **Dependencies:** #47–53 review stack; #50 policy.

## Goal and acceptance criteria

Collapse two SQL requests into one native-typed statement for both pool and in-transaction callers. Return identical committed-state settlement response fields, totals, rounding, ordered pending bookings and precedence. Keep existing actor lock, permissions, idempotency and payment restrictions. Ensure a no-user call performs no DB work, external transaction never falls back to pool, uncommitted cancellation visible only within transaction, rollback restores state. Exact old/new parity on six synthetic cases, real query count 12 to 6, one transactional statement. Re-run same Rush Hour workload and receipt/seat invariants. No absolute latency improvement promise.

## Current state (verified vs assumed)

#53 passed exact code dcbfc5f: 3880/3880, 159.94 peak req/s, p95 48.73ms, p95 acquisition 23.85ms, queue 39, 6720 pool acquisitions at peak; Node 18.13% one core; 47 snapshots, 876 receipts, no unexpected. Peak phase included 320 settlement-status reads that each use two parallel pool.query calls plus session lookup, 195 offer and 577 booking attempts whose settlement checks use two statements on a transaction. Shared NAT 120 allowed/10 throttled; separate fairness task. Queue pressure is observed, not proof of DB CPU saturation.

## Plan

1. Aggregate driver totals first, LEFT JOIN only current actor pending bookings; preserve native PG date/numeric types and bookingPublic mapping. One SQL statement sees one MVCC snapshot; no new caching or stale-state policy.
2. Use existing real PG test and old query reference, exact query counting for pool calls, transaction cancellation/rollback and settlement response parity.
3. Re-run #53 identical phase schedule; compare pool acquisitions per request and queue/latency as observations (not benchmark statistical proof). Retain all regression assertions. Record exact CI.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Existing two SQL queries yield commission + pending list; both are actor scoped. One aggregate subquery and LEFT JOIN preserves contract and eliminates a round trip; no schema or infrastructure.
- **Conventional alternative:** Increase connection count or add cache; more resources, stale financial state and invalidation; unjustified by synthetic queue alone.
- **First-principles alternative:** Return the two datasets in one SQL snapshot rather than two requests. Consider JSON aggregation but it changes PG native timestamptz/numeric decoding; retain typed rows and single aggregate. No need for a separate service or stored procedure.
- **Tradeoffs:** Repeats two aggregate fields per pending row (normally <=1 via HTTP); avoids cross-product by preaggregation. Existing index access remains planner-dependent. One fewer SQL statement per check, one fewer acquisition for standalone query; transactions retain one client. Does not repair all commission/payment business policy or lock topology. No new dependencies, cost or migrations; source revert.
- **Decision:** One native-typed LEFT JOIN query, with explicit no-pending NULL filter. Preserve all existing guards, order and JS rounding. No speculative Redis, H3, more connections.
- **Evidence:** #53 baseline exact workload and queue metrics; source two statements. Deterministic query count reduction is testable; performance improvement unverified until CI and repeated representative tests.
- **Validation:** Six cases reference parity (12 vs 6 real calls), external transaction single query and rollback, cancel parity, exact expected totals and ordering, mixed HTTP and full Rush Hour same schedule. Record results and limitations.

## Progress log

- 2026-11-20 IST — read #53 CI and recorded verified baseline; selected actual source simplification.
- 2026-11-20 IST — implemented one statement and real contract/count tests; CI pending.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Contract and query count | npm run test:rides | PASS, 12→6 |
| HTTP/pressure and stress | existing PostgreSQL CI | PASS |
| Same Rush Hour workload | RIDES_HTTP_RUSH_DISPOSABLE_DB=YES npm run test:rides-http | PASS |
| Baseline | #53 exact dcbfc5f | verified |
| Live | none | not run |

## Risks and decisions

No public contract change intended. The two former SELECTs could see different committed snapshots under READ COMMITTED; new statement deliberately sees one. Does not imply serializable settlement across separate operations or fix existing driver commission race. No new eligibility/payment policy. Source query count is deterministic for those paths; CI timings are single runs and workload outcomes vary. Existing CI role/small corpus/loopback are not production. Shared NAT and privacy gate independent. Roll back by reverting this PR. No migrations, deployment, live access or cloud changes.

## Next steps — exact handoff

1. **Next action:** inspect exact CI SETTLEMENT_QUERY_RESULT and CAMPUS_RUSH_PHASE/RESULT; record parity/count and comparable observations; review candidate stack. Next evaluate shared-campus NAT fairness while keeping abuse protection, and review privacy/settlement pilot policy.
2. **Who may do it:** application engineering / independent reviewer.
3. **Prerequisites and blockers:** #47–53 and #50 review/integration; G1 NO-GO for live release.
4. **Expected evidence:** 12→6 SQL calls, 1 transaction call, snapshot parity, rollback, successful same workload/invariants; no claim if unverified.
5. **Production impact:** none.

## Links and files changed

- Branch perf/single-snapshot-settlement-2026-11-20
- stage1-otp/rides-store.js, test_pg_rides.js, STATUS.md, NEXT_STEPS.md, DECISIONS.md, this task.
- #53 baseline https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44606175424/job/135850349217

## Exact-head CI evidence — 2026-11-20 IST

[PostgreSQL CI](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44609553987/job/135862179734) PASS at `a6832bbcbb1421631f7a3809fe6ebc49f6b84e91`; browser E2E also green. Six real-PG reference cases, old queries 12→6, external transaction 1, rollback and cancelled booking parity true. Rush 3880/3880, zero unexpected/dropped, 47 invariant snapshots, 874 receipts, 8 recovery, NAT 120/10. Peak 159.95/s, p95 30.17ms, p99 44.5ms, pool 6400 acquisitions vs 6720 in both baseline runs, queue 35 vs 39, p95 acquire 15.04ms vs 22.75–23.85ms. Node one-core CPU 11.15% vs 17.37–18.13%; no general speedup guarantee. Six-case statement reduction deterministic; timing observational. Next shared NAT fairness while retaining preauth IP guards and actor caps. No live changes.
