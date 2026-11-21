# Participant dispute response and private case timeline — engineering handoff

**Date:** 2026-11-21 (Asia/Kolkata)  
**Branch:** `feat/booking-dispute-participant-response-2026-11-21`  
**Parent:** Draft financial review PR #66 → pickup PR #64 → dispute architecture PR #63 → boarding PIN #62 → safety audit #61 → journey #60  
**Release:** DRAFT / DEFAULT OFF / NO-GO. No live writes, no payment integration, fines, ban or support reviewer adjudication.

## Rationale

Pickup abort PR #64 stores a case and a report, and financial review PR #66 prevents that case or a cancelled `Pending` booking from silently becoming payable or forgotten. But a person accused of nonresponse was not able to see and respond to the claim after cancellation. This made review one-sided. A neutral reviewer, monetary policy and sanctions require additional owner/legal approvals; this milestone **does not** implement adjudication.

## Minimum implementation

- **Additive migration 013**, `campus_booking_case_responses`, one categoric response per (case, actor), append-only immutable with application-role SELECT/INSERT, no UPDATE/DELETE; private RLS and restrictive foreign keys. No free-text, phone numbers, GPS, PIN, payment identifiers or penalty amounts.
- **Server flag:** `CASE_RESPONSE_ENABLED=false` by default; requires PostgreSQL rides, migrations 012 and 013 at startup. It is deliberately independent of `PICKUP_ABORT_ENABLED`, so existing dispute responses remain visible if new abort reports are temporarily disabled. No migration executed on real staging/production.
- **GET /api/bookings/cases?bookingId=...** — authenticated current booking passenger or actual offered-ride driver only, even after cancellation. Response includes case ID/state/opened time, claims and responses by **actor role**, short bounded category and server timestamps. It never exposes actor UUIDs, contact details, raw PIN, payment status or physical location; no public case enumeration.
- **POST /api/bookings/cases/respond** `{bookingId,code}` — authenticated participant, CSRF and transaction-backed idempotency key, ride→booking→case lock order, only when **counterparty has reported**. Category from a small CHECK-backed list (present at pickup, couldn't locate, attempted contact, other person absent, safety, other). One immutable statement per actor; same code safely retries, different code rejected with 409. A reporter cannot respond to their own claim before a counterparty has reported. No `status`, `seats_left`, `payment_status`, sanctions or commissions updated.
- **Client:** case button for passenger active booking, active driver roster, cancelled passenger booking history, and cancelled driver cases using an authenticated self-role projection. Accessible native dialog displays timeline and, if server authorizes, response selector. Everything is textContent, not unsanitized third-party HTML. Existing light/black/yellow style, keyboard focus and reduced motion. Driver must be parked before interacting; no forced popup.
- **No adjudication:** case stays `open`, reply evidence is not an admission of fault; no pay/waive/refund, no flag/fine/ban and no automated booking-ban removal. Independent reviewer RBAC and appeal remain OPEN.

## Disposable-only acceptance scope

1. No case until a participant reports, no premature counterparty reply, no self-reply with only one's own claim.
2. Both authenticated actors can read case and make one response after opposing claim, even concurrently; outsiders get 403, unauthenticated get 401, CSRF failures 403, invalid categories 400.
3. Retry identical response does not duplicate DB entries; second contradictory response returns 409, preserving the original audit record and the ability to appeal via a future reviewer.
4. Case statements omit UUID, phone, GPS, PIN, finance; driver/passenger view cannot see another passenger's private case; zero cross-ride information.
5. Booking/capacity/payment/status/boarding facts remain byte-for-byte consistent before and after responses; cancelled `Pending` remains review-only, free pilot remains `NoPaymentRequired`, no new sanctions or commission.
6. Existing disputed case accessible after ride cancelled and with pickup reporting flag OFF (case responses flag ON). Missing migration 013 causes fail-closed startup when enabled.
7. Replay migration 013 with populated responses preserves counts and app role cannot update/delete audit records; CI cleans synthetic children in correct order.
8. UI tests: flag OFF hides control, case with no response renders, cancelled driver and passenger history, escaped booking IDs, no unsanitized statements, modal labels, keyboard access, reduced motion, syntax.
9. Run exact-head Stage 1 disposable PostgreSQL/HTTP, real browser, security smoke, Places, mobility load checks. **CI evidence to be appended only after observed actual run results**.

## Risks and open decisions

- **Reviewer authorization absent:** no non-repudiation/independent findings, no enforcement. Owner must designate reviewer roles, reason/appeal windows, evidentiary standard, retention, privacy notice and escalation policy before adjudication.
- **Active undisputed legacy `Pending` restriction remains** under #66 as compatibility behavior; potentially unfair until appeal policy is approved. A case response *never* settles its financial state.
- **Driver arrival self-report and lack of reply** cannot prove physical presence or intentional nonresponse. A PIN is evidence of exchange, not absolute presence.
- **No support SLA:** case shows “awaiting neutral review”, but actual support reviewers and timeframes are not yet established; must not promise response times.
- **G1 recovery and stage/production migration gate, migrations 008–013, full parent PR chain, physical Android TalkBack/200% font/parked driver safety** all remain NO-GO. Do not merge/deploy or touch student data without owner GO.

## Primary evidence

- [Cancelled Pending PR #66](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/66) and [handoff](2026-11-21-cancelled-pending-reconciliation.md).
- [Five-minute pickup PR #64](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/64).
- [Private production roadmap](https://app.notion.com/p/41dca5237af5819ba7d3c3f9bff9b088).

## Verified CI evidence — exact tested code 2026-11-21

**Exact application SHA: `febb384f09f653ad1dbc82e8933c9cda8522c347`. Five GitHub Actions workflows completed SUCCESS.**

- [Stage 1 PostgreSQL/HTTP #44882640865](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44882640865) — `CAMPUS_CASE_RESPONSE_RESULT` logs strictly disposable five actors, authenticated opponent-only replies, cancelled booking timeline, flag rollback read, private timeline, CSRF/anonymous/outsider denied, two concurrent opposing statements, same-code idempotent retries, contradictory second response 409, no money/seat mutation, migration 013 replay, app audit DELETE/UPDATE denied, no reviewer adjudication or automatic sanctions. Previous `CAMPUS_PICKUP_ABORT_RESULT` still passed including 300s pickup limit and financial review invariants.
- [Real-browser E2E #44882640907](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44882640907), [security smoke #44882640870](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44882640870), [Places #44882640974](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44882640974), [disposable PostGIS benchmark #44882640850](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44882640850) all SUCCESS on exact code SHA.
- Security refinement included in verified application: force-close case dialog and clear past actor's timeline on session switch/logout. No live student data or payment touched. Flag remains **DEFAULT OFF**. The full E2E browser suite is **not a substitute** for a physical Android phone, TalkBack/large-text/parked-driver and operational human support trial.
- **Release NO-GO** remains for owner product fairness approval on active legacy Pending, named case reviewer RBAC and appeal support, actual billing/legality, data retention, G1 independent restoration, migrations 008–013 and PR stack review. A documentation-only commit after the verified SHA does not change tested application logic.
