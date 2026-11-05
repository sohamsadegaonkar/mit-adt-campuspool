# CampusPool OTP recovery and safe release runbook

**Status (5 Nov 2026): source fix proposed, production release NO-GO.** This is an engineering handoff, not authorization to deploy, migrate or send real messages.

## Diagnosis

On 4 Nov 2026 at 19:54:49 UTC, Render production accepted `POST /api/auth/send-email-otp` but returned HTTP 503 after `smtp.gmail.com:465` failed. The deployed source used Gmail SMTP fallback. Render Free does not allow outbound SMTP port 465. The source fix selects an HTTPS transactional provider on port 443 instead; no provider credentials have been configured by this PR.

## HTTPS provider configuration — operator only, private settings

1. Select **one** approved provider: Resend (`EMAIL_PROVIDER=resend`) or Brevo (`EMAIL_PROVIDER=brevo`).
2. Verify ownership of the sending domain with the provider, including SPF/DKIM as required. CampusPool must not claim ownership of a university address/domain without authorization. Use an explicitly approved sender domain.
3. In the **separate, protected Render environment**, configure:
   - `EMAIL_PROVIDER` = `resend` or `brevo`
   - `EMAIL_FROM` = a provider-verified sender address, optionally a friendly display name
   - `RESEND_API_KEY` **or** `BREVO_API_KEY`, stored as a protected environment secret
4. Remove/retire legacy `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT` only after ensuring no other service depends on them. The code does not fall back to SMTP. Revoke previously exposed Gmail App Password and rotate any compromised signing secrets separately.
5. Confirm the provider account can send to the chosen **consenting** test recipient; some trial/test senders cannot send to arbitrary recipients. API `accepted` means provider accepted the submission, not that the student inbox received it.

Never paste keys, full addresses, live OTPs, student records, account screenshots showing secrets, or raw provider response bodies in GitHub/CI/chat.

## SMS and complete registration

- Registration requires **both** email and phone proofs. Configure `SMS_PROVIDER=msg91`, private `MSG91_AUTHKEY`, approved `MSG91_FLOW_TEMPLATE_ID` with `VAR1` binding, and complete India DLT requirements.
- SMS API acceptance is not handset receipt. Use consenting test numbers; verify expiry, incorrect code attempts, resend throttling, replay, provider outage and failed delivery without exposing a code.
- With SMS disabled, registration **must remain unavailable** rather than producing a fake verified account.

## Persistence and recovery gate

- Current Render Free production runs SQLite on ephemeral local storage; the log showing zero demo profiles at startup is a warning, not a production data migration. Do not treat a successful signup as durable until this is fixed.
- Before changing production flags, inventory legacy account/ride data without exposing it, securely back up the source, demonstrate an independent off-site encrypted recovery to a separate PostgreSQL 17/PostGIS destination, verify roles/RLS/migration ledger/row-content parity and retained Render rollback eligibility.
- Separate approved production PostgreSQL project from staging. Apply the reviewed identity/Rides migrations in order, reconcile legacy records and sessions, then rehearse login/OTP, restart and rollback in isolated staging. Never copy live student data into staging.
- Do not run migration 008 or enable real student traffic on the new stack until the recovery release gates are satisfied.

## Automated tests

- `npm run test:otp-delivery` — Resend/Brevo mocked HTTPS sender, provider responses and legacy failure cleanup.
- `npm run test:runtime-config` — production HTTPS sender requirements and staging secrets presence checks without revealing values.
- `npm run test:production-auth` — PostgreSQL sign-in response privacy.
- `npm run test:auth` — frontend/security and mocked SMS/legacy auth.
- `npm run test:stage1` with an **isolated disposable PostgreSQL** test environment — failed-provider immediate retry, rate limits, registration proof consumption. This test may skip DB cases when no test DB exists.

## Controlled rollout after gates

1. Obtain passing branch CI and independent code review; merge source to `main` only after approving dependency/evidence.
2. Verify encrypted backup/restore and rollback; obtain explicit staging deploy approval.
3. Configure staging sender/API key and approved MSG91 test template privately; deploy **staging only** at pinned SHA, auto-deploy OFF.
4. Test one consenting synthetic student from start to end: email OTP request, actual inbox arrival, email verification, SMS request, actual handset arrival, phone verification, registration, session refresh/restart, login, logout, negative expiry/replay/rate tests.
5. Only after durable production database migration and security/privacy checks are signed off, plan a separate controlled production rollout and rollback window. Log status codes and sanitized failure classes only.

If a send fails: do not continuously retry/loop; check provider's private delivery dashboard, sender/domain verification, account limits, quotas, and configured variables. The backend returns `503 EMAIL_DELIVERY_UNAVAILABLE` and must not leave a fresh unsent challenge locked under a resend cooldown. Keep independent rate limits active.
