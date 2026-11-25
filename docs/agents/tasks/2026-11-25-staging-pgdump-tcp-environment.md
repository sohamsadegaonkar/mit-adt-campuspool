# Task: Repair real staging backup TCP transport

- **Task ID / file:** 2026-11-25-staging-pgdump-tcp-environment
- **Status:** in review
- **Agent / owner:** engineering agent / repository maintainer
- **Last updated:** 2026-11-25 UTC
- **Baseline:** main@9877396f9b91c6ecb2a30b178ef4e58a5d26b957
- **Scope:** fix pg_dump connection environment, existing protected backup workflow, offline and scratch regression tests. No changes to database grants, migrations, production or deployment.
- **Dependencies / related tasks:** PR #77, PR #78, staging-008 recovery task

## Goal and acceptance criteria

The actual protected export must connect via the verified staging TCP endpoint, not a local Unix socket; preserve pinned CA, exact target and explicit administrator authorization, streaming AGE encryption, separate restore environment and fixed non-sensitive error output. Verify connection fields on synthetic values and actual TCP pg_dump on disposable PostgreSQL before fresh owner-approved main dispatch.

## Current state (verified vs assumed)

Owner confirmed external/privileged writers paused and approved one encrypted backup and isolated restore. [Recovery run 45606804361](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45606804361), job 139179678573: protected approval accepted; preflight passed (application freeze verified, nine empty app tables, migration ledger seven; database-wide freeze not proven by role checks). Actual pg_dump failed trying local Unix socket; encrypted artifact upload and isolated restore were skipped. The app role was frozen in the prior task. Exact thaw procedure is retained in the private roadmap. No archive or restore can be claimed.

## Plan

1. Construct validated libpq discrete environment from existing strict target parser and owner ACK; use database name rather than URI in PGDATABASE.
2. Pass only explicit connection fields to pinned Docker client, preserve pipefail and pinned CA, emit bounded error categories.
3. Exercise equivalent TCP transport against synthetic PostgreSQL, review exact-head CI, obtain maintainer approval, then run a fresh protected main workflow during confirmed maintenance window.

## Progress log

- 2026-11-25 UTC — 5e993d7 adds guarded dump connection environment, db6b130 applies it to export step, aea235a adds policy/regression checks, 688c7c8 exercises host-network TCP export in synthetic CI.
- No actual repeat export, restore, migration or deployment performed by this patch.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Actual staging preflight | run 45606804361 | passed |
| Actual export | job 139179678573 | failed: Unix socket; artifact and restore skipped |
| Policy/connection regressions | node --test test_staging_008_backup_guard.js | CI pending |
| Synthetic TCP pg_dump / AGE restore | existing recovery contract CI | CI pending |

## Risks and decisions

Do not put a credential URI on command-line arguments or print raw errors. The password is present only in the short-lived protected runner and Docker process/container environment. No secret changes required. Explicit owner ACK remains required; only backup step receives it in addition to existing preflight/recheck. Preserve the separate restore identity. Actual libpq TLS and dump/restore still require live evidence; scratch TCP uses fake credentials only.

## Next steps — exact handoff

1. **Next action:** check exact-head CI and approve/merge source-only patch; use a fresh main run, not a rerun of the previous SHA.
2. **Who may do it:** repository maintainer under single-maintainer staging policy.
3. **Prerequisites and blockers:** reconfirm maintenance window and app freeze before dispatch, then approve backup and restore environments. If window ends, do not leave app frozen indefinitely; use recorded thaw under owner authorization.
4. **Expected evidence:** encrypted archive upload, SHA verification, isolated cold restore eight assertions. No migration until recovery/rollback gates pass.
5. **Production impact:** none.

## Links and files changed

- Branch: fix/staging-pgdump-tcp-environment-2026-11-25
- scripts/staging-008-backup-guard.js
- .github/workflows/staging-008-recovery-proof.yml
- .github/workflows/staging-008-recovery-contract.yml
- test_staging_008_backup_guard.js
- docs/agents/STATUS.md and NEXT_STEPS.md
