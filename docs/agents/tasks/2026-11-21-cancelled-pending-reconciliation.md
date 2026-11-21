# Cancelled/Disputed Pending Reconciliation — CampusPool 2.0

**Task date:** 2026-11-21  
**Branch:** `fix/settlement-pending-review-2026-11-21`, draft PR #66, above pickup abort PR #64 → design #63 → boarding PIN #62 → journey safety #61.  
**Status:** Candidate code, CI pending; no staging/production migration, money movement or adjudication.  
**Source prior bug:** safety audit PR #61 and [pickup implementation handoff](2026-11-21-pickup-five-minute-implementation.md).

## Precise defect

`PgRidesStore.checkUserSettlementBlock` used an **active-only** `campus_bookings` filter, and computed **enforceable driver commission** as `SUM((seats_total - seats_left) * student_fare) * 10%`. But cancelling a ride sets all active bookings to `cancelled` and returns seats, without changing `payment_status='Pending'`. A legacy `Pending` booking could disappear from review, and an open reservation could trigger a phantom driver commission without evidence of completed ride or any verified payment.

Earlier commits added private history `GET /api/bookings/history` and an append-only pickup case, but left this separate guard inconsistent. Green PG tests for history were **not** sufficient to call financial review fixed.

## Minimum corrective architecture

Do not add payment providers, charges, wallets, ledger microservices, automated penalty or migration 013. Reuse existing booking and case data; **no SQL payment-status update**:

1. One read-only **SQL snapshot** with no extra pool acquisition: all authenticated passenger legacy `Pending` bookings, irrespective of booking or ride cancellation; driver-side *count of legacy Pending bookings on their own offered rides*. Conditioned case join only when the feature-enabled case schema is present.
2. **`pendingBookings` = active legacy Pending bookings on active rides without an open pickup claim.** Keep the *existing* booking restriction for these while the owner has not decided replacement entitlement/settlement policy. This is a booking restriction, **not evidence of payable debt**; labels never suggest charging.
3. **`reviewRequiredBookings` = cancelled, ride-cancelled or pickup-disputed legacy Pending.** Return `reviewStatus='REVIEW_REQUIRED'` and `hasReviewRequired`; do **not** hard-block new rides from these review-only markers. Preserve `Pending`, original fare/mode, cancelled_at, boarded_at, nonsecret case status. No waiver/forgiveness, no `Paid`/refunded rewrite.
4. **Driver legacy Pending count remains** as `driverReviewCount` for review visibility even after seat counters reset; never make `seats_total-seats_left` a payable commission. `commissionDue=0`, `hasUnsettledCommission=false` and canonical `driverCommission.netDue=0` until an actual approved, bank/provider-verified settlement and service ledger exist.
5. Free-pilot `NoPaymentRequired` booking remains excluded from legacy Pending; zero fare cannot be turned into debt, fine, payout or charge.
6. `safeSettlement` redacts all review bookings through existing historical private projection (no phones, OTP/PIN, bank IDs, exact GPS); server checks session/CSRF, and writes continue to use transaction-scoped restrictions.
7. Browser uses authenticated server financial review snapshot. No local seat-count monetary math. `Not payable` and `Review required` are **explicitly not proof that the underlying financial history was settled or forgiven**. If review data are unavailable, display uncertainty, not fake dues.

**Policy tradeoff:** the active-only legacy `Pending` booking restriction is preserved for compatibility. This may be strict for a person with an unresolved active booking, and remains a **separate owner/product fairness decision** requiring support, appeal and verified payment policy. Avoid declaring it a completed debt or a penalty. A pickup-disputed active record is held for manual review rather than automatically hard-blocking, but case creation itself does not rewrite payment state or mean a student was in the vehicle. Confirmed service requires stronger evidence.

## Regression matrix

