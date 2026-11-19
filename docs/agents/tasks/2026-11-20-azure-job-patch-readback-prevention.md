# Task: Prevent Azure job PATCH readback false blocks and unsafe retries

- **Task ID / file:** `2026-11-20-azure-job-patch-readback-prevention`
- **Status:** in review — incident recovered; prevention policy documented; reusable automated guard/tests pending
- **Agent / owner:** ChatGPT (documentation); implementation owner unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** `ops/backup-three-gates-evidence-2026-11-06@44ceb5bcfd0bed3d429069f105fc6775b437edc2`
- **Scope:** Azure Container Apps backup-job configuration comparison, approved PATCH/rollback, operator evidence and cross-agent handoff. No Azure changes, application code, deployment or migration in this documentation task.
- **Dependencies / related tasks:** [NEXT_STEPS](../NEXT_STEPS.md), [STATUS](../STATUS.md), [backup security review](../../ops/CLOUD_BACKUP_INDEPENDENT_SECURITY_REVIEW_2026-11-05.md).

## Incident and evidence

- The approved TLS-only template PATCH was accepted; exact readback never matched because the returned path `$.template.containers[0].resources.ephemeralStorage` was absent. All other candidate fields matched, including CA mount, manual trigger, zero retries, exact signed image and no export approval. The script correctly blocked the start rather than accepting unexpected drift.
- The field is provider-managed/read-only in the SDK; the [2026-01-01 ARM job schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2026-01-01/jobs) defines writable container CPU/memory. [Storage documentation](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts) describes CPU-based ephemeral capacity. Missing metadata does not prove missing or sufficient runtime storage. Do not generalize this exception to other API versions or fields.
- Owner explicitly entered `RESTORE_PREFLIGHT_ONLY`; guarded restore PATCH was accepted. First observed poll emitted `BLOCK UNEXPECTED_CONFIGURATION_DIFFERENCE`, later poll emitted `MATCH_EXCEPT_READONLY_STORAGE=YES`, followed by `PREFLIGHT_CONFIGURATION_RESTORED=YES` and `AZURE_WORK_PAUSE_READY=YES`. Cause/details of the first restoration mismatch were not captured; it is a transient observation, not proof of a specific Azure provisioning behavior. Final accepted state matched the original baseline except for the one documented omission. Exact prior execution history guard passed (only ziik3b8, Succeeded). No new execution, DB connection or export reported. Actual TLS and runtime storage remain untested.
- Source: owner Cloud Shell outputs on 20 Nov IST; preceding [engineering checkpoint](https://github.com/sohamsadegaonkar/mit-adt-campuspool/commit/44ceb5bcfd0bed3d429069f105fc6775b437edc2). Not independent Azure inspection.

## Required prevention rules (future agents)

1. **Read the exact provider/API contract before preparing a mutation.** Separate the writable request model from the broader GET response. Do not assume a full GET is a valid PATCH body, or that a job start override preserves secret volumes/volume mounts. Use one pinned API version for plan, readback and rollback; verify documented behavior for that version.
2. **Preserve two artifacts:** immutable original live evidence and a separately derived writable baseline/rollback request. Use protected ephemeral storage, mode 0700/0600, checksums and exact candidate diff. Never record raw configuration, passwords, tokens or private keys in handoff. Explicitly review all changed fields; no blind normalization.
3. **Narrow comparison exception:** for this exact API/job/container, accept full expected equality OR equality to a copy of expected with only `template.containers[0].resources.ephemeralStorage` deleted. Do not strip the field from both inputs or accept a changed value, extra keys, missing CA/volumes, reordered/changed identity or env, other resource changes or arbitrary null/missing differences. Leave raw expected intact; remove the read-only field from writable request payloads. Any new exception needs source evidence, review and a negative regression test.
4. **Distinguish request acceptance, pending readback, final verified state and failure/unknown outcome.** After an accepted PATCH, poll read-only within a bounded deadline; never classify every intermediate nonmatch as a final hard block. Never start while comparison is nonmatching or provisioning is not Succeeded. Log safe diff paths and provisioning status for unexpected observations. If a security-critical/unexplained drift is seen, freeze start/mutations and investigate; do not treat it as harmless propagation. Timeout, API error or ambiguous result means stop and inspect, never resubmit a PATCH automatically.
5. **Fail closed around side effects.** Confirm exact subscription/resource identity, image digest, two UAI assignments/lifecycles, least-privilege secrets/RBAC, CA volume, verify-full, staging endpoint, no PGPASSWORD/PGPASSFILE/export approval, manual trigger, one replica, zero retries and unchanged execution history before each mutation or start. Require distinct owner approvals for mutation and actual connection; do not perform export under TLS consent. Recheck configuration/history immediately before the authorized operation. Use concurrency controls/ETag if documented and supported; otherwise coordinate exclusive operator access and fresh readback. Never start on ambiguous state.
6. **Recovery before mutation:** prepare checksum-verified writable rollback and a separate restoration plan including ambiguous/partial updates, interrupted shell, declined start and terminal run failure. An accepted update is not restoration proof. If start may have been accepted, reconcile history/state before any rollback or further start. Restore only approved known state, no blind overwrite of unrelated drift. Verify baseline (with exact documented omission only), provisioning Succeeded, no approval flags, expected history and no extra side effects. Do not declare safe pause while temporary approval remains enabled.
7. **Separate development from release gates.** Offline work on isolated branches/synthetic databases can proceed while recovery is blocked; no live migration, production deployment, real student onboarding or weakening of G1. Time-box infrastructure diagnosis; if no safe resolution, document exact blocker and switch to safe development after confirming rollback or explicitly recording unresolved operational state.

## Required future regression coverage

Before the next reusable operator mutation, implement/run synthetic tests in an isolated environment. This is a test specification, not executed evidence.

| Scenario | Expected |
| --- | --- |
| Exact match, provisioning Succeeded | accept |
| Only documented expected storage field omitted | accept |
| Storage value changed or unexpected field added | reject |
| Missing or changed CA/identity/image/env/CPU/memory/trigger/retry or export approval introduced | reject |
| Temporary readback mismatch then exact approved final state | pending until verified; never start during pending |
| Persistent mismatch, request timeout or unknown acceptance | stop and inspect; no automatic PATCH/start |
| Declined TLS start / failed terminal run / interrupted session | reconcile state and history; approved restoration required |
| Restored baseline with only allowed storage omission | accept only after safe mode/approval/history checks |
| Duplicate or unexpected execution history | reject; no retry |
| API/version changes or undocumented override volume behavior | block until separately reviewed |

## Verification and status

| Check | Evidence | Result |
| --- | --- | --- |
| Restore | owner final readback and history guard | Passed with narrow read-only omission |
| No extra execution / DB contact / export | owner safe verdicts | Reported none |
| Runtime TLS, console proof, actual storage, AGE custody, encrypted backup/restore, budget and PAT revocation | not established | Pending; G1 NO-GO |
| Reusable comparison/polling operator implementation and tests | documentation specification only | Not implemented or run |

## Next steps — exact handoff

1. **Next action:** pause Azure work at restored preflight checkpoint; audit application code/PRs and resume isolated development. Before the next Azure mutation, implement and run the guard test matrix, refresh live state and approval/budget prerequisites.
2. **Who may do it:** authorized operator for cloud changes; development agent for isolated code/test work.
3. **Expected evidence:** tested strict comparator, safe polling verdicts and scoped rollback procedure; separately approved TLS-only run, no export.
4. **Production impact:** none from this documentation task. G1 remains NO-GO.

## Links and files changed

- Operations branch only: `ops/backup-three-gates-evidence-2026-11-06`.
- Canonical prevention pointer: `AGENTS.md`; current checkpoint in `docs/agents/STATUS.md` and `docs/agents/NEXT_STEPS.md`.

## 20 Nov implementation checkpoint — offline guard

- Source-only `scripts/azure-job-readback-guard.js` added at 94eaf7eb7372232606ed2ad02897ad6fea754a98. 25 synthetic predicate checks passed in isolated JavaScript execution of the functions used to generate the file; committed Node CLI not yet executed. Distinguishes VERIFIED/PENDING/BLOCK, rejects unapproved drift, tests sole omission, provisioning states and execution history. This is only a predicate helper; no cloud API, patch/start/rollback orchestration, deadline/reconciliation integration or full regression matrix yet. Caller must independently verify exact ARM resource scope, baseline checksums, identity/RBAC and approval. Next run committed Node `--self-test`, then compare same-API live snapshot to immutable baseline. No writes/start until remaining operator safeguards and approvals.

## D07 Node guard verified; offline TLS state machine added

- Owner Cloud Shell exact committed Node guard: SYNTHETIC_PREDICATES_PASS=25, VERIFIED READONLY_STORAGE_OMISSION, EXECUTION_HISTORY_GUARD_PASS=YES. No Azure writes, new job execution, DB connection or export. Existing preflight baseline verified. Added source-only `scripts/azure-job-tls-operator-state.js` at 7e4b32c2c805da5cb1db2e76a1672aa35d1058cb; 13 mocked transition checks passed in isolated JS (success, separate approval decline, pending/timeout/drift, ambiguous patch/start, terminal failure, extra history, restoration). No actual Azure adapter, no clock-deadline or interruption-recovery implementation; committed Node CLI and combined guard integration not yet tested. Do not run live: next verify committed state machine self-test, then implement pinned protected adapter and resumable reconciliation, exact scope/IAM checks and bounded deadlines; budget/approval requirements remain. D07 partial, G1 NO-GO; no live mutation authorized by these tests.

## D07 Cloud Shell 38/38 and live adapter candidate

- Owner Cloud Shell confirmed committed state machine MOCKED_ORCHESTRATION_PASS=13, no Azure writes/start/DB contact/export. Combined prior Node guard 25 plus 13 mocked checks = 38/38; no real TLS proof. Added unexecuted adapter `scripts/azure-job-tls-operator.js` at 3a2ee08987f50d24ec8df833046874b652c50d92 with read-only plan/inspect, pinned API and operator-supplied subscription, exact secret-scope role verification, immutable baseline/template hash, per-command timeout and bounded polling, separate cost/patch/start approvals, local protected journal and no application-level retry. First intermediate commit contained subscription resource identifier; removed from current source (not a credential); historical Git objects retained. No Azure changes. Next fetch exact adapter, syntax/self-test and read-only plan; do not enter --run until plan reviewed and actual cost evidence within cap, independent scope/RBAC/owner approvals and remaining adapter validation satisfied. Journal is RAM-only, session loss requires manual readback/reconciliation; --inspect is read-only, no automated interrupted rollback. Transport-level retry behavior not proven, full adapter integration tests not run. G1 NO-GO.

## D07 live adapter read-only plan passed — 20 Nov 2026 IST

- Owner Cloud Shell ran exact adapter at 3a2ee08987f50d24ec8df833046874b652c50d92: syntax checks completed, SYNTHETIC_PREDICATES_PASS=25, MOCKED_ORCHESTRATION_PASS=13, EXACT_SCOPE_AND_SECRET_RBAC_PASS=YES, LIVE_BASELINE_AND_HISTORY_PASS=YES. NO_AZURE_WRITES=YES, NO_NEW_JOB_EXECUTION=YES, NO_DATABASE_CONNECTION=YES, NO_DATABASE_EXPORT=YES. This verifies the live read-only plan, not mutation/start/restore adapter integration or runtime TLS.
- Next obtain current-month actual/forecast Azure cost and remaining student credit evidence (including all CampusPool resources, billing currency, timestamp and latency caveat) against existing INR 500 monthly cap. Budget was deferred, never waived. Do not enter --run or type the budget approval until actual evidence and remaining operator prerequisites reviewed; no separate new configuration preparation needed. Microsoft references: https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-cost-mgt-data and https://learn.microsoft.com/en-us/azure/cost-management-billing/understand/plan-manage-costs. RAM journal/session-loss reconciliation manual; no application-level automatic retries, transport behavior not independently proven. Console marker, actual TLS, encrypted backup, independent restore, AGE custody and PAT revocation remain pending. D07 partial; G1 NO-GO. Application engineering continues independently.

## 2026-11-20 — Owner revised Azure budget and TLS billing prerequisite

- Owner made deployment/recovery the priority and revised Azure monthly budget from strict INR 500 to a flexible INR 500–800 (lower preferred). Operational interpretation: target <=500, ceiling 800 without further owner approval; no unnecessary services or unlimited spend. Actual/forecast spend and student credit not reviewed; explicitly defer detailed billing evidence for this one bounded staging TLS run, not blanket permission for future resource creation or export. Supersedes earlier strict 500 budget wording and cost-evidence prerequisite for this specific action; all security, recovery and production gates remain unchanged.
- Exact live read-only adapter plan previously passed, 38/38 synthetic tests. Adapter budget/exclusivity prompt only changed at cdc480d433b2a6919dbbc36bab458e4dbdac29a0 to ACK_800_INR_LIMIT_BILLING_REVIEW_DEFERRED_EXCLUSIVE_OPERATOR; does not falsely attest cost evidence. Next fetch exact commit, syntax and self-test, then one owner-authorized --run: separate patch+restore consent and TLS-start consent, zero export approval. No new deployments or resources; if any outcome uncertain, use --inspect and reconcile, never repeat automatically. Runtime adapter mutation/rollback remains unproven, transport retries not independently established, session-loss recovery manual, no console marker yet. D07 partial; G1 NO-GO.

## D07 pre-approval Azure request failure; sanitized diagnostic — 20 Nov 2026 IST

- Owner reran the approved budget-prompt candidate: 25/25 predicate and 13/13 mocked transition tests passed; run returned BLOCK AZURE_REQUEST_UNKNOWN_OR_FAILED before readiness verdicts or any approval prompt appeared. The source places all mutation/start paths after those prompts. No PATCH/start reached in that invocation; still verify live baseline/history and journal absence read-only. Exact failing call and cause unknown, not a database/TLS test failure. Do not rerun mutation mode blindly.
- Minimal fix/reuse: existing adapter helper now emits allowlisted request stage and failure category, not raw stderr, arguments, identifiers or secret material. Six classifier cases passed in isolated JS; committed syntax/Node and live diagnostics pending. Candidate df001ce5ced968afa626937e9657ff826f874025. No new dependency/service or security guard changes. Next fetch exact adapter and run --plan only; inspect the resulting sanitized category and reconcile before --run. Budget target <=500 INR, ceiling 800, detailed review deferred for this single TLS operation. Actual TLS, console marker, AGE custody and recovery remain pending; G1 NO-GO. No Azure writes by this agent.

## D07 diagnostic plan passed; prior attempt reconciled — 20 Nov 2026 IST

- Owner Cloud Shell ran diagnostic adapter df001ce5ced968afa626937e9657ff826f874025: PRIOR_ATTEMPT_JOURNAL_EXISTS=NO; EXACT_SCOPE_AND_SECRET_RBAC_PASS=YES; LIVE_BASELINE_AND_HISTORY_PASS=YES; no Azure writes, additional job execution, database connection or export. Prior failure occurred before consent/mutation, and current baseline/history is verified. Request failure did not recur; exact cause remains unknown, no assertion of a particular Azure outage or root cause.
- Next reuse exact local diagnostic adapter in --run with the same approved subscription and protected work directory, explicit ACK_800_INR_LIMIT_BILLING_REVIEW_DEFERRED_EXCLUSIVE_OPERATOR, APPLY_TLS_ONLY_AND_RESTORE and START_ONE_TLS_ONLY confirmations. No other Azure operator concurrently. Run performs fresh guards; no new configuration preparation, no new dependencies or code changes. If any outcome ambiguous, do not retry; inspect and reconcile. Actual TLS, live mutation/restore through adapter, console proof, AGE custody, PAT revocation and independent recovery pending; G1 NO-GO. Budget target <=500 INR, ceiling 800, current spending unverified per owner-approved one-run billing deferral.

## D07 first authorized TLS execution failed; live rollback passed — 20 Nov 2026 IST

- Owner explicitly approved revised budget/exclusivity, TLS PATCH+restoration and one TLS-only start using df001ce5ced968afa626937e9657ff826f874025. Exact scope/RBAC and initial baseline/history passed. Readback pending handled; execution campuspool-staging-backup-job-qvgqtq8 terminal Failed; PREFLIGHT_CONFIGURATION_RESTORED=YES, state RESTORED, NO_DATABASE_EXPORT_AUTHORIZED=YES. This proves first live adapter patch/start/terminal-failure rollback path per operator readback, not successful TLS. The failure stage, whether a DB connection occurred, and actual data-plane side effects remain unverified; export was not authorized. Two authorized job executions total expected: ziik3b8 Succeeded, qvgqtq8 Failed.
- Next bounded read-only diagnostic targeted to qvgqtq8: use --inspect to verify baseline/history, execution replica metadata and sanitized allowlisted worker failure codes from existing log stream or existing Log Analytics system/console tables. No raw logs, secrets, restart, new run, privilege changes, logging mutation, weakened TLS or export. If no console evidence, classify as observability-blocked and design smallest isolated diagnostic only after evidence review. Hardcoded one-prior-run guard and journal must not be bypassed; any subsequent TLS attempt requires explicit updated history/authorization and appropriate new journal after reconciliation. G1 NO-GO; actual TLS and recovery pending. Budget target <=500 INR, ceiling 800; current cost unverified.
