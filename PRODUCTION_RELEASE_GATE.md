# CampusPool — production readiness gate (2026-11-02)

**Decision: NO-GO for production migration or release.** Staging is healthy; real OTP delivery, secrets rotation, and durable Rides data are not yet verified.

This checklist is a product-launch gate, not an assertion that a code branch can replace production. The current live Render CampusPool service deploys from \`main\`, whereas the PostgreSQL authentication work is in chained **draft** pull requests.

## Verified

| Area | Evidence | Status |
|---|---|---|
| Staging Render API | \`mit-adt-campuspool-staging\` service reported **Live**, \`GET /healthz=200\` | PASS |
| Staging access | Unauthenticated homepage/account API requests return **401** | PASS |
| Supabase staging | Dedicated \`campuspool-staging-db\`, Singapore, five RLS-enabled server-only authentication tables | PASS |
| Supabase TLS | Node successfully connects to Session Pooler with authentic CA via \`NODE_EXTRA_CA_CERTS\` | PASS |
| Native runtime | Node 22.23.2 boots; \`better-sqlite3\` tests work | PASS |
| Legacy data isolation | Staging imports zero profiles and zero legacy rides | PASS |
| CI | Isolated PostgreSQL signup/sessions, OTP expiry/lockout, SMS/email adapter mocks and security tests | PASS on prior reviewed branch |
| Sign-in privacy | New candidate branch returns identical public responses for known and unknown accounts; the browser no longer expects account metadata | Pending PR review and tests |
| Client-reported payments | API rejects unverified payment-status/settlement marking with HTTP 501 on hardened branch | PASS as an intentional blocker |

## Outstanding P0 blockers — do not deploy to students yet

1. **Credential incident is not closed:** The historic Gmail SMTP App Password and \`OTP_SECRET\` were committed to public Git history. PR #4 removes current tracked copies but **does not revoke or purge historical secrets**. Account owner must revoke the old App Password, rotate any other affected secrets, and verify Google/Render activity. Historical Git cleanup requires separate controlled coordination.
2. **Provider credentials and real delivery not verified:** Staging explicitly has \`EMAIL_PROVIDER=disabled\` and \`SMS_PROVIDER=disabled\`. Create test-only Resend credentials; verify ownership of the sender domain and real controlled email inbox receipt. Configure approved MSG91 India DLT entity, sender and Flow template and verify handset delivery. A provider API acknowledgment is **not** proof the user received the OTP.
3. **Rides and bookings are not durably stored:** Current Rides module uses local \`better-sqlite3\` database. Render Free instances may lose local files between deploys/restarts. A production release requires moving Rides/bookings and their transaction rules to dedicated durable PostgreSQL, a real-data migration plan, backups, and rollback; staging PostgreSQL identity does not solve this.
4. **Live browser/phone QA pending:** Exercise a controlled new MIT-ADT account with both email/SMS OTPs, registration, login by email and phone, refresh/relogin, logout, bad/expired/replayed codes, concurrent requests, CSRF, account isolation, ride seat booking conflict and payments-disabled behavior on actual staging browsers.
5. **Release chain not merged:** Draft PR #4 targets \`main\`; PR #2 targets \`main\`; PR #3 builds on #2; PR #5 builds on #3; PR #6 builds on #5; PR #7 builds on #6; current production-readiness PR builds on #7. Rebase/reconcile and run a FULL CI suite against the actual release candidate. Do not merge all drafts blindly.
6. **Backups/restore and operations:** Verified production-capable PostgreSQL backups, test restores, error monitoring, incident response, privacy/retention policy and deployment rollback plan are required. Free paused staging is not a substitute for production disaster recovery.
7. **Regulated payments:** Live payments/UPI settlement and marketplace commissions remain OFF until an approved payment provider supports the required marketplace payout, refunds and reconciliation flow. Never re-enable client-reported payment confirmations.

## Manual provider setup (staging first)

**Transactional email / Resend**

- Create and verify a CampusPool-controlled sending domain in the provider dashboard.
- Configure \`EMAIL_PROVIDER=resend\`, \`RESEND_API_KEY\`, \`EMAIL_FROM\` privately in **Render staging**.
- Deliver a real OTP to a controlled MIT-ADT email address; check inbox receipt, expiry and retries without disclosing codes in logs.

**India SMS / MSG91**

- Finish DLT registration and approve the sender ID + exact OTP template. In the MSG91 panel, map the DLT template ID to its Flow template ID.
- Configure \`SMS_PROVIDER=msg91\`, \`MSG91_AUTHKEY\`, \`MSG91_FLOW_TEMPLATE_ID\` privately in **Render staging**.
- Send to one controlled test phone and verify actual receipt, failure handling and rate limiting.

**Critical:** SMS template variable in the current adapter is \`VAR1\`. The approved MSG91 Flow must map its six-digit OTP placeholder to exactly that variable. A mismatch will silently block registration.

## Production execution order

1. Revoke/rotate leaked credentials, close incident, and stop committing secrets or SQLite user data.
2. Complete genuine staging Resend+MSG91 delivery tests (with controlled consenting accounts).
3. Implement PostgreSQL Rides/bookings plus tests for seat contention and ownership, and write a separate production database migration + rollback plan.
4. Run realistic browser regression and security QA on staging; preserve evidence and commit SHA.
5. Verify backups and restore, reviewer approvals, automatic deployment controls and release commit.
6. Run \`npm run check:release-production\` in a privileged **production candidate** environment without printing secrets. This tool intentionally blocks while local SQLite is still the Rides source of truth.
7. Deploy to production only after explicit GO approval, then verify external health, authentication, authorization and data integrity; retain ability to roll back quickly.

## Test commands

On a developer machine or GitHub Actions **with a disposable PostgreSQL test database**, not against staging or production user data:

    npm ci
    npm run test:stage1
    npm run test:identity
    npm run test:production-auth
    npm run test:release
    npm run test:security
    npm run test:auth
    npm run test:staging
    npm run check:release-ci

Do not run data-mutating integration suites against a live student database. Production preflight is read-only and never outputs secret values.

## Infrastructure links

- Production Render: https://dashboard.render.com/web/srv-dbh51h0473hc739ae7cg
- Isolated staging Render: https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg
- Staging Supabase: https://supabase.com/dashboard/project/tnitksrlntrdxbvznxzf
- Emergency credential cleanup: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/4

The existing production service has **not** been reconfigured, restarted, merged or deployed by this readiness work.
