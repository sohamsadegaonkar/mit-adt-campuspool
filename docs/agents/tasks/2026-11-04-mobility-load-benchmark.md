# Task: Reproducible PostGIS concurrency and abuse-control benchmark

- **Task ID / file:** `2026-11-04-mobility-load-benchmark`
- **Status:** in progress — isolated benchmark implementation/CI pending
- **Agent / owner:** ChatGPT engineering agent; independent reviewer unassigned
- **Last updated:** 2026-11-04 UTC
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
| Pure safety + percentile helper tests | `npm run test:mobility-bench` | Pending |
| Synthetic concurrent matching, 128 requests | Dedicated GitHub disposable PostGIS service | Pending |
| PostgreSQL shared 30/hour rate bucket check | Same disposable PostGIS | Pending |
| PostgreSQL/PostGIS + security + agent-doc CI | PR GitHub Actions | Pending |
| Production/staging load | Never run | Not authorized |

## Risks and decisions

- This is a **DB-layer** microbenchmark, not full HTTP, real provider OTP, Render network latency, user-device response time, mixed writes, sustained throughput or real-world route verification. Do not mislabel as a capacity guarantee.
- Synthetic spatial distribution and CI host CPU differ from campus traffic and production database. Record runner environment, dataset, pool max and queries in the report.
- Benchmark must refuse anything but a specifically named dedicated localhost database even if environment flags are supplied. No arbitrary destructive SQL or copy of production data.
- Rate bucket and geospatial checks use the same store as the app, no mock of ranking or throttling. No new runtime infrastructure.
- `DECISIONS.md`: keep Redis/H3 deferred until measurements under realistic staged hardware and load show a need.

## Next steps

1. **Next action:** create benchmark and unit safety tests, run CI, fix reproducible issues.
2. **Who may do it:** engineering agent for isolated development; independent reviewer for code evaluation; operations owner for separately approved live staging only.
3. **Prerequisites and blockers:** only isolated CI PostGIS allowed; live staging needs backup/restore+rollback approval and is out of scope.
4. **Expected evidence:** 128 concurrent search completions, bounded candidates/privacy, aggregate percentiles + plan, controlled 31st shared-rate rejection, green CI.
5. **Production impact:** none, no merge, migration or deployment.

## Links and files changed

- Branch: `perf/mobility-load-baseline-2026-11-04` off main
- Existing UI PR: #14 (not a dependency for DB-level benchmark)
- Paths: `bench/mobility-load.js`, `bench/mobility-load.test.js`, `.github/workflows/mobility-load-benchmark.yml`, `package.json`, `docs/agents/{STATUS,NEXT_STEPS,DECISIONS}.md`, this task
