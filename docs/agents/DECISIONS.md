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


## 2026-11-20 — Retryable pool admission failure (branch proposal)

- #51 observed three generic HTTP 500 under five-connection saturation. Classify only pg-pool pending acquisition deadline at owned pool boundary; map to 503 with 2–4s Retry-After and existing same-key manual retry; preserve SQL errors, auth and transaction semantics. No extra queue, dependency or pool expansion. Retry guidance is not guaranteed recovery. Driver contract version-sensitive, covered by real PG integration. [Task](tasks/2026-11-20-graceful-backpressure.md). Review after sustained workload or driver upgrade; revert source-only change if needed.


## 2026-11-20 — Campus Rush Hour measurement before capacity changes (proposed)

- Use existing five-connection pool and real rate limit, disposable fixed-paced mixed HTTP workload with separate shared-NAT case. No queue, Redis, H3 or extra connections justified by design alone. Review actual queue/latency/response payload and 429 metrics; no production SLA from synthetic runs. [Task](tasks/2026-11-20-campus-rush-hour.md).


## 2026-11-20 — single SQL settlement snapshot (branch proposal)

- #53 peak queue 39 and 6720 pool acquisitions at 160 req/s. Existing settlement queries split driver totals and pending list; combine via one aggregate then left join, preserve native column decoding, rounding and pending restriction. No cache, extra connections or schema. Actual count/parity and same workload CI pending; no speedup claim. [Task](tasks/2026-11-20-single-snapshot-settlement.md). Source-only rollback.


## 2026-11-20 — Campus Wi-Fi fairness (branch proposal)

- #53/#54 NAT 120/130 accepted. Default-off exact PG rides routes: verified UUID retains 120 read/60 write per minute across IP/session, pre-auth aggregate IP 600/300, existing anonymous IP budget and bounded replay. No exemption from aggregate cap; no OTP/provider/legacy change. Reuse SQLite, no extra infrastructure. Provisional caps and increased preauth plausible-token lookup allowance require security and enabled workload review; no independent replica guarantee. [Task](tasks/2026-11-20-campus-wifi-fairness.md).


## 2026-11-20 — participant privacy projection (branch proposal)

- Explicit safe feed and historical receipts, active passenger contact via existing booking read, no UPI or unverified QR, GPS no email. No new queries or infrastructure. Prior disclosure cannot be recalled; old receipt storage and GPS retention remain open. [Task](tasks/2026-11-20-participant-privacy-shield.md).


## 2026-11-20 — GPS latest-fix consent lease (proposal)

- Reuse existing SQLite row with session-bound lease hash, explicit start/stop and monotonic capture timestamps, 60s expiry and periodic 30s prune; no worker-local coordinate cache or simulated publication. Existing participant checks retained. No new infra/schema. Logical deletion is not physical erasure; cross-store cancellation point-in-time. [Task](tasks/2026-11-20-smart-gps-privacy.md).


## 2026-11-20 — Free rides-only pilot (proposed)

- Default-off PG rides, mobility disabled. Explicit mode, matching FK, zero-money and NoPaymentRequired; preserve legacy Pending. Owner approval and separate migration required. [Task](tasks/2026-11-20-free-rides-pilot.md).

## 2026-11-21 — driver-reported journey milestones (proposal)
- Minimal PG row state machine (scheduled/departed/pickup_ready/arrived), owner attestation, stored timestamps; no GPS inference or event broker. Existing legacy debt preserved. DB migration 010 and flag require separate release review. [Task](tasks/2026-11-21-journey-state-machine.md).


## 2026-11-21 — Pickup coordination vs passenger boarding proof (product owner decision; implementation PENDING)

