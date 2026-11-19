# Task: HTTP mixed rides concurrency and pool backpressure characterization

- **Task ID / file:** 2026-11-20-http-rides-backpressure
- **Status:** in progress / CI pending
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e; parent #49 at f34fb108a2cfbc83cb3f21c56f35af1e713e3587; owner-approved policy #50 exact 1c493e3
- **Scope:** extend existing disposable real HTTP Rides test and CI command; no app runtime changes, no Azure, live DB or deployment
- **Dependencies / related tasks:** #47–49; #50 policy reviewed and applied without merging separate branch.

## Goal and acceptance criteria

Prove actor-level pending-payment serialization across two rides; same-key retry; mixed book/passenger/driver cancel; unauthorized/CSRF/spoof attempts cannot mutate; seat conservation; existing rate limit preserved. Hold all five shared PG pool connections with actual session table lock, characterize timeout response, ensure health and recovery. Current sanitized 500 timeout is a deficiency to fix separately, not overload acceptance. No unexpected mixed-mutation 5xx or network errors.

## Current state (verified vs assumed)

#49 actual store stress 531 attempts, 173 consistent snapshots, p95 37.31ms; no HTTP path. Existing HTTP fixture already covers rate-limit replay, session cookies, CSRF, payment guards, actual server process. PgOtpStore max 5, acquisition timeout 5000ms, shared with identity and rides; generic error wrapper returns 500. No proof of saturation behavior yet.

## Plan

1. Extend existing fixture, six synthetic actors, two rides, bounded mixed burst under default 60/IP mutation budget; use actual HTTP and SQL invariant checks.
2. Use real session-table lock to saturate pool, check anonymous health and queued timeout behavior, release and assert recovery; retain existing rate limit test.
3. Verify exact-head CI and aggregate diagnostics, record gaps; separate minimal fix if required. No live workload or changes.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Reuse test_pg_rides_http.js, native fetch, existing fixture, real database and workflow; no new package, network service or duplicated harness.
- **Conventional alternative:** k6/Artillery external load runner; useful for representative sustained workloads later but does not add correctness evidence needed for this deterministic case.
- **First-principles alternative:** Test the resource boundary directly by occupying the five actual connections with one SQL lock, then make a small number of HTTP calls and observe release/recovery. No instrumentation of production pool or mocked errors.
- **Tradeoffs:** Small targeted burst avoids rate-budget bypass, added pressure test costs about five seconds and is disposable only. Not representative throughput or multi-replica SLA; no additional dependencies/cost. Retain all safety controls.
- **Decision:** Extend existing HTTP harness and characterize existing behavior before changing runtime. No new service, cache or speculative tuning. Rollback is removal of isolated test change.
- **Evidence:** Store stress measured on #49; source confirms actor lock, HTTP budget 60/IP, shared max five and 5s acquisition. Comparison of production capacity is not measured.
- **Validation:** Actual CI with explicit opt-in, exact localhost DB, six actors, mixed mutations and denial tests, seat snapshot checks, five observed locked sessions, three queued HTTP timeout responses, eight successful recovery reads, existing bounded rate replay coverage.

## Progress log

- 2026-11-20 IST — read source, prior handoff, Notion roadmap and minimum-complexity policy; determined test extension is smallest sufficient option.
- 2026-11-20 IST — implemented bounded HTTP mixed mutation and real connection exhaustion test, diagnostic metrics and exact fixture cleanup; CI pending.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| HTTP mixed writes and pressure | RIDES_HTTP_STRESS_DISPOSABLE_DB=YES npm run test:rides-http | pending exact-head disposable CI |
| Prior store stress | #49 code df02678 | pass; not equivalent to HTTP |
| Real staging/production | none | not run |

## Risks and decisions

Pool acquisition timeout currently generic 500, not graceful 503; characterize separately and leave explicit follow-up. No automatic payment settlement or bypass. Existing session fixture uses synthetic tokens and CI-only database; no actual provider. Single Node process; no distributed IP-limit or representative throughput claims. Explicit stress opt-in required, exact local disposable DB path and no override query. No live migration or data. Prior task and #50 remain independent.

## Next steps — exact handoff

1. **Next action:** read exact-head HTTP_STRESS diagnostic and CI log; if generic 500 confirmed, scope a typed retryable overload response and regression (do not swallow unrelated errors).
2. **Who may do it:** application engineering; independent reviewer unassigned.
3. **Prerequisites and blockers:** review #47–49 and #50; G1 no-go for live migrations/deployment.
4. **Expected evidence:** safe mixed HTTP outcomes, no unauthorized writes, five locked connections, three bounded timeout responses, recovery and rate-limit protection.
5. **Production impact:** none.

## Links and files changed

- Branch test/http-rides-backpressure-2026-11-20
- test_pg_rides_http.js, .github/workflows/stage1-otp.yml, STATUS.md, NEXT_STEPS.md, this task
- Parents #49 and policy #50
