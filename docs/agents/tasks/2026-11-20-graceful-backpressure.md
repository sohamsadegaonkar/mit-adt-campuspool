# Task: Graceful PostgreSQL backpressure and CampusPool traffic-mode feedback

- **Task ID / file:** 2026-11-20-graceful-backpressure
- **Status:** in review / targeted HTTP and browser VM tests passed
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e; parent #51 eed14c1fb7988cf28ef5e947f07a2256dea69e10; policy #50 1c493e3
- **Scope:** owned shared PostgreSQL pool classification, HTTP mapping, existing web toast and idempotent mutation feedback; no live DB, Azure, migration, deployment, payment, OTP retry or automatic request replay
- **Dependencies / related tasks:** #47–51, policy #50; separate recovery workstream

## Goal and acceptance criteria

Map real pending pool acquisition timeout to typed DB_POOL_BUSY then sanitized HTTP 503, no-store and bounded 2–4 second Retry-After; existing SQL, connection startup and unexpected errors unchanged. Preserve callback and promise pg-pool semantics. Saturated HTTP mutation must commit no booking or receipt; retry exact key after lock release and replay once. Existing auth/CSRF, rate budgets, cancellation and seat invariants retained. Traffic-themed message with existing accessible toast, no extra assets or automatic write retries; never fake a successful ride publish on transport failure.

## Current state (verified vs assumed)

#51 tested 40e3d91: 19 targeted HTTP mutations, six consistent snapshots, p95 36.32ms, no unexpected mixed errors; 5/5 connections occupied, three queue acquisition errors surfaced as generic HTTP 500; release restored 8/8 reads. Pool max five, existing acquisition timeout 5000ms. Locked package pg-pool 3.14.0 uses exact acquisition deadline message tested in real integration. Existing UI toast is aria-live; booking and offer use response messages; cancellations silently ignore non-OK; offer transport catch falsely reports local publication. Parent docs-only head postgres CI green.

## Plan

1. Classify only acquisition timeout at owned Pool.connect (both callback and promise); do not classify SQL errors by text. Bubble typed error through Rides/Mobility catches to one central HTTP mapping.
2. Bounded random Retry-After 2–4s to de-phase manual retries; reuse existing toast and browser key lifecycle. Do not add queues, speculative pool caps, dependencies or auto retries.
3. Extend #51 actual saturation test: read plus two identical booking requests, no receipt/effect, then manual same-key success/replay. Verify callback/query and promise acquisition on tiny real pool, SQL error preserved. Add browser VM tests for traffic feedback and no automatic dispatch.
4. Record actual CI and limitations; independent review before merge.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Existing pg-pool admission/timeout, shared pool and browser idempotency suffice; add one typed acquisition-boundary classification and one HTTP mapping; reuse existing toast.
- **Conventional alternative:** Raise pool size or add Redis, external queue/circuit breaker. Neither fixes semantics and they add resource/operational overhead; capacity not measured.
- **First-principles alternative:** Differentiate inability to acquire a resource before operation from query/connection faults, communicate retryability to caller using standard 503 and de-phased delay, preserve same logical mutation identifier. Avoid automatic retries completely.
- **Tradeoffs:** No new dependencies, live cost or persistent state. Exact pg-pool message is version coupled; tests detect drift on upgrade. 2–4s guidance is not a guarantee/recovery estimate; no enforced client cooldown or queue cap. Do not claim session preservation on refresh or total overload resilience. Rollback source-only, no schema.
- **Decision:** Minimal boundary classifier and HTTP handler, existing manual retry path with traffic-mode toast; fix misleading local publication. No frontend redesign, fake confirmation or extra state.
- **Evidence:** #51 real 500s on 5/5 saturation; existing connection timeout 5000ms, package-lock pg-pool 3.14.0 and existing 503 key retention.
- **Validation:** actual disposable PostgreSQL CI, real callback and promise acquisition deadlines, SQLSTATE 42703 remains original, no unauthorized effects, same-key retry receipt exactly one, 503 header 2–4 and eight recovery reads; VM tests of exact text, bounds, no automatic retry and key preservation.

