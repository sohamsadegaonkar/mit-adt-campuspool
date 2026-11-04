# Task: Flutter Places mobile keyboard and cost-cap hardening

- **Task ID:** `2026-11-04-flutter-places-mobile-qa`
- **Status:** in progress — branch-only; no production/staging changes
- **Agent:** ChatGPT coding agent; independent reviewer unassigned
- **Last updated:** 2026-11-04 UTC
- **Baseline:** `feat/flutter-places-autocomplete-2026-11-04@9d57a917fc70d85f6b3592209cc3b259344eb3`; stacked on draft PR #23 → #21 → #19 → #17
- **Scope:** Flutter suggestion popup and tests; server Places daily cap validation and tests; agent/README handoff. Out of scope: Google billing activation, API key deployment, live student data, release, auth, payment, booking.

## User problem and acceptance criteria

On a real Android phone, typing a partial place name should produce a compact, scrollable suggestion list **below the field but above the keyboard**, with Google attribution still visible, and allow Enter/search-key selection. Daily cost-cap configuration must accept tiny test limits without silently rounding up.

Acceptance:
- At 390px mobile width and reduced height, a 5-item dropdown is capped and scrollable; no render overflows.
- IME Search chooses an existing highlighted suggestion, and cannot select a fictitious item if no result is loaded.
- A maximum 80-character text input aligns with the server validator.
- `PLACES_DAILY_CAP=1` is accepted for controlled testing; malformed values fail closed when feature enabled. The public endpoint remains disabled without explicit flag and private key.
- Flutter analyzer/tests, Node mock provider tests, Web release and Android debug build pass on a reproducible exact commit.

## Verified baseline

- PR #23 at `9d57a91` is draft, mergeable, unmerged, not deployed.
- GitHub Actions Flutter run [#41802737844](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41802737844) **passed static analysis, 39/39 unit/widget tests, Web release compilation and Android debug APK compilation**.
- Node Places provider checks and security smoke passed on that branch. No actual Google Places key or real address API request has been used, and physical-device screenshots/keyboard QA remain unverified.
- Google Places documentation confirms a unique session token per search, ending with Place Details selection or abandonment. A local request cap does not replace Google Cloud API quotas/billing policies.

## Plan and progress

1. Create a separate stacked branch for mobile UX hardening.
2. Limit the suggestions list using available screen/keyboard dimensions, preserving a pinned attribution row. Keep the suggestions as a scrollable child instead of growing inside the page past the keyboard.
3. Allow keyboard Search to select highlighted prediction and restrict field length to 80; add 390px 5-item widget test.
4. Replace server `Math.max(20,...)` daily cap clamp with validated 1–1000 budget when feature enabled and tests of invalid values. Run CI; fix failures.
5. Record exact CI evidence and hand off review. No feature activation or deploy.

## Verification

| Check | Evidence | Result |
|---|---|---|
| Source baseline | PR #23 / `9d57a91` | PASS |
| Node syntax / Places adapter | `node --check server.js && node --test test_places_autocomplete.js` | Pending |
| Flutter static analysis / widget tests | `flutter analyze --no-fatal-infos && flutter test` | Pending |
| Web release / unsigned Android debug | CI Flutter platform smoke | Pending |
| Real phone + IME + actual Google provider | No device or approved provider key | Not run |
| Production / staging deployment | None | Not touched |

## Decisions and risks

- The mobile suggestions are **not** an inventory or ride booking claim; the Flutter app still requires server sessions for protected ride data.
- Location search remains OFF by default; no fabricated live Google results. The server cap is a defense-in-depth counter, not a guaranteed billed-spend ceiling; only Google Cloud quotas and owner cost approval can constrain Google charges across environments.
- Attribution is pinned below the results list but an approved official logo asset, Google policies, Terms and Privacy are still a release gate.
- Generated Android debug APK is a **development artifact**, not a production-signed app. No keys or user accounts were used.

## Next steps

1. Inspect CI for this branch; correct analyzer, widget and Node errors. Record passing SHA and build artifact link.
2. Ask QA reviewer to test on an actual Android phone at keyboard-open heights and to confirm no results hidden behind sticky CTAs. Validate Google branding and accessibility at larger text scale.
3. Owner to explicitly approve and provision a restricted server-side Places key and Google quota on disposable/approved staging before live Swargate resolution. No activation by this PR.
4. Keep stacked PR in draft; no direct merge into main or Render deployment.

## Links and modified paths

- Branch: `feat/flutter-places-mobile-qa-2026-11-04`.
- `flutter_app/lib/place_autocomplete_field.dart`, `flutter_app/test/place_autocomplete_test.dart`; `places-autocomplete.js`, `server.js`, `test_places_autocomplete.js`; docs.
- Provider reference: https://developers.google.com/maps/documentation/places/web-service/place-session-tokens
- Previous PR #23: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/23
- Deployment: none.

### Mobile keyboard viewport refinement — 2026-11-04 UTC

- In `flutter_app/lib/app.dart`, hide the fixed guest CTA/navigation bars **only while** Android's soft keyboard occupies the window, allowing the suggestion list to fit. Restore both bars to their original positions as soon as the keyboard closes. This preserves the user's logged-out layout at rest.
- Add a widget test for the transition (open keyboard → hide CTA/nav; close keyboard → restore), alongside the bounded five-item suggestions test.
