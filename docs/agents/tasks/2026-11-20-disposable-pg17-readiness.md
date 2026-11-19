# Task: Disposable PG17 final-server readiness

- **Task ID / file:** `2026-11-20-disposable-pg17-readiness`
- **Status:** in progress / CI pending
- **Agent / owner:** ChatGPT engineering agent; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb; parent OTP #36 has unchanged fixture
- **Scope:** synthetic test_azure_blob_real_tools.js only; no real backup worker or live services
- **Dependencies / related tasks:** PR #36; [failed rerun](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/43050446027/job/135816082794)

## Goal and acceptance criteria

Wait for the final PostgreSQL TCP server and pass real synthetic AGE streaming, ciphertext comparison, restore and ledger assertions without broadening the container network or writing plaintext archives.

## Current state (verified vs assumed)

PR #36 rerun passed package setup, then failed at first fixture psql with missing Unix socket. Source checks pg_isready against Unix socket, plausibly observing temporary init server before its shutdown. Race is a hypothesis until CI confirms. PR #45 four checks passed separately.

## Plan

1. Probe SELECT 1 over container-local TCP, bounded to 60 seconds, not the temporary socket.
2. Use same loopback endpoint for fixture, pg_dump, restore and validation; retain --network none and tmpfs.
3. Run existing real-tools CI unchanged, review and integrate separately. No release waiver.

## Progress log

- 2026-11-20 IST — reviewed failed rerun and fixture; prepared TCP SQL readiness guard and consistent client endpoint.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Prior real-tools | GitHub job 135816082794 | failed at fixture setup |
| Final-server probe and synthetic backup/restore | node --test test_azure_blob_real_tools.js | Pending exact-head CI |

## Risks and decisions

No host port exposed; only container-local loopback. Temporary init server does not listen on TCP. Do not retry export or skip restore assertions. No evidence of real Azure recovery.

## Next steps — exact handoff

1. **Next action:** check azure-realtools at exact branch head; diagnose failures without bypassing tests.
2. **Who may do it:** engineering reviewer.
3. **Prerequisites and blockers:** CI and independent review, then reconcile parent #36 and backup chain.
4. **Expected evidence:** real-tools pass, source/restore parity; no live access.
5. **Production impact:** none.

## Links and files changed

- Branch: fix/disposable-pg17-readiness-2026-11-20
- test_azure_blob_real_tools.js; task; STATUS.md; NEXT_STEPS.md
