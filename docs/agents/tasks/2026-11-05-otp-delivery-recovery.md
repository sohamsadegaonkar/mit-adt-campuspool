# Task: Restore OTP delivery and safe account-registration path

- **Task ID / file:** `2026-11-05-otp-delivery-recovery`
- **Status:** in review — 10/10 CI workflows passed on `bb45bbf`; live integration blocked
- **Agent / owner:** ChatGPT engineering agent; external provider/production approval owner unassigned
- **Last updated:** 2026-11-05 UTC
- **Baseline:** `main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb`; `fix/otp-api-delivery-and-retry-2026-11-05`
- **Scope:** Node legacy + PostgreSQL email OTP adapters, SQL failed-retry state, runtime preflight, mock provider tests, Render Blueprint, release handoff
- **Out of scope:** changing Render environment values, performing live provider calls, provisioning production PostgreSQL, migrating user data, deploying, SMS/DLT approval or real student tests
- **Related:** [Release gate](../../PRODUCTION_RELEASE_GATE.md), [credential incident](../../SECURITY_CREDENTIAL_ROTATION.md), [backup/recovery](../STATUS.md)

## Goal and acceptance criteria

1. CampusPool registration and login dispatch OTP through explicitly configured, verified HTTPS transactional sender, never fallback to Gmail SMTP on Render Free.
2. A rejected outbound email invalidates the unsent SQLite challenge without locking the recipient into a resend cooldown; successful OTP remains single-use. PostgreSQL failed provider submission leaves a failed challenge immediately retryable while shared anti-abuse rate budgets still apply.
3. Automated synthetic tests prove provider routing, response acceptance, safe error handling, production runtime preflight and database cleanup.
4. A controlled full test on isolated staging confirms real inbox and handset delivery, registration, session persistence across restart, and rollback evidence. **This is not yet met.**

## Current state (verified vs assumed)

- Read-only Render production logs (4 Nov 2026 19:54:49 UTC) showed `POST /api/auth/send-email-otp` HTTP 503, `delivered=false`, SMTP connection error; the legacy implementation tried port 465.
- Production had a successful new deployment of `main@1020e2e` but initialized zero local SQLite demo profiles; Render's ephemeral filesystem cannot prove durable student identities.
- The separate staging service is behind a private access gate and remains on an older build; the PostgreSQL identity implementation exists in code behind `AUTH_OTP_BACKEND=postgres`. Real staging SMS is disabled in the Blueprint.
- Code is committed to the repair branch; **not deployed**. Real Resend/Brevo acceptance, verified sender domain, MSG91/DLT, credential rotation, user backup/restore and migration are **not verified**.

## Plan

1. Implement a fail-closed, HTTPS-only provider adapter shared by legacy and PostgreSQL paths; require `EMAIL_PROVIDER=resend|brevo` and provider-specific key plus `EMAIL_FROM`. Do not log provider raw bodies, codes or identities. A provider API acknowledgment is not proof of inbox delivery.
2. Remove the hardcoded Resend test-domain sender and all legacy SMTP fallback; invalidate failed SQLite challenge by ID and mark PostgreSQL failed challenge immediately retryable, preserving IP/target limits.
3. Add unit/integration regression tests and GitHub Actions job; run branch CI, review failures and fix before merge.
4. Independently verify existing backups, restored database and Render rollback eligibility, then authorize isolated staging deploy; configure verified sender and MSG91 Flow privately and test consenting accounts.
5. Plan production PostgreSQL migration and legacy SQLite reconciliation separately; never switch storage flags until schema, backups, identity/ride data parity and rollback are verified.

## Progress log

- 2026-11-05 UTC — Confirmed outbound legacy Gmail SMTP failure in Render logs and legacy SQLite account durability risk.
- 2026-11-05 UTC — Implemented transactional HTTPS-only email provider (Resend/Brevo), legacy dispatch routing, SQLite failed OTP cleanup, PostgreSQL failed delivery cooldown release, updated preflight and Blueprint. No real provider calls or live deployments.
- 2026-11-05 UTC — Added mocked provider/retry tests and dedicated CI. PR #36 at `bb45bbf27263` passed all ten reported GitHub Actions workflows, including `OTP HTTPS delivery regression`, `Stage 1 PostgreSQL OTP tests`, credential/secret hygiene, runtime preflight, security smoke, docs and mobility browser E2E. Real provider and recovery gates remain blocked.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Render signup delivery incident | Read-only production log: `/api/auth/send-email-otp` HTTP 503 (2026-11-04T19:54:49Z) | FAIL pre-fix; root issue identified |
| Syntax + HTTPS tests | GitHub Actions `otp-https`, `npm run test:otp-delivery` | PASS on PR #36 at `bb45bbf` (GitHub CI) |
| Runtime, production-auth, legacy auth | GitHub Actions `otp-https` | PASS on PR #36 at `bb45bbf` (GitHub CI) |
| PostgreSQL failed resend integration | `node --test test_stage1_otp.js` with isolated disposable Postgres | PASS on PR #36 at `bb45bbf` (GitHub CI) |
| Real provider email and SMS | Staging account-owner-led E2E; never include OTP/phone/email in public evidence | NOT RUN |
| Data persistence/rollback | Independent cold restore + restart/session tests | BLOCKED |

