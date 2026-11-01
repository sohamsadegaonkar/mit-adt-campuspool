# CampusPool — Auth integration and protected staging

**Status:** Engineering review only. This branch builds on `security/predeploy-checklist-2026` (PR #2), not production `main`. No Render service has been created or deployed by this change.

## What changed

- Frontend treats only `GET /api/auth/me` as proof of login; locally cached user data is never trusted as authorization.
- Server issues a seven-day, `HttpOnly; SameSite=Lax; Secure` (in production) session cookie after successful existing-user email OTP verification or completed new-user registration.
- The frontend restores identity from the server after page load and confirms it again immediately after login/registration.
- Authentication failures never fabricate local OTPs, accounts, or verified sessions. Legacy localStorage containing personal records is deleted; new storage contains only UI filters.
- Server derives a per-session CSRF token on `GET /api/auth/me`. Browser sends this token in `X-CSRF-Token` for authenticated mutations; cross-origin requests remain restricted.
- Logout invalidates the server-side session and clears locally cached account state.
- SMS delivery is via the MSG91 DLT Flow API (template variable `VAR1`). The server stores hashed OTPs only after provider acceptance and rejects requests when SMS credentials are missing.
- Staging is independently gated by HTTP Basic Auth and uses a separate disposable test database with manual deployment only.
- Payment confirmation is still disabled by the parent security branch, **not enabled by this PR**.

## Create staging manually (not done automatically)

1. Ensure any previously exposed SMTP credential is **revoked and rotated**. Do not reuse old credentials.
2. Go to Render Dashboard → New → Blueprint. Select this GitHub repository, the **`feature/auth-staging-integration` branch**, and the custom Blueprint file **`render-staging.yaml`** (not `render.yaml`). Review the configuration before creating the service.
3. Verify the new service is named `mit-adt-campuspool-staging`, its branch is `feature/auth-staging-integration`, and auto-deploy is **Off**.
4. In the staging service's private environment configuration, provide a new strong `STAGING_BASIC_AUTH_PASSWORD` (at least 20 characters) and **staging-only** SMTP credentials: `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Do not reuse production credentials. The blueprint generates an independent `OTP_SECRET`.
5. For new-user SMS verification, provision a MSG91 account, India DLT sender and approved transactional template with an OTP placeholder bound to `VAR1`. Set `SMS_PROVIDER=msg91`, `MSG91_AUTHKEY` and `MSG91_FLOW_TEMPLATE_ID` **only in the Render secret dashboard**. With `SMS_PROVIDER=disabled`, registration intentionally stops at phone verification. Verify both successful and failed SMS sends with consenting test numbers.
6. Set or confirm `DATABASE_PATH=/tmp/campuspool-staging.db`. This is **ephemeral**, meaning staging accounts disappear on redeploy/restart. Never copy production SQLite files or customer data into staging.
7. Deploy the staging service **manually**, then open its staging URL. The browser prompts for username `staging` and your private staging Basic Auth password. The health check `/healthz` is deliberately accessible without credentials.
8. Test two separate test accounts: registration, email and phone OTP, login, refresh-session persistence, logout, unauthorized access and rate limits. Never verify an actual user account using test tools.
9. Run the isolated tests locally or from CI:

   ```sh
   npm ci
   npm run test:security
   npm run test:auth
   ```

## Key API contracts

- `GET /api/auth/me` — 200 `{success:true,user,csrfToken}` when logged in; otherwise 401.
- `POST /api/auth/login-request` — start existing-user email verification.
- `POST /api/auth/verify-email-otp` — verify OTP and set cookie for existing student; for new students returns a one-use registration token.
- `POST /api/auth/send-phone-otp` — actual MSG91 submission, requires configured provider.
- `POST /api/auth/verify-phone-otp` — check six-digit SMS OTP; returns a one-use registration token.
- `POST /api/auth/register` — requires both valid verification tokens; creates profile and cookie session.
- `POST /api/auth/logout` — requires cookie session and `X-CSRF-Token`; invalidates the cookie.
- Authenticated POST/PUT/PATCH/DELETE actions require `X-CSRF-Token` returned by `/api/auth/me`.

The authentication cookie and CSRF token are intentionally not persisted in `localStorage`. The server checks permissions and identity separately from the frontend.

## Known remaining blockers

**This work does not make CampusPool production-ready.** Real provider setup and delivery tests, prior OTP and profile migration implications, payment provider verification, persistent production DB, backups, browser/device QA, concurrency/load testing, anti-fraud controls, structured monitoring, and production rollback drills still need work. A prior backend security change deliberately stopped unverified payment updates. New-user registration remains unavailable while SMS credentials are absent.

The legacy UI retains other non-authenticated local ride/payment presentation logic, and the main application still needs an end-to-end QA pass before release.

## Safety notes

- The staging service is not a trusted payment environment. Do not use real money or import production records.
- Render's Basic Auth gate protects staging screens but is not a replacement for campus-user verification.
- Never paste credentials into GitHub issues, files, PRs or chats.
- No action on this branch should automatically merge or deploy to `main`.
