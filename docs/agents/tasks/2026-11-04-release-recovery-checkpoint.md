# Task: Four-step CampusPool release execution and recovery checkpoint

- **Task ID:** `2026-11-04-release-recovery-checkpoint`
- **Status:** partially completed — safe source integration and technical PR reviews done; actual backup/independent restore and staging deployment **blocked**
- **Agent / owner:** ChatGPT engineering agent for connected GitHub, Render metadata and read-only Supabase verification; trusted private infrastructure operator for sensitive backup/cold restore and rollback; independent reviewer for security/UX signoff
- **Last verified:** 2026-11-04 UTC
- **Baseline:** `main@056cd26b9e66324c7953065418de1ec765c6ebef` before this task; after PR #18 squash merge `main@3561bb54f38a3f5edce4cd17e24267733a196821`
- **Scope:** PR #18 integration, safe read-only staging metadata/permissions checks, technical reviews on PRs #11–14, readiness and rollback metadata audit, operator handoff. No database backup bytes, migrations, credentials, provider calls, live Render deploy, Flutter PR #17/#19 edits or real user data.
- **Dependencies:** [credential response](../../SECURITY_CREDENTIAL_ROTATION.md), [production release gate](../../PRODUCTION_RELEASE_GATE.md), [migration 008 recovery runbook](https://github.com/sohamsadegaonkar/mit-adt-campuspool/blob/security/transactional-idempotency-2026-11-03/STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md), PRs #11–14, #18.

## Goal and acceptance criteria

User explicitly authorized four tasks: (1) review and integrate tested PR #18; (2) create and independently restore protected staging backup; (3) review the security and mobility PR chain; (4) deploy exact reviewed code to isolated staging only after backup/restore, rollback and independent review safety gates. Do what connected tools support; **do not falsely assert the latter gates are satisfied or bypass real student data protections**.

## Current state (verified vs assumed)

- PR #18 contained **only** Node CLI config checker, synthetic unit/CI and docs, with no runtime server, secret write or deploy operation; tests 10/10 and all 6 PR workflows passed on head `860eb970`. Agent reviewed code for outbound/network calls and secret logging; **no independent human review** was given. Explicit owner authorization to integrate healthy changes was present.
- **Step 1 DONE:** PR #18 squash-merged as `main@3561bb54f38a3f5edce4cd17e24267733a196821`. Post-merge `main` Stage 1 PostgreSQL #41794863177, secret hygiene #41794863065 and agent docs #41794863241 **PASS**.
- Connected staging Supabase `tnitksrlntrdxbvznxzf`: **ACTIVE_HEALTHY**, PostgreSQL **17.11**. A read-only catalog query reported **9 application tables, all 9 RLS-enabled, no anon/authenticated direct table SELECT grants, all 9 have server app-role SELECT**, app role not superuser or BYPASSRLS; migration 007 is present and 008 absent. Security advisor returned **0 current lints**. Metadata/permissions checks are *not* backup or recovery proof.
- **Step 2 BLOCKED:** connected Supabase tools do not expose downloadable logical/physical backups or a safe independent encrypted cold-restore workflow. The working container has no private staging database URL/owner credentials or operator-approved encrypted/off-site mounts; do not request or expose them in chat. No separate restored PG17 project or backup checksum has been presented. Neither a success status nor empty tables proves recoverability.
- **Step 3 TECHNICAL REVIEW COMPLETE (not approval):** PR #11 (transactionally idempotent writes + migration 008), #12 (read-only distinct-restore compare), #13 (SHA-256 row-content digest), #14 (private matching UI) all previously passed their branch-specific CI and have review COMMENTS with specific blockers. PRs #11/#12/#14 are drafts and #13 is stacked on #12, which is stacked on #11. No independent human approval has been recorded. #14 30/30 synthetic browser cases passed, not a real physical-device/staging test.
- **Step 4 NOT EXECUTED:** Render staging service `srv-dbjof8fb9u1s73eks0bg` stays on previous successful deploy `dep-dbke9uo8v5cc738cpnd0`, SHA `cceadbf6251f70634320e50b8288530ba77513c3`, branch main auto-deploy **OFF**. The deployment API exposes status `live`, but **not whether the old build artifact remains eligible for Rollback**. Production `srv-dbh51h0473hc739ae7cg` remains marked live on `63ae551`; attempted `056cd26` rollout failed at `OTP_SECRET` validation, and the owner reported adding a new secret via Save only. No new Render deployment, production live secret value inspection or actual HTTP uptime test performed.

## Plan / work performed

1. Audit PR #18's code/CI, transition from draft to review-ready and squash-merge with `expected_head_sha`; confirm live main SHA and post-merge CI.
2. Inspect connected Supabase staging project/migration and RLS/role metadata **read-only**; research supported Supabase backup options and Render previous-artifact rollback requirements. Attempt to discover safe connector backup/restore actions; stop on capability and private operator proof blockers.
3. Inspect PR #11 idempotency receipt code and staging-only migration 008, #12/#13 backup integrity tools and #14 privacy/UI CI. Submit four COMMENT reviews, distinguish automated CI vs real provider/staging/mobile testing and independent human approval.
4. Recheck both Render live deploy statuses and current release gates. **Do not trigger staging** without verified actual encrypted off-site backup, independent cold restore and matching content integrity, retained rollback artifact and reviewed exact release commit.

## Progress log

- 2026-11-04 UTC — PR #18 merged into `main@3561bb5`; main postmerge CI all three workflows passed.
- 2026-11-04 UTC — Supabase read-only metadata reports PG17.11, 9/9 RLS, 0 direct anon/auth SELECT grants, 9/9 backend SELECT, migration 008 absent. No student records read.
- 2026-11-04 UTC — Repository backup scripts `scripts/staging-secure-backup.sh`, `scripts/staging-backup-guard.js`, `scripts/staging-restore-compare.js` are available on **unmerged review branches** (#11–13). Operator-only backup script enforces staging ref, encrypted temporary directory, off-site age encryption; even after execution it explicitly requires separate remote re-download and independent restore. No private credentials or mounted destination were available through current connectors, so it was **not executed**.
- 2026-11-04 UTC — Posted technical COMMENT reviews to PRs #11/#12/#13/#14 (not approvals). Reviewed the requirement for a consistent comparison snapshot: source changes after backup can create mismatches unrelated to restoration errors.
- 2026-11-04 UTC — Read back Render staging and production deploy lists; previous successful builds remain reported live but rollback-artifact eligibility is unknown. Explicitly **did not call Render trigger_deploy or Supabase mutation endpoints**.

## Verification

| Check | Evidence | Result |
|---|---|---|
| PR #18 synthetic/runtime/security CI | Head `860eb970`, preflight #41792817761; six jobs all green | PASS |
| PR #18 integration | PR #18 merged squash, main `3561bb5` | PASS |
| Main after merge | PG #41794863177; secrets #41794863065; docs #41794863241 | PASS |
| Staging PG version and schema/RLS | Supabase read-only metadata, project `tnitksrlntrdxbvznxzf` | PG17.11; 9/9 RLS; 0 public SELECT; migration 008 absent |
| Supabase advisor | Security lints array empty | PASS as lints-only |
| Encrypted off-site logical export and verified download | No available connector action, no operator artifact | **BLOCKED** |
| Independent PG17/PostGIS cold restore and source/restore fingerprint compare | No approved separate restore target/backup archive | **BLOCKED** |
| Render retained previous build artifact | Staging old deploy status = live; artifact availability not in connector | **NOT VERIFIED** |
| PR #11–14 independent human approval | Four technical comments; no independent approval | **PENDING** |
| Exact-commit authorized staging deployment | All above gates required, production still separately blocked | **NOT RUN** |

## Risks and decisions

- **Staging release is NO-GO** until the actual protected off-site backup, independent restore and retrievable previous Render build artifact are proven. Passing CI, 0 current security lints, 9/9 RLS, and owner Save only do not satisfy these requirements.
- Never use Supabase `restore_project` on the source staging database; it is a potentially destructive service state operation, **not** an independent cold restore into a separate target.
- Supabase paid plans can expose daily/physical backups but may incur charges to duplicate a project; do not create a billed project without operator cost approval.
- Rollback retains a code artifact when available, but may not rewind persistent data, and environment variables can change; a previous deploy record marked `live` or `deactivated` is not sufficient to guarantee rollback button availability.
- Existing staging Render branch `main` could deploy an unintended newer commit if an indiscriminate `trigger_deploy` call were made. Prepare an exact vetted SHA after PR dependency review instead.
- If an external operator runs the protected backup, keep raw SQL dumps and private URLs **only on trusted encrypted local/off-site storage**, never in ChatGPT, Notion, GitHub or CI artifacts.

## Next steps — exact handoff

1. **Owner/DB operator — required to unblock:** On a trusted encrypted machine, use the [PR #11 staging secure-backup runbook](https://github.com/sohamsadegaonkar/mit-adt-campuspool/blob/security/transactional-idempotency-2026-11-03/STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md) with privately configured `STAGING_DB_URL`, AGE recipient, encrypted workspace and off-site mount. Validate `--preflight`, run the approved protected export, re-download remote ciphertext and independently confirm checksum, then restore into a different trusted PG17/PostGIS environment and compare schema/roles/grants/table fingerprints. Report **only status, timestamp and test verdict**, no connection URLs, credentials, backups or row hashes.
2. **Render staging operator:** Open [staging Deploys](https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg) and verify the `Rollback` action is **currently available** for `dep-dbke9uo8v5cc738cpnd0` (`cceadbf`), and retain a rollback/recovery procedure. API status alone cannot confirm artifact retention.
3. **Independent reviewer:** review PRs #11→#12→#13 in dependency order, then PR #14, resolving real migration/UX/security concerns; obtain independent approval and exact final integration SHA. Provider OTP delivery and real phone browser checks still need separately authorized test accounts.
4. **Only after 1–3 prove GO:** Deploy exact reviewed commit **to staging only**, preserving auto-deploy OFF, recording deployed SHA/time and health/auth/CSRF/OTP/booking/mobility/rollback evidence. Do not run migration 008 absent protected recovery proof. Production remains independently NO-GO.
5. **No secret exposure:** If a command or connector cannot complete a private operator step without disclosing credentials/records in chat or CI, stop and document the blocker; never improvise.

## Links and files changed

- Merged PR: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/18
- Reviewed-but-unmerged PRs: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pulls
- Staging service: https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg
- Repo branch: `docs/release-recovery-checkpoint-2026-11-04` (documentation-only)
- Files: this task, `docs/agents/STATUS.md`, `docs/agents/NEXT_STEPS.md`. No application/runtime changes.
