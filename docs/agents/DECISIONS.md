# Architecture and engineering decision register

**Updated:** 2026-11-03 UTC. Track observed/accepted implementation decisions separately from **proposals**. For significant changes, add a dated entry with problem, alternatives, evidence, decision owner, tradeoffs, test/rollback plan and links to tasks/PRs.

| ID | Status | Decision | Rationale / evidence | Revisit when |
|---|---|---|---|---|
| A-001 | Implemented in source | Keep Node.js HTTP API as one application with separate domain modules | Existing server and PG module structure; lower deployment cost than premature microservices | Independent team/deploy/scaling or fault isolation genuinely required |
| A-002 | Implemented behind flag | PostgreSQL for auth, Rides and transactional state | Atomic sessions, seat locks and consistent ownership; SQLite on Render Free is ephemeral | Production migration audit and backups remain blocked |
| A-003 | Implemented behind flag | PostGIS GiST + `ST_DWithin` for private geometric ride candidates | Indexed spatial/time queries and isolated tests exist | Real road-routing, privacy review and p95 load benchmarks |
| A-004 | Implemented | Keep approximate 0.01° grid and 15-minute buckets; do **not** claim H3 is in use | Simple indexing exists; not uniform meter-sized cells or road topology | Large-area hierarchical aggregation/search proven necessary |
| A-005 | Current operational choice | Production and staging deploy manually, no auto-deploy | Render metadata shows both auto-deploy off; controlled release gate | Approved release process with reliable rollback |
| A-006 | Security requirement | Do not trust client-reported payment/commission completion | Verified provider webhook, refunds and settlement flow absent | Authorized provider and independently tested webhook/ledger |
| A-007 | Deferred, not rejected forever | Do not add Redis now | PostgreSQL currently handles shared limits; no measured bottleneck | Sustained DB hotspots, cache churn or global throttling need proven |
| A-008 | Deferred, not rejected forever | Do not add Kafka/microservices now | Single-campus product and one Node backend; unnecessary distributed ops | High sustained asynchronous event volume, independent scaling/isolation |
| A-009 | Proposed (not implemented) | Prefer PostgreSQL transactional outbox + worker as first reliable async step | Atomic event recording with core DB, fewer moving parts | Measured notification/retry need and benchmark/cost review |
| A-010 | Proposed measurement, not infrastructure approval | Establish disposable 128-user PostGIS baseline before Redis, H3 or service splitting | PR on isolated perf branch records reproducible latency, pool, planner and PostgreSQL rate-bucket evidence; no CI results yet | Representative staging hardware, production-like anonymous workload, sustained mixed write/read and independent review |

## Decision rule for adding infrastructure

1. Reproduce and quantify the problem: request rate, p50/p95/p99, database load, query plans, contention, queue delay, privacy risk or failure case.
2. Evaluate low-complexity options first (index, bounded query, batching, cache-control, Postgres outbox and worker).
3. Compare Redis vs PostgreSQL counters, H3 vs existing grid+PostGIS, dedicated microservice vs modular API, and managed queue vs Postgres outbox with operational estimates.
4. Define measurable adoption criteria, failure behavior, migration and rollback before creating external infrastructure or handling production data.
5. Record the result here as `proposed`, `accepted`, `implemented`, `rejected`, or `superseded` with a dated link.

## Decision template

```md
### A-XXX — <Title>
- Date / owner / task or PR:
- Status: proposed | accepted | implemented | rejected | superseded
- Context and measured evidence:
- Alternatives and tradeoffs:
- Chosen approach and why:
- Security, privacy, cost and deployment impact:
- Tests and rollback:
- Next review trigger:
```
