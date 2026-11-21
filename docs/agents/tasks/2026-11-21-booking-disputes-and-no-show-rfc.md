# RFC-CP-021 — No-show, disputed pickup and interrupted-trip architecture

**Date:** 2026-11-21 (Asia/Kolkata)  
**Type:** DESIGN / PLANNING ONLY — no implementation, migration execution, feature enablement, payments or deployment  
**Status:** PROPOSED for owner + safety/security review; not approved policy  
**Parent code:** draft PR #62 (per-passenger in-app boarding PIN), stacked on #61 QA audit → #60 driver milestones  
**Risk:** P1 release hold; current canceled Pending and driver-arrival semantics cannot safely determine payment liability  
**Decision source:** user resolved pickup "can't find each other" via authorized contact; "driver reached drop-off but passenger never boarded" via in-app PIN; separate boarding from vehicle journey

## 1. Evidence baseline and problem

Source review of `stage1-otp/rides-store.js` and `server.js` on feature branch `feat/boarding-pin-in-app-2026-11-21`:

- Ride-level `journey_stage` is a **driver attestation**: `scheduled → departed → pickup_ready → arrived`. It is not GPS confirmation and does not prove a passenger was inside.
- PR #62 adds private **per-booking** `boarded_at` after authenticated in-app PIN exchange. The driver can self-report destination arrival without `boarded_at` on every booking. PIN exchange is evidence but may still be shared remotely; not incontestable physical presence.
- `getBookingsByUser` currently filters `b.status='active'`. `cancelRide` sets all active bookings `cancelled` and resets `seats_left=seats_total`, while leaving `payment_status='Pending'`. The active-only `checkUserSettlementBlock` ignores these canceled Pending rows. This can **erase the obligation from normal visibility/enforcement without actually settling or forgiving it**. Driver commission is also derived from `seats_total-seats_left`, which changes on cancellation, not immutable performed-service evidence.
- After driver-reported departure, passenger cancellation returns `409 JOURNEY_ALREADY_STARTED`; this is not a substitute for a no-show/dispute flow.
- Existing free pilot uses `payment_mode=free_pilot`, `payment_status=NoPaymentRequired`; legacy mode uses `Pending`. **No real payment execution or settlement provider is enabled**, and product/payment legal architecture for *future errands* must not be mistaken for an approved rides settlement mechanism.
- Source #61 explicitly reproduced the unsafe canceled Pending condition. Green characterization tests are **not release sign-off**.

## 2. Non-negotiable invariants

**I1 — Separate independent facts.** A ride has driver-reported vehicle milestones; each booking independently has reservation status, passenger `boarded_at` (nullable), case/dispute status, and financial review classification. Never derive one fact from another.

**I2 — No driver-only completion proof.** Driver reports arrival at destination but `boarded_at IS NULL` → show **"Driver reported arrival; passenger boarding not verified"**. Never render as passenger trip completed or paid.

**I3 — History cannot disappear.** All bookings (active and cancelled), original `payment_mode`, `payment_status`, amount, `boarded_at`, and case outcomes must remain in an authorized history/read path. Cancellation never deletes a booking or invents `Paid`/`NoPaymentRequired`.

**I4 — Monetary effects are independent.** No automatic charge, payout, commission, refund, debt forgiveness, penalty, account ban or money status change from GPS, driver reports, boarding PIN, no-show claim or cancellation alone. `Pending` remains a historical marker until an explicitly approved financial policy/provider exists. A disputed/legacy Pending item remains **visible as unresolved review**, not silently dropped or asserted collectible.

**I5 — Zero-fare pilot distinction.** `free_pilot/NoPaymentRequired` has no payment debt, even if there is a no-show or interrupted trip. A case can still be opened for safety and trust; it must not introduce a fee. Legacy Pending and free-pilot histories must never be merged into an ambiguous "unpaid" category.

