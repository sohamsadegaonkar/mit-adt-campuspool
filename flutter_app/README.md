# CampusPool Flutter client (Figma UI, Phase 1)

**Status: branch-only preview.** This is a separate Flutter/Dart user-interface client. It is not the live CampusPool site, authenticated ride marketplace or payment processor. The existing Node API, database, Render configuration and static frontend are unchanged.

## Design source and current behavior

- [Mobile guest landing](https://www.figma.com/design/nwgHXgnnP3VNHW0jdP7qnA?node-id=4-23) and [desktop guest landing](https://www.figma.com/design/nwgHXgnnP3VNHW0jdP7qnA?node-id=78-98).
- Existing `DESIGN.md` palette: #FFFFFF, #171717, #F4CE37, #F6F6F6. No emoji icons.
- Guest Home, Ride/Errand/Activity/Profile navigation; a persistent **Get started** / **Become a runner** pair on mobile, including while browsing tabs.
- Responsive desktop view switches those calls-to-action to **Find a ride** / **Request an item** only in the clearly labeled signed-in preview state.
- Editable Flutter route illustration and carousel (not an actual MIT-ADT campus photograph). No transient Figma asset URLs in the application.
- Ride filters are local UI state: no fabricated rides, inventory or availability.
- Errand draft with optional ₹10/₹20/₹30 voluntary tip, sample quote, 220 ms expandable **Price details**, and explicit disabled UPI/payment preview.
- Activity/profile guest states, top-up preview, runner verification entry and reduced-motion-aware transitions.

## Local setup

Install a supported stable Flutter SDK (the Flutter SDK also includes Dart). This repository has no Flutter tooling bundled.

```bash
cd flutter_app
flutter create --project-name campuspool_flutter --platforms=android,ios,web .
flutter pub get
flutter analyze --no-fatal-infos
flutter test
flutter run -d chrome
```

For mobile, select an Android emulator or iOS simulator with `flutter devices` and use `flutter run -d <device-id>`. Use `flutter create` once to generate platform-specific Android/iOS project scaffolding. **Do not add Android release signing secrets to Git.** Generated files should be independently reviewed before inclusion in a later PR.

## Architecture / trust boundaries

- `lib/main.dart`: application entry.
- `lib/app.dart`: responsive app shell, navigation, guest and preview modes.
- `lib/landing.dart`: mobile/desktop landing, service cards, carousel.
- `lib/flows.dart`: ride and errand demonstration screens, tip and checkout UI.
- `lib/pricing.dart`: pure quote arithmetic, without money movement.
- `lib/theme.dart` + `lib/widgets.dart`: design tokens, reusable controls and route illustration.
- `test/`: quote and widget contract tests.

No token, session, student identity, live coordinate, booking, OTP or money is persisted or transmitted. The UI **does not** switch backend feature flags, accept a genuine payment, or claim runner payout. The “Preview signed-in layout” action is intentionally **not authentication**.

## Phase 2, deliberately not included

1. Agree on an approved Flutter platform project structure and generate platform scaffolding.
2. Integrate real user sessions against the existing Node API after contract and CSRF review; no client-side login bypass.
3. Integrate server-backed rides/errands only after security/release/privacy gates. Errands server domain and provider-backed settlement are not implemented.
4. Import *approved, properly licensed real images* as static assets with attribution. Until then, the UI uses its Figma route illustration and does not mislabel concept artwork as real photography.
5. Run `flutter test`, `flutter analyze`, physical-device layout/accessibility review and dependency/CI checks. Flutter was not installed in the authoring runtime. **GitHub Actions Flutter 3.47.7 verified analysis and 6/6 tests** in [run #41790737256](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41790737256); native builds and physical-device QA remain outstanding.

See `../AGENTS.md` and `../docs/agents/tasks/2026-11-04-flutter-figma-ui.md` before continuing.

## Phase 2: session-gated ride state system

- `ride_feed.dart` contains a read-only HTTP adapter for the existing server `/api/auth/me` then `/api/rides` contract. It requires an injected already-authenticated transport. No cookie or token storage is implemented; guest mode never initializes a remote request.
- `ride_results.dart` provides explicit loading skeleton, empty, session-expired, network-error/retry, and verified-results UI. The UI model deliberately drops driver email/phone, UPI IDs, raw geodata and free-form notes.
- The optional `RidePreview(source: ..., hasVerifiedSession: ...)` is not wired to fake signed-in preview state. Real authenticated session bootstrap, cookie/CSRF behavior, platform origin handling, and device security QA must precede production enablement.
- CI may generate temporary Android/iOS/Web host scaffolds with `flutter create`; those outputs and unsigned debug builds are *test artifacts*, not distributed or deployed application releases.

### Phase 2 build evidence

- [Flutter analyzer + 19 tests, run #41793703183](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793703183) — PASS on source `244e06c`.
- [Web release and unsigned debug APK, run #41793334499](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793334499) — PASS on source `2ad2d51`; CI artifacts expire after seven days.
- Platform hosts were generated in CI. No iOS compiled binary, production signing or physical Android installation was tested. The latest-source native CI run is separate.

## Phase 3 — real OTP/session integration (unmerged draft)

Phase 3 replaces the visual sign-in shortcut with an API-backed email OTP form. It calls the existing Node `/api/auth/login-request`, `/api/auth/verify-email-otp`, and verifies `/api/auth/me` before enabling signed-in ride cards. It uses CSRF-protected `/api/auth/logout`. No signup, payment, booking, OTP-provider configuration, native session persistence or production release is included.

**Default:** offline guest-only UI; OTP and protected reads are disabled. To *build for a reviewed backend*:

```sh
# Browser deployment: Flutter web must be served by the exact same Node/API origin.
flutter build web --release --dart-define=CAMPUSPOOL_API_ORIGIN=same-origin

# Native test build, explicit approved backend only (never store secrets in define):
flutter run --dart-define=CAMPUSPOOL_API_ORIGIN=https://approved-campuspool-backend.example
```

For local native development, use a loopback address with `adb reverse` to a **disposable local** Node server. Do not target live Render or connected student accounts for testing. The API origin is public configuration; never embed API keys or a session cookie in `--dart-define`.

Browser sessions use a managed HttpOnly cookie on same origin, and are cleared only by server logout; cross-origin Flutter dev server requests are intentionally unsupported because the existing backend does not allow credentialed CORS. Native sessions use an ephemeral, process-memory cookie and require login after a restart. The app refuses to show signed-in UI on OTP success until `/api/auth/me` confirms it. No real users should be invited before backend provider/recovery/release gates pass.

## Phase 4 — Places (New) address suggestions (unmerged draft)

The Rides **GOING TO** field now has a 320ms-debounced suggestions list showing real place title/address parts, loading/empty/rate-limit/error states, and selection confirmation. The selector uses Google Places session tokens and a Place Details lookup before considering a place selected. All API keys remain in the Node backend, never in Dart or Android. **An unconfigured APK remains safe/offline and displays a clear unavailable message rather than fictional locations.**

### Opt-in staging setup (owner review required)

1. In a reviewed Google Cloud project, enable **Places API (New)** and a restrictive budget/quotas, monitor cost. Confirm Google Maps Platform branding, Terms and Privacy requirements; replace the network Google logo with an official bundled asset before release.
2. Store `GOOGLE_PLACES_API_KEY` privately on a disposable local server or approved staging only; use an API-restricted key with only Places API (New). Configure `PLACES_AUTOCOMPLETE_ENABLED=true` and `PLACES_DAILY_CAP=250` (adjust downward for a paid quota). **Do not add these values to Git or Flutter --dart-define.** No existing Render/production environment is changed by this PR.
3. Build native Flutter with `--dart-define=CAMPUSPOOL_API_ORIGIN=https://approved-staging-api.example` or use disposable localhost with `adb reverse tcp:3000 tcp:3000` and `CAMPUSPOOL_API_ORIGIN=http://127.0.0.1:3000`. Web requires a same-origin deployed server. Do not test against real student identities.
4. Type `swargat`: expect Google predictions after ~320ms, select Swargate, see confirmed formatted address. No request/booking is posted by selecting it.

The two public read endpoints are cost-bearing **only when enabled**, with strict per-IP/minute, per-IP/day, and server DB global/day caps; these are not a substitute for Google billing-level quotas or abuse defenses. No full prediction content is persistently cached. See `docs/agents/tasks/2026-11-04-flutter-place-autocomplete.md`.
