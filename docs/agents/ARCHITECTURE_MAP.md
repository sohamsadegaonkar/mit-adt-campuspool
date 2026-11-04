# CampusPool — architecture map for incoming agents

**Reviewed:** 2026-11-03 UTC; source `main@3ee1f4a12e98` plus a separate **unmerged** idempotency branch. This is a navigation/ownership map, not a release claim. Verify code and live configuration before acting.

## Runtime shape (today)

```text
Student browser / PWA (index.html, campuspool.css)
          |
          v
Node.js HTTP API (server.js; Dockerfile, Render)
          |
          +-- Legacy rides, bookings and local state --> database.js / better-sqlite3
          |
          +-- Flagged PostgreSQL auth --> stage1-otp/auth-routes.js
          |                                  stage1-otp/pg-store.js
          |                                  stage1-otp/identity.js
          |
          +-- Flagged PostgreSQL rides --> stage1-otp/rides-store.js
          |
          +-- Flagged matching --> stage1-otp/mobility-store.js
          |                        stage1-otp/mobility-geo.js
          |                        PostGIS + GiST / typed time indexes
          |
          +-- Email/SMS adapters --> stage1-otp/email-provider.js / sms-provider.js
```

No independently deployed microservices, Redis, H3 or Kafka are part of the current source-of-truth architecture.

**Pending branch addition (NOT DEPLOYED):** `idempotency.js` coordinates response receipts with SQLite domain writes or the shared PostgreSQL connection/transaction. New `stage1-otp/migrations/008_transactional_idempotency.sql` adds a server-only, RLS-protected table, required before booting PostgreSQL Rides with the reviewed idempotency branch. See `IDEMPOTENCY_CONTRACT.md` for route coverage, key and replay semantics; do not mistake this for generic exactly-once OTP/provider/payment delivery.

## Feature flags and source of truth

| Switch | Current semantics | Safety boundary |
|---|---|---|
| `AUTH_OTP_BACKEND=postgres` | Selects PostgreSQL-backed OTP/identity route | Requires isolated migrated private PostgreSQL |
| `RIDES_BACKEND=postgres` | Selects durable PostgreSQL Rides/booking store | Requires PostgreSQL auth; fails closed on missing schema |
| `MOBILITY_MATCHING_ENABLED=true` | Enables private travel intents and candidate search routes | Requires PG Rides/auth; default false |
| `EMAIL_PROVIDER` | Staging email integration / disabled fallback | Never simulate successful live delivery |
| `SMS_PROVIDER` | Staging SMS provider integration / disabled fallback | MSG91 DLT prerequisites; never bypass SMS verification |
| `APP_ENV=staging` | Staging-only access gate | Never expose test accounts/secrets in production |

Do not infer a service's **actual current flag values** from the Blueprint YAML alone. Verify private Render environment state without echoing secrets; in particular, never deploy a flag switch based only on documentation.

## Data boundaries

- **Legacy:** `database.js`, SQLite rides/bookings and some local state. Render Free local filesystem is not durable for production data.
- **PostgreSQL identity:** `stage1-otp/migrations/001_otp.sql` through `005_staging_backend_role.sql` establish private OTP/users/sessions/permissions, with staging-only restricted roles and RLS.
- **PostgreSQL Rides:** `006_durable_rides_bookings.sql`; atomic row locking, booking ownership, seat constraints and cancel restoration.
- **Geospatial matching:** `007_spatiotemporal_matching.sql` with PostGIS `ST_DWithin`, indexed pickup/drop-off geography, 0.01° coarse grids and 15-minute buckets; **candidate-only**, based on straight-line distances rather than actual road detours.
- **Errands:** isolated UI demo under `prototypes/campuspool-2/`; no live backend endpoints, real UPI payments or real payout ledger.
- **Payments:** unverified browser-reported payment success is intentionally not trusted. Do not enable financial settlement without approved provider callback plus reconciliation.

## Deep-dive documents (existing)

- [Product scope](../../PRODUCT.md) and [visual design](../../DESIGN.md)
- [PostGIS mobility stage 1](../../MOBILITY_MATCHING_ROLLOUT.md)
- [PostgreSQL Rides](../../RIDES_POSTGRES_ROLLOUT.md)
- [OTP service](../../STAGE1_OTP.md) and [staging database](../../SUPABASE_STAGING.md)
- [Staging setup](../../STAGING_SETUP.md) and [PostgreSQL runbook](../../POSTGRES_STAGING_RUNBOOK.md)
- [Security controls](../../SECURITY_DEPLOYMENT.md) and [credential incident](../../SECURITY_CREDENTIAL_ROTATION.md)
- [Production release gates](../../PRODUCTION_RELEASE_GATE.md) — **NO-GO until individually verified**
- [Prototype limitations](../../prototypes/campuspool-2/README.md)

