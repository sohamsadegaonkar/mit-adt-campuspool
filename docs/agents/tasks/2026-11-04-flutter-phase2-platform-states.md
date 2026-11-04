# Task: Flutter Phase 2 — safe ride states and platform compilation

- **Task ID / file:** `2026-11-04-flutter-phase2-platform-states`
- **Status:** in review on stacked draft PR #19; device QA pending
- **Agent / owner:** ChatGPT coding agent; independent reviewer unassigned
- **Last updated:** 2026-11-04 UTC
- **Baseline:** `feat/flutter-campuspool-figma-ui-2026-11-04@df65ad10842eeee16f269c5219557369b54adabe` (draft PR #17, not merged to main)
- **Scope:** `flutter_app/lib/ride_feed.dart`, `ride_results.dart`, existing `flows.dart`, `flutter_app/test/*`, `pubspec.yaml`, `.github/workflows/flutter-ui.yml`, repo handoff. No changes to Node API, student database, deployment, authentication issuance, money or backend flags.
- **Dependencies:** PR #17 / Flutter Phase 1, existing Node `GET /api/auth/me` + `GET /api/rides` contract, Figma CampusPool guest landing, `DESIGN.md`.

## Goal and acceptance criteria

1. Separate the real authenticated ride-feed contract from public guest browsing; fail closed when a verified server session is missing.
2. Provide clear loading skeleton, empty, unauthorized, unavailable/retry, and actual-result presentation states with the established Figma palette and reduced-motion support.
3. Limit the UI ride model to ID, pickup/destination labels, departure, vehicle and seat availability; exclude driver contact, UPI, free-form notes and raw coordinates.
4. Extend Flutter CI with hosted-runner Android/iOS/web platform scaffold generation, web release build, and unsigned Android debug APK compilation.
5. Add mocked read-only HTTP tests, guest-gating tests, state widget tests, and 390px/1200px responsive checks.

## Current state (verified vs assumed)

- **Verified source:** PR #17 head `df65ad1` is draft, 6/6 Phase 1 tests previously passed in Flutter CI; `main` does not have Flutter.
- **Verified backend contract:** `server.js` enforces authenticated `cp_session` before `GET /api/rides`; `GET /api/auth/me` confirms the session; mutations require session-linked CSRF. The existing API payload contains contact details; this Flutter UI model intentionally drops them.
- **Limitations:** The authoring runtime has no Flutter/Dart SDK. This branch is not built or deployed anywhere. No authenticated browser/native transport is wired into the live Flutter guest shell.
- **No production approval:** Existing repository release NO-GO remains.

## Plan

1. Implement read-only client with injected session-carrying HTTP transport and restricted UI model; expose it only by explicit authorization in a future real login integration.
2. Add Flutter loading/empty/unauthorized/unavailable/rendered-results components; never invent rides or auto-fetch as a guest.
3. Run Flutter CI with analysis, unit/widget tests, web release compilation and Android debug compilation; fix only in-scope issues.
4. Record observed CI links, blockers and next exact step; submit a draft stacked PR targeting Phase 1 branch, not main.

## Progress log

- 2026-11-04 UTC — Inspected exact PR #17, current Node auth/rides routes, Figma design context and relevant private product UX decisions. Claimed a separate stacked branch `feat/flutter-phase2-platform-states-2026-11-04`.
- 2026-11-04 UTC — Added authenticated read-only ride client and explicit screen states. Added mocked privacy/authorization and widget layout tests, and platform build CI.
- 2026-11-04 UTC — GitHub CI Flutter 3.47.7 analysis and **19/19 tests PASS** at source `244e06c` (run #41793703183). Web release and Android unsigned debug compilation PASS at `2ad2d51` (run #41793334499); two downloadable 7-day artifacts created. Latest-source native smoke rerun remains separately observable. No device screenshots, iOS binary, merge or deploy.

## Verification

| Check | Environment/evidence | Result |
|---|---|---|
| Base PR | GitHub PR #17 at `df65ad1` | Verified, draft / unmerged |
| Server session requirements | `server.js` GET auth/me and rides | Verified in source; no live API call |
| Flutter analyze + tests | [Flutter CI #41793703183](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793703183) @ `244e06c` | PASS analyzer, 19/19 widget/unit tests |
| Web release build | [Platform CI #41793334499](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793334499) @ `2ad2d51` | PASS, artifact uploaded |
| Android unsigned debug | [Platform CI #41793334499](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793334499) @ `2ad2d51` | PASS, unsigned debug APK artifact uploaded; no device install |
| iOS template generation | [Platform CI #41793334499](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793334499) @ `2ad2d51` | PASS host generation; no iOS signed/unsigned compiled build |
| Physical device QA | 390 px phone, browser, accessibility | Not run |
| Backend / production / payment | No runtime changes | Not touched |

## Risks and decisions

- Browsing a design preview **must not** unlock a protected Node API. The current demo sign-in state is not a verified session. Network fetch is opt-in only via future injected session-carrying client; Node remains the authorization boundary.
- Native session transport, cookie scoping, CSRF, device storage and login are **not implemented** in this task; do not enable a simulated authentication bypass.
- The existing backend returns contact and UPI fields. Never render or retain them in new Flutter ride presentation models.
- Android builds are unsigned debug-only development artifacts, not releases. No production deployment or user data touched.
- The Figma illustration remains illustrative; real photography needs approved asset rights before shipping.

## Next steps — exact handoff

1. **Next action:** review the CI job for this stacked PR, fix analysis/widget/web/Android compile problems, then inspect Android emulators and mobile web at 390px and desktop at 1200px.
2. **Who may do it:** next Flutter engineering agent or independent reviewer; production operator is not implicitly authorized.
3. **Prerequisites/blockers:** verified session client design, OTP delivery and release gates, cookie handling across platforms; approved real photos.
4. **Expected evidence:** green CI analysis, tests and build artifacts, device screenshots and accessibility review; no raw student data.
5. **Production impact:** none. Do not merge to main or deploy without review and explicit release authorization.

## Links and files changed

- Branch: `feat/flutter-phase2-platform-states-2026-11-04`; [draft PR #19](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/19) stacked on [draft PR #17](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/17).
- Figma: https://www.figma.com/design/nwgHXgnnP3VNHW0jdP7qnA?node-id=4-23
- Code: `flutter_app/lib/{ride_feed,ride_results,flows}.dart`, Flutter tests, CI, docs.
- Deployment SHA: not rechecked; no deploy attempted.

### Observed CI artifacts (development only)

- Web preview artifact `campuspool-web-preview` (artifact ID 13304547677, 14.0 MB).
- Android unsigned debug `campuspool-android-debug` (artifact ID 13305210597, 70.3 MB).
- Both are available within [workflow run #41793334499](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793334499) through **2026-11-11**, absent manual removal. Do not distribute them as release packages.
- Full Android/iOS/web host files are created temporarily in CI, not yet committed as reviewed platform projects. iOS compilation and physical device testing remain unverified.
