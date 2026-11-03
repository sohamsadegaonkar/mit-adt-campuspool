# CampusPool — prioritized next steps and ownership

**Last prioritized:** 2026-11-03 UTC. **Baseline:** `main@0345b6aeff86`. Items are an actionable backlog, **not authorizations** to alter Render production, student data, SMS/email accounts or payment systems.

| Priority | Work item | Current state | Next concrete action | Acceptance / evidence | Owner |
|---|---|---|---|---|---|
| P0 | Close historical credential incident | Unverified account-side revocation | Account owner confirms revoked Gmail App Password, regenerated OTP secret and private Render replacement; review access logs | Dated verification, no raw secrets in Git/logs, controlled provider test | Account owner |
| P0 | Genuine provider OTP verification in staging | Adapter and CI mock tests exist | Configure verified Resend sender/domain and approved MSG91/DLT Flow in isolated staging, then test controlled end-to-end signup/login | Actual inbox/handset receipt, expiry/replay/resend and provider failure checks | Unassigned |
| P0 | Durable production Rides plan | PostgreSQL Rides implementation exists behind flag; production on SQLite | Inventory existing data; design consistent backup/export, UUID reconciliation, staging import and cold restore | Recorded counts/hashes, ownership continuity, proven forward+rollback | Unassigned |
| P0 | Security and release QA | Automated backend tests green | Execute browser/phone E2E on a reviewed staging deploy with test users and adverse concurrency cases | Test report with exact deployed SHA and resolved high-severity defects | Unassigned |
| P1 | Hyperlocal travel-intent frontend | Draft PR #14 has the integrated UI; synthetic 30/30 browser QA passed, NOT deployed | Get independent human privacy/security/accessibility review, then approved staging E2E and physical-phone checks | Verified reviewer signoff + deployed SHA + no raw coordinate/contact leak + rollback evidence | Engineering reviewer / staging owner |
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
- **Historical baseline:** PR #14's initial UI tests passed on `30e4fc2`; subsequent synthetic browser QA and privacy hardening are now documented in the later checkpoint below. No authorized staging browser test or physical-device acceptance has occurred. Independently audit accessibility/mobile UX and provider privacy, then run verified-student browser E2E against a separately authorized staging build. Do not enable public matching, migrate 008 or bypass the owner-operated backup/restore and rollback gates. Future route-aware matching and load benchmarking remain open; do not adopt Redis/H3 until measured evidence warrants it.

## New QA gate — real-browser mobility checks (2026-11-04, PR #14)

- [Disposable Chromium/Firefox/WebKit browser QA](tasks/2026-11-04-mobility-browser-qa.md) added on the unmerged mobility feature branch. The source review also fixed a real ride-ID contract mismatch: `ride_<uuid>` from PostgreSQL was rejected by candidate/booking UI guards. No staging or production service was touched.
- **Immediate action:** code commit `810ad64` PASSED browser E2E run #41701113565 (**21/21** across Chromium, Firefox, mobile WebKit), alongside all four standard CI checks. Obtain independent usability/privacy and keyboard/physical-mobile review, then separately authorized staging E2E; collect exact deployed SHA and rollback evidence before any rollout. Synthetic user sessions bypass real OTP provider delivery and cannot substitute for approved staging E2E. Keep PR #14 draft and release/migration 008 blocked until separately documented owner approval.

## Latest reviewed PR #14 checkpoint — browser state and accessibility (2026-11-03 19:38 UTC)

- [Mobility session-race, map and keyboard hardening](tasks/2026-11-04-mobility-ui-hardening.md) is implemented on the **unmerged draft** `feature/mobility-intent-ui-2026-11-03` branch. Tested code SHA: `76cd1a414bb942086ed7c81ba41c82835f58c19f`.
- **Verified isolated tests:** **30/30 browser cases PASS**, run #41704799368, for Chromium desktop, Firefox desktop and mobile WebKit; security #41704799389 PASS, PostgreSQL/PostGIS #41704799073 PASS, credential hygiene #41704799185 PASS, agent docs #41704799301 PASS. Browser regressions added for delayed successful matching after logout (discard stale response), DOM/form time clearing, genuine opt-in Leaflet map clicks with stubbed tiles and keyboard request creation/cancellation.
- **Immediate responsible action:** an *independent human* should review PR #14 (state race/CSRF, location privacy and retention, accessibility and mobile, failure paths, opt-in semantics and test harness) and record review approval or requested changes. No independent approval was recorded at task start. Engineering can continue isolated static/browser regression only; do not mark passing CI as reviewer authorization.
- **Staging owner / operator action after separately verified restoration gates:** confirm off-site encrypted staging backup, separate independently restored database with matching fingerprints, reviewed rollback, retained Render artifact and approved test accounts; then deploy exact reviewed SHA to isolated staging, run real delivery and physical-device QA and capture evidence. **Until then: no staging/production deploy, migration 008, public mobility enablement or payment activity.**
