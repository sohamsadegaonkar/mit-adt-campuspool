# Task: Mobility browser session-race, map and keyboard hardening

- **Task ID:** 2026-11-04-mobility-ui-hardening
- **Status:** tested (CI) — 30/30 Playwright scenarios green; independent human review, live staging and physical-device acceptance pending
- **Owner:** ChatGPT engineering agent; independent human reviewer and staging owner pending
- **Last verified:** 2026-11-03 19:38 UTC, GitHub run #41704799368 (2026-11-04 user local date)
- **Baseline:** `cb3d7d0541b74c6dfabf43447f3ddae00565e674`, PR #14 draft, targets `main`
- **Scope:** `mobility-ui.js`, synthetic-only browser QA and GitHub workflow, agent handoff. No modifications to SQL, Render, Supabase, identity providers, payments, deployment configuration or production.

## Goal and acceptance criteria

Close the remaining isolated browser QA gaps before independent review: prevent a late create/search/cancel response from mutating private browser state after the current session is invalidated, verify map opt-in is interactive and keeps coordinates out of storage/URLs, and prove core controls work through keyboard activation. Cover the desktop/mobile browser matrix.

## Current state

- PR #14 was verified open, draft, unmerged at `cb3d7d0`; security, credential hygiene, agent documentation, PostgreSQL/PostGIS and 21/21 Playwright tests passed on that SHA.
- Existing Playwright uses synthetic identities with localhost PostgreSQL 16/PostGIS 3.4 and local SQLite rate-limiter data, not real student accounts.
- `mobility-ui.js` already versions asynchronous session refresh calls via `state.requestSeq`, but pending create/cancel/search promises do not check that version before applying their returned results. Logout can therefore be followed by stale UI state being repopulated.
- CI covered manual coordinate entry and responsive layout, not the opt-in map click path, keyboard-driven form controls or stale-response session races.
- No independent human review is recorded on PR #14. No staging or production deployment approval exists.

## Plan

1. Use a monotonic request epoch check after all mutation/search network boundaries, including success and failure branches. Discard stale responses silently rather than rendering private candidate cards or request state.
2. Add deterministic synthetic Playwright browser regression: intercepted delayed successful match response after logout must never render cards or status.
3. Add opt-in map test with test-only pinned Leaflet JS/CSS served locally inside CI; verify tile requests are deferred until map activation; exact selected coordinates never go to local storage or URL. Continue supporting manual coordinates if tiles are unavailable.
4. Verify keyboard Enter handling for request create/cancel plus semantic field labels and status region in Chromium, Firefox and mobile WebKit.
5. Record fresh GitHub CI evidence, adjust QA scripts if necessary, then update `STATUS.md` and `NEXT_STEPS.md` for independent review.

## Verification

| Check | Evidence | Status |
|---|---|---|
| Prior PR browser matrix | #41701714564 — 21/21 PASS at `cb3d7d0` | PASS |
| Stale-response session-race browser regression | Three browser projects, run #41704799368, `76cd1a4` | PASS |
| Opt-in map and keyboard browser regressions | Three browser projects, run #41704799368, `76cd1a4` | PASS |
| Security / PostgreSQL / secret hygiene / docs | #41704799389, #41704799073, #41704799185, #41704799301 | ALL PASS |
| Real provider OTP, manual smartphone, staging acceptance | Operator-controlled environment | NOT RUN / BLOCKED |

## Risks and boundaries

- In-flight writes that reached PostgreSQL before logout may still commit server-side, even if a stale browser response is ignored. This task only guards browser-private state; backend session authorization and request-idempotency guarantees need independent security review.
- Leaflet dependencies are pinned and installed only in disposable CI; external OpenStreetMap tiles are stubbed to avoid leaking test browser data to the provider. Production map delivery remains unchanged.
- Browser test data are synthetic, short-lived and stored only in ephemeral CI services.
- PR #14 stays a draft; staging recovery, backup, rollback, migration 008 and all release gates remain NO-GO.

## Progress log

- 2026-11-04 UTC — Confirmed PR #14 state, current SHA, green CI, missing independent review and inspected the UI/map/test code. Selected versioned asynchronous state protection and map/keyboard synthetic browser regressions.

- 2026-11-03 UTC — Added request-epoch guard for delayed create, cancel and search results. A stale response after session invalidation is ignored rather than repopulating private cards, messages or intents.
- 2026-11-03 UTC — Expanded browser E2E from 21 to 30 scenarios (three browsers × ten flows): genuine pinned CI-only Leaflet map clicks with fake tile responses, coordinate storage/URL leakage checks, Enter-key intent creation/cancellation and delayed-successful-match-after-logout regression. Production Leaflet/CDN delivery remains unchanged.
- 2026-11-03 UTC — Separate privacy audit found hidden DOM could retain a previous request departure time on logout; added explicit form time + departure window wiping on logout/intent cancellation, with extra browser assertions.
- 2026-11-03 UTC — The first docs-contract run identified a nonconforming task heading; corrected it without changing application logic.
- **CI verified:** #41704799368 **30/30 passed** at code SHA \`76cd1a414bb942086ed7c81ba41c82835f58c19f\`. Security smoke #41704799389 PASS, PostgreSQL/PostGIS #41704799073 PASS, secret hygiene #41704799185 PASS, agent docs #41704799301 PASS. **No Render/Supabase/live data accessed; PR #14 remains draft, unmerged.**

## Next steps

- **Completed:** CI run #41704799368 verified `76cd1a414bb942086ed7c81ba41c82835f58c19f` with **30/30 Playwright tests passing** (59.9 s), and all four standard CI workflows also passed. The next agent should verify any subsequently pushed HEAD before treating this as current.
- Obtain independent human review of state lifecycle, privacy/keyboard/mobile UX and test-only Leaflet substitution.
- Coordinate authorized staging acceptance separately after restore and rollback evidence. No automatic merge or deploy.