## Progress log

- 2026-11-20 IST — audited #51, policy, pg-store, API catches, browser key lifecycle and user-facing existing toast.
- 2026-11-20 IST — implemented typed acquisition mapping, bounded retry guidance and traffic-themed failure copy, expanded existing real HTTP and VM tests; CI pending.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Prior baseline | #51 HTTP job 135839111495 | 3 generic 500s verified |
| Actual pressure / same-key retry | RIDES_HTTP_STRESS_DISPOSABLE_DB=YES npm run test:rides-http | PASS, 3/3 overloaded requests return 503, same-key recovery verified |
| Browser contract | npm run test:browser-idempotency | 12/12 PASS; VM not device rendering |
| Live release | none | not performed |

## Risks and decisions

Classification restricted to owned PostgreSQL pool acquire boundary; injected external pool not modified. Exact driver error text dependency tested, not guaranteed across pg-pool upgrades. No queue length bound, no circuit breaker, no auto retry, no production load/SLA proof. 503 copy not a success claim; old session and generic response race limitations remain. Existing auth refresh still fails closed; no bypass or unverified payment. No style assets or new dependencies. Real browser visual/mobile QA pending.

## Next steps — exact handoff

1. **Next action:** inspect exact-head CI and diagnostics; if green, review combined app candidate and evaluate bounded sustained pool pressure and settlement/privacy policy before new infrastructure. If red, fix actual defect without relaxing acceptance.
2. **Who may do it:** application engineering; independent reviewer unassigned.
3. **Prerequisites and blockers:** stacked PR review, G1 recovery independent, no live deployment.
4. **Expected evidence:** all real acquisition responses 503, bounded retry headers, zero seat/receipt effects, one original retry plus replay, original unexpected SQL error preserved, browser tests green.
5. **Production impact:** none.

## Links and files changed

- Branch fix/graceful-backpressure-2026-11-20
- stage1-otp/pg-store.js, server.js, index.html, test_browser_idempotency.js, test_pg_rides_http.js, docs/agents/STATUS.md, NEXT_STEPS.md, DECISIONS.md, this task.
- Parent #51; minimum-complexity policy #50.

## Exact-head CI evidence — 2026-11-19 UTC / 20 Nov IST

Tested code `b095678b9ab325b49d89ba72628c05bb8f1bb4ba`, [PostgreSQL job](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44604277714/job/135843665303). Browser VM 12/12 pass (0 fail/skip), including traffic copy/bounded guidance, no automatic send, same-key retry, unrelated 503 unchanged. HTTP TAP 1/1 pass (0 fail/skip): 20 targeted mutations, 9 accepted and 11 expected domain/security rejections, nine consistent seat snapshots, no unexpected mixed mutation errors, p50 17.87ms/p95 34ms. Actual five shared connections blocked; three queued requests returned 503 DB_POOL_BUSY with coherent bounded Retry-After (one read, two same-key bookings); zero seat/receipt effect before recovery. Both real acquisition APIs verified and SQLSTATE 42703 preserved; one original retry plus one replay, same booking/receipt and final cancellation verified. Eight recovery reads passed; pressure window 5044ms. Counts exclude other baseline, pressure probes, recovery/replay and throttling requests. Compared with #51 three generic 500s, behavior changed as intended, not a claim of speedup. Single-process synthetic test, no sustained overload, real browser visual QA or live runtime proof. Snapshot checks: postgres-otp:completed:success, disposable-benchmark:completed:success, smoke:completed:success, places-unit:completed:success, browser-e2e:in_progress:, places-unit:completed:success. No new dependencies, queue, live access, migration or deployment. Docs evidence checkpoint only; exact tested code unchanged.
