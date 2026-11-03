# CampusPool — prioritized next steps and ownership

**Last prioritized:** 2026-11-03 UTC. **Baseline:** `main@3ee1f4a12e98`. Items are an actionable backlog, **not authorizations** to alter Render production, student data, SMS/email accounts or payment systems.

| Priority | Work item | Current state | Next concrete action | Acceptance / evidence | Owner |
|---|---|---|---|---|---|
| P0 | Verify transactional request idempotency | New bounded replay code passed isolated CI at `3c050be`; PR #11 still unmerged/not staged | Independently review read-only replay under load, PG role/RLS permissions and browser key lifecycle; only after approval plan staging migration 008 | Green CI runs 41588934566/34664/34558/34552; independent review, controlled staging E2E and rollback still required | ChatGPT engineering agent (branch only) |
| P0 | Close historical credential incident | Unverified account-side revocation | Account owner confirms revoked Gmail App Password, regenerated OTP secret and private Render replacement; review access logs | Dated verification, no raw secrets in Git/logs, controlled provider test | Account owner |
| P0 | Genuine provider OTP verification in staging | Adapter and CI mock tests exist | Configure verified Resend sender/domain and approved MSG91/DLT Flow in isolated staging, then test controlled end-to-end signup/login | Actual inbox/handset receipt, expiry/replay/resend and provider failure checks | Unassigned |
| P0 | Durable production Rides plan | PostgreSQL Rides implementation exists behind flag; production on SQLite | Inventory existing data; design consistent backup/export, UUID reconciliation, staging import and cold restore | Recorded counts/hashes, ownership continuity, proven forward+rollback | Unassigned |
| P0 | Security and release QA | Automated backend tests green | Execute browser/phone E2E on a reviewed staging deploy with test users and adverse concurrency cases | Test report with exact deployed SHA and resolved high-severity defects | Unassigned |
| P1 | Hyperlocal travel-intent frontend | Private PostGIS matching API exists; no integrated UI | Add authenticated travel-intent form, privacy-safe candidate cards and booking handoff behind flag | UI/mobile/E2E tests, no raw student coordinates or contacts leaked | Unassigned |
| P1 | Realistic route-aware matching | Geometric straight-line proximity only | Evaluate road-routing provider, cost caps, route detour bounds and fallbacks | Costed design + test comparing sample ground-truth routes | Unassigned |
| P1 | Mobility load and fraud benchmark | CI indexes + basic shared PostgreSQL limits | Create isolated 100+ concurrent-user benchmark, record p95, CPU, locks, query plans and rate-limit behavior | Reproducible report; decide whether optimizations beat Redis/H3 | Unassigned |
| P2 | Errands backend | Standalone sample UI only | Specify request/runner/assignment state machine, roles, PIN handover, notifications and abuse model | Reviewed domain design + server-side integration tests with mock payments | Unassigned |
| P2 | Payment partner readiness | Unverified payment settlement disabled | Review eligible regulated payout provider and settlement/refund flows, not a homegrown escrow | Provider eligibility, signed webhook tests, ledger/reconciliation and approval | Unassigned |
| Conditional | Redis, H3, background queue or microservices | **Deferred**; no performance justification recorded yet | Revisit on evidence: slow spatial query, hot shared limits, reliable notification demand, or independent scaling | ADR with benchmarks, cost, added operational risks, rollback | Unassigned |

## Sequencing rules

- **Security and durable data first;** do not treat GitHub merge as production approval.
- Build the Hyperlocal matching UI and road-route verification on isolated staging before exposing it to students.
- Add a PostgreSQL transactional outbox/background worker before a high-volume external queue if reliability requirements demand asynchronous work.
- **Do not add Redis, H3, Kafka or microservices merely because they are well-known system-design tools.** First measure the real bottleneck and capture an accepted decision in `DECISIONS.md`.

## For the next agent

1. Inspect GitHub HEAD, new PRs, CI and exact staging deployment commit; do not trust this timestamp as real-time.
2. Choose a specific unassigned item, create `docs/agents/tasks/YYYY-MM-DD-<slug>.md`, record an explicit scope and owner, and coordinate changes with active PRs.
3. Update progress in the task file and keep these priorities aligned with verified reality on each implementation PR.
4. If no credentials, authority, safe environment or rollback evidence exist, mark the task blocked instead of improvising a production action.

## Active agent handoff

- [Transactional request idempotency](tasks/2026-11-03-transactional-idempotency.md): draft PR #11 has green GitHub CI at `a2e231b`; bounded throttled replay passed CI at `3c050be`; next independently review permissions/browser retry lifecycle and migration/rollout, then complete separately authorized staging QA before treating as deployed. No live migration authorized.

## Latest completed documentation task

See [2026-11-03-agent-workflow.md](tasks/2026-11-03-agent-workflow.md) for the multi-agent continuity-policy bootstrap and its verification/handoff.