- **Pickup-location mismatch:** if the driver reports being at the pickup point but the passenger cannot find them, use the existing *authorized participant contact* to call/coordinate. A pickup-ready driver report is not proof of passenger boarding. Never force a boarding code just to find a vehicle; keep private phone numbers out of public discovery feeds.
- **False drop-off/never-boarded case:** use an **in-app boarding PIN**, as in familiar ride-hailing workflows. It is generated and displayed inside the authenticated **passenger's CampusPool booking screen** and typed into the **driver's CampusPool interface only after the passenger boards**. No SMS, email, messaging OTP, external OTP provider or fee-bearing send. Explicit instruction: *Do not share the PIN until physically boarded*.
- **Per booking, not per ride:** multiple passengers in one car have separate boarding confirmations. Passenger-boarding verification is **not** the same as driver milestone reporting. Even if the driver reports \`arrived\` at the destination, a passenger with no successful PIN exchange remains **boarding unverified**, and must never automatically appear as a completed passenger trip.
- **Security acceptance (to design and test):** use server CSPRNG code (proposal: 6 numeric digits), only the passenger can read their own live code via authorized private endpoint, driver sees only verification result, server stores a secret-bound verifier rather than plaintext, short bounded expiration with safe renewal and 5-attempt lockout/cooldown, one-use atomic transaction, resistant to concurrent duplicate submissions and replay, rate limits and CSRF, no PIN in browser local storage, URLs, analytics, debug logs, cache, receipts, notifications or other riders' payloads. Never reuse login OTP or require a paid OTP provider. Driver identity must be checked against booking's actual ride owner, not request body claims. Record only booking-level \`boarded_at\`/confirmation metadata, with retention/privacy policy and secure DB rollout reviewed.
- **False reporting & offline behavior:** reporting destination arrival is a driver attestation, NOT GPS or evidence that every reserved passenger boarded. PIN is an additional handover signal, not cryptographic proof of physical presence (it can still be shared remotely). If a PIN is never confirmed, show boarding unverified and offer dispute/no-show resolution. Network errors must never invent success; retries must be idempotent.
- **Financial policy remains unresolved:** no automatic paid/refund/no-show fee, cancellation-based debt erasure or auto-settlement inferred from PIN, reported pickup, or reported arrival. Keep pending/cancelled/disputed audit history available to authorized users until policy approved.
- **Minimum-complexity choice:** extend existing bookings + Node/PostgreSQL transaction/idempotency/session/CSRF model, no SMS, provider, websocket, Redis, QR dependency, external coordination service or new microservice. Alternative one shared ride PIN rejected because it could falsely confirm multiple riders. Alternative passive GPS-based boarding rejected because coordinates do not prove occupancy.
- **Status:** accepted product behavior, **not implemented, deployed or device tested**. Pending independent security/product review, disposable PostgreSQL concurrency tests, accessibility and G1 recovery/release approvals. [Audit handoff](tasks/2026-11-21-journey-release-safety-audit.md), draft PR #61; #60 remains unchanged.


## 2026-11-21 — Proposed booking dispute and no-show architecture (NOT OWNER-APPROVED)

- **Problem verified:** driver cancellation makes cancelled \`Pending\` bookings disappear from active-only booking read and settlement guard. Ride arrival is driver-attested, while per-booking \`boarded_at\` is PIN-exchange evidence; neither establishes monetary liability.
- **Architecture proposal:** preserve original booking, ride milestone and boarding proof; add one booking-level case/current projection and an append-only case event trail (proposed migration 012), with participant-only report/respond and a separately authorized reviewer-only resolution. Do not add a full event-sourcing platform, worker, SMS, Kafka, Redis, microservices, wallet or AI adjudication.
- **Pickup mismatch:** existing participant contact; "can't locate" is coordination, **not** passenger no-show. Explicit claims can lead to neutral review; no driver self-adjudication or arbitrary auto no-show timer.
- **Disputed drop-off:** arrival without PIN stays boarding unverified. Even PIN-verified but disputed boarding stays reviewable; no automatic dismissal or monetary collection. Per-passenger cases; no shared ride verdict.
- **Emergency cancellation:** preserve historical booking even if cancelled; a confirmed-boarded booking may be interrupted, never rewritten to "no-show" or deleted. Existing \`Pending\` is explicitly unresolved rather than silently cleared.
- **Finance:** the existing \`seats_total-seats_left\` is a capacity counter, not evidence of billable travel after cancellation. Free pilot remains \`NoPaymentRequired\`; legacy \`Pending\` and disputed cases require human policy and legacy paid-ride release hold. No charge, refund, waiver, payout, commission or account penalty inferred from claims or PIN; owner must approve any real-world financial policy.
- **Open decisions:** driver waiting/contact grace policy; case reviewer role, response and appeal windows; legacy cancelled \`Pending\` access and finance policy; safe event retention. None assumed approved. **Status: RFC ONLY**. [Detailed model, invariants, threat cases, migration 012 and test plan](tasks/2026-11-21-booking-disputes-and-no-show-rfc.md). G1–G6 NO-GO unchanged.

## 2026-11-21 — Five-minute mutual pickup wait and situational accountability (OWNER PRODUCT DIRECTION)

- **Accepted product behavior:** driver and passenger each have a **maximum 5-minute wait**, sharing a single **300-second window** from server-persisted, driver-reported pickup-ready time. It is an eligibility threshold, not independent proof driver was physically present. Early safety/emergency abort is always available. No automatic cancellation at 5:00.
- **When unresolved and a counterparty is reportedly unresponsive:** show a contextual **Abort pickup?** confirmation to the waiting/reporting user after the window; offer Continue coordinating / Abort pickup / Safety help. Collect a reason. Actual nonresponse must not be inferred from app inactivity, undelivered notifications, unread messages or lost connectivity. Record a case, not a no-show conviction, and retain booking, PIN evidence and Pending/NoPaymentRequired status.
- **Owner-intended progressive accountability:** after fair independent review, **warning → private flag → possible reviewed fine → suspension/ban** for continuing repeated **verified unjustified** misconduct. The UI shows **only the notice relevant to this specific situation and prior verified stage**, never the entire penalty ladder at once. No public shaming, immediate penalty, fabricated first-offense strike or automatic sanctions from raw claims; emergencies and genuine technical failures must be considered. Reversed findings do not count.
- **Policy still OPEN:** offense thresholds/lookback, fee amount, payment/legal basis, terms, human reviewer RBAC, appeal and account restoration, privacy retention and exceptions. Fines and bans are NOT implemented or authorized. No existing legacy Pending booking can be reclassified as a penalty; zero-fare ride remains NoPaymentRequired.
- **Architecture:** reuse existing journey pickup timestamp, booking and PIN proof and planned case/event data; no new scheduler, SMS, service, wallet or infrastructure. [Full policy and 15 planned tests](tasks/2026-11-21-five-minute-pickup-abort-enforcement.md), [dispute RFC](tasks/2026-11-21-booking-disputes-and-no-show-rfc.md). Design-only draft PR #63; G1–G6 NO-GO unchanged.

## 2026-11-21 — Cancelled/disputed Pending must remain reviewable, not automatically collectible (implementation policy)

- **Safety invariant:** `payment_status='Pending'` is an unverified ledger marker, never evidence of payment collection, debt, passenger boarding or authorized driver commission. Existing cancelled `Pending` must survive cancellation as a private booking-history AND finance-review item, not be silently omitted, paid, forgiven or relabeled. A live pickup dispute is also review-required.
- **Minimum correction:** distinguish `pendingBookings` (existing **active unchallenged** Pending restriction) from `reviewRequiredBookings` (cancelled, cancelled-ride or case-disputed Pending), plus owner-side historical review count. A review-only item must not itself trigger a new booking ban, penalty or fee. Keeping existing *active* Pending restriction is a compatibility choice, **not final legal/owner payment policy**.
- **Commission invariant:** `seats_total-seats_left` is mutable seat capacity, NOT proof of a completed paid journey. Without bank/provider-confirmed payment and service evidence, calculate **zero collectible commission**; show old legacy booking counts as review candidates instead. Do not charge or block based on phantom commission.
- **Free pilot:** `NoPaymentRequired` stays outside legacy Pending financial reviews; never convert it to a debt or fine.
- **No new money authority:** reviewer RBAC, resolved-case status, appeal, rules for active Pending/legacy ledger/driver payout and payment verification remain unapproved. Source [corrective task](tasks/2026-11-21-cancelled-pending-reconciliation.md), draft PR #66, stacked on PR #64. Production still NO-GO.

## 2026-11-21 — Review/appeal architecture is non-enforcing and independent

- Product decision for current engineering milestone: **record independent neutral review and appeals only**; no automatic fault, entitlement, debt, charge, waiver, fine, account flag, ban or ride-capacity mutation. The prior 5-minute mutual pickup and cancelled/disputed Pending review rules remain intact.
- Safety rule: initial case reviewer must be an **explicit, currently authorized and unexpired verified user**, not either ride participant, and must consider statements from **both** participants before recording one immutable `no_action` / `insufficient_evidence` / `follow_up_required` record.
- Fairness rule: each participant can appeal once using bounded categories without exposing their reason to the other side; the appeal reviewer must have a **separately granted** role and must not be case participant or original reviewer. Reviewer decisions do not change payment state, booking restrictions or case status.
- Permission grants are **operator-only**, never through a live application endpoint. No reviewers are enrolled by this engineering task. Role expiry and revocation are enforced at query time, with DB grant row locking on writes.
- **Open owner/legal policy:** staffing, reviewer qualifications, appeals and response deadlines, evidentiary standard, retention, notice, compensation/financial settlement, consequences and reinstatement. Do not implement automatic sanctions or financial effects until separately authorized. [Code task](tasks/2026-11-21-reviewer-and-appeals-foundation.md).

## 2026-11-21 — Reviewer onboarding restricted to human approval and read-only preflight

- The technical reviewer/appeal APIs in PR #68 **do not authorize an operator, user or app agent** to grant reviewer roles. A **separately approved** owner + privacy/security change with time-bound access, named verified reviewer, role separation and a privileged DBA remains mandatory. No live reviewer grants have been created.
- Onboarding source [PR #69](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/69) adds only a read-only preflight: strict disposable-loopback or dedicated staging read target, `BEGIN TRANSACTION READ ONLY` with rollback, verified identity, RLS/least privilege and role expiry/duplicate checks; no `--apply`, database permission writes, HTTP self-promotion or fee path. All operator emails, UUIDs and private approvals stay out of logs/PRs.
- The [human review and appeal policy](tasks/2026-11-21-reviewer-operations-policy-proposal.md) remains **UNAPPROVED** pending owner staffing, independent appeal reviewer, safety response, privacy/legal retention, active legacy `Pending` fairness and explicit support SLA decisions. Nothing enables fines, bans, financial settlement, debt waiver or reputational flags. Source [handoff](tasks/2026-11-21-reviewer-onboarding-safety-handoff.md).

## 2026-11-21 — Migrations 008–014 require verified restore-as-rollback, not destructive DOWN

- Engineering decision: audit **each 007→008→…→014 schema boundary** using PostgreSQL read-only catalog state, including names/validated CHECK+FK/indexes, RLS and app-only permissions; source hash inventory is not a signed deployment ledger, and even a perfect catalog match does **not authorize release**.
- Rollback rehearsal uses **independent isolated restoration of an authenticated 007 pre-upgrade archive**, preserving original active/cancelled legacy `Pending` rows; a separate 014 archive must also restore case/response/reviewer/appeal audit parity. Do **not** execute in-place `DROP TABLE`/`DOWN` or overwrite a live DB with an old backup while students can still book; post-snapshot writes may be lost. A real write-freeze, RPO/RTO and approved recovery strategy remain mandatory.
- Test protocol is local synthetic PostgreSQL/PostGIS16, not proof of Supabase version compatibility, independent Azure private blob retrieval, backup image Cosign OIDC signature, encrypted off-site transfer or an approved production G1. **No staging/production migration, rollback or Azure backup execution authorized.** Source [release gate report](tasks/2026-11-21-migration-008-014-recovery-gates.md); draft PR #70.
