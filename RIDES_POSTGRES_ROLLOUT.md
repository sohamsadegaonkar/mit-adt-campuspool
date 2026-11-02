# CampusPool — Durable PostgreSQL Rides and Bookings

## Current state

**Phase 2 staging feature available behind \`RIDES_BACKEND=postgres\`. No production data has been migrated or deleted.**

- The migration \`stage1-otp/migrations/006_durable_rides_bookings.sql\` is applied to the **isolated staging Supabase** project and is repeatable in CI.
- New tables \`public.campus_rides\` and \`public.campus_bookings\` have RLS on, deny \`anon\`/\`authenticated\` direct access, and grant access only to the restricted backend role \`campuspool_staging_app\`.
- Existing \`public.campus_users\` rows and verified server-side sessions provide driver and passenger identity. **Never trust an email/user ID from a booking request.**
- The application defaults to \`RIDES_BACKEND=sqlite\`, preserving the current deployed behavior unless explicitly changed.
- The HTTP routes opt into \`PgRidesStore\` only when \`RIDES_BACKEND=postgres\` and \`AUTH_OTP_BACKEND=postgres\`. Startup validates both new tables; missing schema fails closed rather than silently reverting to SQLite.
- \`campus_rides\` and \`campus_bookings\` are empty in staging as created; this is expected and is **not** a completed production migration.

## Stored data and guarantees

- A driver must be a verified \`campus_users\` row; the server loads the driver name, email, department, and phone from PostgreSQL.
- Booking runs inside one PostgreSQL transaction with a locked ride row (\`SELECT ... FOR UPDATE\`), so two concurrent requests cannot reserve the same remaining seat.
- One active booking per \`ride_id + passenger_user_id\` is enforced by a partial unique index as well as application logic.
- A driver cannot book their own ride, and one user cannot cancel somebody else's booking or ride.
- Cancellations retain \`status='cancelled'\` rows as an audit trail; active lists omit them. Seat restoration is atomic with cancellation.
- Payment status is constrained to \`Pending\` at the database level. There is no client-authorized "Paid" update until a verified provider callback is implemented.
- The Rides HTTP API uses fresh PostgreSQL reads (no stale SQLite version cache); legacy SQLite path is unchanged.

## Deployment controls

### Staging

1. Verify the staging Supabase migration \`campuspool_006_durable_rides_bookings\` exists and both tables' RLS is enabled.
2. Confirm current staging uses the restricted pooler login, \`OTP_DB_SSL=true\`, and a verified Supabase CA Secret File.
3. Ensure \`AUTH_OTP_BACKEND=postgres\`.
4. In the **staging Render service only**, set \`RIDES_BACKEND=postgres\` and deploy the explicitly reviewed \`main\` commit. Auto-deploy remains off.
5. Expect \`/healthz=200\` and a Basic Auth \`401\` on private URLs without credentials. Run a controlled browser session with a test verified account and test ride, then delete test records from the UI after testing.
6. Confirm logs do not contain PostgreSQL error codes, raw connection strings, OTP codes, or contact details.

### Production — do not switch yet

**NO GO** until all conditions below are met:

- Take a consistent backup/export of the existing production SQLite rides/bookings and review whether actual student profiles and booking records are stored on Render's ephemeral disk.
- Implement and independently verify an audited import plan mapping legacy SQLite users to verified \`campus_users\` UUIDs. Resolve orphan/duplicate rides and bookings; record exact row counts and hashes. Do not invent owner identities.
- Verify a cold restore from backups, idempotent backfill, protected maintenance window, and a reconciled forward/rollback plan. Switching back to SQLite after new PG writes would strand records; rollback must account for that.
- Verify real email and MSG91 SMS delivery in controlled staging, and revoke/rotate previously committed secrets.
- Decide operational treatment for settlement: the existing unpaid booking and 10% driver commission block remains, but **there is no approved payment settlement provider**. Do not enable actual financial settlement.
- GPS location caches are presently ephemeral and still use local SQLite; persist or explicitly document their temporary nature before production operations.
- Validate seat contention, ownership, browser/mobile workflows, API threat modeling, and backups under realistic concurrency.
- Keep Render production Auto-Deploy disabled until authorized release approval.

## Reproducible verification

Run only against a **disposable local PostgreSQL instance**, never Supabase staging/production:

\`\`\`bash
npm ci
npm run test:rides
npm run test:rides-http
npm run test:identity
npm run test:stage1
npm run test:security
npm run test:secrets
npm run check:release-ci
\`\`\`

The tests fail closed when their \`OTP_DATABASE_URL\` points to a remote host. The HTTP test creates disposable verified users and server sessions in isolated PostgreSQL, verifies Basic Auth and CSRF, creates a ride, rejects spoofed ownership, books/cancels a seat, checks the shared PostgreSQL seat count, and deletes all fixtures.

Only **\`main\`** is used for development, and Render production/staging remain separate services with private environment variables. The presence of these files in \`main\` is not permission for a production deployment.
