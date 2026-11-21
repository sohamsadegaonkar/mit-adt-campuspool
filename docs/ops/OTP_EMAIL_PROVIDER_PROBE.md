# CampusPool OTP real-email sender readiness and one-shot acceptance probe

**21 November 2026 | Proposed source-only operator aid | NOT a production release approval**

This runbook is for a *single benign email-provider probe* without OTPs or database access. The script intentionally does **not** prove final inbox delivery; a consenting human recipient must confirm receipt. Nothing runs automatically or on CI against a live provider. The previous SMTP failure on Render is addressed by the HTTPS-only adapter in [draft PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36).

## Owner prerequisites

1. Choose one sending provider supported by the existing application: Resend or Brevo. If there is no existing account, owner must create one; do not assume or fabricate login access.
2. Use a **domain the owner controls**, or an explicitly authorized sending domain. Do **not** impersonate an MIT-ADT / university domain or infer permission merely because campus email recipients use it.
3. Verify the sending domain **with that provider**. Add exact DNS SPF/DKIM records offered by the provider via the authorized DNS administrator, checking for conflicting existing TXT/MX records. This manual step changes domain settings and requires owner authorization. Do not log DNS access tokens.
4. Generate a dedicated **sending-only**, preferably domain-restricted provider key when supported. Store the actual key in protected private secrets, never GitHub content, Notion, ticket bodies or chat. With Resend: `EMAIL_PROVIDER=resend`, `EMAIL_FROM` the verified sending mailbox, `RESEND_API_KEY` the protected credential. With Brevo: `EMAIL_PROVIDER=brevo`, `EMAIL_FROM`, `BREVO_API_KEY`.
5. Obtain **explicit consent from one test mailbox owner**, including the exact address; do not use an arbitrary real student mailbox. Set these variables in an approved secure execution environment, not in a committed file:
   - `OTP_EMAIL_PROBE_SENDER_VERIFIED=YES` — operator attests sender verification
   - `OTP_EMAIL_PROBE_RECIPIENT_CONSENT=YES` — operator attests consent
   - `OTP_EMAIL_PROBE_TO` — exact consenting mailbox
   - `OTP_EMAIL_PROBE_CONFIRM_TO` — independently entered exact same mailbox
6. With the candidate branch checked out, run `node scripts/otp-email-provider-probe.js --preflight`. This **never sends** and prints only generic result codes. A pass attests configured metadata and human flags, *not* that domain verification or consent was independently checked.
7. Only after owner authorizes **one real non-OTP test email**, set `OTP_EMAIL_PROBE_APPROVED=SEND_ONE_NON_OTP_EMAIL` and execute **once**: `node scripts/otp-email-provider-probe.js --execute`. This invokes the existing HTTPS adapter exactly once; no retries. It prints `ONE_NON_OTP_EMAIL_PROVIDER_ACCEPTED=YES` only on accepted API response, never message IDs or addresses.
8. Check the consenting mailbox inbox/spam directly and provider's protected dashboard for delivered/bounced/deferred status. Record only `inbox received YES/NO`, tested provider, ISO timestamp and reviewed branch SHA in private release evidence. No OTP, real recipient address, raw provider response, keys or private dashboard screenshots in GitHub. Provider acceptance alone does **not** close the live-delivery gate.

## Release boundaries

- Probe does not generate an OTP, create a user, touch PostgreSQL, deploy Render, change domain settings, or send SMS.
- Real full registration still requires MSG91/DLT approved template and a consenting handset; an SMS API accepted result is not proof of actual receipt.
- To claim end-to-end auth, separately review/merge stacked source PRs, complete independent encrypted backup/restore + rollback, obtain staging deployment approval, deploy pinned build into isolated staging, configure protected secrets, then complete OTP signup/login, failure, replay, session and restart tests.
- Production remains **NO-GO** until all other independently audited release gates and explicit owner approval pass. Never enable test bypass or email-only signup in production.

## Source and CI

`scripts/otp-email-provider-probe.js` defaults to safe preflight-only if explicitly invoked with `--preflight` and refuses unapproved real sends. `test_otp_delivery_recovery.js` tests missing consent, exact-recipient confirmation, one-message limit, no OTP content, redacted provider errors and no network on preflight. CI runs all tests with fakes; it does not call Resend or Brevo with real credentials.
