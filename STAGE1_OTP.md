# CampusPool Stage 1 OTP — PostgreSQL + Email/SMS

**Status: staging implementation only. No production deploy, database creation, payment enablement, or secret rotation has occurred.**

## Architecture

Browser → existing Node.js CampusPool auth API → PostgreSQL OTP state/rate limits → provider HTTPS API → student.

Existing-student email verification creates the existing server-side HttpOnly session. New-student registration requires both email and SMS proofs, valid for 10 minutes and single use.

The OTP tables live in a dedicated CampusPool PostgreSQL database. Existing Rides, students and sessions remain in SQLite until a separate migration. **Never reuse the ReturnDesk PostgreSQL database.**

| Control | Implementation |
|---|---|
| Code generation | Cryptographic random six-digit numeric code |
| Stored data | HMAC-SHA256 for codes and recipient identities; no plaintext recipients |
| Expiry | Five minutes using PostgreSQL timestamps |
| Failed attempts | At most five, counted inside a row-locked transaction |
| Concurrent verification | Exactly one successful verification per challenge |
| Resend | One-minute cooldown, unique row and atomic upsert |
| Abuse prevention | Shared per-IP and per-identifier PostgreSQL rate buckets |
| Proof | Random 256-bit token, hashed, ten-minute lifespan, single use |
| Provider failure | Fail closed: challenge remains unusable |
| Email | Resend HTTPS transactional email API |
| SMS | Existing MSG91 DLT Flow adapter |
| Cleanup | npm run prune:otp, explicitly schedule daily after review |

The running app defaults to AUTH_OTP_BACKEND=sqlite to avoid affecting production. Enabling AUTH_OTP_BACKEND=postgres switches only the six OTP-auth API routes to PostgreSQL-backed logic.

## Private configuration for staging

First revoke all exposed credentials described in SECURITY_CREDENTIAL_ROTATION.md and rotate the old OTP signing secret.

1. Create a new isolated CampusPool staging PostgreSQL instance in Render, separate from all other projects.
2. Configure these values privately in the staging Render dashboard:
   - OTP_DATABASE_URL — private staging PostgreSQL connection string.
   - OTP_HMAC_KEY — new random 32+-character secret, independent of OTP_SECRET.
   - AUTH_OTP_BACKEND — postgres, only after schema migration.
   - OTP_DB_SSL — false for private Render internal connection; true when properly configured for certificate-verified TLS.
   - EMAIL_PROVIDER — resend.
   - RESEND_API_KEY — private transactional email API key.
   - EMAIL_FROM — provider-verified sender identity.
   - SMS_PROVIDER — msg91 only with approved DLT credentials; disabled otherwise.
   - MSG91_AUTHKEY and MSG91_FLOW_TEMPLATE_ID — private approved SMS settings.
   - OTP_SECRET — independent session/CSRF key from existing auth.
   - STAGING_BASIC_AUTH_PASSWORD — independent strong staging password.
3. Apply migration against staging PostgreSQL BEFORE enabling PostgreSQL OTP mode:

       npm ci
       npm run migrate:otp

4. Manually deploy the separate staging branch. The provided render-staging.yaml disables auto-deploy. SMTP/Gmail credentials are not used by the new OTP email adapter.
5. Test two controlled accounts end-to-end: email OTP, SMS OTP, five-attempt lock, resend, login cookie restoration, registration, logout, expired tokens, and failed provider responses.
6. Set up and verify backups, alerts and periodic cleanup.

Never enter or paste real credential values in GitHub, issue comments, or a chat.

## Tests

CI starts an isolated PostgreSQL 16 container and runs:

    npm ci
    npm run test:stage1
    npm run test:security
    npm run test:auth

To run Stage 1 tests locally, provide OTP_DATABASE_URL pointing to a disposable LOCAL TEST database, and run the migration first. The test suite intentionally manipulates records and must never run on production data.

Mocks simulate Resend and MSG91; no real email, SMS, charges or user data are touched by CI.

## Compatibility

The existing frontend endpoints remain:

- POST /api/auth/login-request — issue sign-in email OTP.
- POST /api/auth/send-email-otp — issue signup email OTP.
- POST /api/auth/verify-email-otp — verify once and establish session or return signup proof.
- POST /api/auth/send-phone-otp — send signup SMS OTP.
- POST /api/auth/verify-phone-otp — verify once and return signup proof.
- POST /api/auth/register — atomically consume email and SMS proofs, then create account.

Rides and payments are unaffected by Stage 1. Unverified payment confirmation remains disabled in the parent security branch.

## Remaining blockers before production

- **Mixed databases:** Proof redemption in PostgreSQL and account creation in SQLite are not one atomic transaction. If SQLite fails, the student must repeat verification. Move users/sessions to PostgreSQL before general public signup.
- **Enumeration:** The existing login-request route still reveals whether an account exists. Standardize responses and login UX.
- **Delivery recovery:** Provider API acceptance is not proof of handset delivery. Introduce durable outbox/retries before high-volume use.
- **Operations:** Provider onboarding, Render isolated PostgreSQL provisioning, backups, security review, device/browser QA, fraud monitoring and alerting are outstanding.
- **Secrets:** Emergency cleanup PR #4 is not merged. Exposed Google App Password and OTP secret require owner-side revocation/rotation.
- **Retention:** The cleanup command is not currently scheduled.
- **Cost:** Production PostgreSQL should use a durable plan with verified backup and restore capability; do not use expiring free Postgres for actual students.

**No changes to main, no connection to production credentials, no new Render resources or deployments.**