**I6 — False claims never self-adjudicate.** Driver may report passenger no-show; passenger may challenge pickup/boarding; neither alone proves fault. PIN confirmation is a code exchange indicator, not proof of GPS or actual transport. Manual neutral review can resolve a case only through an authenticated, authorized reviewer role with audit.

**I7 — Write atomicity and ownership.** Ride→booking→case row lock order across booking cancellation, ride cancellation, case create/resolve and PIN verification; same-lock commit includes history/case event/booking change; retries are idempotent; unauthorized identities neither read nor mutate a case.

**I8 — Privacy and recoverability.** Do not expose passenger phone/email to strangers, share PIN/nonce in dispute payloads, or copy precise GPS into a case by default. Reconciliation operates on PostgreSQL source, not stale client cache; append-only audit records are protected by RLS/grants and defined retention policy. No real migration without G1 backup/restore + rollback plan.

## 3. User journey and statuses — simple and separate

### Case A — "I can't find the driver at pickup"

1. Driver reports `pickup_ready`, passenger sees driver-reported pickup readiness, pickup location and authorized contact **Call / Contact driver**.
2. Passenger may tap **"Can't find my driver"**; driver may tap **"Can't find passenger"**. These are support/coordination flags, **not** no-show, boarding, cancellation, payment confirmation or a clock proving fault.
3. Both can coordinate through already-authorized contact. No additional SMS, GPS tracking, live chat, new worker, auto no-show timer or countdown required for the minimum safe release.
4. If unresolved, either may open an authenticated **Pickup issue** case; it remains in review. A driver may *request* no-show classification only after an **owner-approved pickup grace period** and sufficient documented contact attempt policy. Do not invent a fixed number of minutes.

### Case B — "Driver reported destination arrival; I was never picked up"

1. Per-booking `boarded_at` is separate from `ride.journey_stage='arrived'`. Unverified passenger sees **"Boarding not confirmed"** plus a **Report a problem** path.
2. Passenger opens **"I was not picked up"**. Case is `OPEN` then `NEEDS_REVIEW`; timestamp and identity are persisted; do not automatically charge, refund or declare the passenger lying.
3. Driver can respond with a brief bounded factual statement and stored nonsecret timeline evidence (driver report timestamp and PIN verified/unverified). No PIN display or raw location.
4. Authorized reviewer adjudicates (e.g. `NO_BOARDING`, `BOARDING_VERIFIED`, `INTERRUPTED`, `INCONCLUSIVE`) with an explicit rationale. A PIN match is relevant evidence, **not absolute proof of who was in the vehicle**.
5. Case conclusion updates only *case resolution*. Financial settlement remains separately disabled until owner/legal/provider approval. Both parties can read a redacted outcome and request appeal/reopen under later defined policy.

### Case C — Driver marks passenger "no-show"

- Driver can **report a no-show claim**, not mark the passenger culpable. If user confirmed PIN, never silently change `boarded_at` to null; a contradictory no-show claim is flagged for manual review.
- Report may be filed only for a booked passenger on that driver's ride with pickup-relevant journey stage and approved waiting/contact rules. Passenger sees the claim, can dispute it, and booking status/payment cannot be silently overwritten.
- **No auto fee** and no imposed "no-show" debit. Owner must decide whether any future rider consequence exists; pilot recommendation is **none**.

### Case D — Emergency driver cancellation (before or after pickup)

- Before any confirmed passenger boarding: cancel future transport supply; preserve all booking records and create a **driver emergency cancellation** case/event per affected booking, with liability/obligation unresolved for legacy Pending (free rides remain no-money).
- After one or more PIN-verified boardings: distinguish **interrupted journey** from passenger no-show. Never classify boarded rider as a no-show or silently clear existing obligation. Mark transport interrupted and refer to safety/support flow. If a real-world emergency is reported, prompt users to contact local emergency services; app case is not a substitute.
- Since ride cancellation currently resets seats, avoid deriving financial liability from `seats_left` after cancellation; no changes to passenger boarding evidence, original fare/mode or case audit.

