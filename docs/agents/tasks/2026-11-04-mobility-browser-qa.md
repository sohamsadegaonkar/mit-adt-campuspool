# Task: Real-browser mobility QA on PR #14 (disposable PostGIS)

- **Task ID:** 2026-11-04-mobility-browser-qa
- **Status:** tested (GitHub CI) — 21/21 real browser scenarios passed; independent review and actual staging/physical-device acceptance remain pending
- **Owner:** ChatGPT engineering agent; independent reviewer and staging operator not yet assigned
- **Last verified:** 2026-11-03 19:14 UTC (GitHub Actions #41701113565); 2026-11-04 user local date
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
- 2026-11-03 UTC — Initial browser run #41698436474 revealed a CI runner incompatibility (Ubuntu 26.04 with Playwright 1.56.1); runner pinned to Ubuntu 24.04. Follow-up run #41699594647 exposed CI-only HTTP origin vs NODE_ENV=production mismatch and selector expectations; corrected HTTP test mode and browser assertions.
- 2026-11-03 UTC — Run #41700402475 reached 19 passed, 1 failed, 1 flaky; failures traced to shared localhost API_READ rate limits accumulating across independent test scenarios. Introduced explicit preemptive synthetic staging Basic header and a guarded per-scenario reset of **only** `rl:%` counters in the dedicated ephemeral CI SQLite rate-limit table; kept application throttles enabled.
- **CI PASS:** run **#41701113565** on code commit **`810ad6415ecdbe78ae5576bf840ce09c3e5d63cd`** completed **21/21 passed (46.8s browser test stage), no failed or flaky scenarios** across Chromium desktop, Firefox desktop and mobile WebKit. Associated security smoke #41701113571, PostgreSQL/PostGIS #41701113606, credential hygiene #41701113667 and agent documentation #41701113609 all passed. No real student/Render/Supabase staging access.

## Verification

| Check | Environment | Status |
|---|---|---|
| User's previous Node unit/static QA | Local Ubuntu-D, commit `9852c63` | Reported PASS (6/6) |
| Fixed ride-ID regression | `npm run test:mobility-ui` in security smoke #41701113571, code `810ad64` | PASS |
| Playwright browser QA | GitHub #41701113565, code `810ad64`, three projects × seven scenarios | PASS: 21/21 (46.8s) |
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

## CI artifact and remaining acceptance evidence

- Successful run: https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41701113565
- Playwright used a **local PostgreSQL 16/PostGIS 3.4 container**, synthetic seeded campus users/sessions, staging Basic Auth and CSRF, the actual app HTTP server and actual browser engines.
- The browser suite covered manual coordinate entry, not verified OpenStreetMap tile clicks or geolocation permission workflows. It did not validate real SMS/email OTP delivery, real payment callbacks, road routing, physical mobile devices or a staging Render deploy.
- Artifact report includes Playwright HTML report, screenshots/traces on failure and seven-day retention; the pass run may have little to no failure screenshot evidence.
- Rate limiter test independence: delete only synthetic `rl:%` counters in the dedicated /tmp CI SQLite file between tests, with disposable environment preflight; this avoids a false cross-project 429 while retaining app rate limits inside each scenario. Rate-limit enforcement is separately covered by existing backend integration tests.
- **Release gate is unchanged:** PR #14 stays draft, migration 008 remains blocked, no production or staging deployment, and independent database recovery and retained Render rollback artifact still need owner confirmation.
