# Task: Campus Wi-Fi fairness for verified PostgreSQL Rides

- **Task ID / file:** 2026-11-20-campus-wifi-fairness
- **Status:** in review / CI passed
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main 1020e2e; parent #54 d3d095a273ec83473319a707ad3e31d6bc972d73; policy #50 1c493e3
- **Scope:** default-off CAMPUS_WIFI_FAIRNESS pilot flag, four listed GET and four POST rides routes; reuse SQLite shared-file limiter. No live flag change, schema, provider, cloud or deployment.
- **Dependencies / related tasks:** #47–54; #50. Release G1 independent.

## Goal and acceptance criteria

130 legitimate reads on same TCP source across eight verified actors all succeed rather than 120/10. Each verified UUID gets existing 120 read or 60 mutation budget across sessions and IPs. Hard aggregate IP ceiling 600 read/300 write before session query, no replay exemption to ceiling. Invalid/missing/revoked/expired tokens use original IP budgets; no unverified actor buckets. OTP, auth, GPS, mobility, billable Places, legacy and default-off behavior unchanged. Actor-limited replay remains bounded by original 12/IP, only committed authorized same-key receipt, no abuse bypass. Actual HTTP regression over loopback, no forwarded trust; seat and receipt invariants preserved.

## Current state (verified vs assumed)

#53 shared NAT 120/10, 3880 requests complete; #54 both checks passed, six parity cases 12→6 SQL, peak pool acquisitions 6400 vs 6720 and p95 30.17ms. Current server checks IP before resolving session; valid users sharing NAT exhaust same bucket. Existing shared-file SQLite counter fails closed but is not distributed across independent replica disks. Existing trusted proxy and session resolution remain unchanged.

## Plan

1. Add explicit default-off flag valid only for PostgreSQL Rides, exact GET/POST route allowlists. Pre-auth aggregate IP cap on those routes only; strict old anonymous limits and stable hashed verified UUID for actor budgets after session check.
2. Reuse one limiter helper and existing bounded receipt replay flow. Hard cap never permits replay. Keep original public/auth/provider/GPS and legacy policy.
3. Add disposable HTTP CI mode with actual same TCP source, valid and invalid/revoked/expired sessions, alternate real loopback IPs, spoofed header, same-actor and cross-actor mutation, CSRF, exact replay ceiling, hard IP ceilings and SQL reconciliation. Previous workload remains flag-off for comparable baseline.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Reuse existing SQLite counter and real verified session UUID; one extra aggregate check and actor check only on scoped opt-in routes. No token cache, schema or new store.
- **Conventional alternative:** Redis distributed token buckets; adds service/credential/network and consistency complexity; no current evidence independent replica limiter needed for pilot.
- **First-principles alternative:** Distinguish resource admission (preauth per IP) from fairness (verified account regardless of IP/session). Keep scoped old anonymous/public budgets and bounded replay exception; avoid cookie claims or shared-NAT whitelists. No global fairness guarantee.
- **Tradeoffs:** Two SQLite checks instead of one for scoped verified traffic; fivefold aggregate cap deliberately permits more preauth syntactically valid forged-token lookups than old policy, but bounds them and prevents token rotation from granting actor budget. Aggregate exhaustion can still affect legitimate students; 600/300 are provisional pilot caps, not unlimited campus capacity. No new dependencies, storage schema or infrastructure. Default off for rollback, old path preserved.
- **Decision:** Add default-off identity-aware pilot on exact routes, not change live settings. Use verified hashed UUID; same budget across IP/session, preserve CSRF and receipt checks. No increased auth/OTP/provider limits.
- **Evidence:** #53 and #54 real 120/10 NAT baseline, source exact preauth IP guard, session lookup verifies revoked/expiry and is_verified. #54 verified query optimization. New cap and performance unverified pending CI/representative use.
- **Validation:** Existing default-off stress and rush plus new disposable HTTP mode; 130 shared reads, actor cap across sessions/IPs, 5 token categories, anonymous budget, preauth hard ceilings, 11 completed receipt replays plus mismatch and separate-IP new-key rejection, other actor success and exact two receipts/one active booking, unchanged auth policy.

## Progress log

- 2026-11-20 IST — verified #54 and documented baseline; inspected router, limiter, session and replay boundaries.
- 2026-11-20 IST — implemented flag and scoped fairness policy, real HTTP regressions; CI pending.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Fairness and abuse protection | RIDES_HTTP_FAIRNESS_DISPOSABLE_DB=YES npm run test:rides-http | PASS |
| Legacy/default-off HTTP and Rush | PostgreSQL CI | PASS |
| Production configuration | not changed | no live test |

## Risks and decisions

Flag defaults off; no approval to enable on live services. Initial hard IP caps may still throttle large campus NATs, and intentionally raise pre-auth DB work for plausible forged sessions; invalid sessions get no actor budget. Fixed-window limiter and shared-file storage limitations remain. No independent-replica guarantees, no CAPTCHA/identity caching or global abuse solution. Actor cap applied before CSRF, preserving abuse accounting. Session and CSRF still required for writes, aggregate cap never bypassed. Pilot security/performance review and proxy configuration validation required before enablement. No live payment or settlement policy change.

## Next steps — exact handoff

1. **Next action:** read exact-head CI CAMPUS_WIFI_RESULT; verify all unchanged/default-off regressions. If green, independently review pilot cap tradeoff and run enabled sustained shared-IP workload before rollout; next privacy and rides-only settlement release blockers.
2. **Who may do it:** application engineering / independent reviewer; owner authorizes flags/live operations.
3. **Prerequisites and blockers:** stacked review #47–54, #50; G1 remains NO-GO.
4. **Expected evidence:** 130/130 shared reads, stable actor caps, valid hard IP 429, no forged token/CSRF or receipt bypass, committed effect and receipt consistency.
5. **Production impact:** none; feature remains off.

## Links and files changed

- Branch fix/campus-wifi-fairness-2026-11-20
- server.js; test_pg_rides_http.js; bench/campus-wifi-fairness.js; .github/workflows/stage1-otp.yml; STATUS.md, NEXT_STEPS.md, DECISIONS.md, ARCHITECTURE_MAP.md; this task.

## Exact-head CI evidence — 2026-11-20 UTC

`3cea037` all five reported checks successful (including browser E2E, smoke, PostgreSQL and Places). [PostgreSQL log](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44699362127/job/136163703500): CAMPUS_WIFI_RESULT: sharedAccepted 130, actorReadCap 120, crossSessionAndIp true, 5 invalid token categories, anonymous cap 120, aggregate read cap 600, actor write cap 60, aggregate write cap 300, 11 completed replays, replay budget enforced, CSRF denied, another actor booked, two receipts and seat invariant true. Default-off rush 3880/3880, 47 invariant snapshots, 875 receipts, NAT 120/10, recovery 8. Flag remains off, enabled sustained shared-NAT and independent security review pending. Next privacy boundary. No live changes.
