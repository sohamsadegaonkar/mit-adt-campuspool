# Task: Reproducible PostGIS concurrency and abuse-control benchmark

- **Task ID / file:** `2026-11-04-mobility-load-benchmark`
- **Status:** tested (CI) — 128/128 successful, all five CI workflows green; independent review pending
- **Agent / owner:** ChatGPT engineering agent; independent reviewer unassigned
- **Last verified:** 2026-11-03 20:12 UTC, GitHub run #41710272878 (2026-11-04 user local date)
- **Baseline:** `main@3ee1f4a12e984cb6aecbf8ea09150d1e79556c87`; unrelated PR #14 remains draft
- **Scope:** `bench/mobility-load.js`, `bench/mobility-load.test.js`, isolated GitHub Actions benchmark, `package.json`, agent docs. No application API changes, Redis/H3, schema 008, staging/production deployment, external students, live data or providers.
- **Dependencies / related tasks:** `MOBILITY_MATCHING_ROLLOUT.md`; `docs/agents/DECISIONS.md`; independent PR #14 (UI), PRs #11–13 (security/recovery)

## Goal and acceptance criteria

Obtain reproducible baseline measurements for **128 simultaneous synthetic student matching searches** against existing PostgreSQL 16/PostGIS 3.4 GiST indexes with 512 synthetic geocoded rides. Record p50, p95, p99, throughput, PG pool waiting and connection pressure, selected database-stat counters, representative query plan and shared PostgreSQL rate-limit behavior. Fail if requests error, data leaks, maximum results are exceeded, rate limits are bypassed, or unsafe database targets are configured. Do not use synthetic CI measurements alone to justify Redis, H3, costly new infrastructure or a production SLA.

## Current state

- `main` includes the private `PgMobilityStore.findCandidates()` query, two ST_DWithin geography predicates, GiST indexes, unique active intent, and 30/hour shared PostgreSQL per-user matching rate buckets. No dedicated 100+ simultaneous-student benchmark or resource evidence has been added.
- PR #14 contains a UI and passed synthetic browser QA at `bc06f6d`; remains draft, unmerged and not an authority to deploy.
- Staging and production Render have not been modified in this task. Migration 008 remains blocked pending independently restored database and rollback proof.

## Plan

1. Claim new independent perf branch based on current main, avoiding PR #14.
2. Implement deterministic synthetic fixture creation with strict env and localhost/dedicated DB guard, no destructive DROP/TRUNCATE, own-ID cleanup in finally; do not use real student data.
3. Run **128 simultaneous** matching calls through the current PostGIS store (pool of 24), validate result privacy and cap, record latency percentiles and pool/PG metrics, capture a representative EXPLAIN plan.
4. Verify existing shared PostgreSQL matching search throttle still denies search #31 for one synthetic account. Add pure helper/unit tests and a GitHub Actions PostgreSQL/PostGIS CI service. Keep run logs/artifacts aggregates-only.
5. Record actual CI evidence, limitations, tradeoffs and next action in agent docs. Do not merge or deploy without review.

## Progress log

- 2026-11-04 UTC — Inspected `main`, PR #14 and docs; selected the unassigned P1 benchmark instead of touching blocked production release or PR #14. Created `perf/mobility-load-baseline-2026-11-04` from `3ee1f4a`.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Pure safety + percentile helper tests | `npm run test:mobility-bench` in #41710272878 | PASS |
| Synthetic concurrent matching, 128 requests | #41710272878; 512 synthetic rides, 24 pool connections | PASS: 128/128, p50=229.11ms, p95=297.87ms, p99=300.88ms |
| PostgreSQL shared 30/hour rate bucket check | #41710272878, 35 parallel operations on one account | PASS: 30 allowed, 5 denied, durable count 30 |
| PostgreSQL/PostGIS + security + agent-doc CI | #41710272720, #41710273292, #41710272608, #41710272767 | ALL PASS |
| Production/staging load | Never run | Not authorized |

## Risks and decisions

