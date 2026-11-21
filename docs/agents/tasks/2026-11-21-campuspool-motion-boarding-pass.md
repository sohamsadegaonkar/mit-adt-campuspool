# CampusPool Motion Language — booking and boarding pass (v1)

- **Task ID / file:** 2026-11-21-campuspool-motion-boarding-pass
- **Status:** implementation candidate, CI pending, unmerged and undeployed
- **Agent / owner:** application engineering; design/product review pending
- **Last updated:** 2026-11-21 IST
- **Baseline:** main 1020e2e; parent PR #58 at ddc8932; minimum-complexity policy PR #50
- **Scope:** existing index.html styles/DOM, one isolated JS VM test, existing PostgreSQL CI path; no backend, schema, infrastructure, assets, external animation library or deployment change.
- **Dependencies:** stacked app PRs #47–58 review; UI/device validation and G1 separate.

## Goal and acceptance criteria

Create a distinctive yellow/black boarding pass for active ride bookings. Animate a ticket stamp only when the newly received POST receipt's booking ID is found in a subsequent successful authenticated GET of current bookings under the same session. A replay of a cancelled booking or a lost private refresh must not celebrate. Show seat availability markers and a short movement only when an already-displayed ride's *verified* GET result changes seat count; no fake GPS or journey state. Preserve privacy, sanitization, contact only for active passenger, no false payment state. Avoid loops, heavy canvas or dependencies. CSS supports narrow phones and prefers-reduced-motion.

## Current state (verified vs assumed)

PR #58 ddc8932 6/6 reported CI checks passed; pilot is proposed/default-off and migration 009 not approved live. Existing booking handler gets receipt and calls syncUserBookings without awaiting current state. Existing My Rides shows active results; old receipt can be replayed after cancellation, so a POST 201 alone is insufficient to celebrate. Current server does not have a real departure/arrival state machine; static route illustration must not be portrayed as tracking. No live UI verification.

## Plan

1. Isolated pure, testable motion helpers and namespaced CSS in existing index.html. Boarding pass shows safe route/departure/fare/payment-status already from active private booking; no new PII.
2. On receipt, re-fetch current bookings and check same verified session+booking ID before one-time ticket stamp. Do not persist animation state or create fake reservations. If refresh unavailable, display truthful receipt status.
3. On fresh ride GET, compare prior *ready* snapshot and animate seat dots when count changes. No animation from cached/initial feed. Keep keyboard and focus behavior unchanged.
4. Add browser VM tests for state transitions, XSS safety, payment copy, historic receipt, session change, reduced-motion policy and full inline JS syntax. Run existing browser/PG CI. Device/visual review remains separate.

## Minimum complexity review

- **Level:** small (UI-only, no backend/security/payment change)
- **Existing / smallest:** Reuse existing confirmed POST receipt and authorized GET; render HTML/CSS with inline SVG and a CSS class toggle; no duplicate API or new state service.
- **Decision:** No looping animation, no auto-drive or ETA, no motion that claims an unverified booking, no external libraries or asset downloads. Animate only verified state transitions, respect reduced motion.
- **Validation:** static/VM checks and full CI; manual low-end Android and screen reader review required before release.

## Progress log

- 2026-11-21 IST — read Notion user preference and verified #58 CI. Designed a first small motion slice tied to real booking/seat data; implementation drafted for PR review.

## Verification

| Check | Evidence | Status |
|---|---|---|
| New motion VM regression | node --test test_browser_motion.js | pending CI |
| Browser idempotency and GPS | existing CI | pending |
| PostgreSQL end-to-end and Rush Hour | existing CI | pending |
| Visual accessibility and device QA | real browser/phone | not run |

## Risks and decisions

No real movement/progress animation until a trustworthy journey lifecycle exists. Prefers-reduced-motion removes ticket and seat animations but retains visible labels. Displayed contact still requires current booking authorization; no PII exposed to feed. Browser timers/refresh races may suppress celebratory motion rather than mislead, a deliberate fail-closed UX tradeoff. Ticket reference is only a shortened server booking identifier, not an authentication credential. No new third-party animation, media requests or runtime dependencies. Prior design references are conceptual, not production screenshots.

## Next steps — exact handoff

1. Check exact PR head source syntax, motion VM tests, browser E2E and PostgreSQL CI; fix genuine failures.
2. Independent reviewer inspects booking+logout races and low-end mobile behavior; verify contrast, focus, WCAG reduced-motion and text scaling.
3. Review and integrate stacked PRs; do not deploy or enable pilot based on this UI work. Next design independent ride lifecycle events if backend state is implemented and measured.
4. Files changed: index.html, test_browser_motion.js, .github/workflows/stage1-otp.yml, docs/agents/STATUS.md, NEXT_STEPS.md, task file; no runtime server/schema change.

- 2026-11-21 IST — corrected three template literal interpolation syntax errors before PR; inline script parse checkpoint: Inline classic JavaScript parsed with Function. New VM/CI still required.
