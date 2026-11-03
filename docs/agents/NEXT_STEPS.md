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

## Latest completed documentation task

See [2026-11-03-agent-workflow.md](tasks/2026-11-03-agent-workflow.md) for the multi-agent continuity-policy bootstrap and its verification/handoff.

## Independent P1 development handoff — authenticated mobility UI (2026-11-03 UTC)

- [Feature-gated mobility intent panel](tasks/2026-11-03-mobility-intent-ui.md): new unmerged `feature/mobility-intent-ui-2026-11-03` branch off `main`, separate from nested security PRs #11–13. Implements the previously missing student-facing request, cancellation, private geometric candidate cards, existing booking handoff and optional opt-in geocoded driver offer fields (default off), without revealing raw GPS or contact data in candidate cards. Staging-only backend flag remains OFF by default; this is **not a deployed feature**.
- **Next engineering action:** PR #14 latest driver+student feature tests passed at `30e4fc2` (security #41637089366, PostGIS #41637089296, credential hygiene #41637089125, agent docs #41637089162). An initial follow-up test syntax issue was corrected; no browser or live-staging test has occurred. Independently audit accessibility/mobile UX, session hide/reveal and map privacy, then run verified-student browser E2E against a separately authorized staging build. Do not enable public matching, migrate 008 or bypass the owner-operated backup/restore and rollback gates. Future route-aware matching and load benchmarking remain open; do not adopt Redis/H3 until measured evidence warrants it.

## New QA gate — real-browser mobility checks (2026-11-04, PR #14)

- [Disposable Chromium/Firefox/WebKit browser QA](tasks/2026-11-04-mobility-browser-qa.md) added on the unmerged mobility feature branch. The source review also fixed a real ride-ID contract mismatch: `ride_<uuid>` from PostgreSQL was rejected by candidate/booking UI guards. No staging or production service was touched.
- **Immediate action:** code commit `810ad64` PASSED browser E2E run #41701113565 (**21/21** across Chromium, Firefox, mobile WebKit), alongside all four standard CI checks. Obtain independent usability/privacy and keyboard/physical-mobile review, then separately authorized staging E2E; collect exact deployed SHA and rollback evidence before any rollout. Synthetic user sessions bypass real OTP provider delivery and cannot substitute for approved staging E2E. Keep PR #14 draft and release/migration 008 blocked until separately documented owner approval.