- This is a **DB-layer** microbenchmark, not full HTTP, real provider OTP, Render network latency, user-device response time, mixed writes, sustained throughput or real-world route verification. Do not mislabel as a capacity guarantee.
- Synthetic spatial distribution and CI host CPU differ from campus traffic and production database. Record runner environment, dataset, pool max and queries in the report.
- Benchmark requires an explicit flag, loopback *client URL*, exact dedicated database/role and empty benchmark tables; Docker can expose a different server-side bridge interface, so that is not a reliable security boundary. No arbitrary destructive SQL or copy of production data.
- Rate bucket and geospatial checks use the same store as the app, no mock of ranking or throttling. No new runtime infrastructure.
- `DECISIONS.md`: keep Redis/H3 deferred until measurements under realistic staged hardware and load show a need.

## Next steps

1. **Next action:** create benchmark and unit safety tests, run CI, fix reproducible issues.
2. **Who may do it:** engineering agent for isolated development; independent reviewer for code evaluation; operations owner for separately approved live staging only.
3. **Prerequisites and blockers:** only isolated CI PostGIS allowed; live staging needs backup/restore+rollback approval and is out of scope.
4. **Expected evidence:** obtained for synthetic DB-layer burst (128/128, p95=297.87ms, plan/index metadata, 30 allowed / 5 denied, green CI); independent representative staging/hardware review remains required.
5. **Production impact:** none, no merge, migration or deployment.

## Links and files changed

- Branch: `perf/mobility-load-baseline-2026-11-04` off main
- Existing UI PR: #14 (not a dependency for DB-level benchmark)
- Paths: `bench/mobility-load.js`, `bench/mobility-load.test.js`, `.github/workflows/mobility-load-benchmark.yml`, `package.json`, `docs/agents/{STATUS,NEXT_STEPS,DECISIONS}.md`, this task

## Measured CI checkpoint — 2026-11-03 20:12 UTC

- **Implementation SHA:** `da7063afa40f46143eba2545c6d15c461eddc36e`; benchmark GitHub Actions run [#41710272878](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41710272878) PASSED, report [aggregate-only artifact](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41710272878/artifacts/13266692837) (7-day retention).
- **Scenario:** PostgreSQL 16 / PostGIS 3.4 on GitHub 4-CPU Linux runner, 128 simultaneous synthetic student queries, 512 synthetic geocoded rides, 24-connection application pool, deterministic random seed 4096. All 128 queries succeeded and all had matching candidates (1,280 bounded candidate cards). This is DB-level matching, not complete HTTP or real mobile E2E.
- **Latency and burst rate:** p50 **229.11ms**, p95 **297.87ms**, p99 **300.88ms**, max 301.64ms, total 302.01ms and **423.83 queries/s** over this single burst; this is not sustainable throughput or a production SLA.
- **Pool and database:** peak client queue **104**, max application connections **24**, monitoring max active PostgreSQL sessions **25**, sampled lock waiters **0**, Node.js CPU user 126.09ms / system 23.06ms (not PostgreSQL server CPU), RSS 67.13 MiB. `pg_stat_database` deltas are approximate (asynchronous counters).
- **Representative plan:** EXPLAIN ANALYZE execution **1.70ms**, planning **0.64ms**; used `campus_ride_geo_dropoff_gist_idx` + `campus_rides_pkey`; 409 matched geocoded ride rows in the dense synthetic distribution. One student-intent Seq Scan is reasonable at tiny input size but not evidence about larger deployments.
- **Shared-rate contention:** 35 simultaneous `PgOtpStore.rate` operations on the same synthetic identity => **30 allowed, 5 rejected** with durable count 30 (17.55ms). Backend policy remained enabled and unmodified.
- **CI:** Stage 1 PG/PostGIS #41710272720, security #41710273292, credentials #41710272608, agent docs #41710272767 all PASS on the implementation SHA.
- **Diagnostics corrected during development:** CI container server interface is not a reliable network isolation check and the first synthetic-intent SQL fixture had one missing value placeholder; both were fixed. The final benchmark requires a loopback client URL, dedicated empty DB, exact role and explicit opt-in, with own-ID cleanup. No SQL/secret details appear in failure logs.
- **Architectural decision:** Redis/H3/microservices still deferred. The 104 queued requests demonstrate burst pool saturation under 128 callers but no sampled DB lock contention; investigate sustained throughput and representative staging hardware before scaling infrastructure. Not a feature release.
