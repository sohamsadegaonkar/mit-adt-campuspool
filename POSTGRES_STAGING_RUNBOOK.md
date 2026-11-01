# CampusPool isolated PostgreSQL identity staging rollout

STATUS: Engineering code and isolated CI tests only. No production records, payments or deploys modified.

## Infrastructure blocker
Render rejected creation of a second free-tier PostgreSQL instance: cannot have more than one active free tier database. The workspace already contains a separate ReturnDesk free PostgreSQL database. We must not reuse or replace it. A paid plan requires explicit billing approval. Until then, there is no live CampusPool staging PostgreSQL database.

## Implemented
- Migration 001: PostgreSQL OTP tables and database-backed rate limits.
- Migration 002: campus_users, campus_sessions and campus_identity_audit.
- PostgreSQL identity repository: normalized user lookups, server-side hashed sessions, revocation, and atomic registration with both verification proofs in one transaction.
- Existing sign-in, signup, session introspection, logout and API ownership use PostgreSQL identity when AUTH_OTP_BACKEND=postgres.
- Migration command runs both migrations.
- Integration tests exercise OTP expiry, lockout, resending, concurrent verification, one-use proofs, full registration, concurrent account creation, session persistence, CSRF, logout and cross-account denial.
- Staging configuration uses Singapore, private secrets, and disabled automatic deploys.
- Existing Rides data remains in SQLite. No actual production user records or sessions were copied.

## Remaining nine steps
1. Revoke compromised Gmail App Password and rotate OTP_SECRET in account/private Render settings; the user must perform Google revocation.
2. Provision a SEPARATE CampusPool staging PostgreSQL 16 database in Singapore, after approval of a billed plan or a suitable isolated provider.
3. Create a separate Singapore staging Render web service on this branch, auto-deploy disabled and strong basic-auth gate.
4. Configure OTP_DATABASE_URL, OTP_HMAC_KEY, OTP_SECRET and staging-only provider credentials privately; no secret values in Git.
5. Run npm ci and npm run migrate:otp against the new STAGING database, then inspect the created schemas.
6. Configure verified Resend sender/domain and approved MSG91 DLT sender/template; keep SMS signup disabled until actual delivery is proven.
7. Run npm run test:stage1, npm run test:identity, npm run test:security and npm run test:auth against disposable CI databases only.
8. Test controlled end-to-end signup/login on Android and desktop browsers, including OTP lockouts, expiry, resends, session refresh, logout and unauthorized user access.
9. Complete staging backup/restore drill, monitoring, rollback and production release review.

## Safety gates
Never run the destructive integration tests on production or real student data. Never copy production SQLite accounts or sessions into staging. Production migration will require its own dry-run, data mapping, backups and a forced reauthentication plan. Existing ReturnDesk data is unrelated and must not be accessed or reused.

## CI coverage
GitHub Actions provisions isolated PostgreSQL 16 and runs the OTP and identity tests without any real email/SMS provider access. Passing CI does not prove actual provider delivery or browser compatibility.

## Branch relationship
This work builds on PR #5, itself based on PR #3 and security PR #2. Emergency cleanup PR #4 is separate against main. Do not merge or deploy the chain without reconciling those branches and rotating compromised credentials.
