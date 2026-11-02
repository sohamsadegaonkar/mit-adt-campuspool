# CampusPool Mobility Matching — Stage 1 (PostGIS)

## Status and design

The first matching increment is a **feature-flagged, demand-first candidate search**, not an automated booking or road-routing product. It runs inside the existing Node.js API using the existing private PostgreSQL connection; no Redis, new paid services, messaging bus or LLM is required.

Main backend is \`RIDES_BACKEND=postgres\`. The additional switch is:

    MOBILITY_MATCHING_ENABLED=true

Default is **false**, and startup refuses to enable matching unless PostgreSQL rides and identity are selected. Production Render Auto-Deploy stays OFF. Never turn on production without a reviewed release and migration.

### Data model and indexing

- Additive migration: \`stage1-otp/migrations/007_spatiotemporal_matching.sql\`
- \`public.campus_ride_geo\` holds optional geocoded pickup/drop-off + typed departure for a ride. Legacy rides without coordinates still work but cannot appear in matching suggestions.
- \`public.campus_trip_intents\` holds one active travel intent per verified student, with two private geographies and an earliest/latest time window.
- **Spatial indexes:** PostGIS \`geography(Point,4326)\` + GiST indexes on both endpoints; \`ST_DWithin\` limits expensive distance calculations to candidate rides.
- **Grid:** deterministic coarse \`pickup_cell\`, \`dropoff_cell\` keys (0.01° grid, approximate ~1 km scale depending on latitude) plus 15-minute time bucket indexes for future anonymous aggregation. This is not H3 and cells do not claim uniform meter dimensions.
- **Time:** typed \`timestamptz\` and a maximum 3-hour student departure window, at most 7 days ahead; matching excludes outside-window and already departed trips.
- **Rank:** simple, bounded score based on two **straight-line** endpoint distances under 1,500 m each. It is an explainable geometric **candidate only**; actual roads, detours, walking routes and safety suitability require later verification.
- **Privacy:** matches return only ride ID, vehicle type, seat count, fare, time and rounded distances. They do NOT expose exact GPS, rider emails or driver contact details. No API lists other students' intents.
- **Access:** Tables are private to \`campuspool_staging_app\`, RLS enabled, with no \`anon\` or \`authenticated\` grants. API enforces verified session, CSRF for writes, and ownership for reads/cancellation.
- **Abuse protection:** Shared PostgreSQL rate buckets limit each account to 8 intent creation attempts and 30 matching searches per hour; no process-local counters. One active intent per account is enforced by unique index.
- **Booking safety:** Matching never creates or reserves a seat. The existing PostgreSQL transaction handles actual seat reservations, duplicate prevention and cancellations. Sold-out rides are filtered out of suggestions.
- **Load balancing:** API instances remain stateless. All intent state, rate limits, indexes and booking locks are database-backed and shared across replicas. Additional Render instances or separate workers can be introduced when measured traffic warrants it.

## HTTP API (private and behind staging Basic Auth)

All routes require a logged-in verified campus account. POST requests also require the CSRF token from \`GET /api/auth/me\`.

**POST /api/mobility/intents**

\`\`\`json
{
  "pickup": {"lat": 18.5103, "lon": 73.9232},
  "dropoff": {"lat": 18.4652, "lon": 74.0181},
  "earliestDeparture": "2027-01-02T08:30:00+05:30",
  "latestDeparture": "2027-01-02T10:00:00+05:30"
}
\`\`\`

Returns an intent ID, coarse cells and times, not raw GPS. A second active intent receives HTTP 409.

**GET /api/mobility/intent** returns the current user's active intent, if any.

**GET /api/mobility/matches?intentId=<UUID>** returns up to 10 candidates with \`candidateOnly=true\` and \`roadRouteVerificationRequired=true\`. Nonowners receive HTTP 404.

**POST /api/mobility/intents/cancel**

\`\`\`json
{"intentId":"<UUID>"}
\`\`\`

Only the owner may cancel. Cancelled/expired intents are never matched.

A driver can opt into matching when creating an existing ride using **all three** new optional fields:
\`\`\`json
{
  "pickupCoordinates":{"lat":18.5103,"lon":73.9232},
  "destinationCoordinates":{"lat":18.4652,"lon":74.0181},
  "departureAt":"2027-01-02T09:15:00+05:30"
}
\`\`\`

These fields are additional to the existing ride form (vehicle, names of locations, capacity, fare, etc). They must be provided together; incomplete or invalid coordinates are rejected. The server uses the verified driver's account details, never caller-supplied driver identity.

## Verification and rollout

CI uses a **disposable \`postgis/postgis:16-3.4\` PostgreSQL service**, with:

    npm run test:mobility-geo
    npm run test:mobility
    npm run test:mobility-http

The integration tests verify index usage (GiST query plan), spatial/time filtering, privacy, per-account ownership, full-seat changes, duplicate intents, POST CSRF, and cross-user denial. No live Supabase tables receive these test fixtures.

For staging, first apply \`campuspool_007_spatiotemporal_matching\` **only to the isolated staging Supabase database**, verify RLS and zero imported records, then set \`MOBILITY_MATCHING_ENABLED=true\` **only** on Render \`mit-adt-campuspool-staging\`. Because Render may automatically deploy on environment changes, verify the exact main commit before doing so and confirm the deployed service is staging, never production.

Production requires an independent privacy and data-retention review, verified email/SMS, migration of legacy Rides, route-provider selection and true road-detour estimates. The current geometric matching should not be presented as a verified pickup route.

### Next increments

1. UI: add travel request form and candidate cards inside the CampusPool student journey.
2. Route provider: verify realistic driving/walking distances and detour budgets with a bounded paid-API quota.
3. Persist shared notification outbox; background processing for seat-releases and match alerts.
4. Add idempotent booking/seat-hold protocol with expiry, then group formation.
5. Aggregate coarse demand cells only when there are enough distinct students; prevent differencing queries and limit raw point retention.
6. Load test 100+ concurrent students, query p95, pool saturation, lock contention and queue lag before horizontal scaling.

**No H3 dependency, Redis, additional production instance, LLM or uncontrolled route-provider bill is needed at this stage.**