## 4. State models — avoid giant combined status machine

Use four narrow facts instead of a single "trip_status" enum with dozens of permutations.

| Fact | Storage | Examples | Authority |
| --- | --- | --- | --- |
| Vehicle journey | existing `campus_rides.journey_stage` | scheduled/departed/pickup_ready/arrived | driver report, server records |
| Booking lifecycle | existing `campus_bookings.status`, `cancelled_at` | active/cancelled | current booking rules |
| Boarding proof | existing `campus_bookings.boarded_at` | NULL/verified-at | successful server PIN check |
| Case and financial review | proposed case record and append-only events | open/under_review/resolved; legacy_pending/review_required/no_money | verified case actors and explicit policy |

**Case workflow proposal:** `OPEN → AWAITING_COUNTERPARTY → UNDER_REVIEW → RESOLVED`. A bounded, authorized `REOPENED` event may return a resolved case to `UNDER_REVIEW`; never erase prior resolution. An owner must decide response/appeal windows before implementing automatic deadlines. No automatic closure by passage of time.

**Possible case reasons:** `PICKUP_COORDINATION`, `PASSENGER_NEVER_BOARDED`, `DRIVER_REPORTS_NO_SHOW`, `EMERGENCY_DRIVER_CANCEL`, `INTERRUPTED_AFTER_BOARDING`, `OTHER_JOURNEY_ISSUE`. Caller is verified participant; reviewer is separately authorized. Do not label any party fraudulent automatically.

**Disposition proposal (NON-MONETARY):** `NOT_APPLICABLE_FREE`, `LEGACY_PENDING_UNREVIEWED`, `LEGACY_PENDING_DISPUTED`, `LEGACY_PENDING_MANUAL_REVIEW`, `LEGACY_PENDING_REVIEW_CLOSED`. Never use `Paid`, `waived`, `refunded` in these case states, because no bank/provider transaction was verified. A financial ledger/payment integration, if ever approved, is a **separate system with its own audit and legal review**.

## 5. Minimal persistence proposal (migration 012 — design only)

Prefer **two small tables**, not event-sourced infrastructure or a microservice:

1. `campus_booking_cases`: `id UUID PK`, `booking_id TEXT FK REFERENCES campus_bookings ON DELETE RESTRICT`, `ride_id TEXT FK` (server-derived, not trusted from client), `reason` enum/CHECK, `state` CHECK, `opened_by_user_id UUID FK`, `created_at`, `updated_at`, `resolved_at`, `resolution_code` (nullable), `resolution_actor_id` (nullable), `revision INTEGER`. One open case per booking via partial unique index; maintain history across multiple issues. Retain source booking even if cancelled.
2. `campus_booking_case_events`: `id UUID PK`, `case_id UUID FK ON DELETE RESTRICT`, `event_type` CHECK, `actor_id` (nullable only for system events), `created_at` server timestamp, `note` short bounded text (optional), `metadata` minimal schema-validated nonsecret JSONB (e.g. recorded stage, boarding boolean, NOT location/PIN); immutable from app role (INSERT/SELECT only; no UPDATE/DELETE). Index by `case_id, created_at`. The case row is the cheap current projection; the event row is the append-only "why/how" audit trail.

Apply `REVOKE PUBLIC, anon, authenticated`, `ENABLE ROW LEVEL SECURITY`, narrowly scoped backend grants/policies, and mandatory server-side authorization. Do not open direct client PostgreSQL access or generic public case discovery. Case note must exclude student secrets, PINs, contact numbers, raw GPS, payment identifier and photo uploads. Set an explicit privacy retention schedule **before launch**, based on campus/legal review (not an invented number).

