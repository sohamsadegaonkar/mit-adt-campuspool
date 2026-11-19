# Task: Campus Rush Hour sustained mixed HTTP load

- **Task ID / file:** 2026-11-20-campus-rush-hour
- **Status:** in review / exact-head CI passed
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e; parent #52 ff4869abe12aab847298f2598146b2fe7bdb1133; policy #50 1c493e3.
- **Scope:** disposable Linux CI real HTTP, no runtime modifications, no live DB, Azure, deployment, payment or provider.
- **Dependencies / related tasks:** #47–52 and #50. Prior lock-barrier regression separate; no repeat as performance evidence.

## Goal and acceptance criteria

Exercise one actual Node server, existing five PG connection pool and real rate limits for 45 seconds of paced arrivals (10s at 8/s, 15s at 40/s, 20s at 160/s, total 3880 planned). 96 synthetic verified actors, 16 drivers, 32 seeded four-seat rides; browse, offer, reserve, cancel, settlement reads. At least 99% delivered arrivals, zero unexpected responses/transports, no seat/actor/receipt divergence in sampled committed states; 429/503 only valid explicit contract. Do not grade p95 as a release SLA. Separate simulated campus NAT 130 reads (120 allowed, ten 429), recovery 8/8. Record per-phase p50/p95/p99, accepted p95, queue, acquisition, CPU/RSS/event loop, payload and actual achieved RPS. Hard cap 128 in-flight; record missed arrivals, do not silently retry. No new runtime service.

## Current state (verified vs assumed)

Parent #52 code b095678 verified 3/3 503 overload responses under forced lock, 12 browser VM cases, 8 recovery reads. Parent docs-only head reports PG/smoke/benchmark/places green; browser-e2e in progress at audit. Existing full ride listing returns all active rides, session/auth and business query share five PG connections, IP limits 120 read/60 write per minute; forwarded IP untrusted except configured proxy. Prior direct store p95 not comparable to sustained HTTP.

## Plan

1. Reuse existing fixture and server process. Separate opt-in mode with exact local database name and real Linux TCP addresses 127.0.0.10–105; no forged forwarded header or changed rate-limit policy.
2. Test-only child process probe wraps existing acquire API to measure waitingCount and acquire latency, uses IPC at phase boundaries; no production code or instrumentation. Observer snapshots once per second. Fixed paced phases, separate NAT condition, compare committed receipts to actual successful HTTP writes.
3. CI with existing disposable PostGIS job; report metrics and explicit bottleneck/limitations. No changes to application behavior; choose next engineering task based on observed data.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Reuse Node server and fixture, native http/IPC, PostgreSQL observer, existing workflow. No k6, Redis or load infrastructure. Extend one harness opt-in rather than duplicate setup and cleanup.
- **Conventional alternative:** k6/Locust distributed runners useful for longer real-world WAN topology, but introduce extra setup and cannot replace exact receipt reconciliation; defer until useful.
- **First-principles alternative:** Separate resource capacity from rate limiter by actual stable loopback source IP per actor, then isolate single-NAT fairness; observed pool queue and arrival pacing, not just throughput. No fictitious user concurrency claim.
- **Tradeoffs:** 45-second CI workload plus setup/NAT, bounded request concurrency and request deadlines. Probe overhead and loopback/runner/small seed corpus limit generalization; CI superuser fixture from existing HTTP harness, not production privileges. Native PG connection pool actual, no external services. No new dependencies or live expenditure. 
- **Decision:** Use fixed-paced stepped arrivals, no catch-up or blind retries, record actual misses; characterize before optimizing. Revert benchmark-only branch if needed.
- **Evidence:** #52 forced contention evidence and existing rate policy source; prior synthetic store test not sustained HTTP. No claim of capacity before test.
- **Validation:** per-phase diagnostics, invariant and receipt checks, shared-IP 429 contract, recovery, existing prior suite continues independently; review exact CI logs. No target latency SLA without owner-approved real workload.

## Progress log

