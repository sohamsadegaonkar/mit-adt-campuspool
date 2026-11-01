# CampusPool staging on Supabase PostgreSQL

## Purpose

## Provisioned staging project — 2026-11-01

- Supabase project: **campuspool-staging-db** (`tnitksrlntrdxbvznxzf`)
- Organization: `sohamsadegaonkar's Org`
- Region: Singapore (`ap-southeast-1`)
- Plan cost quoted: **$0/month**, confirmed Free
- Status at verification: **ACTIVE_HEALTHY**
- Dashboard: https://supabase.com/dashboard/project/tnitksrlntrdxbvznxzf
- Applied migrations: `campuspool_001_otp`, `campuspool_002_users_sessions`, `campuspool_003_supabase_private_tables`, `campuspool_004_audit_user_index`, `campuspool_005_staging_backend_role`.
- Verified five auth tables exist, initially empty, have RLS enabled and reject `anon`/`authenticated` SELECT privileges.
- Supabase security advisor now shows **no findings** after the backend-only role policies were added. Never grant access to `anon` or `authenticated` for these tables.
- Performance advisor no longer flags the audit-table foreign key as unindexed. Other newly created indexes are reported as unused because the tables are empty.

**Not yet connected to Render:** Provider connection credentials are only available through the owner's private Supabase dashboard. Configure the session-pooler URL and password in the separate Render staging Environment screen; do not send them in chat. Real provider signup testing is pending.


Replace the blocked second Render Free PostgreSQL database with a separate Supabase Free project. This project is **only for CampusPool staging**, not for ReturnDesk or CampusPool production.

Supabase account discovery (2026-11-01):
- Organization available: `sohamsadegaonkar's Org` (Free).
- Existing projects: `alpha_testing` and `sohamsadegaonkar's Project`, both inactive. Do not restore, delete, or repurpose either.
- Supabase currently supports two active projects on Free; inactive projects do not count toward the active project quota, subject to actual account restrictions.
- The user explicitly selected this organization and authorized Free-plan creation; the new project was created successfully.
- No subscription upgrade or billable feature was authorized or created.

## Render staging service — created but intentionally not live

- Service: **mit-adt-campuspool-staging**
- Render service ID: `srv-dbjof8fb9u1s73eks0bg`
- Dashboard: https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg
- URL (not yet operational): https://mit-adt-campuspool-staging.onrender.com
- Branch: `feature/supabase-staging-postgres`; Singapore, Node.js, Free plan.
- Auto-deploy: **OFF**.
- Initial build: **successful**. Initial runtime deploy: **failed closed** due to missing `OTP_SECRET`. This is deliberate: no insecure/default secrets were provisioned.
- Currently configured non-sensitive settings: `NODE_ENV=production`, `APP_ENV=staging`, `AUTH_OTP_BACKEND=postgres`, `OTP_DB_SSL=true`, `EMAIL_PROVIDER=disabled`, `SMS_PROVIDER=disabled`, and isolated SQLite path.
- The Supabase connector cannot return the database password or the project-specific Session Pooler hostname. A cross-service credential-transfer attempt was **blocked by the platform's safety checks**. No password or pooler hostname was guessed or stored in Render.
- A dedicated role `campuspool_staging_app` exists in Supabase with access to only the five auth tables, plus server-only RLS policies. Its LOGIN capability is currently **disabled** (`NOLOGIN`) until a new password can be configured privately.

### Complete the private connection (account-owner UI only)

1. In your password manager, generate four separate high-entropy secrets (e.g. 64+ hex characters): one for the custom database role, one for `OTP_HMAC_KEY`, one for `OTP_SECRET`, and one for `STAGING_BASIC_AUTH_PASSWORD`. Do not reuse old compromised keys.
2. In Supabase SQL Editor on **campuspool-staging-db only**, activate the restricted database role with a password stored privately:

       ALTER ROLE campuspool_staging_app WITH LOGIN PASSWORD '<GENERATED-PRIVATE-ROLE-PASSWORD>';

   Do not commit this SQL with the actual password. Treat the SQL Editor's query history as sensitive. You may use a supported Supabase role-password UI instead if available.
