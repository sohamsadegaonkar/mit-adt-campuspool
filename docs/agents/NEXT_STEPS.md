# CampusPool — prioritized next steps and ownership

**Last prioritized:** 2026-11-03 UTC. **Baseline:** `main@0345b6aeff86`. Items are an actionable backlog, **not authorizations** to alter Render production, student data, SMS/email accounts or payment systems.

| Priority | Work item | Current state | Next concrete action | Acceptance / evidence | Owner |
|---|---|---|---|---|---|
| P0 | Close historical credential incident | Unverified account-side revocation | Account owner confirms revoked Gmail App Password, regenerated OTP secret and private Render replacement; review access logs | Dated verification, no raw secrets in Git/logs, controlled provider test | Account owner |
| P0 | Genuine provider OTP verification in staging | Adapter and CI mock tests exist | Configure verified Resend sender/domain and approved MSG91/DLT Flow in isolated staging, then test controlled end-to-end signup/login | Actual inbox/handset receipt, expiry/replay/resend and provider failure checks | Unassigned |
| P0 | Durable production Rides plan | PostgreSQL Rides implementation exists behind flag; production on SQLite | Inventory existing data; design consistent backup/export, UUID reconciliation, staging import and cold restore | Recorded counts/hashes, ownership continuity, proven forward+rollback | Unassigned |
| P0 | Security and release QA | Automated backend tests green | Execute browser/phone E2E on a reviewed staging deploy with test users and adverse concurrency cases | Test report with exact deployed SHA and resolved high-severity defects | Unassigned |
| P1 | Hyperlocal travel-intent frontend | Private PostGIS matching API exists; no integrated UI | Add authenticated travel-intent form, privacy-safe candidate cards and booking handoff behind flag | UI/mobile/E2E tests, no raw student coordinates or contacts leaked | Unassigned |
| P1 | Realistic route-aware matching | Geometric straight-line proximity only | Evaluate road-routing provider, cost caps, route detour bounds and fallbacks | Costed design + test comparing sample ground-truth routes | Unassigned |
| P1 | Mobility load and fraud benchmark | Independent PR #15 measured 128/128 synthetic PostGIS matches and 30/35 enforced shared rate limits; no real staging benchmark | Independently review #41710272878 (p95 297.87ms, queue peak 104, no sampled DB locks), then design representative sustained HTTP/staging-safe workload with restoration gates | Aggregate-only report in GitHub Actions, code SHA, decision memo; no Redis/H3 based on synthetic CI alone | Engineering agent / reviewer |
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

## Latest completed documentation task

See [2026-11-03-agent-workflow.md](tasks/2026-11-03-agent-workflow.md) for the multi-agent continuity-policy bootstrap and its verification/handoff.

## P1 performance measurement, isolated from blocked staging — 2026-11-04 UTC

- [128-student mobility/PostGIS concurrency benchmark](tasks/2026-11-04-mobility-load-benchmark.md) is implemented **only** on `perf/mobility-load-baseline-2026-11-04` based on main. It creates 512 deterministic synthetic rides and 128 unique active intents; bursts 128 actual `PgMobilityStore.findCandidates` calls, checks result privacy/counts, and races 35 shared rate-bucket increments to verify the 30/hour account ceiling under contention.
- **Next engineering action:** verified run #41710272878 passed on `da7063a`: 128/128 successful, 512 synthetic rides, p50/p95/p99 **229.11/297.87/300.88ms**, ~**424/s** burst, pool wait queue104/24 connections, no sampled DB lock waits, dropoff GiST index selected, 30 allowed/5 denied on concurrent rate increments. Independently review report and construct a sustained, representative HTTP + DB workload before changing indexes or adopting Redis/H3. Do not deploy, merge, add Redis/H3, touch protected staging databases or enable live matching.
- **Independently blocked release:** draft PR #14's UI approval, staging backup/restore/cold recovery and Render rollback, historical credentials and OTP delivery remain separate P0 gates.

## Most recent user-requested merge/Render deployment audit — 2026-11-03 UTC

- **Merged and verified:** independent performance PR #15 is now merged into `main@a76eaca`, not deployed; `main` PostgreSQL, credential-hygiene and docs workflows passed. [Release audit and step-by-step gates](tasks/2026-11-04-release-merge-audit.md).
- **Still open:** PR #11 transactional idempotency includes migration 008, with dependent PR #12 read-only restore comparison and PR #13 data-integrity digests; all require dependency-order independent review and owner-operated *actual* encrypted staging backup, independent off-site re-download/checksum/decrypt/PG17 restore, comparison and retained Render rollback proof. PR #14 has 30/30 synthetic browser E2E green but awaits independent reviewer/privacy/physical-device acceptance. None were merged in this audit.
- **STOP on Render deploy:** both production and staging auto-deploy are OFF; live SHAs `63ae551` and `cceadbf` respectively. Connected staging DB lists migrations 001–007 (no 008) and is healthy; this is not a backup. Historical credential revocation and genuine email/SMS delivery still need account owner verification. Neither `trigger_deploy` (which deploys configured main) nor staging migration may run without the recovery proof and a **separate, explicit GO**. Do not infer that this user's request to deploy waives data protection and rollback.
- **Next exact responsible actions:** owner privately proves secure off-site stage export and independently restored scratch + Render retained rollback artifact; independent reviewer approves PR #11–#14 scope; operator reviews candidate SHA, then performs a controlled staging-only test release after prerequisites. Production remains separately blocked by legacy SQLite durability, revoked secret verification, true OTP delivery and business safety acceptance. See [release audit task](tasks/2026-11-04-release-merge-audit.md).

## New Flutter client handoff — 2026-11-04 UTC (branch only)

- **P1 / UI review:** [Flutter/Figma Phase 1](tasks/2026-11-04-flutter-figma-ui.md) lives only on `feat/flutter-campuspool-figma-ui-2026-11-04` and does not alter the production web app. **CI verified:** Flutter 3.47.7 analyzer and **6/6 tests pass** in [run #41790737256](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41790737256). **Next:** generate/review Android/iOS shells using `flutter create`, check real phone/tablet/browser screenshots, accessibility and reduced motion, then obtain independent PR review.
- **After approval only:** design session-based Node API client integration with CSRF, ownership and ride-match privacy guards. Errands, verified pricing, tip top-ups and UPI remain disabled until server implementations and trusted provider callbacks exist. Do not deploy or merge this client as a production release by inference.

## Flutter Phase 2 (stacked, not in main) — 2026-11-04 UTC

- [Phase 2 ride feed / loading states + platform build](tasks/2026-11-04-flutter-phase2-platform-states.md): `feat/flutter-phase2-platform-states-2026-11-04` is stacked on draft PR #17 and **does not deploy**. Next: verify Flutter CI and downloadable web/debug Android artifacts, run manual emulator/browser responsive and reduced-motion checks, then review real session transport/cookie scoping and privacy. Do **not** wire the simulated signed-in preview to actual protected endpoints.
- Separate approved work would be needed for a real verified OTP/session flow, Android secure cookie storage, iOS signing, actual rides inventory integration, and errands/payment backend. Existing P0 release blockers retain priority.