## Target evolution, not current deployment

Maintain a **modular monolith** with isolated domains. PostgreSQL/PostGIS remain authoritative for durable data, identity and bookings. Add road-route verification for real detour checks, and a transactional outbox/worker if reliable asynchronous notifications are required. Introduce Redis only after measured hot cache/throttle load; H3 only after evidence for hierarchical demand aggregation or discovery; microservices only for independently justified scaling or fault isolation. Kafka is not on the near-term path. See [DECISIONS.md](DECISIONS.md).

## Agent file ownership

- Runtime/API: `server.js`, `stage1-otp/*`; coordinate any overlapping edits.
- Data migration: `stage1-otp/migrations/*`, `database.js`; require isolated tests, no live migration without approval.
- Frontend: `index.html`, `campuspool.css`, prototype isolated subtree.
- Testing/CI: `test_*.js`, `.github/workflows/*`, `scripts/*`.
- Integration state: `docs/agents/STATUS.md` and `NEXT_STEPS.md`; updated and reconciled for every implementation PR.
- Agent-specific progress: distinct files under `docs/agents/tasks/`.

**Rule:** if a diagram or this map disagrees with code or deployed configuration, fix it with evidence before using it to authorize a change.

## Flutter/Places branch history carried into main — 2026-11-05

Historical headings below were recorded before the combined source merge. The UI remains separate and optional; Google Places billing-dependent endpoints are disabled until explicit provider approval. No Render deployment, staging migration or provider charge was authorized.

## Optional Flutter UI client (unmerged proposal, 2026-11-04)

`feat/flutter-campuspool-figma-ui-2026-11-04` introduces `flutter_app/` as a **standalone local UI prototype** beside the existing static website. It has no network API client, no persistent or privileged student state, and no backend migration. Flutter screens reflect the existing Figma white/black/yellow design and local demonstration quote calculations. Do not replace this map's deployed Node frontend diagram until Flutter is reviewed, integrated and explicitly released. See [task record](tasks/2026-11-04-flutter-figma-ui.md).

## Optional Flutter Phase 2 read-only adapter (branch-local, 2026-11-04)

The separate Flutter UI branch introduces `lib/ride_feed.dart`: an opt-in HTTPS/localhost-only HTTP client that checks `GET /api/auth/me` before `GET /api/rides` using an **injected**, already-authenticated transport. There is no account login, credential persistence, or native cookie manager yet. A caller's UI flag alone is not proof of authorization; the existing Node session check remains mandatory. `lib/ride_results.dart` handles explicit state layouts and strips driver contact/UPI and free-form fields from the ride model. This is **not on main or deployed**. See [task](tasks/2026-11-04-flutter-phase2-platform-states.md).

## Proposed Flutter Phase 3 session boundary (unmerged, 2026-11-04)

`campus_auth.dart` requests an email OTP using existing Node endpoints and only marks a session authenticated after an actual successful `GET /api/auth/me` with a server-issued cookie. `session_transport_web.dart` uses browser-managed HttpOnly same-origin credentials, while `session_transport_io.dart` holds `cp_session` solely in native process memory, denies cross-origin and redirects, and discards it on logout. `campus_runtime.dart` requires explicitly configured, reviewed API origin; an unconfigured build remains guest-only. Existing Node authorization/CSRF remains authoritative; no live bookings or payment features are added. This is branch-local and not deployed. [Task](tasks/2026-11-04-flutter-session-login.md).

## Proposed destination autocomplete integration — branch-local (2026-11-04)

Flutter `PlaceAutocompleteField` calls `HttpPlaceSearchSource` using the configured CampusPool origin. The Node server has two narrow optional, publicly readable JSON POST endpoints, `/api/places/suggest` and `/api/places/resolve`, behind `PLACES_AUTOCOMPLETE_ENABLED`. `places-autocomplete.js` calls fixed Google Places (New) endpoints using the **server-only** `GOOGLE_PLACES_API_KEY`. Google session token comes from the Flutter typing/selection session. Strict rate/budget limits are checked in the Node SQLite bucket; external provider quota must be configured separately. No user session, GPS, payment, rides data or production environment is changed by this unmerged branch. [Task](tasks/2026-11-04-flutter-place-autocomplete.md).
