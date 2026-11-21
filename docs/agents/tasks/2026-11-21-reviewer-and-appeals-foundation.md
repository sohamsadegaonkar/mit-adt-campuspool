# Case reviewer and appeals foundation — engineering handoff

**Date:** 2026-11-21 · **Branch:** `feat/case-review-appeals-foundation-2026-11-21` · **Parent:** Draft #67, stacked on #66 / #64 / #63 / #62 / #61 / #60.  
**Status:** source candidate. `CASE_REVIEW_ENABLED=false` by default. No provisioned live reviewer, no staging/production migration or settlement. **NO-GO**.

## Why

Pickup cases can now contain claims and two participants' responses, while cancelled/disputed legacy `Pending` stays visible for review. Without an independent reviewer and an appeal path there is no fair way to establish a record for support; but no financial, disciplinary or contract authority has been approved. This feature adds **administrative-only records and RBAC**, not enforcement.

## Scope and safety

- Additive migration **014** creates `campus_case_reviewer_grants`, `campus_case_review_decisions`, `campus_case_appeals`, `campus_case_appeal_reviews`. All have RLS and restrictive FK. The app role gets **SELECT-only** on grants, **SELECT/INSERT-only** on audit tables; no UPDATE/DELETE. No existing booking/ride/payment/OTP schema is modified. Migration replay preserves records.
- Reviewer grants are **NOT self-service**. Only an authorized DBA/operator may later provision an identified, verified `campus_users.id` for `case_reviewer` or `appeal_reviewer`, with explicit expiry and revocation. No permission grants, roles, or production secrets were created by this task. All endpoints fail closed without active roles; role records must be approved by the owner outside this PR.
- `CASE_REVIEW_ENABLED=true` requires `CASE_RESPONSE_ENABLED=true`, PostgreSQL identity, and migrations 012–014. The pickup-abort reporting flag may remain OFF. Without this flag the app exposes no reviewer/appeal actions; historical evidence is still frozen after review if schema 014 exists.
- Reviewer decisions are intentionally non-punitive categories: `no_action`, `insufficient_evidence`, `follow_up_required`. Before any decision, the record must contain a statement from **each ride participant**; the reviewer must not be the driver or passenger, and only one immutable decision per case is permitted. Same actor/code retries replay safely; conflicting/competing outcomes return 409.
- Participants may each submit **one appeal per case only after a review record**, with reason codes (missing evidence, mistaken identity, technical issue, safety context, other). Reasons are hidden from the other participant. The appeal is immutable and never changes the case, booking, payment, capacity or account flags.
- An independently granted `appeal_reviewer` may record one nonmonetary result per appeal (`review_record_unchanged`, `additional_review_required`, `insufficient_information`), but **cannot be the initial reviewer or a case participant**. Appeal reviewers may inspect only cases with a filed appeal and where they were not initial reviewer. Case remains `open` and no settlement/reputation effect is triggered; `additional_review_required` is a support record, not an automatic re-adjudication or waiver.
- Reviewer queue `GET /api/reviewer/cases?role=case_reviewer|appeal_reviewer` exposes only case/booking ID + timestamps; detail `GET /api/reviewer/case-detail?bookingId=...` returns categorical roles and statements only. Reviewer role checked **before** case lookup to prevent existence probing. No email/phone, PIN, GPS, payment identifiers, passenger names or detailed free text.
- `POST /api/reviewer/cases/decision`, `POST /api/bookings/cases/appeal`, `POST /api/reviewer/appeals/decision` require authenticated user sessions, existing CSRF/idempotency guard, DB transaction, scoped grants and row locks. No endpoint for creating reviewer grants.
- Existing participant case dialog adds review summary and a one-time appeal form (only if the server says eligible); it does not collect raw personal narratives, promise a response deadline or auto-popup during driving. Prior account data is cleared on session change. No reviewer administrative dashboard is enabled before staffing and privacy approval; staff-facing backend workflows are ready for an approved future console.

## Mandatory acceptance tests — disposable database only

