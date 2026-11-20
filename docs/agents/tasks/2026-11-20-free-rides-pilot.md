# Settlement & Payment Safety — free rides-only pilot

- **Task ID / file:** 2026-11-20-free-rides-pilot
- **Status:** candidate / CI pending / activation NOT approved
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main 1020e2e; parent #57 f64aea5205f84a149b36c1fabb005064760ea376; #50 policy
- **Scope:** default-off PG rides, additive migration 009 in CI only, browser offer/booking, existing settlement guards.
- **Dependencies / related tasks:** #47–57, owner policy and migration approval, G1 NO-GO.

## Goal and acceptance criteria

Zero fare/payout/benchmark and no UPI for new free_pilot rides. NoPaymentRequired is distinct from Pending and never Paid. Preserve historical obligations including legacy zero fare. Feed and new bookings isolated by mode; owner read/cancel and original receipts retained. Existing CSRF, actor lock, seat and idempotency invariants remain. Repeat free booking/offer without new debt; payment APIs 501. No live activation.

## Current state (verified vs assumed)

#57 all four checks passed, 11 GPS and 3 browser VM cases, 29 privacy, 3880/3880 rush. Existing booking constraint Pending only and commission guard blocks users; payment APIs 501. Old zero-fare Pending remains historical state. Proposed voluntary no-money policy, not reimbursement or escrow.

## Plan

1. 009 adds mode columns default legacy, zero-money and status checks and composite FK. No data updates; repeatable disposable migration; candidate requires 009 readiness.
2. Default-off flag, PG only and mobility disabled. Strict zero inputs, server-controlled mode, locked ride decides booking status; historical settlement checks unchanged.
3. Browser explicit free label and offer, hide pricing inputs, no false payment confirmation.
4. Real HTTP mixed legacy/free tests, repeat migration populated DB, simultaneous duplicate, repeat free booking, existing commission, invalid states, cancellation and disabled APIs. Prior regression default off.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Skipping guards or inferring free from zero Pending could waive historical obligations. Use existing tables with constrained explicit mode and state, no external service.
- **Conventional alternative:** approved payment provider plus auditable ledger, needed for actual money later, not authorized now.
- **First-principles alternative:** eliminate new obligations entirely, not payment safeguards. Zero fare/commission, explicit no-payment state, reuse receipt transaction.
- **Tradeoffs:** two mode columns, redundant unique index/FK, separate migration review. No fuel reimbursement; adoption and seat-hoarding review needed. Multiple distinct free bookings allowed, same-ride duplicate and capacity constraints intact; no completion lifecycle or off-app solicitation enforcement. Mobility disabled; no mixed-code rollout.
- **Decision:** flag default OFF, owner approves voluntary free rides and separate migration. No fake Paid or historical waiver.
- **Evidence:** source 006 Pending check, API 501, #57 verified. Candidate CI pending.
- **Validation:** real mixed-mode HTTP, DB constraints, repeat 009, receipt/seat consistency, old zero and positive Pending preserved, earlier tests/browser E2E.

## Progress log

- 2026-11-20 IST — verified GPS, reviewed settlement deadlock and selected proposed no-money policy; implemented candidate, CI pending.

## Verification

| Test | Evidence | Result |
|---|---|---|
| Pilot | RIDES_HTTP_FREE_PILOT_DISPOSABLE_DB=YES npm run test:rides-http | pending |
| Default-off regressions | disposable CI | pending |
| Live migration | none | not applied |

## Risks and decisions

009 needs separate rehearsal, backup, target checks and approval; 008 preflight insufficient. Candidate requires schema. Flag off stops new free bookings, retains read/cancel and receipts. Never drop safeguards or convert free records to Pending during rollback. Historical obligations remain blocked pending reviewed resolution. No payments/refunds/waiver or legal compliance claim; no deployment. Device and UI copy review remain.

## Next steps — exact handoff

1. Inspect exact-head CI CAMPUS_FREE_PILOT_RESULT; correct failures. Review pilot policy/terms and UI before owner decision.
2. Independent review and owner; G1 separate.
3. Integrate stacked PRs, approve separate 009 staging migration and coordinated rollout.
4. Expected evidence: zero obligations from new free rides, old state preserved, no fake Paid, mode isolation and seat/receipt integrity.
5. Production impact: none.

## Links and files changed

- Branch feat/free-rides-pilot-2026-11-20
- migration 009, migrate.js, rides-store.js, server.js, index.html, test_pg_rides_http.js, bench/campus-free-pilot.js, CI and agent docs.
