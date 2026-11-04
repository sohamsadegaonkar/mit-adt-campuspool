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
| A-010 | Proposed (synthetic evidence recorded; not infrastructure approval) | Keep existing PostGIS architecture while collecting representative scale evidence | PR #15 run #41710272878: 128/128 burst, p95 297.87ms, queue 104 with pool24, no sampled lock waits, GiST plan used, 30/35 throttled; synthetic CI is insufficient for a Redis/H3 decision | Representative staging hardware, sustained HTTP and mixed write/read workload, independent review |

| A-011 | Implemented in source behind migration gate | Require per-operation client idempotency keys with durable SQL receipts on business mutations | Duplicate booking/cancel responses and ride creation lack exact retry guarantees; store response in same DB transaction | After CI and bounded replay-probe validation, staging migration and browser/device tests. New HTTP writes remain rate-limited; completed-key read-only probes are separately capped at 12/IP/minute on the unmerged branch. Do NOT apply generic replay to OTP proof/session or external payment/webhook calls |

| A-013 | Source-only optional client | Keep Flutter separate from existing Node web frontend | UI mock tests; no real payment/booking | Real mobile provider/device QA and accessibility |
| A-014 | Source-only read-only adapter | Gate Flutter ride listings behind verified server session | No client-side auth state trust | Backend contact-data minimization and rollout acceptance |
| A-015 | Source-only auth boundary | Flutter OTP/cookie sessions remain server-verified and memory-limited | Existing Node is credential/CSRF authority | Real OTP provider and platform cookie review |
| A-016 | Disabled-by-default optional feature | Server-side Google Places proxy with per-IP/global budget guards | Avoid embedding billable key in mobile app | Owner billing/key/provider privacy approval |
| A-017 | Source-only UX hardening | Cap mobile suggestions and reject invalid daily provider budget | Prevent uncontrolled quota and keyboard overlap | Real-device and provider quota acceptance |

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

### A-010 — Synthetic PostGIS burst baseline is not a Redis/H3 adoption trigger
- **Date / owner / task:** 2026-11-04 IST; engineering agent. [Task](tasks/2026-11-04-mobility-load-benchmark.md), PR #15. No operational adoption approval.
- **Status:** proposed: measure realistic production-equivalent load before changing infrastructure.
- **Measured baseline:** Isolated GitHub runner (4 CPUs), PostGIS 16/3.4, 128 concurrent `PgMobilityStore.findCandidates()` calls over 512 synthetic rides, pool max 24. #41710272878: p50 229.11ms, p95 297.87ms, p99 300.88ms, 423.83/s single-burst rate; queue peak 104, no sampled DB lock waiters, PostGIS dropoff GiST index selected in representative query. Shared PostgreSQL rate limiter rejected five of 35 concurrent attempts by one account.
- **Interpretation and alternatives:** The burst queue reflects application pool contention, not yet a database bottleneck requiring Redis or microservices. Sample 11 monitoring intervals cannot rule out short lock contention. Next compare pool sizing/backpressure, spatial selectivity, query and index tuning, sustained reads+writes, and cost/headroom on approved representative hardware. H3 can be considered for aggregation only if a real need appears; it does not replace road-route verification or PostGIS.
- **Privacy, cost and safety:** No production, staging, personal data or provider billing. The isolated test bypasses HTTP/auth network overhead, does not reproduce campus travel demand, and uses a database admin role for CI; it is not a student-facing latency SLA. Do not copy staging data into CI.
- **Next decision trigger:** Independent benchmark review and signed-off sustained API + DB acceptance on isolated staging with recovery and rollback evidence. Otherwise keep the single PostGIS-backed modular monolith.

## A-012 — Conditional staging rollout requires off-site restore proof (2026-11-03 UTC)

- **Status:** conditional/blocked; [task](tasks/2026-11-03-staging-permissions-browser-retry.md), draft PR #11.
- **Evidence:** Supabase Free staging PG role is non-superuser/non-bypassrls, app tables RLS protected, source migration 008 not applied, seven critical tables empty. Browser retry across same-tab reload and SQL impersonated-role tests passed isolated CI at `282df2c`.
- **Choice:** Do not apply 008 or deploy until there is an encrypted off-site dump, independently tested restore and a confirmed exact Render staging release/previous-artifact rollback mechanism. Supabase Free does not guarantee automatic daily snapshots.
- **Rollback:** return app to verified prior deploy and retain additive 008 table; do not DROP active receipts to undo application code. A destructive DB restore requires independent approval, downtime/data-loss review.
- **Revisit:** after operator provides verified off-site backup integrity, scratch restore result, selected Render workspace/service/branch and rollback SHA.

## A-013 — Flutter as a separate optional client (proposed in branch, 2026-11-04)