3. In Supabase, open **Connect → Session pooler**. Copy the actual hostname (do not assume any particular `aws-N-` prefix) and port **5432**. Change the connection username to `campuspool_staging_app.tnitksrlntrdxbvznxzf` and use your newly created restricted-role password. If it contains URL-reserved characters, percent-encode it.
4. Open the **new staging service** Render Environment page, add `OTP_DATABASE_URL` with this private URL, and set `OTP_HMAC_KEY`, `OTP_SECRET` and `STAGING_BASIC_AUTH_PASSWORD`. Keep `OTP_DB_SSL=true`, `NODE_ENV=production` and `AUTH_OTP_BACKEND=postgres`. Do **not** modify the existing production Render service.
5. Choose **Save and deploy**. The existing web build succeeded, so the new deploy should attempt startup with the private values. Check for `live` status and `/healthz` returning 200. If the TLS certificate chain is not trusted, install the provider's official CA instead of disabling TLS verification.
6. Leave `EMAIL_PROVIDER=disabled`, `SMS_PROVIDER=disabled` until separate verified provider credentials are installed. Real signups intentionally fail closed while delivery is disabled.
7. Once private configuration is complete, request a fresh staging health check and controlled user journey verification. Do not share credential values in the chat or GitHub issues.

The backend's database role has no superuser or database-creation privileges; public Supabase roles remain denied. No production users or sessions were copied into the new project.

## Architecture

CampusPool staging Node.js server on Render Singapore -> TLS PostgreSQL connection -> separate Supabase project in Singapore `ap-southeast-1`.

This uses PostgreSQL directly through the server's `pg` library. It does **not** replace CampusPool identity with Supabase Auth, does not add a public supabase-js client, and does not expose service-role credentials in the browser.

## Once the organization is confirmed

1. **Completed:** Created a separate Supabase Free project named `campuspool-staging-db` in `ap-southeast-1`; existing projects were not modified.
2. **Completed:** Confirmed the new project is healthy and its ID is `tnitksrlntrdxbvznxzf`.
3. **Completed:** Applied four `stage1-otp/migrations` to the new project only. Migration 003 enables RLS/revokes public access; 004 adds the audit-user index.
4. **Completed:** Queried `pg_class` and verified all five tables have RLS enabled and deny anon/authenticated SELECT; reviewed both security and performance advisors.
5. **Created:** The separate Render staging web service is provisioned, but has not reached a live state because secrets are absent. Complete the private steps above.
6. In Supabase Dashboard -> Project -> Connect, choose **Session pooler** for an IPv4-only Render connection. Copy the actual connection string into Render's private `OTP_DATABASE_URL` environment variable; do not paste it into chat or GitHub. The pooler username differs from direct connections.
7. Set `OTP_DB_SSL=true` and use valid TLS certificate verification. If the connection fails certificate verification, configure the provider's documented CA certificate securely; **do not disable verification to make it work**.
8. Configure new staging-only `OTP_HMAC_KEY` and `OTP_SECRET`, and a strong `STAGING_BASIC_AUTH_PASSWORD`. Do not reuse any committed/exposed secret.
9. Configure test-only Resend and MSG91 credentials after their respective accounts, sender verification and SMS templates have been approved. With SMS disabled, live student registration intentionally cannot complete.
10. Verify isolated PostgreSQL CI, staging browser signup/login, OTP replay/expiry, concurrent registration, session refresh, logout, CSRF and cross-user authorization before any production launch.

## Local and CI checks

- `npm ci`
- `npm run migrate:otp` (ONLY against the new isolated Supabase project or throwaway test database)
- `npm run test:stage1`
- `npm run test:identity`
- `npm run test:security`
- `npm run test:auth`

**Warning:** The integration tests create accounts, expire verification records, and change session state. Never point test runners at Supabase staging if it contains real test users, and never point them at production. CI uses a disposable PostgreSQL service instead.

## Operational limitations

Supabase Free is appropriate for staging but can pause during inactivity; it is not a substitute for production backup guarantees. This migration does not copy any production students or rides. The existing rides data remains in SQLite, so full production durability is still a separate milestone.

Google App Password revocation and legacy secret rotation must be performed through the owning accounts. GitHub PR #4 does not revoke credentials. Production service `mit-adt-campuspool` remains unchanged.
