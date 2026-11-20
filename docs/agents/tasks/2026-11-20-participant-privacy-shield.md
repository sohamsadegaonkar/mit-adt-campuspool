# Task: CampusPool Privacy Shield

- **Task ID / file:** 2026-11-20-participant-privacy-shield
- **Status:** in progress / CI pending
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main 1020e2e; parent #55 2e83809cfb9a443878328e97f5a48bcc173ae73c; policy #50 1c493e3
- **Scope:** both Rides HTTP backends, discovery/participant/receipt DTOs, GPS wire fields, browser feedback and unverified payment destinations. No live changes.
- **Dependencies:** #47–55, privacy/payment release gates; G1 independent.

## Goal and acceptance criteria

No discovery contact/email/UPI/free-form note/exact GPS. Own email retained for owner views; active passenger booking may include driver's phone only; driver sees booking name but not other email. Receipt and settlement metadata never includes counterparty contacts/UPI, including old stored receipts on normal and throttled replay. GPS authorization enforced before response, no redundant email; cancelled actors denied. Remove payment links/QR and generated VPA while both payment verification APIs remain disabled. Preserve booking, settlement rules, seat and idempotency invariants. Web refreshes active records after historical receipts and guards late cross-session private responses.

## Current state (verified vs assumed)

#55 all five checks green, 130/130 shared-IP reads, flag off. Source audit confirmed feed includes contact and UPI in both modes, SQLite feed publicly cacheable, old receipt JSON includes driver details, GPS redundant email. Existing active participant checks already in stores. Browser synthesizes UPI and calls third-party QR despite server payment endpoints 501. No live deployment audit in this task.

## Plan

1. Common explicit allowlists for discovery, owner, participant and historical receipt at HTTP boundary. Store safe receipt and project prior receipts at both replay paths. No new queries.
2. Reuse active booking read for contact. Clear stale UI state on session change, guard private fetch generations, reconcile successful receipts using active reads; remove unverified payments presentation.
3. Run four-actor disposable HTTP test including simulated pre-fix receipt, two passengers, outsider, GPS, cancellation and throttled replay. Existing CI preserved.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Existing verified sessions, owner/participant queries and receipt paths; project response fields before serialization, no new storage or query.
- **Conventional alternative:** separate contact service/token exchange; needless infrastructure and revocation complexity at present.
- **First-principles alternative:** no counterparty contact in discovery or historical receipts at all. Use active booking read as existing authorization boundary; identical safe feed across actors, no personalized shared cache. Withhold UPI without verified provider.
- **Tradeoffs:** Previously disclosed details cannot be recalled; old DB receipts remain until existing pruning; no live purge. Free text can still encode PII; note withheld, no universal DLP. Existing GPS persistence/freshness and read/cancel race remain separate; participant check point-in-time. No new dependencies. Browser visual/native compatibility review needed.
- **Decision:** Apply safe DTOs for both backends without flag, no new endpoint. Driver phone only for active booked passenger. Retain self email for compatible clients. Remove unsafe fabricated VPA/QR because payment APIs disabled, do not change debt rules. Source rollback requires alternate privacy safeguards.
- **Evidence:** #55 verified, actual server and browser source inspection; candidate unverified until CI.
- **Validation:** four real actors, feed ETag/visibility, receipt at rest and legacy replay, GPS matrix, canceled authorization, payment endpoint remains disabled and seat invariant. Existing CI and browser E2E.

## Progress log

- 2026-11-20 IST — verified #55; audited disclosure paths and payment UI.
- 2026-11-20 IST — implemented server projections, browser safety changes and isolated HTTP regression; CI pending.

## Verification

| Test | Environment | Result |
|---|---|---|
| Privacy HTTP | RIDES_HTTP_PRIVACY_DISPOSABLE_DB=YES npm run test:rides-http | pending |
| Existing regression | disposable CI | pending |
| Live / physical device | none | not run |

## Risks and decisions

No historical data deletion, no legal compliance claim. Current active contact available only while authorized at query time. Prior cached/disclosed data cannot be erased remotely; GPS TTL and storage retention remain open. Payment verification disabled, existing settlement restrictions unchanged; owner must approve pilot policy. No production operations. Test fixture uses synthetic PG; SQLite shares HTTP projections but targeted four-actor mode is PG. Browser E2E and independent compatibility review required.

## Next steps — exact handoff

1. **Next action:** inspect CAMPUS_PRIVACY_RESULT and regression CI, fix failures, review privacy and client compatibility, then explicit rides-only settlement policy and GPS retention.
2. **Who may do it:** application engineer / independent reviewer.
3. **Prerequisites and blockers:** review stack; G1 NO-GO; live approval separate.
4. **Expected evidence:** actual discovery/receipt redaction, current passenger access, denied outsiders/cancelled GPS, same receipt and seat consistency.
5. **Production impact:** none.

## Links and files changed

- Branch security/participant-privacy-shield-2026-11-20
- server.js, index.html, test_pg_rides_http.js, bench/campus-privacy-shield.js, .github/workflows/stage1-otp.yml; STATUS.md, NEXT_STEPS.md, DECISIONS.md, ARCHITECTURE_MAP.md, this task.
