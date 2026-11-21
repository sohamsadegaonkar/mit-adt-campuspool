# CampusPool pickup waiting & contextual abort policy — 21 Nov 2026

**Status:** Owner-decided product behavior for the five-minute mutual waiting limit and progressive consequence concept. **Not implemented, not live.** Monetary fines, ban thresholds, enforcement authority and legal terms remain to be approved separately.

**Parent architecture:** Draft PR #63, the [booking dispute RFC](2026-11-21-booking-disputes-and-no-show-rfc.md); parent boarding PIN PR #62.

## 1. One five-minute window for BOTH people

- The driver and passenger each have a maximum pickup wait obligation of **five minutes (300 seconds)**. Not five minutes per person; not ten minutes combined.
- Start at the database-recorded driver **pickup_ready** milestone timestamp. The server calculates eligibility using that timestamp plus 300 seconds. This is **driver-reported arrival at pickup**, not verified GPS and not evidence of actual physical presence.
- Show the remaining time in the app with accessible text if the user has an active booking. The UI countdown must derive from authenticated server state and must not reset on refresh, device change or app restart. The server must enforce the deadline when a pickup-abort claim is submitted.
- During the window either party can contact the other using authorized contact. If a real safety or medical emergency exists, an immediate safety abort/report must be available without waiting five minutes.
- If both parties successfully coordinate after five minutes, they may voluntarily proceed, but neither is forced to wait beyond five minutes.

## 2. At five minutes: prompt the waiting user, do not auto-cancel

Condition: driver has reported pickup-ready, **one party reports that the other is not responding**, passenger has not completed the in-app boarding PIN, and the server's 300-second deadline has elapsed.

Then **show the reporting/waiting party** a non-alarming contextual confirmation with:

**Title:** Pickup still unresolved

**Body:** Five minutes have passed since pickup was reported. You are not required to wait longer. Would you like to abort this pickup attempt?

**Actions:** Continue coordinating / Abort pickup / Report safety issue

If the user presses Abort, ask for the relevant reason: Could not find driver/passenger; No response after contact attempt; Other party changed plans; Safety or emergency; Other (optional short bounded text). Then confirm and persist an authenticated **pickup-abort claim**. **Do not infer silence from a closed browser, an unread app notification or a missing in-app response**; external calls cannot establish that someone deliberately ignored a contact attempt.

No automatic five-minute cancellation, no automatic no-show adjudication, no immediate seat release against existing post-departure rules, and no payment/fee/debt mutation. Abort means *end the pickup attempt and open/append a case for appropriate review*, not automatically cancel an entire driver's journey or mark every passenger absent. Preserve original booking status, ride milestones, per-booking boarding verification and financial markers until a separately reviewed transaction may lawfully alter them.

The unresponsive person, when they next open CampusPool, should see the abort claim and be able to respond. No hidden assumption that push delivery succeeded. Don't spam repeated popups or make drivers interact while the vehicle is moving. One booking-scoped case with deduplicated events is sufficient.

## 3. Different situation, different warning

| Situation | Suggested disclosure | Consequence stage |
| --- | --- | --- |
| Contact attempt during 0–5 min | Contact your driver/passenger to coordinate pickup. | None |
| Five minutes expired, pickup unresolved | You may abort the pickup attempt. Your report will be recorded. | Claim only |
| First ordinary abort, no confirmed past misconduct | Deliberately false or unjustified reports may be reviewed. | No instant strike |
| First **verified and unjustified** action, after review | This action violated pickup rules. Please avoid repeating it. | Warning |
| Repeated **verified** unjustified behavior | Continued violations may place your account under review and lead to restrictions. | Private account flag, appeal |
| Persistent repeat violations; fine policy is independently approved and legally supported | Further confirmed misconduct may result in a monetary penalty under the published policy, with a chance to contest it. | Reviewed fine **only after separate payment/legal approval** |
| Further confirmed repeat violations following notice and fair review | Further misconduct could lead to temporary suspension or a ban; appeal is available. | Reviewed restriction or ban |
| Genuine safety, accessibility, medical emergency or loss of connectivity | Safety comes first. Report the issue; you do not need to wait five minutes. | No automatic accusation or penalty |

**Do not display the whole escalation ladder in one popup.** Use only the immediate warning relevant to that person's validated prior history and current reason. Do not call a person a repeat offender based on allegations or a self-reported driver pickup milestone. Strikes must be earned by **confirmed unjustified cases**, not complaint count. Reversed or unsupported decisions do not count. Give both parties notice and a way to challenge evidence.

**Product intent:** warning, then private flag, then a fine for repeated verified abuse, then suspension/ban if misconduct continues. Fine **amount**, number of qualifying occurrences, lookback period, who can issue sanctions, legal basis, consent/terms, payout provider, chargeback/appeal rules and limits remain **OPEN**. This is a design ladder, not automatic enforcement authorization. Under the current zero-fare pilot there is no live payment or debt collection system, so fines **cannot be charged** and a free ride stays NoPaymentRequired. Existing legacy Pending rows must never be repurposed into penalty debts.