- **Problem:** implement CampusPool's new mobile-first Figma interface in Flutter/Dart without destabilizing the live Node/static web service.
- **Choice:** create `flutter_app/` as an independent cross-platform UI scaffold. Keep existing Node API and website unchanged. The Flutter demo contains no live payment, verification, booking or student-data operation.
- **Alternatives:** wholesale replacement of current frontend (rejected: release/auth regression risk); React-native client (rejected for this task: user expressly selected Flutter/Dart).
- **Trade-offs:** separate UI implementation to maintain and test; Android/iOS platform scaffolds and accessibility review pending; backend API adapters require formal contracts.
- **Validation and rollback:** run Flutter analyze/test/device QA in its own CI; branch-only change can be abandoned without any production rollback. [Task handoff](tasks/2026-11-04-flutter-figma-ui.md).

## A-014 — Keep Flutter ride feed authenticated and read-only (proposed in stacked branch, 2026-11-04)

- **Decision:** Flutter gets an injected read-only adapter that first verifies the existing `/api/auth/me` server session, then reads `/api/rides`; guest and synthetic signed-in preview states do not trigger a network request. Never implement authentication by toggling local UI state.
- **Data minimization:** map only ride ID, generic pickup/destination, departure, vehicle and seat count into UI. Discard driver email, phone, payment handle and free-form notes currently present in legacy backend responses. Future backend privacy review is still required.
- **Alternatives rejected for now:** new public rides endpoint (would weaken server auth), direct client Postgres access (unacceptable), native cookie/token storage without provider/session review (premature).
- **Validation/rollback:** Mock HTTP tests, session/late-result controller checks, Flutter CI/web/debug build; abandon stacked branch without affecting current web/Node deployment. [Task](tasks/2026-11-04-flutter-phase2-platform-states.md).

## A-015 — Verified OTP/cookie session required for Flutter login (branch proposal, 2026-11-04)

- **Decision:** use existing email OTP and `/api/auth/me` instead of local preview state as authentication. Node remains sole credential/CSRF authority. The Flutter app never stores OTP/cookie/CSRF in preferences or URLs. Native cookie remains memory-only; Web requires same-origin. All data loads remain read-only and require server verification.
- **Rejected:** fake sign-in via UI state, persistent client cookies without security review, cross-origin credentialed CORS changes, direct database access, and exposing legacy ride contact/UPI fields.
- **Verification and rollback:** mocked OTP/session/cookie/logout tests; CI compile. Abandon stacked feature branch to roll back with no Node or production changes. [Task](tasks/2026-11-04-flutter-session-login.md).

- **Phase 3 security follow-up (2026-11-04):** Legacy SQLite `login-request` returns account-dependent status and profile fields. The Flutter client rejects such non-generic acknowledgement bodies and refuses to authenticate against them, but this does **not** make the existing server endpoint non-enumerating. Real rollout requires verified Postgres OTP backend, real provider delivery, server response minimization and independent security acceptance. [Task](tasks/2026-11-04-flutter-session-login.md).

## A-016 — Real, cost-capped destination predictions via optional server proxy (proposed, 2026-11-04)

- **Problem:** plain Flutter ride-destination text input gives no address confidence; request a Rapido/Uber-style suggestion dropdown.
- **Choice:** Google Places API (New) prediction + details using secure session tokens, Pune-biased India search and a private server key. Flutter cannot directly embed an unrestricted Google key. A guest-readable read-only proxy with per-IP and global instance-level caps remains OFF until owner approves billing/attribution/privacy. Explicit coordinate confirmation required after selecting a suggestion.
- **Rejected:** free-text route destinations treated as geocoded addresses; Nominatim public instance as per-keystroke autocomplete (not compliant with public usage); unrestricted direct Google Places calls from APK; cached prediction lists and made-up example addresses in real UI.
- **Rollback:** discard branch; default-off flag requires no production rollback, credentials or DB mutation. Tests in `test_places_autocomplete.js` and Flutter widget/HTTP tests. [Task](tasks/2026-11-04-flutter-place-autocomplete.md).

## A-017 — bounded mobile suggestions + fail-closed provider budget (branch proposal, 2026-11-04)

- **Problem:** long prediction lists could be buried by Android IME; per-instance Places budget previously clamped values below 20 up to 20, preventing cautious one-request QA.
- **Choice:** cap/scroll suggestion items while keeping attribution visible; support keyboard Search selection and 80-character input maximum. Parse the daily cap strictly (1–1000) only when opt-in feature is enabled; reject invalid limits rather than silently raising them.
- **Caveat:** local shared rate limiter is not a Google Cloud billing cap; external quotas/alerts and provider terms/privacy reviews remain mandatory. No live testing or credential changes. [Task](tasks/2026-11-04-flutter-places-mobile-qa.md).
