# Task: Real-browser mobility QA on PR #14 (disposable PostGIS)

- **Task ID:** 2026-11-04-mobility-browser-qa
- **Status:** in progress — tests and workflow committed on PR #14, first real-browser CI result pending
- **Owner:** ChatGPT engineering agent; independent reviewer and staging operator not yet assigned
- **Last updated:** 2026-11-04 (user local date); UTC evidence must be read from GitHub Actions runs
- **Baseline:** PR #14 at `9852c637a7afc9f5f9d03a3979e2729d0c7e00df` before this QA work
- **Branch:** `feature/mobility-intent-ui-2026-11-03`; targets `main` via draft PR #14
- **Scope:** frontend ride-ID validation fix, synthetic-only Playwright E2E tests and CI, agent docs. No Render deploy, live Supabase SQL, external OTP, payment, user data or schema migration 008.

## Goal and acceptance criteria

Prove the existing matching UI works across real Chromium, Firefox and mobile WebKit browsers: unauthenticated and disabled-feature hiding, verified student create/view/cancel, driver geocoded opt-in posting, real PostGIS candidate match, booking handoff without auto-reservation, CSRF enforcement, privacy, logout state reset and viewport fit. Real PostgreSQL tests must be isolated on CI's disposable PostGIS: no live staging or production access. Screenshots and traces are synthetic-only and retained briefly.

## Current state

- Existing frontend and backend CI passed before this task, but no actual Playwright browser had yet exercised the student-to-driver matching journey.
- PR #14 remains a draft and the connected Render production/staging services are still on older commits; this QA does not authorize deployment or feature-flag changes.
- A source-level ride-ID mismatch was identified and corrected in this branch, with CI regression evidence still being collected.

## Observed gap and corrective fix

An independently checked integration mismatch was found before browser QA: `campus_rides.id` uses `ride_<uuid>`, but the new JS candidate validator and booking bridge previously required plain `<uuid>`. The backend `rank()` sends the database ride ID unchanged, so valid candidates would be discarded and their booking button would reject the ID. Updated `mobility-ui.js`, `index.html`, and `test_mobility_ui.js` to require `ride_<uuid>` for candidate ride IDs while leaving travel-intent ID validation as plain UUID.

## Plan

1. Use the existing PostgreSQL 16/PostGIS 3.4 image as a disposable CI service; run migrations 001–007 against loopback-only CI database with test credentials.
2. Seed synthetic campus user and session records with random identifiers; use browser cookies for authenticated scenarios without sending OTP through real providers.
3. Run multiple browser projects (Chromium desktop, Firefox desktop, WebKit iPhone 13) with screenshots/traces only on failure. Test one real student/driver booking flow and denial/feature-off paths.
4. Fix reproducible failures without bypassing auth/CSRF/feature flag, then capture actual CI evidence, browser limitations and next independent review.

## Progress log

- 2026-11-04 — Verified local WSL native Node QA result reported by user: six of six frontend unit/static tests passed at `9852c63`, but this was not real-browser QA.
- 2026-11-04 — Reviewed backend ID contract; fixed mismatch between `ride_<uuid>` database IDs and plain UUID checks on candidate cards/booking handoff; added regression assertion.
- 2026-11-04 — Added `playwright.mobility.config.cjs`, `e2e/mobility-fixtures.cjs`, `e2e/mobility.spec.cjs`, CI workflow, and `test:e2e:mobility` npm command. Database fixture verifies `QA_DISPOSABLE_POSTGIS=YES` and hostname loopback; browser service uses isolated PG identity/rides/mobility and synthetic-only identities. No data exported or live service changed.
- **Pending:** GitHub CI must execute the real browser suites; static source alone is not evidence that Playwright passed.

## Verification

| Check | Environment | Status |
|---|---|---|
| User's previous Node unit/static QA | Local Ubuntu-D, commit `9852c63` | Reported PASS (6/6) |
| Fixed ride-ID regression | `npm run test:mobility-ui` (new branch CI) | Pending |
| Playwright browser QA | GitHub PR #14, Chromium / Firefox / WebKit, isolated loopback PostGIS | Pending |
| Actual smartphone/browser manual acceptance | Approved isolated test environment | NOT RUN |
| Actual staging/production Render or Supabase | Live services | UNTOUCHED |

## Security and QA limitations

- Synthetic seeded sessions bypass actual email/SMS OTP and provider delivery; those require separately authorized staging tests. Browser code still uses actual session cookies, CSRF, route authorization, PostgreSQL matching and seat interfaces.
- A scripted browser QA service is not a release deployment. Existing staging backup, independently restored source, Render rollback-artifact and human approval gates remain NO-GO.
- External Leaflet/Tailwind CDN loads could be flaky in CI; classify such failures separately from app logic and document actual evidence before modifying a test.
- `@playwright/test@1.56.1` is explicitly pinned and installed **only inside the dedicated CI QA job**, not as a production runtime dependency; future dependency lockfile maintenance can be reviewed separately.
- Screenshots, HTML reports and traces contain synthetic IDs only; artifacts have seven-day retention. No browser test sends UPI payment or messages real students.
- The browser QA job deliberately refuses a remote database URL; do not weaken this restriction for staging.

## Next steps — exact handoff

1. Check the newest PR #14 GitHub Actions run named `CampusPool mobility browser E2E (disposable only)`; inspect failed steps and screenshots/traces if necessary.
2. Fix test/product bugs on the feature branch, rerun all browser projects and record passing run IDs/SHAs in this file and `docs/agents/STATUS.md`.
3. Independently review mobile responsiveness, screen reader and keyboard behaviour, fake-user session setup, and browser error paths. Manual browser QA after separate staging-owner approval is still required.
4. Do not merge/deploy merely because synthetic browser CI passes; do not run migrations or deploy on Render without independent backup/rollback gates.

## Paths changed

- `index.html`, `mobility-ui.js`, `test_mobility_ui.js`, `package.json`
- `playwright.mobility.config.cjs`, `e2e/mobility-fixtures.cjs`, `e2e/mobility.spec.cjs`
- `.github/workflows/mobility-browser-qa.yml`
- `docs/agents/tasks/2026-11-04-mobility-browser-qa.md`, `docs/agents/STATUS.md`, `docs/agents/NEXT_STEPS.md`
