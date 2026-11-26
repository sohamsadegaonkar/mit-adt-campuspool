# Issue #80 — resumable registration foundation

- Date: 2026-11-26
- Base: main cc1602cd4673760dab7dd46a07e3089b752cdd5d
- Scope: source-only candidate migration, PostgreSQL transaction layer and isolated CI test. No live environment changes.
- Issue: https://github.com/sohamsadegaonkar/mit-adt-campuspool/issues/80

## Status and invariants

Candidate migration 015 is deliberately not in the migration runner. Reconcile numbering and release order against existing 009–014 work before rollout. Draft creation returns a random opaque capability; only its SHA-256 digest persists. Pending state is separate from campus_users and campus_sessions; no unique constraint reserves unverified contacts. Contact edits invalidate only the changed verification. The trusted issuance and verification hooks validate exact normalized target, purpose, channel and bound challenge ID, and the verification hook consumes the short-lived OTP proof in the same transaction. Completion locks the draft, checks both channels and atomically creates the account, normal session and audit row before marking the draft consumed. Expired draft cleanup is bounded.

Retention is an explicit constructor input (no default). Seven days remains an unapproved proposal; tests use one hour. This foundation is not reachable from HTTP, does not implement cookie handling or cross-device recovery, and is not a complete OTP flow.

## Required before merge or rollout

1. Wire OTP issuance and successful verification hooks into the existing PgOtpStore transactions, including rejecting legacy-path verification of draft-bound challenges, shared rate limits, challenge replacement, response-loss recovery and no raw proof exposure. Tests must exercise actual code verification and provider failure, not only the transaction fixture.
2. Add restricted resume cookie, origin/CSRF protections, rate-limited draft creation/recovery, generic responses, lost-cookie recovery with fresh proof of already verified contact, token rotation and UI for both orders. Ensure normal login remains unchanged.
3. Add browser E2E and isolated PostgreSQL tests under the restricted runtime role (not only migration-owner role), full concurrency/security regressions, expiration and replay checks. Review finalization response-loss recovery and duplicate submissions.
4. Reconcile migration numbering, preflight/restore expectations and schema rollout ordering. Explicitly approve retention policy, staging backup/recovery and migration; do not apply migration 015 or deploy this draft to any live environment.

CI workflow uses a disposable runner database with synthetic fixtures; no actual email/SMS, no staging secrets. Direct local clone was unavailable in this environment. Check exact-head CI before claiming tests passed.
