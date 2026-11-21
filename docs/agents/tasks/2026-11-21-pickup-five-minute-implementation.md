# Five-minute pickup abort: implementation and safety handoff

**Date:** 2026-11-21 · **Parent:** design PR #63 → boarding PIN PR #62 → safety audit #61 → journey PR #60  
**Status:** candidate feature **OFF by default**; CI verification pending; **NO STAGING/PROD WRITES**.

## Owner policy implemented in this branch (not enabled)

Both parties have a shared maximum five-minute pickup waiting window measured from **server-persisted driver-reported pickup_ready timestamp**. Neither app inactivity nor self-reported arrival proves physical presence, fault or payment liability. After 300 seconds, a booked driver or passenger can report an unresolved pickup with a reason; a safety/emergency report is available earlier. No report automatically cancels a booking, frees a seat, charges or waives Pending, flags a user, imposes a fine, bans anyone, or settles a dispute.

**Progressive penalties remain a proposed separately reviewed policy**, NOT an implemented feature: verified repeated unjustified conduct might eventually lead to warning, private flag, reviewed fine, then suspension/ban with due process. Exact thresholds, amounts, human reviewer/RBAC, payment/legal basis, notice, appeal and privacy retention are unresolved. First-time abort UI shows only a limited review disclaimer and never the entire ladder.

## Engineering changes

- `012_pickup_abort_cases.sql`: two small private tables with **one case per booking**, a case state `open`, and one append-only event per actor/reason. Restricted role grants (SELECT/INSERT only), RLS, no updating/deleting event history. Additive/replayable with existing 008→009→010→011; migration runner is expanded but **not run on staging or prod**. No fund collection or penalty schema.
- `PgRidesStore.getBookingHistory`: private participant-scoped, paginated read of active **and cancelled** bookings, original `Pending` or `NoPaymentRequired`, boarding proof, and non-secret pickup case summary. No driver contact details or PIN/nonce in historic projection. This *exposes* cancelled Pending but does **not yet correct** the active-only settlement guard; a follow-up policy must reconcile financial review and any booking restrictions.
- `PgRidesStore.pickupWaitStatus`: authenticated participant-only server time, persisted pickup report, eligible timestamp exactly 300s later and boarding/case marker. Client countdown is illustrative; server remains authority.
- `PgRidesStore.reportPickupAbort`: ride→booking lock, verified passenger/driver actor, valid reason, 300-second eligibility for ordinary claims and immediate safety exception, fail if passenger already PIN-confirmed for ordinary claim, unique booking case and event dedup, existing idempotent DB transaction. No ride/booking/financial mutation. A driver can *claim*, not mark someone guilty.
- Default OFF `PICKUP_ABORT_ENABLED` requires enabled PostgreSQL journey and boarding PIN. New `GET /api/bookings/history`, `GET /api/bookings/pickup-status`, `POST /api/bookings/pickup-abort` with existing session/CSRF, controlled idempotency, no-store and typed error codes.
- `index.html`: passenger and driver per-booking five-minute countdown, separate emergency action, accessible native modal with limited relevant disclaimer and reason picker. Never auto-cancels; only after explicit action. Adds read-only cancelled booking history, distinguishing free pilot versus historical Pending for review. Client uses authenticated server time offset; never treats client timer as enforcement.

## Planned and connected CI

- `RIDES_HTTP_PICKUP_DISPOSABLE_DB=YES npm run test:rides-http` is strictly guarded to loopback PostgreSQL database `campuspool_stage1_ci` only. New `bench/campus-pickup-abort.js` uses five session actors, real HTTP, security, early emergency, 4m59 versus 5m00, two concurrent opposing claims, idempotency, isolated passengers/boarding, no payment or seat mutation, canceled Pending history and 012 replay.
- `node --test test_browser_pickup_abort.js` verifies feature OFF, timer representation, no-show absent for boarded/cancelled, case status, escaped identifiers, dialog accessibility, retained-history messaging and script syntax. Run from Stage 1 workflow; no mock claims of physical Android.
- Preserve legacy booking/seat/load/GPS/OTP regressions. CI green ≠ production GO.

## Remaining risks and next task

1. **P1 finance/history:** existing active-only `checkUserSettlementBlock` still ignores cancelled `Pending`; visible history helps audit but does not decide whether future paid bookings should be blocked. Owner + policy + legal/payment review required. No silent waiver, charge or automatic account ban.
2. **Pending case resolution:** no approved reviewer role, disposition/appeal/time limits, privacy retention, cancellation consistency, no-show enforcement, payment gateway or legal fines. Cases remain `open`, with no self-adjudication endpoint.
3. **Timing trust:** driver may self-report pickup early. Five minutes controls abort *eligibility*, never proves physical presence. No messaging delivery acknowledgments, so "no response" is user testimony only.
4. **Physical Android:** TalkBack/200% text, focus after modal, dialogs on low-end/slow network, parked-driver safety **not executed**.
5. **Rollout:** stacked unmerged PRs, disposable DB tests required, G1 independently restored backup/recovery, migration and rollback review, scoped user cohort and explicit owner GO before any staging/production write.
6. **Upcoming hardening:** perhaps avoid case overflow for multiple user reports, add author RBAC/responses, independent cancellation/PIN race tests and a compatibility layer for historical finance. No automated enforcement without approved policy.

[Owner policy](2026-11-21-five-minute-pickup-abort-enforcement.md) · [Dispute architecture](2026-11-21-booking-disputes-and-no-show-rfc.md).
