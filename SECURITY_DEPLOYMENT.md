# CampusPool deployment-readiness checklist — 2026-11-01

**Status: NO-GO for production merge or deployment.** This branch is a security hardening proposal, not a release authorization. Use a separate local/staging database when running tests. It does not include the optional CampusPool 2.0 frontend prototype PR.

## Critical findings (act before any deployment)

1. **Public secret exposure — CRITICAL.** The repository previously contained an SMTP app password in `render.yaml` and a tracked `.env.production` file. The branch removes the file and secret values from the latest tree, adds ignore rules, and changes Render Blueprint values to `sync: false`. **You must revoke/rotate the exposed credential in Google and all SMTP providers, update Render's environment, and assess all other secrets previously committed.** The secret remains available in Git history, forks and caches until a coordinated history remediation; even history rewriting does not replace revocation. Never share the replacement secret in an issue or PR.
2. **Authorization gaps — CRITICAL.** The main branch accepts caller-supplied emails and IDs to create/cancel rides, read bookings and GPS coordinates, and update payment states. This branch adds hashed, seven-day HTTP-only cookie sessions after verified email login/registration, cross-user access checks, and server-derived actor identities. The existing client still has offline sign-in fallbacks and needs an end-to-end session-aware integration pass before launch.
3. **Payment-state forgery — CRITICAL.** Users were able to submit `Paid` or commission-settlement claims directly to the server. This branch returns `501 PAYMENT_VERIFICATION_REQUIRED` for these routes until trusted payment-provider webhooks and reconciliation exist. **The old frontend's self-reported payment buttons must also be redesigned/disabled before launch. Do not assume payments succeeded.**
4. **SMS OTP is not actually dispatched — CRITICAL.** Existing code generates/logs codes, but does not call an SMS gateway. Production `/api/auth/send-phone-otp` now returns 503 instead of pretending to send a text. **New student registration will be blocked** until the real provider is integrated and tested (or the signup design is changed with a reviewed security model).
5. **Durable state — CRITICAL.** Render's free ephemeral filesystem must not be treated as durable production SQLite storage. Plan a managed PostgreSQL migration or persistent disk plus verified offsite backup strategy, with test restore, before accepting real accounts/payments.

## Checklist from the deployment reference

| Check | Status in this branch | Required verification |
|---|---|---|
| Access control | **Implemented in backend; unverified end-to-end** | Browser sign-in/logout, user and runner roles, other-user read/write denial, old offline client fallback removed, secure cookie lifecycle, cross-user GPS tests |
| Reset links expire | **Not applicable to current app**; email/phone OTP tokens now checked against expiry and invalidated after signup; session expires in 7 days | Add tests for expired/replayed links if password reset or magic links are introduced |
| Sanitized input | **Partial**: JSON <=64 KB, malformed JSON rejected, core ride fields bounded, GPS coordinates checked | Validate all auth, booking, payment-provider, content and identifier fields; HTML escaping and DOM XSS review |
| Error pages | **Partial**: unknown static paths return 404, unknown API routes return JSON 404 for authenticated requests, server errors use generic JSON 500 | Design branded 404/503 pages and verify them at CDN/proxy/app levels |
| Rate limits | **Hardened**: shared SQLite tiers, fail-closed limiter, forwarded IP trusted only for configured proxy addresses | Proxy integration, realistic load tests, multi-worker test in staging, per-account throttles |
| CORS | **Restricted**: same-origin by default; optional `CORS_ALLOWED_ORIGINS` | Validate both browser and proxy origin behavior; avoid `*` for authenticated endpoints |
| Indexes | **Extended**: composite booking/ride indexes, sessions, OTP expiry, GPS cleanup | Benchmark realistic production-scale queries, migrations and DB backups |
| Logs + alerts | **Partial**: structured console request logs and 5xx warning messages without query strings | Configure real alert delivery for 5xx spikes, payment failures, OTP delivery, DB integrity and suspicious access; retention/redaction rules |
| Rollback | **Documented, not exercised** | Stage a prior release rollback, verify data restore, define owner and alert thresholds |

## New configuration

Store secrets in the hosting dashboard, not Git:

- `NODE_ENV=production`
- `OTP_SECRET`: strong new secret generated/stored by hosting provider
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`: nonsecret provider configuration
- `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: secret/private settings, configured through Render (not committed)
- `CORS_ALLOWED_ORIGINS`: optional comma-separated, exact HTTPS origins for explicitly permitted external web clients
- `TRUSTED_PROXY_ADDRESSES`: optional, exact TCP peer IPs of trusted ingress proxies; **do not set to arbitrary client addresses** and do not blindly trust spoofable X-Forwarded-For
- `DATABASE_PATH`: local/staging database path or durable production database path

Avoid `ALLOW_DEV_OTP=true` outside isolated local development. This flag is ignored in production.

## Test locally on **non-production** data

```sh
npm ci
npm run test:security
```

The test script launches a local server, uses a temporary SQLite file, exercises origin/authorization/OTP/payment/404/rate-limit controls, and deletes its temporary database. A GitHub Actions smoke workflow runs on PRs. Do not point these tests at your Render live URL.

Also rerun the existing QA/load/rate-limit tests after adapting their assumptions: existing tests may rely on unauthenticated access and spoofed `X-Forwarded-For`, which are intentionally no longer allowed.

## Release and rollback runbook (for a future approved release)

**Before:** Rotate compromised secrets; perform targeted security review; confirm SMS and payment provider behavior; migrate or back up durable data using SQLite's online backup API/CLI (never copy a live WAL database naïvely); test a full restore; record the currently deployed Git SHA and Render deployment ID; ensure external alerting is active.

**Stage:** Deploy to a separate Render staging service with staging-only keys and a fresh non-production database. Validate campus sign-in, registration, permissions, existing rides, cancellation, payment handling, rate-limit headers, 404/503 responses, 5xx alerting, and mobile UI. Run security and prior regression suites.

**Canary:** Start with a small trusted cohort; monitor request errors, auth denials, DB write failures, duplicate bookings, and latency. Do not enable real financial settlement until provider-reconciled payouts exist.

**Rollback:** If a new release regresses, disable new traffic to it, roll back to the previously recorded working Render deployment or revert the merge commit, and restore data from the verified backup only when schema/data compatibility requires it. Coordinate any schema rollback with a designated operator. Revoked secrets stay revoked and must not be restored from old config. Record the incident and rerun smoke tests.

**Do not auto-merge this branch.** Authentication behavior and payment UI require intentional release coordination.