## Risks and decisions

- No live migration, deploy, credential rotation, Azure blob write or personal data export authorized by this source-only change. Keep provider keys, OTP secrets, student addresses and sender verification evidence private.
- Existing production uses ephemeral SQLite; an email fix does not make registration safe for real student data. PostgreSQL production promotion is a separate irreversible-data-risk release.
- The public legacy auth code still differs from the PostgreSQL implementation in account-enumeration and session hardening; production transition should adopt the reviewed PostgreSQL identity flow, not treat this PR as complete launch authorization.
- MSG91 registration remains fail-closed until owner configures approved India DLT sender, Flow template and tests a consenting handset.

## Next steps — exact handoff

1. **Next action:** Review PR diff and CI for `fix/otp-api-delivery-and-retry-2026-11-05`; correct any failures; keep production release gated.
2. **Who may do it:** engineering reviewer for code; credential owner for verified provider domains/keys; data/release owner for production migration/rollback.
3. **Prerequisites and blockers:** verified historical credential revocation; verified Resend/Brevo sender domain and private key, authorized MSG91/DLT, actual encrypted offsite staging archive and independent restore, retained Render rollback artifact, authorized production PostgreSQL with migration plan.
4. **Expected evidence:** CI passing on exact SHA; real controlled inbox+handset delivery receipts without code/PII in Git; independent restored PG data equality, session persistence across service restart; documented deploy and rollback SHA.
5. **Production impact:** none — source branch only, not merged or deployed.

## Links and files changed

- PR: [#36 OTP HTTPS delivery repair](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36)
- Branch: [OTP delivery fix](https://github.com/sohamsadegaonkar/mit-adt-campuspool/tree/fix/otp-api-delivery-and-retry-2026-11-05)
- Runbook: [OTP recovery release](../../docs/ops/OTP_RECOVERY_RELEASE.md)
- Code: `stage1-otp/email-provider.js`, `server.js`, `database.js`, `stage1-otp/pg-store.js`, `scripts/check-runtime-config.js`, `render.yaml`
- Tests: `test_otp_delivery_recovery.js`, `test_stage1_otp.js`, `test_runtime_config.js`, `.github/workflows/otp-delivery-guards.yml`
- Last known production deployed SHA at incident: `1020e2e4a6d4`; staging older `cceadbf6251f`


## 2026-11-11 — Production-readiness code hardening (source-only; cost review deferred by owner)

- **User goal:** make CampusPool production-ready without spending time on the Azure cost review in this engineering session. This is *not* approval to incur cloud charges, deploy, migrate real data or bypass recovery/security controls. The existing release gate remains NO-GO until actual evidence is obtained.
- **Verified live Render metadata:** production service `mit-adt-campuspool` is Docker in Singapore with auto-deploy OFF and latest live commit `main@1020e2e4a6d4` (Nov 4). Staging is a separate Node service, live at `cceadbf6251f`, auto-deploy OFF. No Render deployments or configuration changes were made in this session. This PR #36 remains a **draft branch**, not live.
- **P0 release guard fix:** `scripts/check-runtime-config.js` now refuses to pass the production profile when identity or rides still use SQLite or when PostgreSQL URL/TLS/CA, distinct OTP HMAC/signing keys, explicit APP_ENV, configured Resend/Brevo sender, or MSG91 DLT provider fields are absent. Staging retains its isolated basic-auth and optional disabled-SMS behavior. Even a synthetically passing production configuration reports **release NOT approved**, with explicit manual real delivery/restore/migration reviews. Synthetic negative tests were added.
- **Release gate parity:** `scripts/check-release-gates.js` now accepts either explicitly configured Resend or Brevo HTTPS sender rather than incorrectly demanding Resend only; rejects malformed/CRLF sender; still requires production PostgreSQL, MSG91, manual restore, credential rotation, exact target QA and release approval. `test_release_gates.js` expanded for Resend/Brevo/SMTP rejection. CI `otp-delivery-guards.yml` now includes release gate tests and a separate Docker build / isolated no-provider health smoke job.
- **Deployment footprint parity:** previously `render.yaml` said Node/Oregon while actual production is Docker/Singapore. Source Blueprint now matches **Docker/Singapore**, branch main, automatic deploy OFF; OTP private key remains private (sync false), not embedded/generated anew during a later config review. No Blueprint sync performed. `Dockerfile` now uses `npm ci --omit=dev` instead of unlocked `npm install`, with native build dependencies retained. Test and runtime initialization do not read live secrets or connect to real data.
- **Important limitation:** synthetic config and Docker health tests cannot prove new account registration, real inbox/handset delivery, schema/roles/RLS, independent restore, production migration, provider compliance or readiness to launch. No student flows were enabled. **Production status: NOT READY / NO-GO** until real external acceptance.
- **Next handoff:** review exact-head CI on [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) and fix failures; obtain fresh verified sender and MSG91 DLT credentials privately; independently verify encrypted staging/offsite backup and isolated PG17/PostGIS restore; prepare distinct production PostgreSQL and migration/rollback evidence; execute controlled staging E2E with consenting test accounts; separately approve merge, deploy and production release. Never promote staging DB to production or copy raw auth/OTP contents into docs.