**Why not simply add a `disputed=true` booking column?** It loses who claimed what, response, conflicting evidence, timing and appeal; cannot explain resolution. **Why not full event sourcing, Redis, microservices, queues, wallets?** Unnecessary operational complexity for a two-party campus pilot.

**Migration and backfill caution:** 012 must not automatically interpret old cancelled Pending as payable or forgiven. Identify historical cancelled/legacy Pending records as **needs operator review**, with safe backfill/derived review queues, and verify row counts/amounts first in disposable PostgreSQL. No batch charges, no punitive lockouts, no data deletion. Constraint and RLS test, migration replay, and old-client/rollback compatibility are required.

## 6. Proposed endpoints / authorization contracts

All use existing cookie-session auth; mutations require CSRF, JSON validation, rate limits, stable idempotency keys for successful case creation and bounded receipts. No payment or provider calls.

- `GET /api/bookings/history`: actor-filtered, paginated view including cancelled records. Passenger sees only own items. Driver sees only rides they offered with redacted historical passenger data. Return case-state and boarding-derived labels, never PIN/nonce or private other-rider data; avoid leaking contact details after booking ends.
- `POST /api/bookings/cases` `{bookingId,reason,note?}`: verified owner passenger OR driver of actual ride; server derives ride/role. Enforce one unresolved case/booking and retry deduplication. If concurrent opposite-party claim, append case event rather than creating two contradictory open cases. Return case reference, not private data.
- `GET /api/bookings/cases?bookingId=...`: only booking passenger, actual driver, **or designated reviewer with explicit RBAC**; private redacted event trail, ordered by server timestamps.
- `POST /api/bookings/cases/respond`: identified counterparty only, bounded note, no status or money override.
- `POST /api/bookings/cases/resolve`: **not enabled until reviewer RBAC exists**. No student/driver self-adjudication. Revision/If-Match or similar optimistic compare + row lock; append immutable event, record reviewer and rationale. No money write.
- `GET /api/bookings/obligation-review`: optional owner-private non-monetary review projection for *legacy* `Pending` rows, not a collectible invoice. Prefer one shared SQL query to avoid hiding cancelled items in the existing active-only settlement guard.

Avoid a new support dashboard in MVP unless a real reviewer role and support operations owner exist. An unreviewed case stays open; don't pretend "resolved" because no admin UI exists.

## 7. Atomicity, concurrency, financial safety

