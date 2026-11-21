# Task: Version-pinned read-only deployment QA harness

## Goal and acceptance criteria

Make each CampusPool deployment easier to verify without requiring a sending domain, real OTP or student data. Source and operator-confirmed deployed commit must match; external smoke checks must be read-only and fail closed on unsafe origins, bad health, exposed staging page and unauthenticated session access. Passing smoke is explicitly NOT production release approval.

## Current state

- On 21 November 2026, production Render had a manually deployed live main commit 202330a8166674d86a428e1f90ab8ed857d1313d. Real OTP remains blocked by verified sender, MSG91/DLT, persistence and recovery gates.
- Existing isolated tests cover OTP, security, bookings, staging Basic Auth and mobility. There was no dedicated exact-SHA public read-only smoke operator harness.
- Scope is **review-branch source only**. No Render changes, provider calls, credentials, database operations or real student traffic are authorized.

## Plan

1. Add fixed-origins smoke script, operator-entered source/deploy SHA parity check and only three anonymous GET probes.
2. Test bad URLs, SHA mismatch, smoke failures and protected staging response using mocked fetch.
3. Add a scoped CI workflow and operator runbook, then review exact-commit CI before any source-only merge.

## Progress log

- 21 November 2026 — Added scripts/deployment-smoke.js, test_deployment_smoke.js, .github/workflows/deployment-smoke.yml, docs/ops/DEPLOYMENT_QA.md in separate review branch chore/deployment-qa-smoke-2026-11-21.
- Existing OTP/ride code, production settings, cloud resources and services intentionally unchanged.

## Verification

- Local Node 22 test suite: Initial local 7/7 PASS with network mocked; subsequent source-added 8th mocked regression checks all-network-inaccessible verdict is INCONCLUSIVE, not a product outage; tested only approved loopback/Render origins, SHA mismatch prevention, three GET calls without cookies, healthy/unhealthy/redirect, staging Basic Auth gate and argument validation.
- GitHub Actions run on exact review SHA remains required. Do not claim real deployment coverage or inbox receipt from mocked test output.

## Next steps

- Check dedicated PR CI, review code, and consider source-only merge separately; do not deploy or change Render environment.
- After an owner-approved deployment, record the live SHA from Render and invoke the read-only smoke manually. Attach browser and isolated functional QA evidence. Mark real email/SMS, durable database migration and recovery/rollback as BLOCKED until independently demonstrated.
