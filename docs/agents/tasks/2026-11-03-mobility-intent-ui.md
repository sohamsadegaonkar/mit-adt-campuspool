# Task: Feature-gated student travel intent UI

- **Task ID / file:** 2026-11-03-mobility-intent-ui
- **Status:** in review — isolated GitHub CI passed; real staging/browser QA pending
- **Agent / owner:** ChatGPT engineering agent (code/tests); staging release operator unassigned
- **Last updated:** 2026-11-03 UTC
- **Baseline:** `main@3ee1f4a12e984cb6aecbf8ea09150d1e79556c87`; separate staging security PRs #11, #12 and #13 remain unmerged
- **Scope:** frontend `index.html`, new `mobility-ui.js`, public static allowlist `server.js`, tests/CI, agent documentation. No migrations, DB access, Render operations, emails, SMS, payments, GPS tracking, or production changes.
- **Dependencies / related tasks:** `MOBILITY_MATCHING_ROLLOUT.md`; existing 007 PostGIS route contracts; `docs/agents/NEXT_STEPS.md`. Staging deploy is blocked independently by secure release gates.

## Goal and acceptance criteria

Give verified students a usable private travel-intent form directly inside Available Rides: choose pickup and destination on an opt-in map or type coordinates, set a departure window, create/view/cancel their own intent, and search candidate-only rides. Hide the component entirely if the server's mobility feature flag is disabled or the student is not authenticated. No raw user coordinates, driver contact details or exact locations in localStorage/URL/HTML candidate cards. Candidate cards use the existing booking flow and do not reserve a seat directly. Keyboard-accessible labelled fields and status, mobile layout, runtime feature probe, csrf, ownership and backend rate limits.

## Current state (verified vs assumed)

- `main` has PostgreSQL/PostGIS mobility endpoints behind `MOBILITY_MATCHING_ENABLED`, default **false**. It returns current-user intent and candidates with rounded straight-line distances, no exact coordinates or driver contact info.
- Browser had no integrated mobility intent entry point. Existing app has verified-cookie session, CSRF token from `/api/auth/me`, and seat booking restrictions.
- This feature branch is independent of draft security PR #13; it does not include idempotency migration 008 and must not be deployed or merged to main as a workaround for blocked security review.

## Plan

1. Add an accessible compact Find Matching Rides panel within the existing Available Rides tab, hidden until a verified user obtains HTTP 200 from `GET /api/mobility/intent`. Recheck availability on login, registration, logout and session expiry.
2. Permit explicit map location selection (only after click) or manual coordinate entry; validate India's bounds, a 3-hour departure window and 7-day future horizon before POST. Clear coordinate inputs and map markers after successful creation/logout. Never save coordinates in browser storage.
3. Handle create, cancel, refresh and explicit bounded matching search; render only allowlisted candidate fields via `textContent` (no untrusted `innerHTML`) and label results unverified road-route candidates. Only delegate seat selection through existing booking/auth/settlement checks; no auto-booking.
4. Add frontend unit/static allowlist regression tests and CI. No live staging release until migration/recovery credentials and approved test users exist.

## Progress log

- 2026-11-03 UTC — Read agent policy/architecture, confirmed existing API/matching privacy schema and current single-page UI. Chose a new independent `feature/mobility-intent-ui-2026-11-03` branch from `main` to avoid PR #13 review conflict.
- 2026-11-03 UTC — Added server-feature-gated UI panel, isolated controller, session change notifications and booking handoff. Added controlled static asset allowlist, privacy/time/candidate unit tests and security smoke CI.
- 2026-11-03 UTC — GitHub PR #14 opened as a draft, with no Supabase/Render or student record access. Initial code/docs commit e31d644a passed all four workflows: security smoke #41636232397, PostgreSQL/PostGIS #41636232259, credential hygiene #41636232152 and agent documentation #41636232165.
- 2026-11-03 UTC — Integration review found a driver-side gap: current Offer a Ride form never submitted optional geocoded route fields, so student intent matches could not be populated from ordinary UI offers. Added a **default-off optional driver geocoding section** shown only when the same authenticated mobility API is enabled, and added safe route validation before combining the 3 optional backend fields with existing offer payload. Existing offers remain unchanged if not opted in. Additional driver test and renewed CI pending.

## Verification

| Check | Environment / evidence | Result / limitation |
|---|---|---|
| API contract | Reviewed `server.js`, `stage1-otp/mobility-store.js`, `stage1-otp/mobility-geo.js`, `test_pg_mobility_http.js` on main | Existing staging-only API contract verified in source; no live call |
| UI unit/static safety | `npm run test:mobility-ui` in security smoke #41636232397 | PASS in GitHub CI; no real browser |
| Security tests | GitHub security smoke #41636232397 and credential hygiene #41636232152 | PASS |
| Real browser/mobile and accessibility | Authorized staging deployment with verified test accounts | NOT RUN / release blocked |
| Real staging backup, migration 008, live provider tests | Separate release-gate owners | NOT PERFORMED |

## Risks and decisions

- Current backend matches are **straight-line candidates**, not road detours or pickup safety verification. Labels must never suggest confirmed route, seat or payment.
- Existing leaflet tiles load only when a user elects map selection; users can use manual coordinate inputs without tiles.
- Third-party map tile request can reveal general visible map region to tile provider (not selected exact POST coordinates); add privacy/provider review before public release.
- No background geolocation, no exact GPS in localStorage/sessionStorage, URL, browser analytics or response cards. Selected points remain in memory and form fields until submission/cancellation/logout.
- Backend remains the authority for authentication, CSRF, ownership, rate limits and seat availability. Frontend only handles usability and basic early validation.
- Client adds `Idempotency-Key` on writes for forward compatibility with separate idempotency PR #11, without automatic replay of an ambiguous write.
- The new script is static-allowlisted and separately revalidated so rollout updates are not hidden by long CDN cache periods. No new dependencies, databases or microservices.

## Next steps — exact handoff

1. **Next action:** inspect fresh GitHub security/PG CI and fix any failures. Independently review frontend auth/feature gating, location privacy, mobile UX and booking handoff. Then arrange approved staging deployment on a verified source SHA with test accounts and browser/device QA, separately from idempotency release gating.
2. **Who may do it:** engineering reviewer for code and tests; authorized staging owner/operator for any deployment. Production requires separate approval.
3. **Prerequisites and blockers:** real staging migration/backup and recovery signoff; approved staging feature flag and verified test identities; no automatic launch.
4. **Expected evidence:** green UI/security CI, browser create/search/cancel on exact staged SHA, no exposed coords and route uncertainty clearly shown, server-side 401/403/404/409/429 behavior verified.
5. **Production impact:** none. No merge or deploy.

## Links and files changed

- Branch: `feature/mobility-intent-ui-2026-11-03` (targets `main`, independent of PRs #11–13)
- Paths: `index.html`, `mobility-ui.js`, `server.js`, `test_mobility_ui.js`, `package.json`, `.github/workflows/security-smoke.yml`, `docs/agents/{STATUS,NEXT_STEPS}.md`.
- Last known production deployment: older `main` commit according to `docs/agents/STATUS.md`; not rechecked for this task.
