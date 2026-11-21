# CampusPool — cancelled Pending reconciliation (P1) engineering handoff

**Date:** 2026-11-21 · **Stacked PR:** #65 above pickup #64 → policy #63 → PIN #62 → journey safety audit #61 → journey #60  
**Status:** source candidate, disposable CI in progress; **NO CLOUD WRITES, DEPLOY OR PAYMENT**.

## Corrected invariant

When a **legacy** booking is cancelled, retain its original database `payment_status='Pending'` as historical evidence and preserve booked fare, cancellation timestamp, boarding PIN and pickup case. It must **never** disappear from the authenticated settlement review read, be automatically billed, paid, waived, refunded, fined, suspended or used alone to restrict new rides.

The previous active-only settlement predicate hid cancelled Pending. The previous driver calculation `seats_total-seats_left` reset upon ride cancellation, wrongly treating capacity as financially performed service. An unpaid marker does not prove that somebody travelled or owes money.

## Minimal fix (existing Node + PostgreSQL; no schema change)

- `PgRidesStore.checkUserSettlementBlock`: one MVCC SELECT and one pool acquisition using two independent aggregates plus the participant Pending rows, separated by `status='active'` versus `status='cancelled'`. The private caller's cancelled rows appear in `reviewRequiredBookings`, `hasReviewRequired`, `reviewReason='CANCELLED_PENDING_UNREVIEWED'`. An original cancelled booking is classified as `financialReview.state='CANCELLED_PENDING_REVIEW'` and `collectionAuthorized=false` in both review status and the existing paginated private history route.
- Driver cancelled legacy Pending is preserved as `driverCancellationReview:{count,originalFareTotal,state,collectionAuthorized:false}`; this is historical **face value**, not earned commission or an invoice. This is aggregate only; it does not expose other passengers' contacts, PINs or cases.
- Driver provisional active commission computation now comes from **active legacy booking rows**, not remaining seat capacity or driver-reported destination arrival. It remains clearly labeled **estimated, not collectible**. The pre-existing restriction for active unreviewed legacy bookings remains unchanged; cancelled review records **never cause an additional block**.
- `safeSettlement` projects the review-only records through the existing privacy-safe booking projection, without phone, UPI identifier, PIN or nonce. The driver-only aggregate does not include other passengers' identities.
- Frontend reads financial estimates from the authenticated server `/api/user/settlement-status`, not mutable client `seatsLeft` or optimistic frontend totals; historical Pending and driver cancellation review remain visible after the original ride disappears. Old "Due/Gross Collected/Take Home" labels changed to provisional estimates and notices explicitly deny that money was collected. When the private read is unavailable, the client does **not** invent a charge.
- No new migration, case resolution, ledger balance, account flag, payout, refund, money collection, recurring task, microservice, or live DB change. This keeps the smallest mechanism that fixes the inconsistency.

## Test scope

1. `test_pg_rides.js` independently derives the expected result from three simple reference SQL queries, checks exact one-snapshot store parity, one DB call, transaction client and rollback. Controlled synthetic seat counter drift cannot change provisionally booked commission; passenger and driver review counts survive cancellation.
2. `bench/campus-journey-lifecycle.js`: driver emergency cancellation leaves cancelled passenger Pending record visible in settlement as uncollected review, not an active unpaid restriction; owner case handling unchanged.
3. `bench/campus-pickup-abort.js`: two seats, one PIN-confirmed, concurrent claims followed by driver cancel, both records still visible privately; driver sees aggregate noncollectible historical fare only; no seat/money mutation.
4. `bench/campus-free-pilot.js`: cancelled zero-fare `NoPaymentRequired` bookings create neither debt nor Pending review for driver or passenger.
5. `test_browser_financial_review.js`: client never derives money from seats, even if client seat counter is distorted; driver review and status messaging do not assert paid/earned income; all inline scripts compile.
6. All pre-existing PostgreSQL, concurrency, security, browser, mobility, backup and deployment guard tests must stay green before any integration.

CI earlier found a **test fixture** expecting exactly two cancelled rows when earlier test subcases had already created additional cancelled bookings. The assertion was corrected to verify the **delta** caused by cancellation, not to clear/mutate historical state. Exact application-head CI must be confirmed separately.

## Policy limitations / release gates

- `Pending` means stored historical marker, **not** bank-verified payment, liability or an invoice.
- A cancelled `Pending` with no dispute claim must be called *unreviewed cancellation*, not automatically misconduct. A reported case or PIN is evidence for future reviewer, not proof that money is owed.
- No policy exists to adjudicate who owes what for interrupted ride, no show, or false arrival. The case reviewer/appeal role, financial provider, legal terms and sanctions are not authorized.
- Existing **active legacy booking** restrictions are preserved for backward compatibility; this does not approve indefinite punishment or auto-collection. In zero-fare pilot, the `NoPaymentRequired` state creates no monetary debt.
- Operator review is pending. The historical status cannot be deleted or changed to Paid/NoPaymentRequired without explicit verified owner/financial policy and independent audit.
- Cases are review-only, no issuance of fine/ban, refund/credit/waiver or automated settlement through this PR.
- **NO-GO** until G1 independent backup+restore, signed staged migration of ancestor 008–012, mobile Android/TalkBack/slow-network/parked driver tests, and independently reviewed complete draft PR chain.

## Next task after CI

Close any failing regression, verify exact commit evidence, then plan the **read-only authorized operator reconciliation queue / appeal workflow**—not an automatic payments engine. The review queue must apply fairness, retention, role checks and human decisions to historical Pending records. Do not add "pay now" buttons or user punishment.

[PR #65](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/65) · [5-minute abort PR #64](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/64) · [dispute RFC #63](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/63).
