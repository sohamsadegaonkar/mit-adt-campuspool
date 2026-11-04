# Task: Mobile destination autocomplete — Flutter + protected Places proxy

- **Task ID / file:** `2026-11-04-flutter-place-autocomplete`
- **Status:** in review — draft PR #23, unmerged / not deployed
- **Agent / owner:** ChatGPT coding agent; independent reviewer unassigned
- **Last updated:** 2026-11-04 UTC
- **Baseline:** `feat/flutter-phase3-session-login-2026-11-04@20527bd17da705d8414f2051196927db1e3b0b`, stacked on draft PR #21 → #19 → #17; `main` was independently observed at `b83107d`, but this task does **not** modify `main`.
- **Scope:** Flutter ride destination autocomplete, privacy-gated and cost-capped opt-in Node Google Places (New) proxy, mocked tests, scoped CI workflow, docs. No payment, routing, ride booking, student GPS tracking, real OTP provider or Render secrets.
- **Related:** Figma ride flow, `docs/agents/tasks/2026-11-04-flutter-session-login.md`, `DESIGN.md`, `AGENTS.md`.

## Goal and acceptance criteria

When a student types `swargat` in **GOING TO**, show a compact list of genuine addresses/landmarks below the text box. Support tap or keyboard selection, display a confirmed formatted address after a successful Place Details lookup, and avoid fabricated addresses. Respect the white/black/yellow Figma style. The original guest action bar and bottom navigation remain fixed.

Expected checks: 320ms debounce, no searches shorter than 3 characters, at most 5 predictions, token reuse per typing session, new token after selection, response-order safety, empty/loading/error/rate-limit states, clear control, keyboard navigation, and no credentials in Flutter.

## Current state (verified vs assumed)

- Previous Android screenshot showed a plain destination `TextField` with no predictions; ride inventory remained a guest preview.
- Google Places API **(New)** has `places:autocomplete` and Place Details. Sessions use a token across typing and selection; place predictions shown without a map require the official Google attribution. Billing is possible even for abandoned sessions (see source docs).
- Existing Node server uses shared rate limiting with per-IP buckets and same-origin CORS defaults, and checks an authenticated session for other API routes. A separate, narrowly scoped **public read-only** Places endpoint is proposed to permit guest discovery without unlocking student ride data.
- No Google key, cost approval, API enablement, or real queries have been authorized or performed. Staging/production flags remain unchanged.

## Plan and changes

1. New `places-autocomplete.js`: calls fixed Google-host Places (New) endpoints using an environment-only key, uses Pune location bias and India restriction, validates/sanitizes predictions and details, limits output to safe, necessary fields and never logs queries.
2. `server.js` explicit opt-in `PLACES_AUTOCOMPLETE_ENABLED=true`; endpoints `POST /api/places/suggest (JSON q, sessionToken)` and `POST /api/places/resolve (JSON id, sessionToken)`. Defaults to 503 (disabled); no API key in Flutter/web. Per-IP minute/24h and global per-day caps limit *this process/DB's* requests. **Google Cloud billing/quota must still be configured independently**, especially across multiple replicas.
3. Flutter `PlaceAutocompleteField` + `HttpPlaceSearchSource`: debounce, stale response guard, secure session token, suggestions and selected address, loading/empty/rate-limit/provider states and Google branding, integration into `RidePreview`, `CampusRuntime` and `CampusShell`.
4. Add mocked Node + Flutter tests, analyzer/Web/Android CI; review manually on actual device. Do not merge or enable flags without independent cost/security/privacy review.

## Verification