- 2026-11-20 IST — reviewed parent and owner-approved protocol; selected existing disposable HTTP fixture and test-only probe.
- 2026-11-20 IST — implemented 3 stepped phases, actual stable TCP source, NAT scenario, bounded concurrency, invariant and exact receipt reconciliation; CI pending.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Sustained rush hour | RIDES_HTTP_RUSH_DISPOSABLE_DB=YES npm run test:rides-http | PASS; see exact-head CI evidence below |
| Parent forced lock | #52 code b095678 | verified |
| Production load | not run | out of scope |

## Risks and decisions

Single process, one local PostGIS CI runner, 96 synthetic identities not 96 simultaneous people; read-heavy pattern and modest seeded data selected provisionally, application role same as prior HTTP fixture. No WAN/mobile, real OTP or payments, no real geospatial matching benchmark in this workload. Per-IP limiter remains shared SQLite local to instance. Probe measures acquisition including connection creation, not pure queue dwell; CPU percentage is relative to one core, excludes database CPU; RSS instantaneous end of phase. No production capacity or Redis/H3 adoption claim. A 429 or 503 is a capacity signal, not a correctness failure if explicit contract preserved. All rejection receipts checked. No automatic retries. No runtime modifications or production access.

## Next steps — exact handoff

1. **Next action:** Inspect exact-head CI diagnostics CAMPUS_RUSH_PHASE and CAMPUS_RUSH_RESULT; identify actual bottleneck; investigate shared-NAT fairness and sustained admission if justified. If test fails, retain evidence, correct harness or bug without relaxing correctness.
2. **Who may do it:** application engineering; independent reviewer unassigned.
3. **Prerequisites and blockers:** stacked review #47–52; G1 remains separate NO-GO; no live migrations/deployment.
4. **Expected evidence:** 3 phases, 3880 planned, every observed snapshot consistent, matched receipt counts and exact keys, no unexpected errors, recorded rate-limit and latency/queue/CPU.
5. **Production impact:** none.

## Links and files changed

- Branch test/campus-rush-hour-2026-11-20
- bench/campus-rush-hour.js, test_pg_rides_http.js, .github/workflows/stage1-otp.yml, STATUS.md, NEXT_STEPS.md, DECISIONS.md, this task.

## Exact-head CI evidence — 2026-11-19 UTC / 20 Nov IST

[Disposable PostgreSQL job](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44606175424/job/135850349217) passed at code `dcbfc5fd9f2051e27aeb4ac1fc949efbcead5193`. Rush Hour subtest PASS: 3880/3880 completed, zero dropped/unexpected; 47 invariant snapshots, 876 exact receipts (including seeded writes), zero sampled DB lock waiters, 8/8 recovery. 96 actors, 16 drivers, 32 initial rides, four-core CI runner, Node 22.23.2. Separate same-IP NAT 120 accepted / 10 HTTP 429 / 0 unexpected. No 429/503 in paced distinct-IP phases.

| Phase | Completed / actual RPS | p95/p99 HTTP ms | p95 acquire ms | Pool acquisitions / peak queued | Node CPU one-core % / RSS MiB |
|---|---:|---:|---:|---:|---:|
| Warmup | 80 / 8 | 9.40 / 16.94 | 0.08 | 168 / 2 | 2.94 / 80.16 |
| Lecture dismissal | 600 / 39.99 | 19.40 / 21.71 | 5.03 | 1260 / 6 | 8.03 / 88.21 |
| Rush hour | 3200 / 159.94 | 48.73 / 59.72 | 23.85 | 6720 / 39 | 18.13 / 109.55 |

Peak 320 settlement-status reads, 195 offer attempts and 577 booking attempts; standalone settlement reads use two parallel pool acquisitions, mutation settlement checks use two statements on an existing transaction client. Queue pressure merits eliminating avoidable SQL round trips before more infrastructure. Not proof of a saturated production DB (no DB CPU measurement or WAN). #54 candidate to consolidate statement; separate NAT fairness and privacy/settlement-policy follow-ups. No production changes.
