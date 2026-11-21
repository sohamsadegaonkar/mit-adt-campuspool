# CampusPool — per-booking in-app boarding PIN (PR #62 candidate)

- **Task ID:** 2026-11-21-in-app-boarding-pin
- **Owner:** application engineering, independent security/product reviewer unassigned
- **Baseline:** QA audit PR #61 at `f94c0d5c5372c4a43daed26f69137e40c1bdd269` (stacked on draft journey #60)
- **Status:** code candidate, CI pending; migration 011 and feature OFF in all live environments
- **Decision:** pickup location mismatch = coordinate via authorized contact. Never treat pickup ready as boarded. At destination arrival driver report ≠ passenger verified boarding. No SMS/email code delivery. See `docs/agents/DECISIONS.md` and [audit](2026-11-21-journey-release-safety-audit.md).

## Scope / minimum complexity

One existing Node app + existing PostgreSQL rides/bookings and existing session/CSRF/idempotency protections. Extend the *booking* row rather than adding a service/event broker, a ride-wide PIN, provider messages or QR integration. Use one conditional `BOARDING_PIN_ENABLED` (default `false`) requiring `RIDES_JOURNEY_ENABLED=true` and PostgreSQL Rides, with secret-bound server derivation. No payment logic, driver GPS verification or autonomous completion.

## Implementation (branch only)

- Migration `stage1-otp/migrations/011_in_app_boarding_pin.sql`: additive `boarded_at`, private random `boarding_pin_nonce`, expiry, attempt counter and validated constraint on existing RLS-protected booking table; no plaintext PIN column and no schema downgrade. `migrate.js` applies after 008, 009 and 010 in disposable CI.
- `PgRidesStore.issueBoardingPin`: passenger-only, pickup-ready/active booking only; secure 24-byte random nonce, HMAC-SHA256 keyed with strong private `OTP_SECRET` and context-bound booking ID, six numeric digits, fixed 20-minute window; repeated request returns same code while current window active; expiry rotates nonce; 5 failed guesses lock until expiry. The PIN response is never stored in idempotency receipts. Server logs path/status only, no body.
- `PgRidesStore.verifyBoardingPin`: driver-only, stage pickup_ready, CSRF guarded, ride→booking locks (the booking row and `boarded_at` make successful retries idempotent without storing a PIN-bearing receipt), constant-time code compare and persisted failed-attempt counter, one `boarded_at` timestamp with atomic nonce clearing; same passenger retry gives stable alreadyBoarded response. One passenger cannot confirm another. No automatic `Paid` or commission change.
- `POST /api/bookings/boarding-pin`: private passenger PIN reveal from server, no email/SMS provider and Cache-Control no-store.
- `POST /api/bookings/verify-boarding-pin`: private driver check of booking ID and PIN, never returns the code; idempotent response contains only status/timestamp.
- `/api/bookings`: authenticated booking view includes `boardedAt` but not nonce, PIN, attempts or expiry. Driver sees own active-booking roster; passenger sees their own booking; no passenger PIN stored client-side or in idempotency receipts.
- `index.html`: passenger has one-click, on-demand PIN reveal after pickup-ready with instruction **share only after entering**; driver can verify separately per active booking. Driver-reported arrival without PIN shows unverified boarding. Code lives only in the current DOM, disappears on render/session change. Text status survives reduced-motion. No simulator posing as GPS.

## Test evidence / acceptance

Added strict disposable-only `bench/campus-boarding-pin.js` and `RIDES_HTTP_BOARDING_DISPOSABLE_DB=YES npm run test:rides-http` to Stage 1 PostGIS GitHub Actions, plus `test_browser_boarding_pin.js` Node VM. Pending CI execution confirms:

- Five actors, multi-passenger separated private issue; no active session/CSRF/other passenger/driver PIN read; no issue before pickup or after arrival.
- Unique nonce per booking, stable within window, expiry rotation, non-echoed driver response and no PIN in existing booking read models.
- Concurrent correct driver verifications consume one boarding event; idempotency and owned booking scope.
- Five concurrent wrong guesses lock; attempts persist; locked PIN cannot be reset until expiry; old code fails after rotation.
- Arrival records vehicle status but never marks unverified passenger as boarded; no auto payment settlement.
- Driver emergency cancel revokes outstanding PIN and cannot verify a cancelled booking.
- Reapply 011 on populated CI rows without changing existing confirmation state or Pending.
- Browser helper sanitizes passenger names, has explicit unverified status and reduced-motion/focus, all classic scripts compile.

## Known risks and release gates

- **No independent physical-presence proof:** passenger can tell the PIN remotely; ownership/boarded evidence does not settle false-reporting disputes.
- **P1 remains:** parent QA PR #61 reproducibly demonstrates cancelled Pending obligation disappearing from active settlement guard and history. This feature does not fix it; no automatic fees/refunds/forgiveness.
- **Offline/UX:** one authenticated server request needed at pickup. UI may require live phone contact, screen-reader review, 150–200% text scaling and slower-Android real-device validation; physical device test **not executed**.
- **Key rollover:** rotating private `OTP_SECRET` invalidates unconsumed derived PINs (expiry max 20 min); coordinate rotation outside live journeys and require private incident response.
- **Migration:** 011 is additive; startup requires 011 only if boarding flag enabled. Do not enable flag until independent backup+restore and 008→009→010→011 preflight, compatible application rollback and reviewed staged release. Never roll back to an old binary that ignores already departed stages.
- **Branch dependencies:** #47→...→#59→#60→#61→new feature. Main unchanged, no cloud/data operation.

## Next agent actions

1. Verify GitHub CI at exact feature-branch SHA and inspect `CAMPUS_BOARDING_PIN_RESULT`; fix source/test errors and rerun.
2. Independently review security of HMAC derivation, PIN guessing/abuse throttles and issuance logging, driver read-only passenger roster, abort/session transitions.
3. Resolve P1 cancelled-Pending dispute policy before any release; add negative/abuse acceptance tests.
4. Physical Android TalkBack, large fonts, focus and slow-network tests; capture sanitized evidence.
5. Coordinate backup/recovery + migrations and dependency-order merges only after explicit approval; retain release NO-GO.

## CI correction checkpoint

- The first disposable GitHub run reproduced a new test failure: incorrect PIN attempts were not counted through the generic success-only idempotency receipt wrapper. The implementation now uses an ordinary authenticated/CSRF-protected PostgreSQL transaction that commits 409/429 failed attempts, enforces five-try lockout, and returns alreadyBoarded for duplicate successful PINs. No sensitive PIN-bearing receipts are persisted. Repeat exact-head CI before sign-off; the initial failure must remain visible rather than being ignored.
