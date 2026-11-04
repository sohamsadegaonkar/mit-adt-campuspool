# Task: Flutter Phase 3 — verified campus sign-in & read-only ride search

- **Task ID / file:** `2026-11-04-flutter-session-login`
- **Status:** in review — draft PR #21; never deployed
- **Agent / owner:** ChatGPT engineering agent; independent reviewer unassigned
- **Last updated:** 2026-11-04 UTC
- **Baseline:** `feat/flutter-phase2-platform-states-2026-11-04@f43f8139bcb89170f7f1faa74d7249b4e3431fb7` (draft PR #19, stacked on draft PR #17). `main` unchanged.
- **Scope:** Flutter client session transport (web/native), email OTP request/verify and confirmed profile, real server-gated ride feed, UI tests, docs; NO Node/Render/DB changes, booking, payment, production configuration, OTP provider modification or release.

## Goal and acceptance criteria

1. Replace the non-authentic “Preview signed-in layout” action with actual API login-request, email-OTP verification and server `/api/auth/me` session validation before signed-in UI state.
2. Web must be **same-origin only** with browser-managed HttpOnly cookie; native must use **in-memory-only** cp_session cookie with no insecure arbitrary origin or disk persistence. Neither stores OTPs, session cookies, CSRF tokens or student identities in app preferences, URLs or logs.
3. Allow real authenticated, read-only ride cards (summary fields only); guests cannot query protected rides, and no booking, driver contact, UPI, payment or raw coordinate fields are exposed.
4. Support error/rate-limit/provider-unavailable/invalid-code states, real logout with server CSRF, revoked-session fallback, and disabled flow when backend is not configured.
5. Pass static analysis, mock HTTP and widget tests, web release & unsigned Android debug build. Device QA, provider delivery and production deployment remain separate gates.

## Current state (verified vs assumed)

- At 2026-11-04 UTC: draft PR #19 head `f43f8139`, PR #17 head `df65ad1`, neither merged into `main@056cd26`.
- Node `POST /api/auth/login-request` accepts `identifier`; `POST /api/auth/verify-email-otp` accepts `email`, `otp`, `isLoginFlow:true` and sets HttpOnly `cp_session` after success. `GET /api/auth/me` confirms identity and a CSRF token. `POST /api/auth/logout` requires session-linked CSRF. `GET /api/rides` is blocked without server authentication. Existing CORS **does not allow credentialed cross-origin browser requests**.
- Flutter Phase 2 CI analyzer and 19 tests passed; prior web release and unsigned Android debug compilation passed. No real mobile installation/provider verification has been performed.
- Backend OTP delivery, staging backup/restore and rollback proofs remain separate P0 no-go gates. This code never tests against student accounts or live databases.

## Plan and implementation

1. Add `session_transport_io.dart` native client with same-origin restriction, bounded session-cookie capture, redirect refusal and memory-only logout cleanup. Add `session_transport_web.dart` same-origin browser credentials; no JavaScript cookie read.
2. Add `CampusAuthApi` for generic OTP request, OTP verify, authoritative `/api/auth/me` session check and CSRF-protected logout. Use UI-neutral sanitized errors and a controller that invalidates stale asynchronous responses.
3. Replace the fake sign-in control with `CampusLoginScreen` and Figma styling; signed-in buttons/profile/ride results depend only on `CampusAuthController.isAuthenticated`. Keep guest navigation/CTAs at original positions.
4. Test API-side auth, rejection, cookie, logout and widgets with mocks; run CI and explicitly record evidence. Never deploy automatically.

## Progress log

- 2026-11-04 UTC — Examined existing Figma identity styling, Node legacy/Postgres auth paths, CORS and CSRF checks, Flutter Phase 2 client and prior failing/review gates. Created stacked branch `feat/flutter-phase3-session-login-2026-11-04`.
- 2026-11-04 UTC — Wrote session transports, OTP API, session controller, configured runtime, login UI and signed-in shell gating. Removed the fake login shortcut. Added mocked tests for successful & rejected sessions, logout, native cookie/origin validation, and real signed-in UI.
- 2026-11-04 UTC — Static analysis, tests, and platform build evidence are **pending CI**; no real OTP dispatched and no production/staging mutation.

## Verification

| Check | Environment and command | Result |
|---|---|---|
| Server routes and trust boundaries | GitHub source at exact `main@056cd26` | Verified in source, not live |
| Flutter static analysis | [CI #41796997734](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41796997734), source `503b5ba` | PASS on Flutter 3.47.7 |
| Mock authentication / UI tests | [CI #41796997734](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41796997734), source `503b5ba` | PASS — 28/28 tests |
| Browser release compile | [CI #41796997734](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41796997734), source `503b5ba` | PASS |
| Android unsigned debug | [CI #41796440947](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41796440947), source `f8d2ccf` | PASS; latest security-source rebuild in CI #41796997734 pending at this checkpoint |
| Real OTP delivery, device QA and signed iOS | Controlled staging/device environment | Not run |
| Production deployment / DB / provider | None | Not touched |

## Risks and decisions

- **Cookie trust:** Native transports must never persist `cp_session` or follow cross-origin redirects. Browser `HttpOnly` cookie can only be changed by the server. Cross-origin browser auth is intentionally unsupported under the existing CORS contract.
- **No fake auth:** The absence of `CAMPUSPOOL_API_ORIGIN` disables login; the guest screen cannot claim identity. Compile with `--dart-define=CAMPUSPOOL_API_ORIGIN=same-origin` only when Flutter Web is served by the **same** audited Node origin. Native require reviewed HTTPS backend (or localhost with ADB reverse for local development).
- **No unsafe release:** Existing provider readiness, staging recovery/rollback and security/no-go gates apply even if Flutter tests pass; nothing here authorizes a live release.
- **Privacy:** Legacy `GET /api/rides` returns more fields than needed. Flutter maps only safe summary fields, but backend minimization should be reviewed before real users.
- **Native sessions:** Memory-only cookies disappear on app restart; no persistent login/refresh flow or system-keychain integration is assumed. User must sign in again after restart.

## Next steps — exact handoff

1. **Next action:** review Flutter CI failures and update only in-scope Dart source/tests. Check browser same-origin boot, Android emulator local `adb reverse`, real session-cookie lifecycle and explicit 401/403 handling in isolated test environment.
2. **Who may do it:** Flutter engineer / independent security reviewer, not a production operator by implication.
3. **Prerequisites and blockers:** verified provider email delivery, approved backend origin, staged test identities and recovery proof; signed native builds and device UI review.
4. **Expected evidence:** green analyzer/tests and web/Android build, device screenshots, browser cookie test, CSRF/logout test, no sensitive fields in UI and no user accounts or live payment operations.
5. **Production impact:** NONE. Neither draft PR may be merged or deployed without review and separate approval.

## Links and files changed

- Branch: `feat/flutter-phase3-session-login-2026-11-04`; [draft PR #21](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/21) stacked on #19 and #17.
- `flutter_app/lib/{campus_auth,campus_login_screen,campus_runtime,session_transport*,main,app,flows}.dart`; `flutter_app/test/*`; docs.
- Figma entry: https://www.figma.com/design/nwgHXgnnP3VNHW0jdP7qnA?node-id=4-23
- Last known deployment SHA: intentionally not reverified here; no deployment attempted.

### Validation checkpoint — 2026-11-04 UTC

- Flutter CI #41796997734 at source `503b5ba`: analyzer **PASS**, **28/28 tests PASS**, Web release compilation **PASS**. Android debug compilation was still in progress at the moment this note was recorded. Earlier Phase 3 CI #41796440947 built an unsigned Android debug APK successfully at `f8d2ccf`.
- Safety hardening: `CampusAuthApi.requestCode` now requires the generic, non-account-enumerating PostgreSQL-auth response (`expiresInSeconds` between 60 and 900 with no returned email, phone, name or dev OTP hint), and refuses the legacy SQLite response. Added dedicated rejection test. **Server-side legacy enumeration remains a blocker** and must not be marketed as repaired by the Flutter client.
- Live provider end-to-end, browser same-origin cookie round-trip, real Android install, staging recovery and release GO remain **not verified**. No student data or OTP provider was touched.
