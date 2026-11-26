# Issue #80 — resumable registration foundation

- **Task ID:** 2026-11-26-resumable-registration-foundation
- **Date:** 2026-11-26
- **State:** browser recovery implementation and isolated HTTPS browser tests; draft PR #81, not approved for deployment
- **Base:** main cc1602cd4673760dab7dd46a07e3089b752cdd5d
- **Branch:** feat/resumable-registration-issue-80
- **Issue:** https://github.com/sohamsadegaonkar/mit-adt-campuspool/issues/80

## Goal and acceptance criteria

Persist successful email or mobile verification in a restricted server-side registration draft. Preserve progress across delivery failure, expired OTP proof and application restart. Require both exact normalized contacts and atomic finalization before an active account or normal session exists. Avoid raw proof exposure or redemption through the legacy signup path. Keep staging and production unchanged.

## Current state

Candidate migration 015 is deliberately not in the migration runner; reconcile numbering and release order against existing 009–014 work before rollout. Draft creation returns a random opaque capability; only its SHA-256 digest persists. Pending state is separate from campus_users and campus_sessions; no uniqueness constraint reserves unverified contacts. Contact edits invalidate only the changed verification. Completion locks the draft and atomically creates the verified account, session and audit row. Bounded cleanup removes expired drafts only.

The OTP store now has distinct draft-only purposes in migration 015, with the same target/IP throttles as legacy OTPs. In the issuance transaction the challenge is bound to its owning draft; verification checks exact target and challenge ownership before comparing the OTP and records durable progress and consumes the proof in the same transaction. Provider I/O remains outside SQL locks. The existing send, verify, register and status routes support opt-in dependency injection; server.js enables the browser adapter only with the explicit REGISTRATION_RESUME_ENABLED=true HTTPS staging configuration and approved retention. The flag defaults off and production activation is rejected. No browser-supplied resume token or challenge ID is accepted by the route adapter. Existing legacy login/signup remains unchanged with injection disabled.

Retention is an explicit constructor input with no default. Seven days remains an unapproved proposal; isolated tests use one hour. The browser adapter uses a persistent Secure, HttpOnly, SameSite=Strict, host-only __Host-cp_registration cookie with remaining draft lifetime; raw resume capabilities are never returned in JSON or stored by frontend JS. Mutations require exact configured HTTPS Origin, JSON, a custom request header, and same-origin Fetch Metadata when present. Draft creation/recovery budgets are PostgreSQL-backed. Recovery uses distinct OTP purposes and fresh proof of an already verified normalized contact; ineligible contacts receive no provider message, public request responses are generic, ambiguous matches fail closed, and recovery rotates the old capability atomically with proof consumption. A dedicated registration panel shows independent verified/pending states, either verification order, contact edits and lost-device recovery. Name and department are re-entered after browser closure; only contact verification progress persists. No claim of live functionality.

## Plan

1. Build candidate schema and transaction layer.
2. Connect actual OTP issuance/verification and route adapter; exercise both orderings and SMS failure.
3. Implement secure cookie and CSRF defenses, rate-limited creation/recovery and frontend; test actual HTTP/browser.
4. Verify restricted-role runtime permissions and reconcile migration/preflight/restore gates before approved staging rollout.

## Progress log

- 26 Nov 2026: foundation committed in draft PR #81; first exact-head disposable PostgreSQL and Stage 1 PostgreSQL OTP checks succeeded. Documentation contract failed due to missing headings; corrected in this revision.
- 26 Nov 2026: distinct OTP purposes, trusted issuance/verification hooks, opt-in auth route adapter and actual OTP delivery-failure regression tests implemented. All seven workflows on a457048 passed.
- 26 Nov 2026: added HTTPS-only staging flag, browser controller, persistent secure resume cookie, strict same-origin request protections, recovery-only proofs and rotation, generic recovery responses, eligible-delivery gating, and UI. Added Playwright Chromium tests against real server through disposable TLS proxy, synthetic provider fixture and restricted PostgreSQL runtime role. No live configuration, migration, deployment, secrets or messaging.

## Verification

The earlier foundation run 45824936355 passed; Stage 1 OTP run 45824936162 passed on head 92e03da. The updated suite uses a disposable runner PostgreSQL database and synthetic delivery callbacks (no real email/SMS or staging credentials). It checks draft ownership, incorrect/replayed OTP, legacy isolation, SMS disabled and rejected, expired proof, restarted store, partial registration denial, retry, concurrent finalization, mobile-first and normal login. Run 45826799299 disposable PostgreSQL job succeeded on 0e1357b; browser job is running at this checkpoint. Exact-head checks for subsequent eligibility and restricted-role changes are pending. Browser coverage includes cookie attributes and real profile closure/reopening, SMS failure, partial-access denial, recovery proof rejection/rotation, mobile-first recovery, completion and draft creation throttling. No local test execution claimed.

## Next steps

- Confirm exact-head CI, including documentation contract. Add deeper challenge-replacement, contact-edit and rollback regression coverage as needed.
- Verify the new Chromium suite and restricted-role runs on the latest head; investigate any failures and expand mobile/Firefox/WebKit coverage before release. Test recovery ambiguity, contact edits and response-loss races more deeply. Review finalization response-loss recovery and ensure no public auth or draft data leak.
- Confirm live staging HTTPS origin, explicit retention and cleanup schedule; never enable flag until migration order, backup and recovery gates are approved.
- Reconcile migration numbering, preflight/restore expectations and schema rollout ordering. Explicitly approve retention policy, staging backup/recovery and migration before enabling any live feature.
