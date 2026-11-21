# CampusPool Motion Language — implementation rules (v1)

**Status:** design direction confirmed. First implemented slice is draft PR #59; not deployed. **Last checked:** 2026-11-21 UTC.

## Product character

CampusPool motion should resemble a friendly boarding-pass and campus journey experience: yellow (#facc15), ink black (#171717), white, restrained typography and no neon. Animated moments must explain real outcomes, not distract.

## Trustworthy animation contract

| Trigger | Motion | Evidence required | Must never imply |
|---|---|---|---|
| Booking completed | Boarding pass enters, ticket stamp | POST receipt followed by successful authenticated GET of the same active booking under same session | A cancelled historical receipt is still active |
| Seat count changes | Seat glyphs briefly snap or release | Changed verified ride-feed count after previous ready snapshot | Locally assumed reservation or capacity |
| GPS sharing enabled | Subtle live indicator | Fresh authorized GPS fix inside TTL | Old GPS pin is current |
| Journey milestone (future) | Car progresses once to named state | Real persisted server ride lifecycle transition | Time-based progress is GPS or ETA |
| Cancellation (future) | Seat releases | Confirmed cancellation and refreshed seat count | Refund or financial forgiveness |
| Timeout or unavailable | Static clear feedback | Verified error handler | Payment, reservation or trip succeeded |

Continuous car animations are allowed as clearly labeled illustrations only, never as live ride tracking. Do not start infinite animation for inferred journey progress.

## Motion and accessibility

- Tap feedback around 120–180 ms; seat change 360 ms; ticket reveal about 650 ms once. Avoid simultaneous oversized effects.
- Prefer CSS transforms/opacity, inline SVG and short class toggles. No canvas engines, animation library, extra network calls, continuous loops or permanent will-change.
- Respect prefers-reduced-motion; static final states remain fully readable. Use text and explicit status, not color/movement alone.
- Keep keyboard focus stable, provide visible focus rings and high contrast. Verify 320–380px phones, text scaling, and slower Android hardware.
- Sanitize all server strings before HTML insertion. Booking references and participant contact belong only in authorized private views.
- Never animate payments, GPS, departure or arrival without verified corresponding backend evidence. No fictional ETA or fake paid badge.

## Current code, owner and next steps

- [Draft PR #59](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/59): namespaced CP CSS, short SVG and helper functions in index.html, no new dependency or backend. [Task/evidence](tasks/2026-11-21-campuspool-motion-boarding-pass.md).
- Review visual presentation with real low-end Android, screen reader, large text and reduced motion. Implement real journey state machine before live progress animations.
- Existing pilot #58 remains unapproved/default-off; no production release or live payments authorized.
## Journey timeline (candidate #60, not deployed)
- **Source of truth:** authenticated driver-reported PostgreSQL milestone and timestamp. Stages scheduled, departed, pickup_ready, arrived. Never portray as independently GPS verified.
- Change animation only when a previously seen authorized private snapshot advances to a later stage; no animation for initial/loading/stale receipts.
- Color and movement complement readable status text, paused/disabled in reduced motion. Driver should only report while safely parked; product/driver safety validation pending.
