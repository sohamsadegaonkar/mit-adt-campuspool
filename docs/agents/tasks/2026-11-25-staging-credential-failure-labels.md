# Task: Specific staging credential failure labels

- **Task ID / file:** 2026-11-25-staging-credential-failure-labels
- **Status:** in review
- **Agent / owner:** engineering agent / repository maintainer
- **Last updated:** 2026-11-25 UTC
- **Baseline:** main (credential workflow run at 4b25a0c9348e1507e9df8ce5bc41ca76400217fc)
- **Scope:** existing diagnostic script and regression tests; no guard relaxation, secret changes, DB access, export, freeze, migration or deploy.
- **Dependencies / related tasks:** PR #77; 2026-11-23-staging-008-recovery-workflow.md

## Goal and acceptance criteria
Report fixed PASS/FAIL labels for individual configuration fields without leaking any value or changing connection authorization. Retain original config guard as sole authority; test rejection/no connection and secret redaction.

## Current state (verified vs assumed)
[Run 45601322828](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45601322828) job 139160710376: stage, typed confirmation and admin input valid; STAGING_TARGET_AND_ROLE=FAIL, PINNED_CA_AND_VALIDITY=PASS; AGE encryption passed. Restore job 139161373865 waiting. Owner's local format-only check found SSL mode and query parameter mismatch, then corrected locally; live GitHub config still rejected. Stored values cannot be read and exact residual mismatch is unknown.

## Plan
1. Add fixed diagnostic labels on rejected config only; no raw errors, URL or secret text.
2. Test each representative malformed config, existing connection gate and no disclosure.
3. Exact-head CI, maintainer source-only approval/merge, then one fresh main run.

## Progress log
- 2026-11-25 UTC — source 23dabdc adds explainConfig and failure-only checks; test 9e8cce0 covers admin ACK, SSL, query parameters, port, project, malformed URL, blocked connection, fixed-only output.

## Verification
| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Latest live diagnostic | run 45601322828 | failed before connection |
| New tests | node --test test_staging_008_credential_validation.js; PR CI | pending |
| Live backup / restore | not authorized by this patch | not executed |

## Risks and decisions
No added secrets or authorization; explanation labels are informational, original guard unchanged. Never echo raw URL, password or AGE identity. Preserve both protected environments and real recovery requirement.

## Next steps — exact handoff
1. **Next action:** review exact-head CI and merge only with maintainer approval; fresh main diagnostic then inspect DIAG_* labels.
2. **Who may do it:** repository maintainer.
3. **Prerequisites and blockers:** protected job approval; existing correctly configured secrets. Do not rerun old SHA.
4. **Expected evidence:** fixed PASS/FAIL labels or successful read-only connection. Isolated AGE matching remains separate.
5. **Production impact:** none.

## Links and files changed
- Branch: fix/staging-credential-failure-labels-2026-11-25
- scripts/staging-008-credential-validation.js
- test_staging_008_credential_validation.js
- docs/agents/STATUS.md and NEXT_STEPS.md