- **Lock order:** ride row `FOR UPDATE` → booking row `FOR UPDATE` → case row `FOR UPDATE` when present → event INSERT, same PostgreSQL transaction for cancellation + case creation + booking status. Never take case lock then ride lock. For multiple bookings on one ride, sort booking IDs deterministically before row locks.
- **Cases opened concurrently:** `UNIQUE(booking_id) WHERE state!='RESOLVED'` backed by retry with same canonical case ID; opposite-party claims append events and mark review, not overwrite each other. Idempotent DB receipt must never return secrets; be careful not to roll back 4xx with side effects (lesson from #62).
- **Cancellation and PIN races:** if PIN verified first, preserve `boarded_at` and classify interruption; if cancellation first, reject PIN and classify no boarding confirmed; serializable consistent outcome under ride lock. No "already arrived" override for passenger dispute.
- **Unpaid history:** do not compute collectible commission from current `seats_left`; it is a capacity field which changes on cancellations. Keep booked amount/mode/legacy Pending snapshot and separate case disposition. No automatically collectible debt on contested claims. A transaction must not silently change `Pending` to `Paid`, `NoPaymentRequired` or null.
- **Legacy booking guard:** existing `checkUserSettlementBlock` currently ignores canceled Pending. **Short-term release rule:** halt activation of legacy paid journey flows until explicitly decided whether disputed Pending should restrict new paid bookings, and how students appeal. Do not silently clear or impose an irrevocable lock. Free zero-fare pilot creates no debt; user access/privacy issues handled separately. Offer explicit review-needed status rather than a false payment message.
- **Retries and crashes:** after commit, read from PostgreSQL; delayed HTTP response never creates a second open case; if transaction aborts, booking/case/event all roll back; behavior tested at disconnect/timeout. No database partial commit.
- **Performance:** each case creation bounded O(1) queries, single row for booking case; emergency cancel at max supported seats 4 (or enforce existing seat cap). Avoid `N+1` reads for history; paginate, index and load-test. No queue or extra service by default.

## 8. Safety language and app UX

- **Passenger booking card:** `Pickup ready — driver reported`, `Find my driver`, `Boarding PIN verified` **or** `Boarding not confirmed`, `Report a pickup problem`, `View case`. Driver arrival at final stop must be explicitly labeled `Driver reported arrival` on unverified booking, never "you arrived".
- **Driver view:** passenger-by-passenger confirmation; `Contact passenger`, `Report unable to locate`, `Report emergency cancellation`, `View disputed booking`. Mark no-show as `Claim submitted`, not `Passenger penalized`.
- **Case screen:** brief reason, who reported it, stage timestamps as driver-reported, boarding-PIN verification indicator without exposing PIN, latest status, next actor/action; no sensational "fraud" labels.
- **Accessibility:** status expressed in text (not color/animation only), labels/focus and 200% text support, real Android TalkBack/keyboard, safe use while parked, offline case submission shows uncertain delivery until server readback. No pressure to interact while driving.
- **Privacy:** show passenger private contact only when booking participant and appropriately active; avoid retaining notes with secrets. No photo/location/video evidence in MVP. Add higher-friction attachments only if investigation requires them and storage/retention approved.

## 9. Disposable-only acceptance matrix (no code/test executed in this design PR)

| ID | Scenario | Required assertion |
| --- | --- | --- |
| D01 | Driver `pickup_ready`, passenger cannot locate | Contact option; no boarded, no no-show fee and no financial mutation |
| D02 | Passenger creates pickup issue twice / slow retry | Exactly one open case; immutable event; server readback |
| D03 | Driver and passenger dispute same booking concurrently | One case, both claims retained, clear review state |
| D04 | Destination arrival without PIN | Passenger boarding remains unverified; case can open; no money changes |
| D05 | Destination arrival with verified PIN but passenger disputes | PIN audit retained; **manual review**, not automatically rejected |
| D06 | Two passengers, only one PIN entered | Independent verified/unverified statuses and independent cases |
| D07 | Driver attempts no-show for another ride | 403; no case data leaked or written |
| D08 | Passenger attempts to resolve own/driver case | 403; explicit reviewer role only |
| D09 | Driver emergency cancels before any PIN | All bookings preserved in historical view; Pending review not lost; no new charge |
| D10 | Driver emergency cancels with one boarded seat | That booking labeled interrupted, unboarded seat separate, neither silently paid |
| D11 | Concurrent PIN verify vs emergency cancel | Atomic ordered outcome; boarded evidence never erased |
| D12 | Concurrent passenger cancellation vs case creation | No duplicate case, all affected history readable |
| D13 | Cancelled Pending legacy row + new paid action | Non-silent review outcome; explicit owner policy, no unapproved monetary block/waiver |
| D14 | Free-pilot case and cancellation | `NoPaymentRequired` remains, no debt or commission introduced |
| D15 | Reapply proposed 012 after populated baseline | No duplicate rows/events, RLS and historical counts/amounts preserved |
| D16 | Session expiry, CSRF fail, stranger reads | 401/403, no mutation, no private status leakage |
| D17 | Browser refresh/feature OFF/old client | Cases and boarding evidence persist; no unsafe old booking/cancel writes |
| D18 | Snapshot, restore and transaction failure | Recover case/event parity; no partial commit |
| D19 | Real Android TalkBack, 200% scale, focus, offline, parked driver | Independent device evidence, not desktop simulation |

CI should emit `CAMPUS_DISPUTE_RESULT` with all safety acceptance booleans only **after** actual disposable PostgreSQL HTTP tests exist and pass. Do not write a fabricated PASS now.

## 10. Open product decisions — MUST be approved before runtime rollout

| Decision | Recommendation for MVP | Status |
| --- | --- | --- |
| How long must driver wait before submitting a no-show claim? | Define campus-approved grace period, communication attempt requirements; no automated fault assignment | **OPEN** |
| Does a driver claim by itself penalize passenger? | **No** | Proposed, not owner-approved |
| Does a verified boarding PIN defeat a passenger dispute? | **No**; it is strong but rebuttable evidence | Proposed |
| Who may resolve disputes and what appeal window? | Named trusted CampusPool reviewer role + rationale/event trail; support owner, SLAs and retention approved first | **OPEN** |
| What happens to legacy cancelled `Pending` and old "commission due"? | Visible as unsettled review; no silent waiver, automatic debt collection or irrebuttable access ban. Stop legacy paid rollout until policy defined | **OPEN / P1** |
| Free rides pilot no-show money consequence? | **No fees, no payout, no penalty amount** | Proposed |
| Emergency cancellation after boarding | Interrupted-service case; prioritized human support, no automated settlement | Proposed |
| Dispute note retention, user notice and campus policy | Minimize notes; owner/privacy/legal sign-off, no arbitrary TTL | **OPEN** |

**Design acceptance is not product policy approval.** Implement `012` and API behind default-OFF flag only after owner accepts these and independent security/product review. Do not enable or migrate staging/production until G1 recovery and separate GO.

## 11. Implementation sequencing and review gates

1. **P1 ledger/history fix first:** failing disposable tests reproduce `cancelled Pending ignored`; add read-only private historical bookings + legacy Pending review projection **without changing financial status**. Verify free/legacy separation and receipt privacy.
2. Add migration **012** cases+events after 011, validate constraints/RLS on disposable Postgres; no secrets, append-only authorization and stable transaction locks.
3. Add case creation/response and ride-cancellation event atomicity, explicitly no resolution API until reviewer RBAC; test 4-party races and fault injection.
4. Add minimal accessible pickup/report/case UI with no new communications service; physical Android device QA.
5. Owner chooses dispute/no-show/reviewer/legacy Pending policy, implements restricted resolution, adversarial security/finance tests and support operations.
6. Only after parent #47→…→#62 stacked review, exact CI, full 008→009→010→011→012 compatibility and **independently recovered** staging data, consider owner-authorized staging migration and later production. Never backfill a collectible debt automatically or destructively roll back schema.

**Out of scope:** real payments/escrow/wallet, claims adjudicated by AI, automatic fines, passenger geolocation proving boarding, new backend microservices, background worker/no-show timer, legal determination of student financial liability.

## References / evidence links (dated 2026-11-21)

- [PR #61 adversarial audit](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/61) and [disposable 5-actor PostgreSQL evidence #44871822116](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44871822116).
- [PR #62 in-app PIN](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/62); [verified Stage 1 PIN run #44873467356](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44873467356), [exact browser E2E #44873467396](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44873467396).
- [Notion CampusPool production roadmap — G1–G6 NO-GO](https://app.notion.com/p/41dca5237af5819ba7d3c3f9bff9b088) (21 Nov 2026 checkpoint).
- [Notion CampusPool payment-holding research](https://app.notion.com/p/40eca5237af58108b4b4ceb970d61b52) (4 Nov 2026): primarily future errand payment architecture; NOT authorization to turn on rides payments.
- Repository [existing product decision](../DECISIONS.md), [#61 release safety audit](2026-11-21-journey-release-safety-audit.md), [#62 boarding PIN handoff](2026-11-21-in-app-boarding-pin.md).

**Release verdict: design drafted; implementation NOT STARTED in this RFC; production still NO-GO.**
