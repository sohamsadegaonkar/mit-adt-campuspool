# Task: Fail closed on HTTPS OTP provider redirects

- **Task ID / file:** `2026-11-20-otp-redirect-guard`
- **Status:** in progress / CI pending
- **Agent / owner:** ChatGPT engineering agent; independent reviewer unassigned
- **Last updated:** 2026-11-19 UTC / 2026-11-20 IST
- **Baseline:** `main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb`; parent PR #36 head `f21cbd3deb7034038a79308c5978be4471f983fc`
- **Scope:** shared Resend/Brevo HTTPS adapter and synthetic redirect regression. No external provider, live data, cloud modification or deployment.
- **Dependencies / related tasks:** PR #36; [OTP recovery task](2026-11-05-otp-delivery-recovery.md); G1/G2 remain separate.

## Goal and acceptance criteria

Both adapters reject redirects with sanitized unavailable error; loopback HTTP 307 regression observes two initial requests and zero redirected requests. Exact-head CI and independent review required.

## Current state (verified vs assumed)

PR #36 had 10 successful checks; Azure real-tools failed at Ubuntu DNS/AGE installation; browser E2E cancelled at browser installation. Both reruns accepted, not yet passed. Fetch default follows redirects; conditional risk, no observed leak.

## Plan

1. Set `redirect:'error'` on the fixed HTTPS URL request.
2. Test both adapters using real loopback 307 response with synthetic inputs.
3. Review exact parent/child CI before integration. No release waiver.

## Progress log

- 2026-11-20 IST — audited parent check runs and workflows; requested two disposable reruns.
- 2026-11-20 IST — scoped redirect guard and regression prepared on child branch; CI pending.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Parent real-tools | [Job](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/43050446027/job/130625765493) | Install failure; rerun accepted |
| Parent browser | [Job](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/43050446063/job/130625765184) | Cancelled setup; rerun accepted |
| Redirect regression | npm run test:otp-delivery | Pending child CI |
| Genuine OTP | Controlled staging receipt after gates | Not run |

## Risks and decisions

Reject all redirects, even same-origin, for fixed provider URLs. Future legitimate endpoint change requires review. No new dependencies and no claim of actual leak.

## Next steps — exact handoff

1. **Next action:** inspect exact parent reruns and child OTP CI; fix failures without bypass.
2. **Who may do it:** engineering reviewer.
3. **Prerequisites and blockers:** parent #36 review, child CI, recovery/credential/provider gates.
4. **Expected evidence:** two initial requests, zero redirects, green required checks.
5. **Production impact:** none; no merge, deploy, live DB or backup access.

## Links and files changed

- Parent [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36)
- Child branch `security/otp-https-redirect-guard-2026-11-20`
- `stage1-otp/email-provider.js`, `test_otp_delivery_recovery.js`, STATUS/NEXT_STEPS and this task.