1. Ordinary authenticated student and stranger cannot access reviewer list/detail/decisions, even knowing booking IDs. Unauthenticated and missing CSRF rejected. Role assignments do not exist by default.
2. Test-only privileged SQL provisions verified reviewer UUIDs with expiry; app role **cannot INSERT/UPDATE/DELETE** grants. Unauthorized, expired and revoked grants fail closed; no test grant affects real staging/production.
3. Reviewer who is driver/passenger cannot decide their ride, even if manually given role; appellate reviewer cannot review original decision made by themselves. Separate appeal role required.
4. Reviewer queue/detail contain only case IDs, categorical statements and timestamps; unprivileged case-existence oracle denied; appeal reviewers cannot inspect non-appealed cases.
5. A complaint from only one side cannot receive a decision; after both contribute statements a neutral review record is accepted. No fee, ban, charge, booking/seat/boarding/payment effect.
6. Same reviewer and same code retry idempotently; conflicting second review or contradicting appeal is rejected; concurrent submissions cannot overwrite earlier rows.
7. Each driver and passenger can submit one appeal after review, including after ride cancellation. Other participant cannot see private appeal reason. Appeals stay visible after relevant flag rollback without changing legacy Pending.
8. Separate appeal reviewer can record a bounded result; initial reviewer cannot decide own appeal, and no result updates an underlying case, booking or payment.
9. Migration 014 replay safe with populated decisions, grants and appeals; event app role cannot delete/alter audit. Disposable cleanup deletes children first; no live data is accessed.
10. Browser tests confirm hidden-by-default controls, accessible labels, escaped untrusted content, text-only statements, 200% text planned device follow-up and reduced-motion compatibility.
11. Verify exact-code GitHub Actions Stage 1 PG+HTTP, real browser E2E, security, Places, mobility load workflows. Record SHA and actual run IDs only after success.

## Deferred, explicitly not in this PR

No automatically implied guilt, strike, fine, suspension, ban, debt or refund. No payment provider or self-service reviewer onboarding, no reviewer permission granted in a live environment. **Active undisputed legacy Pending still has the compatibility restriction** requiring a separate fairness policy. Reviewer SLA, evidence standard, response windows, retention/consent/legal basis, staff governance, independent appeal escalation, real-money settlement, account reinstatement and notification delivery are unresolved.

**NO-GO:** G1 independently verified off-site backup/restore, migration 008–014 preflight and rollback, full stacked PR integration, physical Android TalkBack/large fonts and parked-driver UX, owner security/legal/policy approval and explicit deployment authorization. No production or staging writes authorized.

[Previous participant-response handoff](2026-11-21-participant-dispute-responses.md) · [Financial review handoff](2026-11-21-cancelled-pending-reconciliation.md).


## Final verified CI checkpoint — 21 Nov 2026

**Exactly tested application code SHA: `be358d6518c9fe69a42e2ded36f59e5f80b1d237`. All FIVE triggered workflows completed SUCCESS.**

- [Stage 1 PostgreSQL #44884061538](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44884061538) SUCCESS; logged actual `CAMPUS_CASE_REVIEW_APPEALS_RESULT` on a strictly disposable five-identity database: operator-only reviewer grants, app role no self-promotion, revocation denial, conflicted reviewer and self-appeal rejection, one-sided review denied until both participants gave statements, one initial review per case, one appeal per participant, independent appeal result, private reasons and timeline, immutable grants/events, flag-OFF freeze, migration **014 replay**, and **no financial/seat/booking/penalty effects**. Parent `CAMPUS_CASE_RESPONSE_RESULT` and `CAMPUS_PICKUP_ABORT_RESULT` also passed in the same run.
- [Real-browser desktop/mobile E2E #44884061505](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44884061505) SUCCESS, [security smoke #44884061503](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44884061503) SUCCESS, [Places server #44884061516](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44884061516) SUCCESS, [disposable PostGIS mobility benchmark #44884061497](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44884061497) SUCCESS.
- **Failure diagnosed then corrected:** first test run failed at the final synthetic one-sided-case setup with real `RATE_LIMIT_EXCEEDED` (429). The test was moved to direct disposable PostgreSQL store operations, while existing full HTTP reviewer, appeal, CSRF, idempotency and authorization tests remain intact. No production rate-limit configuration or code was weakened. Next run passed end-to-end.
- **No live reviewer grants**, no student/staging/prod data, no financial or Azure writes, no merge/deploy. All later commits adding the above evidence are documentation-only; cite the **exact application SHA** for passed code. Physical Android/TalkBack/200% text and parked-driver acceptance were not executed by desktop/mobile browser E2E. Default flag remains OFF.
- **Release NO-GO** until product/legal approval of active legacy Pending fairness, appeal process/SLA and reviewer training, explicit reviewer provisioning, G1 independently restored backup, migration 008–014 staging/rollback approval and parent stacked PR integration. No automatic money or account enforcement.
