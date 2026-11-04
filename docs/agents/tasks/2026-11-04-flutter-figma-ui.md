# Task: Bootstrap Flutter UI from CampusPool Figma

- **Task ID / file:** `2026-11-04-flutter-figma-ui`
- **Status:** in review (branch only; no release)
- **Agent / owner:** ChatGPT coding agent; human reviewer unassigned
- **Last updated:** 2026-11-04 UTC
- **Baseline:** `main@056cd26b9e66324c7953065418de1ec765c6ebef`; branch `feat/flutter-campuspool-figma-ui-2026-11-04`
- **Scope:** new `flutter_app/` client, isolated Flutter CI, this task and branch-only documentation. **Not:** current Node service, static frontend, mobile production app, production/staging config, API routes, DB, keys, payments.
- **Dependencies:** `DESIGN.md`, CampusPool Figma guest landing `4:23` / `78:98`, checkout `4:938`, product docs, AGENTS.md.

## Goal and acceptance criteria

Create a working, independent Flutter/Dart UI scaffold reflecting CampusPool's Figma styling and UX: responsive guest landing, fixed CTA pair until sign-in, guest feature previews, optional urgent tips with quote arithmetic, progressive disclosure of charges, safe disabled payment state and automated widget tests.

## Current state (verified vs assumed)

- **Verified repository:** `main` contains a Node.js HTTP/static website, Postgres feature-gated rides/auth and independent errands demo, but no Flutter project. Inspected the exact baseline tree and docs. Production release is still NO-GO.
- **Verified Figma:** `66:172` guest landing design context and screenshot; design system in `DESIGN.md`.
- **Environment:** authoring environment does not have `flutter` or `dart` executables; the new Flutter source cannot yet be compiled locally.
- **Not verified:** Flutter runtime, device behavior, auth and backend API integrations.

## Plan

1. Create isolated Flutter client with palette, route graphics and responsive guest/signed-in preview layout.
2. Implement local ride/errand navigation and quote UI with no real student or financial actions.
3. Add Flutter widget and pricing tests and scoped GitHub Actions workflow.
4. Review CI, respond to compile errors, then request independent human/mobile acceptance. No deployment.

## Progress log

- 2026-11-04 UTC — Inspected GitHub main, agent docs, design specification, Figma design context. Created feature branch without modifying main.
- 2026-11-04 UTC — Added initial Flutter client under `flutter_app/`, route/brand widgets, responsive shell and guest navigation, ride/errand/runner/profile previews, quote and optional tip UI. Added tests and Flutter CI.
- 2026-11-04 UTC — Corrected unbounded service-card flex layout in landing widgets. Design data and money state explicitly labeled as examples. CI was not run in authoring environment.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Repository baseline | GitHub refs + tree for `056cd26` | PASS — no Flutter client before change |
| Figma design mapping | Figma `get_design_context(66:172)` | PASS — guest screenshot and source hierarchy obtained |
| Flutter SDK presence | Local `which flutter; which dart` | UNAVAILABLE — tooling not installed |
| Flutter source analysis | `cd flutter_app && flutter analyze --no-fatal-infos` | NOT RUN locally — GitHub workflow added |
| Flutter widget tests | `cd flutter_app && flutter test` | NOT RUN locally — GitHub workflow added |
| Production / payment | No production or provider actions | NOT TOUCHED |

## Risks and decisions

- Adopt Flutter **as a separate client** rather than replacing the existing live HTML/Node implementation or altering server contracts. Avoid any production release in this phase.
- Flutter screen state and example quote stay local and must not be mistaken for authoritative booking, identity, persistence or financial state.
- No real campus images are bundled without rights/asset verification. The route illustration is explicitly illustrative; future approved photos are separate.
- A false verification shortcut must never become a production authentication path; the preview state is labeled as such.

## Next steps — exact handoff

1. **Next action:** check the GitHub Flutter UI workflow on this branch/PR and fix any analyzer/test failures in `flutter_app/lib` or `flutter_app/test`.
2. **Who may do it:** assigned Flutter engineer/reviewer; no permission to deploy implied.
3. **Prerequisites and blockers:** Flutter SDK/device CI, Android/iOS platform files generated and reviewed, backend auth/session contract, privacy and payment approvals for real integrations.
4. **Expected evidence:** CI URLs with Flutter analyzer+tests green, emulator screenshots at 390px and desktop widths, focused accessibility/reduced-motion QA.
5. **Production impact:** NONE. Existing Node/Render deploy untouched.

## Links and files changed

- Branch: `feat/flutter-campuspool-figma-ui-2026-11-04` (PR link to be added after creation)
- Files: `flutter_app/**`, `.github/workflows/flutter-ui.yml`, `docs/agents/tasks/2026-11-04-flutter-figma-ui.md`, `docs/agents/{STATUS,NEXT_STEPS,DECISIONS,ARCHITECTURE_MAP}.md`
- Figma: https://www.figma.com/design/nwgHXgnnP3VNHW0jdP7qnA?node-id=4-23
- Deployment SHA: not independently rechecked during this Flutter-only task; no deploy attempted.