| Check | Environment | Result |
|---|---|---|
| Node provider syntax and mock API tests | [CI #41801773535](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41801773535), source `1860647` | PASS — 5/5 mocked provider tests + server syntax |
| Flutter unit/widget tests and analyzer | [CI #41802050615](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41802050615), source `6cbff8e` | PASS — 39/39 tests, static analyzer |
| Flutter Web / unsigned Android build | [CI #41802050615](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41802050615), source `6cbff8e` | In progress at this checkpoint; do not claim APK yet |
| Real Swargate prediction / provider bill | Deliberately not called | Not verified |
| On-device keyboard, tap targets and screen overflow | Physical Android | Pending |
| Production/staging API key, flag, quota and Google policy sign-off | Manual owner action | Not performed |

## Decisions, risks and launch gates

- **No unlicensed/fake address results.** If no provider is configured, Flutter honestly reports that live location search is unavailable. UI is testable with an injected mock in widget CI; a real debug APK needs the API origin and server feature flag to fetch real places.
- **Cost controls:** debounced requests and Places session tokens reduce unnecessary traffic, but they are not a hard spending limit. Google Cloud Places API (New) enablement, billing account budget/quotas and alerting must be explicitly reviewed by the owner. The Node shared SQLite cap is instance-local when deployment replicas have independent stores; it must not be treated as a provider-wide hard cap.
- **Guest safety:** exact public read-only endpoints are available without student session only if the feature is enabled, but rate limits and provider cost still merit abuse testing, potential CAPTCHA/gating, plus strict privacy policy disclosure before live traffic.
- **Attribution/licensing:** the suggestion panel references Google's official "Powered by Google" logo URL. Download and bundle an *official, approved* logo asset for offline availability; verify required Terms/Privacy links and attributions before production. No Google prediction content is persistently cached or bulk stored.
- **No geolocation permission** requested; Pune bias is a public city center, not the student's inferred location. No coordinates sent to bookings or mobility matching.

## Next steps — exact handoff

1. **Next action:** inspect latest Flutter and Node CI; fix compile/test failures; check UI at 390px with keyboard and scroll. Run controlled same-origin staging with an independently approved API key and a low Google Cloud quota; confirm `swargat` resolves to a real Swargate place and that no costs are incurred without the flag.
2. **Who may do it:** next assigned Flutter/Node engineer and cost/security reviewer. Account owner alone decides external Places billing and key deployment.
3. **Prerequisites/blockers:** Google Maps Platform project / Places (New) access, budget/quota approval, key stored only in server env, privacy/attribution review, safe local/staging QA.
4. **Expected evidence:** green Node/Flutter CI, provider request/selection screenshots with true addresses, measured calls per user journey, source attribution, blocked request tests and budget evidence.
5. **Production impact:** NONE. This branch is stacked on draft Flutter PRs; do not merge to main or deploy without explicit approval.

## Links and files changed

- Branch: `feat/flutter-places-autocomplete-2026-11-04`; [draft PR #23](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/23) stacked on draft #21.
- Paths: `places-autocomplete.js`, `server.js`, `test_places_autocomplete.js`, `.github/workflows/places-node.yml`, `flutter_app/lib/place_{search,autocomplete_field}.dart`, Flutter UI wiring/tests, agent docs.
- Figma: https://www.figma.com/design/nwgHXgnnP3VNHW0jdP7qnA?node-id=4-23
- Google Places (New): https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
- Provider policy: https://developers.google.com/maps/documentation/places/web-service/policies
- Deployment: not attempted; live SHA not independently rechecked.

### CI checkpoint — 2026-11-04 UTC

- **Verified source** `6cbff8e` (PR #23): Flutter 3.47.7 static analyzer and 39/39 tests PASS in [run #41802050615](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41802050615). Node provider adapter 5/5 tests and syntax PASS in [run #41801773535](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41801773535) from immediate prior commit. Security smoke and PostgreSQL OTP checks also passed at `1860647`.
- Additional UI verification: keyboard arrow/Enter selection tested; selected resolved destination retained for local ride filtering. No provider key or Google request was used in CI. Latest Web/Android build was still pending at the time of this note.
- **Owner action still needed:** acquire/approve Google Cloud billing quota, server-only key and explicit feature flag before real addresses can display on a physical phone. No production or staging activation authorized. Google official logo bundle and privacy/terms review remain launch gates.

- **Privacy revision (2026-11-04):** Both public read-only Places requests now use JSON POST payloads to avoid putting destination text and session tokens into request URLs / reverse-proxy query logs. The exact routes execute before the router's authenticated mutation CSRF check because they do not create student account state; CORS checks, JSON content-type requirement, strict per-IP and global provider caps remain mandatory. They are still disabled by default.

## Progress log

- 2026-11-04 UTC — Feature-gated Google Places proxy and Flutter UI suggestions implemented in source; no provider key, billing or real student data used.
- 2026-11-05 UTC — Reconciled the Places route with the mainline idempotency-aware Node router for PR #33. Runtime remains disabled by default until explicit provider approval.
