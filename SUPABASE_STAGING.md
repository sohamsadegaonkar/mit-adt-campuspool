# CampusPool staging on Supabase PostgreSQL

## Purpose

Replace the blocked second Render Free PostgreSQL database with a separate Supabase Free project. This project is **only for CampusPool staging**, not for ReturnDesk or CampusPool production.

Supabase account discovery (2026-11-01):
- Organization available: `sohamsadegaonkar's Org` (Free).
- Existing projects: `alpha_testing` and `sohamsadegaonkar's Project`, both inactive. Do not restore, delete, or repurpose either.
- Supabase currently supports two active projects on Free; inactive projects do not count toward the active project quota, subject to actual account restrictions.
- A new project **must not be created until the user explicitly chooses the organization**. The connector requires that selection even when only one organization is listed.
- No subscription upgrade or billable feature has been authorized.

## Architecture

CampusPool staging Node.js server on Render Singapore -> TLS PostgreSQL connection -> separate Supabase project in Singapore `ap-southeast-1`.

This uses PostgreSQL directly through the server's `pg` library. It does **not** replace CampusPool identity with Supabase Auth, does not add a public supabase-js client, and does not expose service-role credentials in the browser.

## Once the organization is confirmed

1. Create a new Supabase Free project named `campuspool-staging-db` in `ap-southeast-1`, provided the provider confirms no extra charges. Do not use existing Supabase projects.
2. Wait for the new project to become active. Verify the selected project name and project ID.
3. Apply the three `stage1-otp/migrations` to **that new project only**. The third migration enables RLS and revokes public, anon and authenticated role access to the sensitive tables.
4. Query `pg_class` to confirm each CampusPool auth table has `relrowsecurity=true`. Run Supabase security advisors and address findings.
5. Configure the separate Render staging web service, based on `render-staging.yaml` in this branch. It has manual deployments and Basic Auth.
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
