# CampusPool exact-commit deployment smoke — read-only QA

**Purpose:** Check each approved CampusPool deployment without requiring a sender domain, real OTP, or student account. This is not a release approval, a database migration, or a substitute for controlled functional QA.

## Before any deployment

- Select a reviewed commit, confirm exact-commit CI, and obtain any separate deployment approval. The existence of this script does not authorize deploying, restarting or modifying a Render service.
- Run the existing isolated suites (for example: npm run test:otp-delivery, npm run test:auth, npm run test:security, npm run test:runtime-config and npm run test:release). PostgreSQL Stage 1 tests require a disposable test database; if its URL is absent, some local checks can skip.
- Never enable ALLOW_DEV_OTP on public staging or production. Without verified Resend sender/MSG91 delivery, live signup remains blocked.

## Exact SHA readback

Read the latest **Live deployment SHA** from the [production Render dashboard](https://dashboard.render.com/web/srv-dbh51h0473hc739ae7cg) or [staging Render dashboard](https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg). Compare it with the exact GitHub source commit. The script does NOT independently query the Render API for the SHA: it trusts your supplied deployment metadata.

From a checkout of the exact deployed commit:

~~~bash
SOURCE_SHA="$(git rev-parse HEAD)"
# Replace with full 40-character SHA shown on the live Render deployment:
RENDER_DEPLOYED_SHA='<40-character SHA from Render dashboard>'

node scripts/deployment-smoke.js \
  --target production \
  --url https://mit-adt-campuspool.onrender.com \
  --expected-sha "$SOURCE_SHA" \
  --deployed-sha "$RENDER_DEPLOYED_SHA"
~~~

To inspect the protected staging service instead, change to --target staging and --url https://mit-adt-campuspool-staging.onrender.com. For a local-only server, use --target local and --url http://127.0.0.1:18080. In every case the supplied source/deployment SHA must match; otherwise the script makes **no network calls**.

## Exactly what it checks

Only three anonymous GET requests are sent, with no cookies, query strings, redirects, OTP, credentials, SMS, payments or database mutations.

| Path | Production/local expected | Protected staging expected |
| --- | --- | --- |
| /healthz | HTTP 200 and JSON status healthy | Same |
| / | HTTP 200 and CampusPool home page | HTTP 401 Basic Auth gate |
| /api/auth/me | HTTP 401, no session | HTTP 401, no session/Basic Auth |

A mismatch, timeout, bad status, degraded JSON, unsafe origin or unexpected public access to staging means BLOCKED. A positive verdict is **PASS_READ_ONLY_SMOKE_NOT_RELEASE_APPROVAL**: not proof of real inbox/handset OTP, physical-device UX, durable PostgreSQL state, backup restore, rollback or payment safety. Response bodies and student identifiers are never printed. No domain purchase is required for these limited checks.

## Manual QA record for every new deployment

Save the date/time, Render service and deployment ID, actual deployed SHA, source SHA, test device/browser and evidence links. Mark each case PASS/FAIL/BLOCKED with reproducible steps:

1. Desktop/mobile guest landing, navigation, accessible forms, empty/error states, layout overflow.
2. Local-only OTP signup/login, negative/wrong/replayed/expired code tests and disabled-SMS fail-closed semantics; do not issue real emails or SMS.
3. Ride feed/filter, authorized synthetic booking/cancellation, concurrency last-seat conflict and idempotent retry in disposable test state.
4. Session/logout/CSRF, feature-gate privacy and unsupported payment/settlement safeguards.
5. Real inbox/handset delivery, production durability, restored backup and safe rollback are **BLOCKED** until separately proven.

Stop if the wrong SHA is deployed, a protected page becomes public, sensitive data is exposed, there is a booking invariant break or storage loss. Never automatically reset, migrate or rollback live PostgreSQL schemas.

## Verify the harness without external requests

~~~bash
node --check scripts/deployment-smoke.js
node --test test_deployment_smoke.js
~~~

The dedicated GitHub Actions workflow also runs only these mocked tests. The script's public smoke mode requires an explicit operator invocation and is **not** executed against Render by CI.