## 4. Critical corner cases

- A driver may report pickup-ready early to start the timer unfairly. A timer alone cannot prove presence. A passenger can contest; no automatic fault finding.
- A passenger may be present but not able to find the vehicle. This is pickup coordination, not proof of a no-show.
- The driver may have several passengers. Boarding PIN confirmation for one must never turn another into boarded or punish them. A reported absent passenger does not cancel already boarded riders' journey.
- A driver may have left, arrived at destination or cancelled. Driver-reported destination arrival must not justify penalty for a passenger who has no verified boarding record.
- If the passenger's PIN was verified before a pickup-abort attempt, ordinary "never boarded" handling is invalid; open a conflicting/interrupt case for neutral review.
- No response because of poor cellular coverage, service cold start, browser logout, a notification not delivered, or accessibility obstacles is not deliberate misconduct.
- Emergency reporting and safe abort may happen before the 300-second clock; don't block safety behind a timer or threatening fine banner.
- A driver does not have to wait more than five minutes to continue the route when another passenger is genuinely unavailable; this is separate from adjudicating the unavailable passenger.
- Case events and boarding proof remain in private, role-checked history even after driver cancels, travel status changes or the feature is disabled.

## 5. Minimal implementation later — no new infrastructure

**Reuse** the existing Node/PostgreSQL monolith, ride pickup timestamp, booking row, PIN verification field, participant sessions, CSRF and proposed case/event tables from RFC #63. No SMS, live chat, Redis, Kafka, background scheduler, wallet, new microservice or automated enforcement engine.

- Client countdown is presentation only. Server's authoritative time determines eligibility at an ordinary no-response abort request.
- Contextual popup appears only after expiry **and unresolved pickup**, e.g. when an authenticated user reports the other side absent. Do not open it indiscriminately while somebody is already boarding.
- Booking-scoped abort mutation uses ride→booking→case locking, a single consistent database transaction and idempotency. A false abort cannot silently free or double-sell a seat.
- Mutations are logged as minimal nonsecret case events with actor, server timestamp, reason, and who claims what. Do not log PIN, phone conversation, precise location, payment identifiers, personal medical details or user secrets.
- The proposed account-action ladder requires a separate authorized reviewer/RBAC enforcement record and audit with notices/appeal. Do not activate monetized or punitive endpoints until the owner approves the thresholds/amounts, law/terms, data protection and payment integration.

## 6. Acceptance cases to add to the RFC suite

| ID | Synthetic case | Required result |
| --- | --- | --- |
| W01 | Either party at 4:59 | No ordinary unresponsive abort eligibility; contact remains; early safety reporting allowed |
| W02 | Either party at exactly 5:00 | Same server-derived deadline for driver and passenger, regardless of client clocks |
| W03 | Browser refresh, logout/relogin, device change | Does not restart or prolong the shared pickup timer |
| W04 | Timeout with one side reporting nonresponse | Situational confirm; no auto abort, fine or strike; persist claim only on explicit action |
| W05 | Coordinated pickup / passenger PIN verified | No no-show confirmation; allow normal boarding status and route progress |
| W06 | Driver falsely self-reports pickup-ready early | Report is contestable; clock does not automatically justify fault, fee or ban |
| W07 | App offline, no push, bad network, delayed response | No false guilty status or double claims; replay/readback is consistent |
| W08 | Emergency at 0:30 | Immediate safe abort/report available without waiting and without automatic threat |
| W09 | One booked passenger boarded, one missing | Independent statuses and separate cases; no whole-ride cancellation assumption |
| W10 | Repeat claims or concurrency at 5:00 | One open booking case; no seat mismatch, money mutation, duplicated penalty or event |
| W11 | No previous confirmed violations | Only relevant plain disclaimer; no invented fine or ban |
| W12 | Review-confirmed repeated misconduct | Appropriate escalated private notice, human review and appeal; no unapproved monetary charge |
| W13 | Unauthorized outsider or other driver submits abort | 403; no student case information leaks |
| W14 | Reviewer overturns disputed claim | Remove strike from escalation eligibility while retaining protected resolution audit |
| W15 | Real Android TalkBack, 200% font, slow network, parked driver | Visible focus, countdown announced without incessant live-region speech, non-coercive safety flow |

**Status:** Requirements and test plan only. No runtime code, migration, sanctions, feature flags, production data or payment operations changed. Previous PR #63 remains a draft RFC, and G1–G6 release gates remain NO-GO.

## Source links

- [Booking dispute architecture PR #63](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/63)
- [In-app boarding PIN PR #62](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/62)
- [CampusPool private production roadmap](https://app.notion.com/p/41dca5237af5819ba7d3c3f9bff9b088)
