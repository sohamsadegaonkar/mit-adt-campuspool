# OTP provider-acceptance accuracy and live-delivery readiness — 21 Nov 2026

## Goal and acceptance criteria

Make signup/login OTP email use a secure HTTPS provider, preserve failed-provider retry safety and provide truthful status to students. Acceptance requires mocked and disposable PostgreSQL auth tests, Docker startup checks, secret hygiene, security, and browser regression checks on the integrated branch. Real delivery, recovery, durability and production approval remain independent release gates.

## Current state

**Source-only OTP integration candidate:** [PR #72](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/72) merged into [PR #71](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/71), which merged into [draft PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36). Combined repair branch source checkpoint `75508475a2a424fd65dec6d897e4416fae85ffbd`; follow-up documentation changes may advance HEAD. **No main merge or Render deployment yet.** On 21 November, production Render still ran `main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb`, staging `cceadbf6251f70634320e50b8288530ba77513c3`; both auto-deploy OFF. Resend no-domain simulator reached provider API acceptance and a screenshot-confirmed *simulated* Delivered status; this does not prove campus mailbox receipt.

## Plan

1. Consolidate the OTP HTTPS repair, provider receipt semantics and consent-gated provider probe scripts into a single review branch.
2. Run full CI on the combined SHA and repair integration-specific regressions without affecting live services.
3. Seek independent code review; keep deployment, private provider settings, real user delivery, migration and database recovery as separate explicitly approved stages.

## Progress log

- 21 Nov 2026: Integrated #72 into #71 (squash SHA `84cc04b3dfedb154c1450f2ee294d2aab999d73c`) and #71 into #36 (squash SHA `75508475a2a424fd65dec6d897e4416fae85ffbd`), preserving the draft main-facing PR.
- First consolidated CI reported a documentation contract failure because this task handoff omitted required headings; this update repairs the source documentation structure. No runtime rollback/deploy required.
- No real student email/SMS sent by these GitHub changes; provider API simulator evidence is separate from application E2E proof.

## Verified defect and minimal fix

The PostgreSQL signup endpoint `POST /api/auth/send-email-otp` returned `deliveredToInbox:true` as soon as the Resend/Brevo HTTPS adapter returned an accepted API message ID. That response cannot prove inbox receipt, delivery latency or spam filtering. The legacy SQLite signup/login responses similarly returned `deliveredToInbox` based on provider acceptance. The user interface displayed stale **Real-Time SMTP Dispatch Active** wording despite the HTTPS-only adapter.

- PostgreSQL and legacy responses now use `providerAccepted` for provider/API acceptance; no confirmed-inbox field is asserted. The signup response explicitly says recipient receipt is unconfirmed.
- UI signup/login banners use request/acceptance language instead of promising receipt or claiming SMTP is active. No OTP value or student identifier was added to logs.
- Added disposable PostgreSQL API-contract assertion to `test_stage1_otp.js` requiring `providerAccepted:true`, absence of `deliveredToInbox`, and honest provider submission copy.
- An existing local HTTP integration test expected the retired field and initially failed both security/OTP CI; fixed `test_auth_integration.js` to verify `providerAccepted:false` and no fictitious receipt when development mode uses an OTP hint and no email provider. No delivery, code generation, HMAC/expiry, rate limiter, session or database migration semantics changed.

## Verification

### Earlier code-level CI on SHA 289b46b2

- [PostgreSQL OTP run 44900668227](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44900668227): **SUCCESS**. Logs confirm actual disposable PostgreSQL Stage 1 lifecycle, failed-provider retry, and complete email+phone registration/login contract executed (not skipped), including new assertion.
- [OTP HTTPS regression 44900668224](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44900668224): **SUCCESS**; both HTTPS test and Docker isolated health jobs passed.
- [Security smoke 44900668228](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44900668228): **SUCCESS** on corrected test; original preceding code SHA had an expected stale-field test failure.
- [Places checks 44900668238](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44900668238): **SUCCESS**.
- [Browser E2E 44900668320](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44900668320): **PENDING at checkpoint** (browser installer in progress); check final outcome before claiming complete.
- CI is synthetic/disposable. None of the results prove real institutional inbox or handset receipt or durable production sessions.

## Next steps

1. Review the integrated draft PR #36 and its exact-SHA consolidated CI; obtain independent code review before any main merge. Do not infer approval from synthetic tests.
2. Obtain owner-approved verified sender domain and provider account for **Resend or Brevo**, configured via protected staging settings (never GitHub/Notion/chat). Review SMS MSG91 DLT sender/template/handset readiness. Never substitute a fake OTP for production signup.
3. Complete required recovery and rollback preflight. Only after separate authorization deploy exact CI-tested SHA to isolated staging and demonstrate real consenting inbox receipt, phone receipt, wrong/expired/replayed/cooldown behavior, successful session, persistence after restart and safe provider failures.
4. Production requires independent PostgreSQL durability, staged data-migration/rollback, restored backup evidence, security review and explicit owner release approval. No payments or mobile/real-user signup release implied by these tests.

**NO LIVE EMAIL OR SMS SENT. NO RENDER/AZURE/PG WRITES. NO SECRETS STORED. PRODUCTION NO-GO.**
