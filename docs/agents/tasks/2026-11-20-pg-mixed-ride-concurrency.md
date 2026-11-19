# Task: PostgreSQL mixed ride mutation concurrency stress

- **Task ID / file:** 2026-11-20-pg-mixed-ride-concurrency
- **Status:** in progress / exact-head CI pending
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb; parent PR #48 at 417f1c692b31d2bd9b1b4adce898e59331c99ee3
- **Scope:** disposable PostgreSQL/PostGIS CI, actual PgRidesStore + PgIdempotencyStore, no app logic changes or live DB access
- **Dependencies / related tasks:** #47 canonical digest, #48 browser retry; both exact-head CI green. Recovery remains separate.

## Goal and acceptance criteria

Every observed committed ride obeys seats_left + active bookings = seats_total, no duplicate active passenger, correct cancellation timestamps, no active booking on cancelled ride. Same-key receipts commit exactly once and replays preserve response; rolled-back operations leave no receipt or effect. No unexpected SQL errors/timeouts/deadlocks. Exercise actual DB lock contention in every wave.

## Current state (verified vs assumed)

Parent #48 exact head 3/3 checks green; PostgreSQL job 135825049450 shows 10/10 browser retry tests including six added cases. Existing rides tests cover simple two-passenger last-seat race and sequential cancellation; mixed booking/driver/passenger cancellation and post-write rollback deserve explicit stress. Source locks ride then booking, and transaction receipts share the same client. These are not live production guarantees.

## Plan

1. Use explicit opt-in and exact localhost disposable database name, verify current_database before applying CI-only fixture migrations. Four independent pools of four connections; use restricted campuspool_staging_app role for every business mutation.
2. Run twelve rounds, each with two lock-barrier waves and varied dispatch order: three seed bookings, final-seat pressure concurrent with passenger cancellation; then driver cancellation concurrent with booking and passenger cancellation. Include repeated keys and new keys for same booking/cancel.
3. Observe one-statement MVCC seat/bookings snapshots while waves run and after; check receipts/replay and allowed business rejection codes; fail unexpected SQL error. Inject post-write failure for each mutation and retry same key. Report aggregate p50/p95/p99 and pool queue separately from SLA.
4. Wire suite into existing disposable CI (no skipped pass); clean fixture IDs only. No staging or production migrations.

## Progress log

- 2026-11-20 IST — parent #48 exact-head CI and browser test log verified; reviewed store locks, migrations, restricted role and CI workflow.
- 2026-11-20 IST — implemented real restricted-role mixed stress suite, SQL invariant observer, receipt verification, three rollback/retry tests, workflow and npm script.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Parent browser retry | GitHub job 135825049450 | 10/10 pass, parent 3/3 checks |
| Mixed concurrency | RIDES_STRESS_DISPOSABLE_DB=YES npm run test:rides-stress | exact-head CI pending |
| Invariants and receipt rollback | same stress suite | pending |
| Live runtime or HTTP load | not executed | out of scope |

## Risks and decisions

Direct store integration, not HTTP; deliberately does not exercise commission/settlement policy, auth/CSRF or rate limits. Uses disposable CI database with schema migrations; never run against real data. Four pools model independent clients, not multiple OS workers/hosts. Lock barrier intentionally adds latency; timings are diagnostic, not representative load SLA. MVCC sampling can miss transient committed states, supplemented by final snapshots and transactional constraints; no proof for arbitrary workloads. Keep Redis/H3 deferred. No schema/business code change.

## Next steps — exact handoff

1. **Next action:** inspect exact-head CI job and RIDES_STRESS_RESULT; if failures, diagnose lock or receipt behavior without relaxing assertions. Then add HTTP mixed concurrency/settlement policy and pool backpressure tests separately.
2. **Who may do it:** application engineering; independent review unassigned.
3. **Prerequisites and blockers:** parent #47/#48 review, exact-head green CI and integrated candidate review. G1 and separate approvals required for any live deployment/migration.
4. **Expected evidence:** 12 rounds, 24 observed lock waves, consistent snapshots, 3 rollback/retry checks, no unexpected failures.
5. **Production impact:** none.

## Links and files changed

- Branch: test/pg-mixed-ride-concurrency-2026-11-20
- Parent PR #48: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/48
- test_pg_rides_stress.js, package.json, .github/workflows/stage1-otp.yml, STATUS.md, NEXT_STEPS.md, this task.