| Scenario | Expected outcome |
| --- | --- |
| Active legacy Pending, no case | Remains in `pendingBookings`; restriction preserved, no automatic payment |
| Cancelled legacy Pending | Moved to `reviewRequiredBookings`; original SQL Pending retained; no new booking restriction from this record |
| Driver cancels ride, seats reset | Driver still has `driverReviewCount`; **no collectible commission** computed from changed capacity |
| Two riders, one case open | Disputed rider's Pending in review; other rider remains independent, active restriction if otherwise applicable |
| Driver/pax claim concurrently | One pickup case and evidence preserved; finance read doesn't create another charge or case |
| PIN verified vs driver self-report | Neither alone settles money; original PIN/ride fields preserved |
| Free-pilot NoPaymentRequired | Not in legacy Pending/review/debt; no paid commission |
| HTTP unauthorized or stale session | No review leaks; server owns actual restriction enforcement |
| External transaction with cancellation | Read uses single SQL statement on same client; sees uncommitted row changes, rolls back correctly |
| Browser with full seats, no verified payment | No client-created rupee commission or artificial debt |
| Staging schema without migration 012 | Case join only when feature enabled; legacy Pending classification still works; no forced production migration |

## Evidence, caveats and release gates

- Existing PostgreSQL parity integration tests now compare new single-statement result with a separately assembled two-query reference, including before/after driver cancellation and external transaction rollback.
- Real disposable HTTP pickup suite asserts active vs disputed vs cancelled reconciliation, driver review count/zero commission, no phone leaks, no cap/seat/money write, and case migration replay. Free-pilot suite asserts a driver is not blocked from offering free ride by phantom legacy capacity-derived commission.
- Browser VM test verifies no seat-derived monetary math; review-only banner; active restriction preserved and safe syntax.
- **CI pending at initial commit:** wait for exact-code `Stage 1 PostgreSQL OTP`, browser security and mobility pipelines. Record exact SHA, failure fixes and run IDs only after real logs.
- **NO-GO:** legal and owner policy for eventual collectible obligations, legitimate rider access, case reviewer RBAC/appeal, G1 independent backup/restore, staged migration 008–012, physical Android accessibility, reviewed parent PR chain and production release. This is an **internal candidate**, not real billing. Do not merge/deploy until explicit GO.

## Exact-code verification checkpoint — 21 Nov 2026

- **Tested application SHA: `ed9fd5b458a47ef9ea283369f1ed60d482bc6c66`.** [Stage 1 PostgreSQL #44881146242](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44881146242) **SUCCESS** on exact SHA.
- Source logs verified: `SETTLEMENT_QUERY_RESULT` confirms six-identity query parity, 12 reference calls versus **7 single-statement store calls**, external transaction one-query read, rollback/cancellation parity. `CAMPUS_PICKUP_ABORT_RESULT` confirms cancelled/disputed Pending preserved, feature-flag rollback does not reclassify a disputed record into blocked, no capacity-derived commission, multi-actor separation, unchanged payment status, and migration 012 replay. `CAMPUS_FREE_PILOT_RESULT` confirms zero monetary violations, no review debt after free cancellation and legacy driver's phantom commission not collectible.
- **Two red checks were addressed transparently**: the initial browser VM test matched explanatory text about removed seat arithmetic (not executable code), and the SQL regression assumed a driver had exactly three Pending bookings when older synthetic test fixtures had more. New assertions ignore comments and assert complete baseline preservation + delta after cancellation; subsequent Stage 1 passed.
- [Security smoke #44881146194](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44881146194) and [Places #44881146300](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44881146300) also **SUCCESS** at tested SHA. [Real-browser E2E #44881146216](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44881146216) was **IN_PROGRESS** at this recording; check final conclusion before claiming all green.
- Additional frontend hardening removes misleading "Weekly Due", "Gross Collected", "Settle Commission (UPI)", fake transfer prompt and forced-settlement copy. The original `Pending` and independently stored case records remain intact.
- **Release NO-GO** persists regardless of green CI: active unchallenged Pending access policy must be independently reviewed for fairness, reviewer and appeal RBAC absent, payment provider/terms absent, physical Android incomplete, G1 backup restore and 008–012 staging migration not approved, stacked PRs unmerged. **No staging, production, user billing, payout, penalty or ban write.**
- Documentation-only commits made after the application SHA do not alter the tested program; verify current head CI before merging.

## Verified browser/CI conclusion — exact tested code

The previously IN_PROGRESS [real-browser E2E #44881146216](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44881146216) **COMPLETED SUCCESS** on the same exact application SHA `ed9fd5b458a47ef9ea283369f1ed60d482bc6c66`. **All four triggered checks** (Stage 1 PostgreSQL, real browser, security smoke, Places) completed SUCCESS. This does not replace physical Android/TalkBack/parked-driver tests or approval of actual payment liability. The subsequent documentation-only commits do not change the tested application code.
