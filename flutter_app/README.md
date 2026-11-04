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
5. Run `flutter test`, `flutter analyze`, physical-device layout/accessibility review and dependency/CI checks. Flutter was not installed in the authoring runtime, so compilation remains unverified until CI.

See `../AGENTS.md` and `../docs/agents/tasks/2026-11-04-flutter-figma-ui.md` before continuing.
