# Issue #80 — resumable registration foundation

- **Task ID:** 2026-11-26-resumable-registration-foundation
- **Date:** 2026-11-26
- **State:** source implementation and opt-in route adapter; draft PR #81, not approved for deployment
- **Base:** main cc1602cd4673760dab7dd46a07e3089b752cdd5d
- **Branch:** feat/resumable-registration-issue-80
- **Issue:** https://github.com/sohamsadegaonkar/mit-adt-campuspool/issues/80

## Goal and acceptance criteria

Persist successful email or mobile verification in a restricted server-side registration draft. Preserve progress across delivery failure, expired OTP proof and application restart. Require both exact normalized contacts and atomic finalization before an active account or normal session exists. Avoid raw proof exposure or redemption through the legacy signup path. Keep staging and production unchanged.

## Current state

Candidate migration 015 is deliberately not in the migration runner; reconcile numbering and release order against existing 009–014 work before rollout. Draft creation returns a random opaque capability; only its SHA-256 digest persists. Pending state is separate from campus_users and campus_sessions; no uniqueness constraint reserves unverified contacts. Contact edits invalidate only the changed verification. Completion locks the draft and atomically creates the verified account, session and audit row. Bounded cleanup removes expired drafts only.

The OTP store now has distinct draft-only purposes in migration 015, with the same target/IP throttles as legacy OTPs. In the issuance transaction the challenge is bound to its owning draft; verification checks exact target and challenge ownership before comparing the OTP and records durable progress and consumes the proof in the same transaction. Provider I/O remains outside SQL locks. The existing send, verify, register and new status route support opt-in dependency injection; server.js does not enable this feature. No browser-supplied resume token or challenge ID is accepted by the route adapter. Existing legacy login/signup remains unchanged with injection disabled.

Retention is an explicit constructor input with no default. Seven days remains an unapproved proposal; isolated tests use one hour. Cross-device recovery, secure cookie transport, draft creation HTTP endpoints and frontend are not implemented. No claim of live functionality.

## Plan

1. Build candidate schema and transaction layer.
2. Connect actual OTP issuance/verification and route adapter; exercise both orderings and SMS failure.
3. Implement secure cookie and CSRF defenses, rate-limited creation/recovery and frontend; test actual HTTP/browser.
4. Verify restricted-role runtime permissions and reconcile migration/preflight/restore gates before approved staging rollout.

## Progress log

- 26 Nov 2026: foundation committed in draft PR #81; first exact-head disposable PostgreSQL and Stage 1 PostgreSQL OTP checks succeeded. Documentation contract failed due to missing headings; corrected in this revision.
- 26 Nov 2026: distinct OTP purposes, trusted issuance/verification hooks, opt-in auth route adapter and actual OTP delivery-failure regression tests implemented. No live configuration, migration, deployment, secrets or messaging.

## Verification

The earlier foundation run 45824936355 passed; Stage 1 OTP run 45824936162 passed on head 92e03da. The updated suite uses a disposable runner PostgreSQL database and synthetic delivery callbacks (no real email/SMS or staging credentials). It checks draft ownership, incorrect/replayed OTP, legacy isolation, SMS disabled and rejected, expired proof, restarted store, partial registration denial, retry, concurrent finalization, mobile-first and normal login. New exact-head CI is pending at commit submission; no local test execution claimed.

## Next steps

- Confirm exact-head CI, including documentation contract. Add deeper challenge-replacement, contact-edit and rollback regression coverage as needed.
- Add restricted resume cookie, same-origin/CSRF protections, rate-limited draft creation/recovery, generic responses, lost-cookie recovery with fresh proof of already verified contact, token rotation and UI for both orders. Review finalization response-loss recovery.
- Add browser E2E and isolated PostgreSQL tests under the restricted runtime role rather than only the migration-owner role. Verify no public auth or draft data leak.
- Reconcile migration numbering, preflight/restore expectations and schema rollout ordering. Explicitly approve retention policy, staging backup/recovery and migration before enabling any live feature.
