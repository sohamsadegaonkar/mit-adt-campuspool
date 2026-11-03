# Task: Mobility browser session-race, map and keyboard hardening

- **Task ID:** 2026-11-04-mobility-ui-hardening
- **Status:** in progress — implementation and isolated browser evidence pending
- **Owner:** ChatGPT engineering agent; independent human reviewer and staging owner pending
- **Last verified:** 2026-11-04 UTC (repository and PR state verified at task start)
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
| Stale-response session-race browser regression | New Playwright suite | PENDING |
| Opt-in map and keyboard browser regressions | New Playwright suite | PENDING |
| Security / PostgreSQL / secret hygiene / docs | GitHub Actions | PENDING |
| Real provider OTP, manual smartphone, staging acceptance | Operator-controlled environment | NOT RUN / BLOCKED |

## Risks and boundaries

- In-flight writes that reached PostgreSQL before logout may still commit server-side, even if a stale browser response is ignored. This task only guards browser-private state; backend session authorization and request-idempotency guarantees need independent security review.
- Leaflet dependencies are pinned and installed only in disposable CI; external OpenStreetMap tiles are stubbed to avoid leaking test browser data to the provider. Production map delivery remains unchanged.
- Browser test data are synthetic, short-lived and stored only in ephemeral CI services.
- PR #14 stays a draft; staging recovery, backup, rollback, migration 008 and all release gates remain NO-GO.

## Progress log

- 2026-11-04 UTC — Confirmed PR #14 state, current SHA, green CI, missing independent review and inspected the UI/map/test code. Selected versioned asynchronous state protection and map/keyboard synthetic browser regressions.

## Next steps

- Finish implementation and rerun GitHub Actions; record exact SHA and run results.
- Obtain independent human review of state lifecycle, privacy/keyboard/mobile UX and test-only Leaflet substitution.
- Coordinate authorized staging acceptance separately after restore and rollback evidence. No automatic merge or deploy.
