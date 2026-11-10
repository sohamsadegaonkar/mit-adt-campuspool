
## 2026-11-10 — GHCR single-secret UAI IAM preflight PASS; scoped grant operator prepared

- Owner's **live Azure Cloud Shell read-only** `python3 scripts/azure-ghcr-secret-scope-rbac-plan.py --plan` output: `AZURE_STUDENT_VAULT_RBAC_VERIFIED=YES`, `GHCR_PULL_TOKEN_ARM_METADATA_PRESENT=YES`, `GHCR_SECRET_VALUE_NOT_READ_OR_PRINTED=YES`, `GHCR_MANAGED_IDENTITY_VERIFIED=YES`, `EXISTING_UAI_SCOPE_ROLE_ASSIGNMENTS_FOUND=0`, `PROPOSED_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY`, `PROPOSED_ROLE=KEY_VAULT_SECRETS_USER`, `GHCR_SECRET_SCOPE_RBAC_PLAN_COMPLETE=YES`, `GROUP_PIM_DENY_AND_EFFECTIVE_PERMISSIONS_NOT_PROVEN=YES`, `AZURE_ROLE_GRANTS_OR_SECRET_VALUES_CHANGED=NO`. **No UAI role granted yet.** Human one-shot Vault Secrets Officer was independently confirmed revoked in earlier owner output.
- [Scoped operator helper](../scripts/azure-ghcr-secret-scope-rbac-operator.py) and [offline mock tests](../test_azure_ghcr_secret_scope_rbac_operator.py) added to draft PR #44. `--plan` read-only, `--grant` requires typed `GRANT_GHCR_TOKEN_SECRET_ONLY_TO_CAMPUSPOOL_UAI`; targets **only** `ghcr-pull-token` with `Key Vault Secrets User` (`4633458b-17de-408a-b874-0445c86b69e6`) for `campuspool-ghcr-vault-reader`, checks exact ARM readback. `--verify` is read-only independent role check; `--revoke` requires separate typed confirmation and removes only deterministic helper-owned assignment. Refuses unexpected existing broader UAI roles. No DB password, no Vault-wide grants, no secret reads/writes, no job start. [Runbook](../docs/ops/AZURE_GHCR_SECRET_SCOPE_READER_GRANT_2026-11-10.md).
- **Next owner command:** `cd ~/campuspool-vault-setup && git pull --ff-only && python3 scripts/azure-ghcr-secret-scope-rbac-operator.py --plan`; only after explicit review/consent `python3 scripts/azure-ghcr-secret-scope-rbac-operator.py --grant` then independent `--verify`. If ARM PUT response or readback STOPs, investigate `--verify` privately; do **not** rerun/widen role blindly. No actual GHCR pull proof, staging root CA, independent DB password role, no-delete Blob writer, manual job, genuine encrypted backup or independent PG17 restore yet. $500/₹500 cost gate deferred.


## LATEST Nov 10: GHCR Key Vault import PASS, human role revoked, next UAI single-secret read-only PLAN

Owner **live Azure** success: `GHCR_PULL_TOKEN_IMPORTED_TO_KEY_VAULT=YES`, `GHCR_TOKEN_SCOPE_NOT_INDEPENDENTLY_VERIFIED=YES`, `TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES`, `ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES`. GHCR token now stored under `ghcr-pull-token` in `campuspool-backup-kv-01`, and temporary human Secrets Officer exact-Vault IAM grant removed. No user-assigned identity reader role, staging CA/PG password, Blob writer, backup Job or offsite recovery proof yet.

**NEXT OWNER AZURE CLOUD SHELL IS READ-ONLY:** `cd ~/campuspool-vault-setup && git pull --ff-only && python3 scripts/azure-ghcr-secret-scope-rbac-plan.py --plan`. The new script checks exact ARM token **metadata only, never a secret value**, `campuspool-ghcr-vault-reader` principal and inherited role inventory. [Security runbook](../ops/AZURE_GHCR_SECRET_SCOPE_RBAC_PLAN_2026-11-10.md). Only after a successful plan and explicit scoped permission review may prepare `Key Vault Secrets User` access at **the GHCR token secret scope only**. Neither Vault-wide secret read nor DB password read allowed for UAI.

**Source-level zlib provenance CI gate now PASS:** Alpine stable updated zlib to `1.4-r0` and deleted old patch; pinned 1.4 upstream fixed source SHA evidence validated without waiver. Still no full independent release acceptance, worker deployment, staging AGE encrypted backup or PG17/PostGIS cold restore; budget ₹500/month evidence remains owner-deferred.


## November 10 2026 — first live GHCR secret import blocked; writer cleanup verified

- User ran `python3 scripts/azure-vault-ghcr-token-one-shot-import.py --run-once` in real Azure Cloud Shell after explicitly authorizing the temporary Vault-only role and entering a hidden classic GHCR `read:packages` token. Observed `VAULT_SCOPE_AND_OPERATOR_VERIFIED=YES`, `TEMP_WRITER_INITIAL_STATUS=ABSENT`, `TEMP_VAULT_WRITER_GRANT_ACCEPTED=YES`, **`TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES`**, then `STOP_VAULT_ACCESS_DENIED_OR_PROPAGATION`. Failure happened during Key Vault **metadata GET before any secret PUT**, so the token **was NOT imported**. The temporary operator assignment is confirmed removed via ARM readback. No token value was transmitted to chat. Treat the unused GitHub PAT as subject to revocation unless a securely stored controlled retry is intended.
- Microsoft Key Vault guidance documents role propagation 1–5 min and immediate 403 after assignment; actual cause not proven (firewall may also return 403). Updated importer to **retry only metadata GET for explicit `ForbiddenByRbac`**, bounded 16 attempts / 20 sec gaps; distinguish `ForbiddenByFirewall` and unclassified 403 with immediate stop, never print raw errors, never retry secret PUT, always attempt exact temporary role cleanup (except hard process failure). Offline mock CI now covers RBAC retry success, timeout, firewall denial and exact cleanup. [Runbook](../ops/AZURE_GHCR_ONE_SHOT_SECRET_IMPORT_2026-11-10.md). **Corrected importer has not yet been run in live Azure.**
- **Next owner action:** after `git pull --ff-only`, rerun standalone `python3 scripts/azure-vault-temporary-operator-secrets-officer.py --plan` and confirm `TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=NO`; only after consciously accepting temporary role and creating/reusing secure classic `read:packages` PAT run updated one-shot import with typed approval. On any STOP immediately check `--plan`/`--revoke`; verify `GHCR_PULL_TOKEN_IMPORTED_TO_KEY_VAULT=YES` and `TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES` before other work. Worker release `zlib-source-provenance` gate still failed, production export/backup/restore blocked.


## CURRENT Nov 10: owner Vault-only role PLAN passed; GHCR PAT one-shot protected import

Owner's Azure Cloud Shell read-only `python3 scripts/azure-vault-temporary-operator-secrets-officer.py --plan` returned `ROLE_PLAN_COMPLETE=YES`, `TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=NO`, `OWNER_ACTION=PLAN_ONLY_NO_AZURE_WRITES`. Live Vault, UAI, backup Blob container, read-only IAM and ARM operator permission checks were previously green. **No Vault Secrets Officer, GHCR token, UAI secret-read role, job, backup or restore has been created from this plan.**

New guarded **one-shot** human GHCR private image pull token import prepared (source/CI only): `scripts/azure-vault-ghcr-token-one-shot-import.py`, [runbook](../ops/AZURE_GHCR_ONE_SHOT_SECRET_IMPORT_2026-11-10.md). When consciously accepted by owner, it obtains hidden new GitHub classic `read:packages` token in Cloud Shell, grants Vault-only human Secrets Officer, uploads `ghcr-pull-token` via TLS to Key Vault REST without token shell arguments/env/files/logs, then immediately attempts to revoke helper-owned role and verify absence. Not automatically expiring or hard-crash-proof. **Next owner command after `git pull --ff-only`:** `python3 scripts/azure-vault-ghcr-token-one-shot-import.py --run-once`; typed phrase `IMPORT_GHCR_TOKEN_AND_REVOKE_VAULT_WRITER` and hidden token required. Never paste token in chat. If role revoke not verified run separate `--plan` then `--revoke`; do NOT proceed until confirmed absent.

After verified import, grant GHCR reader UAI `Key Vault Secrets User` at individual GHCR token and staging root CA scopes only (CA not imported), separate job identity for PG password, no-delete Blob container writer, manual-only worker, genuine AGE encrypted staging backup and independent cold PG17/PostGIS restore. Budget ₹500 actual billing unverified/deferred, no production OTP rollout.


## LATEST: Operator ARM REST PASS; Vault secret-import admin plan ONLY

2026-11-07 owner-run `az rest` operator Vault RBAC audit passed with **one direct assignment** and `DIRECT_ROLE_ASSIGNMENT_ADMIN_CANDIDATE=YES`, `DIRECT_SECRET_WRITER_CANDIDATE=NO_OR_UNKNOWN`; these are potential authorizations, **not** verified effective rights (group/PIM/deny/custom unknown). No Azure writes, secret reads, roles or backup jobs were created. Prior CLI errors were from unsupported `--assignee-object-id` on `az role assignment list`, resolved by ARM REST GET.

**Next owner Cloud Shell action is read-only only:** `cd ~/campuspool-vault-setup && git pull --ff-only && python3 scripts/azure-vault-temporary-operator-secrets-officer.py --plan`. [Security runbook](../ops/AZURE_VAULT_TEMP_OPERATOR_WRITER_2026-11-07.md). The optional reviewed `--grant` creates one **Vault-only Key Vault Secrets Officer** assignment for the current operator with explicit typed confirmation and no automatic expiry; `--revoke` deletes only that exact assignment and verifies absence. **No grant performed yet.** Must explain all-Vault secret read/update/delete power until revoked, and require explicit owner acceptance before grant or GHCR token generation. No secret-ingestion path approved yet. Do not turn on job or export.


## CURRENT NEXT STEP — Nov 7 Azure operator IAM via ARM REST

Owner verified live Key Vault `campuspool-backup-kv-01` + user-assigned identity `campuspool-ghcr-vault-reader` creation in Azure for Students, Malaysia West, and passed the Vault/Blob read-only audit (backup container exists, UAI has 0 reported role assignments, no Container Apps Job). Private GHCR image `ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2` was **published Private and keyless signed/verified**; short-lived write PAT owner reported deleted. Earlier outdated blocks below describe PREVIOUS checkpoint and do not supersede this one.

Owner operator permissions query failed three times because `az role assignment list` was supplied unsupported `--assignee-object-id` (documented for CREATE only). New **read-only** Azure ARM role scope API query with mocked CI tests is now at `scripts/azure-vault-operator-arm-readonly.py`, accessed via original Bash wrapper.

**Next owner Cloud Shell action:** `cd ~/campuspool-vault-setup && git pull --ff-only && bash ops/cloud-backup/azure-vault-operator-role-readonly.sh`. Share only sanitized counts/candidate status. If ARM reports lack of `Microsoft.Authorization/roleAssignments/read`, inspect Access control (IAM) in Azure Portal privately and obtain appropriately scoped authorization through normal admin review—**no broad privilege grant to work around a diagnostic**.

Then review exact secret-scoped GHCR + CA access (reader UAI), operator temporary writer, separate future job system identity for staging DB password, container-specific Blob read/add/write without delete, protected source credential ingestion and root CA/tmpfs runtime before manual-only job and separately approved genuine AGE backup/independent PG17/PostGIS restore. ₹500 monthly spend verification was owner-deferred, not waived or passed. No recurring job, staging export, restore or production OTP rollout is live.

# CampusPool — prioritized next steps and ownership

**Last prioritized:** 2026-11-03 UTC. **Baseline:** `main@0345b6aeff86`. Items are an actionable backlog, **not authorizations** to alter Render production, student data, SMS/email accounts or payment systems.

| Priority | Work item | Current state | Next concrete action | Acceptance / evidence | Owner |
|---|---|---|---|---|---|
| P0 | Close historical credential incident | Unverified account-side revocation | Account owner confirms revoked Gmail App Password, regenerated OTP secret and private Render replacement; review access logs | Dated verification, no raw secrets in Git/logs, controlled provider test | Account owner |
| P0 | Genuine provider OTP verification in staging | Adapter and CI mock tests exist | Configure verified Resend sender/domain and approved MSG91/DLT Flow in isolated staging, then test controlled end-to-end signup/login | Actual inbox/handset receipt, expiry/replay/resend and provider failure checks | Unassigned |
| P0 | Durable production Rides plan | PostgreSQL Rides implementation exists behind flag; production on SQLite | Inventory existing data; design consistent backup/export, UUID reconciliation, staging import and cold restore | Recorded counts/hashes, ownership continuity, proven forward+rollback | Unassigned |
| P0 | Security and release QA | Automated backend tests green | Execute browser/phone E2E on a reviewed staging deploy with test users and adverse concurrency cases | Test report with exact deployed SHA and resolved high-severity defects | Unassigned |
| P1 | Hyperlocal travel-intent frontend | Private PostGIS matching API exists; no integrated UI | Add authenticated travel-intent form, privacy-safe candidate cards and booking handoff behind flag | UI/mobile/E2E tests, no raw student coordinates or contacts leaked | Unassigned |
| P1 | Realistic route-aware matching | Geometric straight-line proximity only | Evaluate road-routing provider, cost caps, route detour bounds and fallbacks | Costed design + test comparing sample ground-truth routes | Unassigned |
| P1 | Mobility load and fraud benchmark | Independent PR #15 measured 128/128 synthetic PostGIS matches and 30/35 enforced shared rate limits; no real staging benchmark | Independently review #41710272878 (p95 297.87ms, queue peak 104, no sampled DB locks), then design representative sustained HTTP/staging-safe workload with restoration gates | Aggregate-only report in GitHub Actions, code SHA, decision memo; no Redis/H3 based on synthetic CI alone | Engineering agent / reviewer |
| P2 | Errands backend | Standalone sample UI only | Specify request/runner/assignment state machine, roles, PIN handover, notifications and abuse model | Reviewed domain design + server-side integration tests with mock payments | Unassigned |
| P2 | Payment partner readiness | Unverified payment settlement disabled | Review eligible regulated payout provider and settlement/refund flows, not a homegrown escrow | Provider eligibility, signed webhook tests, ledger/reconciliation and approval | Unassigned |
| Conditional | Redis, H3, background queue or microservices | **Deferred**; no performance justification recorded yet | Revisit on evidence: slow spatial query, hot shared limits, reliable notification demand, or independent scaling | ADR with benchmarks, cost, added operational risks, rollback | Unassigned |

## Sequencing rules

- **Security and durable data first;** do not treat GitHub merge as production approval.
- Build the Hyperlocal matching UI and road-route verification on isolated staging before exposing it to students.
- Add a PostgreSQL transactional outbox/background worker before a high-volume external queue if reliability requirements demand asynchronous work.
- **Do not add Redis, H3, Kafka or microservices merely because they are well-known system-design tools.** First measure the real bottleneck and capture an accepted decision in `DECISIONS.md`.

## For the next agent

1. Inspect GitHub HEAD, new PRs, CI and exact staging deployment commit; do not trust this timestamp as real-time.
2. Choose a specific unassigned item, create `docs/agents/tasks/YYYY-MM-DD-<slug>.md`, record an explicit scope and owner, and coordinate changes with active PRs.
3. Update progress in the task file and keep these priorities aligned with verified reality on each implementation PR.
4. If no credentials, authority, safe environment or rollback evidence exist, mark the task blocked instead of improvising a production action.

## Latest completed documentation task

See [2026-11-03-agent-workflow.md](tasks/2026-11-03-agent-workflow.md) for the multi-agent continuity-policy bootstrap and its verification/handoff.

## P1 performance measurement, isolated from blocked staging — 2026-11-04 UTC

- [128-student mobility/PostGIS concurrency benchmark](tasks/2026-11-04-mobility-load-benchmark.md) is implemented **only** on `perf/mobility-load-baseline-2026-11-04` based on main. It creates 512 deterministic synthetic rides and 128 unique active intents; bursts 128 actual `PgMobilityStore.findCandidates` calls, checks result privacy/counts, and races 35 shared rate-bucket increments to verify the 30/hour account ceiling under contention.
- **Next engineering action:** verified run #41710272878 passed on `da7063a`: 128/128 successful, 512 synthetic rides, p50/p95/p99 **229.11/297.87/300.88ms**, ~**424/s** burst, pool wait queue104/24 connections, no sampled DB lock waits, dropoff GiST index selected, 30 allowed/5 denied on concurrent rate increments. Independently review report and construct a sustained, representative HTTP + DB workload before changing indexes or adopting Redis/H3. Do not deploy, merge, add Redis/H3, touch protected staging databases or enable live matching.
- **Independently blocked release:** draft PR #14's UI approval, staging backup/restore/cold recovery and Render rollback, historical credentials and OTP delivery remain separate P0 gates.

## Most recent user-requested merge/Render deployment audit — 2026-11-03 UTC

- **Merged and verified:** independent performance PR #15 is now merged into `main@a76eaca`, not deployed; `main` PostgreSQL, credential-hygiene and docs workflows passed. [Release audit and step-by-step gates](tasks/2026-11-04-release-merge-audit.md).
- **Still open:** PR #11 transactional idempotency includes migration 008, with dependent PR #12 read-only restore comparison and PR #13 data-integrity digests; all require dependency-order independent review and owner-operated *actual* encrypted staging backup, independent off-site re-download/checksum/decrypt/PG17 restore, comparison and retained Render rollback proof. PR #14 has 30/30 synthetic browser E2E green but awaits independent reviewer/privacy/physical-device acceptance. None were merged in this audit.
- **STOP on Render deploy:** both production and staging auto-deploy are OFF; live SHAs `63ae551` and `cceadbf` respectively. Connected staging DB lists migrations 001–007 (no 008) and is healthy; this is not a backup. Historical credential revocation and genuine email/SMS delivery still need account owner verification. Neither `trigger_deploy` (which deploys configured main) nor staging migration may run without the recovery proof and a **separate, explicit GO**. Do not infer that this user's request to deploy waives data protection and rollback.
- **Next exact responsible actions:** owner privately proves secure off-site stage export and independently restored scratch + Render retained rollback artifact; independent reviewer approves PR #11–#14 scope; operator reviews candidate SHA, then performs a controlled staging-only test release after prerequisites. Production remains separately blocked by legacy SQLite durability, revoked secret verification, true OTP delivery and business safety acceptance. See [release audit task](tasks/2026-11-04-release-merge-audit.md).

## Next engineering work — runtime config preflight after Render OTP_SECRET startup failure (2026-11-04)

- [Private, read-only startup config preflight](tasks/2026-11-04-runtime-env-preflight.md) is implemented/tested (CI) in draft PR #18 on `chore/runtime-env-preflight-2026-11-04`, independent from draft PRs #11–14 and #17. Its `production` mode matches the **legacy SQLite** application actually configured on Render, instead of incorrectly reusing the PostgreSQL-only production release gate; `staging` checks separate Postgres/TLS/CA/Resend/Basic Auth settings. Tests are **synthetic only**, don't access Render, and may report only safe check codes.
- **Next exact action:** runtime config job #41792580706 **PASS (10/10)** and all five other workflows passed on code SHA `33df5499`. Obtain independent review of PR #18; then verify real Render variables privately using the dashboard, separately confirm staging/production backup and rollback, and check genuine OTP provider delivery before any deployment. A passing runtime config check is **not** proof of old exposed App Password revocation, OTP inbox/handset receipt, live database backup/restore, PostgreSQL Rides durability or authorized deployment.
- **Owner/operator work still separately required:** verify current Render secret settings without exposing values; produce backup/restore/rollback proof and real provider checks before deliberately deploying to staging, then production only after its distinct gates. Both Render services have auto-deploy OFF.

## Latest four-step release execution checkpoint — 2026-11-04 UTC

- **DONE:** PR #18 reviewed at implementation level and squash-merged, `main@3561bb5` with three green post-merge workflows. Read-only staging PG17.11/RLS/role metadata, migration list and zero security-advisor lints verified. Technical COMMENT reviews posted to PRs #11–14, with explicit branch-dependency and privacy/restore gates; no independent approval.
- **BLOCKED — highest priority: protect real staging data.** Current connected tools cannot perform a real encrypted off-site `pg_dump` plus separately downloaded and verified archive/cold restore. The restricted backup utility/runbook exists on the **unmerged PR #11 branch**. A trusted operator must run it with private staging credentials, approved encrypted work volume, off-site AGE recipient and distinct scratch PG17/PostGIS recovery target. Record only export/checksum/restore/comparison verdicts without publishing data or credentials.
- **BLOCKED — release rollback:** Render staging deploy `dep-dbke9uo8v5cc738cpnd0` at `cceadbf` is still marked live, but a dashboard `Rollback` action's availability must be verified on [staging service](https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg). A deploy history row is not proof that an old build artifact can still be used.
- **NEXT once recovered:** independently review and integrate PR #11→#12→#13 in correct order and PR #14 after security/UX acceptance; choose an exact reviewed staging commit; run controlled staging migration 008 only after complete independent backup and restore with safe rollback; deploy staging and verify OTP, booking, idempotency, privacy and physical mobile flows. **No production promotion** without a separate data/credential/provider release GO.
- **Authoritative task:** [2026-11-04-release-recovery-checkpoint.md](tasks/2026-11-04-release-recovery-checkpoint.md). Another agent should not deploy current `main` through generic Render `trigger_deploy` in place of a reviewed feature SHA, or treat synthetic tests as staging acceptance.

## 2026-11-05 — Verified Render production release blocker (read-only audit)

- Production remains live on previous release `63ae551`; attempted `056cd26` update on 2026-11-03 returned **`update_failed`** because production startup's `server.js:72` rejected missing/weak/exposed `OTP_SECRET`. Keep this guard intact; the owner must configure a fresh high-entropy 32+ character secret through Render's protected UI, never Git/chat. This is **necessary but not sufficient** for release.
- Current GitHub `main` is ahead of live deployment, both Render CampusPool services have auto deploy OFF, staging retains known `cceadbf`. No new deployment initiated.
- Review data persistence (production logs mention SQLite/JSON startup), protect staged migration and rollback. **Still NO-GO** pending actual off-site encrypted cloud staging backup, separate PG17/PostGIS cold restore, user/role/RLS/data comparison and Render rollback evidence.
- See [production readiness task](tasks/2026-11-05-render-production-readiness.md); cloud backup worker PR #28 and stdout fix PR #27 are separate drafts.

## Consolidation note — 2026-11-05

The sections below preserve unique engineering evidence from the reviewed security/cloud-recovery branch. They are **historical checkpoints**, not new deployment approvals. The current release remains NO-GO until encrypted cloud backup and independent restore, credentials, privacy and rollback are verified. No Render deployment or migration was triggered by repository integration.

## Active agent handoff

- [Transactional request idempotency](tasks/2026-11-03-transactional-idempotency.md): draft PR #11 has green GitHub CI at `a2e231b`; bounded throttled replay passed CI at `3c050be`; next independently review permissions/browser retry lifecycle and migration/rollout, then complete separately authorized staging QA before treating as deployed. No live migration authorized.

## Current blocking handoff — staging release gate (2026-11-03 UTC)

- **P0 / blocked:** [Staging permissions, browser retry and rollback task](tasks/2026-11-03-staging-permissions-browser-retry.md). Browser fix and restricted-role tests are CI-green at `282df2c`; live staging retains migrations 001–007 only, no idempotency 008.
- **Exact next action:** account owner verifies encrypted off-site staging dump and restores it to an independent disposable PostgreSQL/PostGIS target; confirms intended Render workspace/service, current staging branch, known-good deploy SHA and executable rollback path. Do not request secrets in Git or chat.
- **Next engineering action after gates pass:** re-audit grants, apply 008 in **staging only**, verify roles/RLS and deploy exact CI-tested branch SHA with both browser and backend. Run synthetic-account E2E and rehearse returning to prior SHA. **No live migration or deploy authorized by this note.**
- Read [staging idempotency release runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md). Production remains NO-GO.

## Next engineering handoff — staging migration preflight (2026-11-03)

- [Read-only migration 008 preflight](tasks/2026-11-03-staging-migration-preflight.md): isolated GitHub CI passed at `4d66aa0` (PostGIS #41595567003, security #41595567015). Review the exact-project guard and run `APP_ENV=staging OTP_DB_SSL=true npm run check:staging-migration -- --mode=before` **only** with a private stage-only `OTP_DATABASE_URL` on the authorized operator machine.
- Before any live SQL: obtain encrypted off-site backup, independent restore proof, verified Render workspace and re-deployable known-good SHA. The preflight itself deliberately reports `releaseReady:false`; passing schema inspection never waives release gates.

## Release-gate blocker — 2026-11-03

- [Actual staging backup and rollback evidence](tasks/2026-11-03-staging-backup-restore-gates.md): Render candidate `My Workspace` awaits owner confirmation; last deployed stage SHA not verified. Supabase stage remains 001–007 with no 008.
- Verify a **real encrypted off-site staging database dump + scratch restore**, not just the synthetic CI backup/restore rehearsal; ensure schema/roles/data and migration history are restored correctly. After this and Render rollback artifact validation, consider stage-only migration 008 with reviewed tool and manual deployment to exact vetted SHA. NO-GO otherwise.

## Latest verified synthetic restore CI — 2026-11-03

- Draft PR #11 `f59eb8b` passed PostGIS #41597004644, security #41597004543, docs #41597004472 and credential #41597004588. The disposable PG16 synthetic backup + encrypted checksum + logical restore drill passed. It **does not substitute for a real encrypted off-site staging backup and scratch restore of the actual staging dataset**.
- Next: owner confirms Render workspace `My Workspace`, then verify actual staging service/last-good deploy SHA. Owner securely exports and encrypts staging roles/schema/data, restores to an independent scratch target and records verification evidence. Only then can the authorized migration 008 and rollback rehearsal proceed.

## Render target verified — next unblock (2026-11-03 UTC)

- **Completed:** User confirmed `My Workspace`; staging service `srv-dbjof8fb9u1s73eks0bg` branch `main`/auto-deploy off. Current live rollback baseline `cceadbf6251f`, Render deploy `dep-dbke9uo8v5cc738cpnd0`; historical successful `fe93c6be16b4`, deploy `dep-dbkdr5qjnfac738p2heg`. Build-retention/rollback dashboard button still needs a read-only eligibility check.
- **Unblocked action owner must perform next:** encrypted off-site export of real `campuspool-staging-db` PostgreSQL 17 roles/schema/data + migration history, verification of ciphertext digest, independent compatible scratch restore and RLS/grant/count comparisons. Keep all credentials and archive content out of Git/CI/chat. Until complete, **DO NOT** migrate 008, deploy PR #11, or rehearse live rollback.
- On proof of successful restore and approved stage release, use Render Dashboard *Deploy a specific commit* for the reviewed PR SHA (not default `trigger_deploy` on `main`); preserve the original `cceadbf6251f` build as rollback target. Confirm that Rollback is eligible in Dashboard. See [task](tasks/2026-11-03-staging-backup-restore-gates.md).

## Operator execution handoff — 2026-11-03 UTC

The actual PG17 backup/restore steps remain impossible to execute through the available read-only project metadata connections. The owner must use a trusted local encrypted machine with private stage-only DB owner credentials, age recipient, approved off-site storage and distinct PG17/PostGIS scratch restore target; see the detailed command sequence and queries in [runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md). Current `cceadbf6251f` Render deploy is confirmed `live` but artifact rollback eligibility cannot be verified by Render MCP; check the staging Events dashboard before release. **Staging migration/deploy and rollback remain NO-GO.**

## Next concrete action — local-operator staging backup (2026-11-03)

- The unmerged PR #11 adds `npm run check:staging-backup` (safe local preflight) and `npm run backup:staging-operator` (explicit private-stage export). [Task and conditions](tasks/2026-11-03-secure-backup-operator-tool.md). Isolated CI passed at `3f723d1`; account owner next runs these on an encrypted trusted workstation with a separately confirmed encrypted off-site mount and stage-only private connection string. **Never** run with live credentials from GitHub Actions/Render/chat.
- After encrypted archive creation, independently download its off-site copy and check SHA-256; restore to a different approved Supabase-compatible PostgreSQL 17/PostGIS project and compare data/roles/indexes/RLS/policies/permissions. Until that evidence and Render build-artifact eligibility exist, live migration 008 and staged deployment remain blocked.

## Next unmerged engineering handoff — independent staging restore comparison (2026-11-03 UTC)

- [Operator-only read-only restore comparison](tasks/2026-11-03-staging-restore-compare.md) developed on child branch security/staging-restore-compare-2026-11-03, based on idempotency PR #11. Security smoke #41626504817 and disposable PostgreSQL/PostGIS integration #41626505003 passed at code head a0962f2; no real staging restore was executed.
- **Next operator action after verified private backup:** restore independently to a different approved Supabase-compatible PG17/PostGIS scratch project, verify the ciphertext via separate remote download, and privately set APP_ENV=staging, RESTORE_TARGET_CONFIRMED=YES, RESTORE_PROJECT_REF and both DB URLs. Run the comparison preflight followed by read-only comparison per the runbook. Never supply the credentials to chat, GitHub or CI.
- **Required additional evidence:** full restore operation success, migration history, role credentials, provider-managed objects, independent data checks and Render retained artifact eligibility. A matching metadata/row-count comparison is necessary but **insufficient** for release. Do not apply 008 or deploy until authorized.

## Engineering handoff — row-content integrity in independently restored staging (2026-11-03 UTC)

- [Bounded SHA-256 restored-row verification](tasks/2026-11-03-staging-content-integrity.md) developed on child branch security/staging-restore-content-digests-2026-11-03 targeting draft PR #12 (which targets PR #11), not main. The staged recovery verifier now checks that **record contents** match, not just counts, while keeping all derived digests private.
- **Immediate engineering action:** CI passed on eb9200f8 (security #41627772559, PostGIS #41627772557 including equal-count row mutation). Next independently review fingerprint serialization/collation, the 25,000-row cap and documentation contract, then fold reviewed changes into PR #12. The operator's real encrypted off-site backup/restore and Render rollback proof remain separately blocked; **NO** application migration 008 or live deploy is authorized.

## Next exact review gate — fail-closed recovery evidence (2026-11-03 UTC)

- Current draft PR #13 contains a fail-closed fix for both sides omitting required evidence or migration history. Fresh CI for hardened code commit `6384a55` PASSED (security smoke #41629693100; disposable PostgreSQL/PostGIS #41629693149). **Next engineering action:** PR #13 was marked Ready for review after an engineering COMMENT review (review ID 5751792917); obtain a separate human reviewer approval of query behavior, time bounds, strict ledger requirement and security claims before integrating PR #13 into PR #12. No merge has occurred.
- Real-staging operator gates remain unchanged: off-site encrypted archive verified by independent download, a compatible separate scratch restore, role/security/data evidence and retained Render rollback artifact availability. Do not run a live migration 008, deploy staging or production, or merge the release branch merely because the tests pass.

## Actual independent staging backup/restore start — 2026-11-04 UTC

- **Source metadata check complete** at 08:15 UTC: exact PG17 staging, 9/9 RLS, restricted backend role, 001–007 installed, 008 absent. No source data rows read. A separate recovery database and protected off-site archive have **not** been created.
- **Next local operator action:** [current recovery execution task](tasks/2026-11-04-independent-staging-recovery-start.md) and [runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md) define Ubuntu-D preflight with private `STAGING_DB_URL`, encrypted scratch/off-site directory, AGE public recipient and strict project allowlist. Use updated **five-part** backup after CI and independently verified write-quiescence. No raw SQL/URL/keys in ChatGPT/GitHub.
- **After live export:** re-download encrypted bytes independently, verify SHA256, decrypt inside a trusted encrypted volume, provision approved separate PG17/PostGIS target, restore ALL five components including `supabase_migrations` and compare source/target catalog, permissions, counts and bounded content digests. Operator must independently verify Render rollback artifact and record only PASS/BLOCKED proof. **Do not deploy/migrate 008** without all hard gates.

## Azure private Blob backup next gate — 2026-11-04 UTC

- Owner reported Azure for Students storage account `011campuspoolbackup` created in Malaysia West. Owner has now confirmed `campuspool-staging-backups` container created. **Next action:** verify container **Private** access and assign the operator **Storage Blob Data Contributor at container scope** via Azure IAM (without sharing access keys); then use Ubuntu-D Azure CLI Entra authentication cached under encrypted-in-RAM `/dev/shm`, `az storage container show --auth-mode login` read-only, and only then test encrypted synthetic upload. Confirm RBAC, encryption, network scope and any cost warning; don't paste access keys, tokens or student data into GitHub/chat.
- [Azure Blob operator runbook](../ops/AZURE_BLOB_BACKUP.md) and [dated task](tasks/2026-11-04-azure-private-blob-backup.md) document new Azure SDK/Entra streaming backup branch, synthetic tests and protected /dev/shm Azure CLI session credentials. Cloudflare R2 PR #25 remains untouched (not merged). Do not execute actual staging export until private container confirmed and harmless encrypted sample roundtrip tested.
- Continue separate **cold restore** with verified PG17/PostGIS, global roles / managed objects and RLS, migration ledger, content parity and retained Render rollback; migration 008 and all staging/production deployments still NO-GO.

## Azure container RBAC assigned — owner reported, Nov 4 2026

- Owner reports `Storage Blob Data Contributor` assignment for their Microsoft Entra user at the `campuspool-staging-backups` container scope. Next safe step: Ubuntu-D `az login --use-device-code` with `AZURE_CONFIG_DIR` rooted in `/dev/shm` (tmpfs 0700) and **read-only** `az storage container show --auth-mode login` on the exact storage account and container. Verify private access, proper subscription and successful RBAC. Report only PASS/BLOCKED, not access codes/tokens or IDs.
- PR #26 remains draft, unmerged. No student data export or cloud test upload occurred; after successful read-only access, test encrypted synthetic upload and independent ciphertext readback. A full cold restore and source/target parity remain mandatory before migration 008 or any protected staging deployment.

## Following successful Azure AGE smoke test — Nov 4 2026

- Owner ran private Entra-authenticated test: AGE-encrypted synthetic payload upload/download/decrypt and test blob deletion — **both PASS**, no database access. Next local step: install the Azure JS SDK in a dedicated non-repository directory, fetch PR #26 in a **new worktree** and run its synthetic tests before preparing restricted preflight. Keep Azure CLI auth cache under verified private `/dev/shm`.
- Before **any real staging PostgreSQL dump** uploaded to Malaysia West: ensure durable separate AGE private-key custody and recoverability, appropriate student-data cross-border review, credit/billing check, selected-schema backup scope review, local PG17/SDK preflight and an approved independent PG17/PostGIS cold-restore target. Release gating remains **NO-GO**; migration 008, Render and production unchanged.

## Azure backup operator local preflight — 2026-11-04 UTC

- Azure owner confirms local 6/6 synthetic tests passed. Run **credential-free** `node scripts/azure-blob-backup.js --preflight` from `~/campuspool-azure-recovery` using **synthetic PGHOST/PGPASSWORD/AGE_RECIPIENT sentinel values** that satisfy config shape and exact destination allowlists; `NODE_PATH` points to separately installed Azure SDK and `AZURE_CONFIG_DIR` is private 0700 tmpfs. This only validates tool versions, packages and config; it performs no DB or cloud query.
- **Do not** proceed to `--execute` with sentinel values. The live cross-border staging export still requires separately recoverable **durable AGE private identity**, approved student-data transfer/privacy and subscription cost review, and independent recovery target planning. Release gates remain NO-GO.

## Azure preflight passed — next durable AGE recovery key gate (2026-11-04)

- Owner reports `AZURE_PREFLIGHT_PASS; no database or blob contacted` from guarded fake-only CLI preflight. No source/cloud contact. Azure private-container and synthetic AGE upload checks already passed.
- Execute **only** the persistent AGE encryption-identity key generation procedure in [Azure task](tasks/2026-11-04-azure-private-blob-backup.md), keeping plaintext identity in `/dev/shm` and writing only a strongly passphrase-encrypted identity to local persistent storage. Verify synthetic ciphertext decrypts through this protected identity and independently back up encrypted key/passphrase in approved separate secure storage. Treat WSL swap and key-loss risk as unresolved until reviewed.
- Do not run `--execute` or any real student-data export to Malaysia until transfer privacy/data-retention and Azure credits are reviewed, durable decryption recovery proved, and separate PG17/PostGIS restore + rollback plan approved. Migration 008, staging/production deploy remain NO-GO.

## Durable AGE backup-key recovery — next operator gate (Nov 4, 2026)

- Owner reports the new permanent AGE identity was **passphrase-encrypted** and successfully decrypted a synthetic AGE file (two PASS checks). The identity is currently known only as a locally created encrypted file; independent key backup and off-device restore test are **not done**.
- Next: copy `~/.local/share/campuspool-recovery/staging-age-identity.passphrase.age` to a **separate secure vault/location** and safeguard its passphrase separately. Retrieve that copy independently, verify it matches the local encrypted copy, and use it to decrypt a fresh sample with the stored public recipient; do not expose keys/passphrases or write plaintext identity to unencrypted C:/D:. Do not delete the only working copy.
- Continue to block all actual staging uploads until permitted personal-data cross-border transfer, Azure credit/cost/retention, selected-schema vs full recovery scope, an independent PostgreSQL 17/PostGIS restore target and Render rollback have been reviewed. No staging migration 008, production or Render deployment.

## Owner-reported Azure recovery completed; audit evidence before release — 2026-11-04 UTC

- Owner says final three tasks are complete: independent encrypted AGE key copy, transfer/cost review, actual PostgreSQL backup and independent restore. **Do not ask owner to redo the work.** Agent has no local WSL filesystem or Azure storage integration to independently inspect archived bytes or local Postgres restore. Request **only sanitized status evidence** (no secrets/records): independently re-downloaded ciphertext digest match, AGE key recovery/decrypt result, PG17/PostGIS restore target type and successful operation, schema+ledger+role/RLS/grants+row fingerprints/count parity, cost/data-transfer signoff.
- Optional owner-side authenticated **read-only** check for actual Azure archive metadata:
  `az storage blob list --account-name 011campuspoolbackup --container-name campuspool-staging-backups --auth-mode login --prefix staging/ --query "[].{bytes:properties.contentLength,modified:properties.lastModified}" --output table`.
  Report only item count/nonzero bytes/most recent timestamp; object names and data not needed.
- Connected Supabase still reports seven migration versions; Render stage old `cceadbf6251f` is live. No newly created restore Supabase project in connected account; a local PG17/PostGIS restore would be expected in that case. Restore compare script in Azure branch expects a **different Supabase project ref** and is not directly usable for local restores.
- Validate actual restore and held backup covers intended recovery scope. Azure code archives `public` and `supabase_migrations` only (global roles and provider-managed schemas/media excluded): do not claim complete Supabase project recovery from a matching selected-schema restore.
- Confirm existing Render artifact can actually be re-deployed/rolled back, then obtain review of stacked recovery PRs #11/#12/#13/#22/#26 and explicit approval before staging migration 008. No production work.

## CORRECTED recovery handoff — independent restore remaining (Nov 4, 2026 UTC)

- Owner explicitly clarified the independent PostgreSQL restore is **not done**, correcting the prior owner completion claim. Do not mark restore done or release approved.
- Next safe action: list encrypted `staging/` Azure blob objects with **read-only** Azure CLI `az storage blob list --auth-mode login`; confirm nonzero encrypted backup archive bytes/modified time. No credentials or student records in chat.
- Establish a **separate, isolated, approved PG17/PostGIS target with encrypted storage**. Both Windows C:/D: lack BitLocker; do not restore personal-data rows into ordinary WSL or Docker host volumes that persist there. Review trusted encrypted cloud/volume or secure RAM-only container + WSL swap risk. Never restore onto the original staging source or production.
- Once isolated restore target is ready: independently retrieve AGE ciphertext and checksum, decrypt privately in encrypted workspace, inspect custom archive listing with `pg_restore --list`, restore with fail-closed error behavior, and compare table schema, migration ledger, RLS, privileges, rows/content fingerprints. Global roles/Supabase-managed objects not in Azure two-schema archive must be handled separately. Retained Render rollback proof remains pending; no staging migration/deploy.

## Immediate operator action: create the missing Azure backup (owner listing: 0 / []) — 2026-11-04

- Exact `campuspool-staging-backups` container is confirmed **empty** (`staging/` count 0; full listing []), correcting the earlier mistaken report of completed database export. Do **not** proceed to restoring an object that does not exist.
- From isolated Ubuntu-D Azure worktree, preserve protected `AZURE_CONFIG_DIR` under `/dev/shm` and private SDK under `NODE_PATH`. Use actual copied Supabase stage *session pooler* host, exact stage user/ref, 5432, `PGSSLMODE=verify-full`, stage password read silently and saved AGE **public** recipient. Operator first runs `node scripts/azure-blob-backup.js --preflight` with real values (no DB or cloud connection). After explicit manual confirmation, operator can run `AZURE_EXPORT_APPROVED=YES node scripts/azure-blob-backup.js --execute` to create a uniquely named AGE-encrypted `staging/*.pgdump.age` Azure blob, with automatic ciphertext readback and digest verification. Avoid printing/sharing secret environments.
- Verify `CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED` and a nonzero `staging/` object in a read-only Azure listing. Log safe object metadata and checksum locally, then secure approval for a distinct PG17/PostGIS cold restore environment. Source schema scope excludes global roles and Supabase-managed schemas/storage. No migration 008 or application deployment.

## Handle first real staging Azure export failure — 2026-11-04 UTC

- Owner's first `node scripts/azure-blob-backup.js --execute` returned only `AZURE_BACKUP_BLOCKED; no verified restoration` after `AZURE_PREFLIGHT_PASS`. This is **NOT** a successful remote backup. Original script hid specific stage. No blind rerun.
- **Immediate diagnostic:** run a **read-only `psql -X -w -qAt -c 'SELECT 1'`** using real staging *session pooler* host, exact staging user, port 5432, database postgres, `PGSSLMODE=verify-full` and private password read without echo. Keep stderr temporary under private `/dev/shm`, print only static TLS/AUTH/NETWORK/OTHER outcome, erase temporary diagnostics; no plaintext rows read. Review `PGSSLROOTCERT`/CA trust on TLS failure without changing `verify-full`.
- **Confirm no misleading residual blob:** list `staging/` objects read-only via Entra ID Azure CLI; do not delete a partial remote object without reviewed cleanup. Then `git fetch`/update clean detached Azure worktree to current PR #26 head and rerun 9/9 synthetic unit tests; the script now reports stable failure-stage categories and never raw SDK or SQL messages.
- If source probe PASS, run a separately approved guarded backup execution only once with current safe diagnostics; checksum readback plus independently verified remote presence required. Independent PG17/PostGIS cold restore and rollback still gated; no migration 008 or staging/prod deploy.

## Correct live-source TLS before Azure export — November 4, 2026

- Operator's read-only `psql SELECT 1` probe returned `DB_TLS_BLOCKED`. **Stop real backup retries** until strict verification passes. The old PG probe classified multiple SSL errors under the same code; missing local CA is plausible, not proven.
- Download the verified **project-specific Supabase CA certificate** via staging Dashboard → Database Settings → SSL Configuration → Download certificate; parse with `openssl x509`, install outside repository, set `PGSSLROOTCERT` for libpq/PG17; keep `PGSSLMODE=verify-full` and exact Session Pooler hostname. Re-run read-only `SELECT 1` with private staging password; report only category. If TLS still fails, inspect **local private stderr without pasting secrets**, check hostname and certificate provenance; never use `sslmode=require`, disable TLS, or skip certificate validation.
- Once `DB_CONNECT_PASS`, recheck Azure container metadata and guarded current code/CI before separate approved encrypted export; final independent PG17/PostGIS restore and release gates remain outstanding.

## Source strict TLS gate passed — retry real encrypted backup once (2026-11-04)

- Owner successfully downloaded authentic Supabase staging `prod-ca-2021.crt`, installed a private local copy in `~/.config/campuspool/supabase-staging-ca.crt`, and ran read-only `psql SELECT 1` with `PGSSLROOTCERT` and `PGSSLMODE=verify-full`; outcome **`DB_CONNECT_PASS`**.
- The earlier credential-containing shell block was subshell-scoped. In a new protected Ubuntu-D shell explicitly restore `PGSSLROOTCERT`, `PGSSLMODE=verify-full`, exact stage project/user, actual dashboard pooler host and secret PG password read silently; preserve only the durable AGE **public** recipient in env. Azure SDK `NODE_PATH` and `AZURE_CONFIG_DIR` must be set to private paths. Check Azure data-plane access read-only, run latest guarded `--preflight`, then only after explicit `BACKUP` confirmation retry the new, diagnostic `--execute` once. Do not use any unverified CA and do not disable certificate checks.
- Confirm `AZURE_CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED` and a nonzero immutable `staging/` Azure blob, then independently retrieve/decrypt and plan distinct PG17/PostGIS restore. Do not claim full Supabase project recovery: Azure dump includes `public` and `supabase_migrations` only; managed auth/storage/global roles require separate procedures.

## Next operator command after clean Azure worktree — November 4, 2026

- Use the tested clean `~/campuspool-azure-retry` checkout (owner local 10/10 pass, commit `e6850ab`) rather than disturbing the previous worktree with untracked `-`. The stage `psql SELECT 1` previously returned DB_CONNECT_PASS with project-supplied TLS CA.
- Before uploading, read-only check existing Azure `staging/` blobs, and stop on any current objects. In a protected subshell re-export `PGSSLROOTCERT=$HOME/.config/campuspool/supabase-staging-ca.crt` and `PGSSLMODE=verify-full`, source stage user/host, Azure private container and RAM-backed CLI tokens, permanent AGE public recipient. Enter PG password only silently; read-only test `SELECT 1`, real-config `--preflight`, then user-confirm `BACKUP` to permit one stream upload. Share only categorized status and object size, never credentials or private identity.
- Do not deploy/migrate or claim recovery until Azure ciphertext confirmed, separately downloaded/decrypted and restored into distinct secure PG17/PostGIS, with migration/security/data comparisons and Render rollback verification.

## P0 security blocker — broken Azure stdout stream and accidental plaintext file (2026-11-04)

- **Current evidence:** PostgreSQL 17.11 and TLS-authenticated staging `SELECT 1` pass. The previous `--file=-` incorrectly created a local file named `-` (operator-reported 48,600 bytes in retry worktree, 0 bytes in older worktree). Treat as sensitive data on unencrypted Windows host. Old 200-byte Azure object decrypts but fails `pg_restore --list`; **not a verified backup**. The earlier apparent dump/AGE PASS relied on an empty stdout stream and is withdrawn.
- **Code task:** [Azure stdout incident](tasks/2026-11-04-azure-pgdump-stdout-incident.md) on isolated fix branch `fix/azure-pgdump-stdout-guard-2026-11-04`. Review code, run `node --test test_azure_blob_backup.js`, check CI and use synthetic PG17+AGE validation of real archive bytes. No old-code live export.
- **Owner action:** restrict and securely handle local `-` file (no content sharing, `git add -A`, or unsafe claim of secure deletion), review encryption for Windows/WSL host and backups, confirm AGE key custody and permitted stage-region transfer. Avoid any new cloud upload before approved corrected code and safe environment.
- **After review and separate approval:** one guarded live staging backup, independent ciphertext readback and AGE decrypt, valid `pg_restore --list` and complete cold restore in distinct encrypted PG17/PostGIS, permissions/migrations/RLS/grants/data parity, Render retained artifact verification. Keep migration 008 and staging/production deployments **NO-GO**.

## Next cloud recovery engineering milestone — 2026-11-05

1. Review new draft PR #28 (`ops/cloud-backup-worker-2026-11-05`) stacked on PR #27. Confirm all GitHub CI and Docker smoke checks pass; patch any failures and record code commit/evidence. No live cloud operation.
2. Fix worker supply-chain reproducibility: lock exact Azure SDK transitive dependencies, review vulnerability scan, pin Node/PostgreSQL image digests, generate immutable signed image before any cloud deployment.
3. Owner approval for Azure Container Apps **manual-only** job resource, Key Vault/managed identity, network/region selection and costs. No recurring schedule without separate explicit approval. Use [cloud job runbook](../ops/CLOUD_AZURE_BACKUP_WORKER.md).
4. Execute a single separately approved stage-only cloud backup with verified private ciphertext readback. Independently decrypt and cold restore to encrypted PG17/PostGIS, compare migration ledger/RLS/roles/content and verify Render rollback artifact. **NO-GO for migration 008 or live deployment until completed**.
5. Local accidental `-` dump remains a separate at-rest security incident; don't upload, commit or assume securely erased. No more local staging exports.

## Mainline integration follow-up — 2026-11-05

Historical branch notes above may still call PRs unmerged. The checked integration PR governs final merge status. Keep the latest verified CI evidence and explicit recovery/rollback release gates in the dated consolidation task. Do not deploy merely because code reached main.

## Flutter/Places branch history carried into main — 2026-11-05

Historical headings below were recorded before the combined source merge. The UI remains separate and optional; Google Places billing-dependent endpoints are disabled until explicit provider approval. No Render deployment, staging migration or provider charge was authorized.

## New Flutter client handoff — 2026-11-04 UTC (branch only)

- **P1 / UI review:** [Flutter/Figma Phase 1](tasks/2026-11-04-flutter-figma-ui.md) lives only on `feat/flutter-campuspool-figma-ui-2026-11-04` and does not alter the production web app. **CI verified:** Flutter 3.47.7 analyzer and **6/6 tests pass** in [run #41790737256](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41790737256). **Next:** generate/review Android/iOS shells using `flutter create`, check real phone/tablet/browser screenshots, accessibility and reduced motion, then obtain independent PR review.
- **After approval only:** design session-based Node API client integration with CSRF, ownership and ride-match privacy guards. Errands, verified pricing, tip top-ups and UPI remain disabled until server implementations and trusted provider callbacks exist. Do not deploy or merge this client as a production release by inference.

## Flutter Phase 2 (stacked, not in main) — 2026-11-04 UTC

- [Phase 2 ride feed / loading states + platform build](tasks/2026-11-04-flutter-phase2-platform-states.md): `feat/flutter-phase2-platform-states-2026-11-04` is stacked on draft PR #17 and **does not deploy**. Verified: Flutter analysis and 19/19 tests pass at `244e06c` (CI #41793703183); web release and Android unsigned debug APK build artifacts pass at `2ad2d51` (CI #41793334499). Next: run manual emulator/browser responsive and reduced-motion checks, review generated native host files, and design real session transport/cookie scoping and privacy. Do **not** wire the simulated signed-in preview to actual protected endpoints.
- Separate approved work would be needed for a real verified OTP/session flow, Android secure cookie storage, iOS signing, actual rides inventory integration, and errands/payment backend. Existing P0 release blockers retain priority.

## Flutter Phase 3 real login — stacked draft, 2026-11-04 UTC

- [OTP/session transport task](tasks/2026-11-04-flutter-session-login.md) is in `feat/flutter-phase3-session-login-2026-11-04`, stacked on draft PR #19 and #17. Verified: analyzer + 28/28 tests and Web release PASS at `503b5ba` (CI #41796997734); unsigned Android debug PASS at earlier `f8d2ccf` (CI #41796440947), latest build still running at checkpoint. Next: isolate and disable the account-enumerating legacy SQLite OTP mode in server configuration, then carry out isolated staging/provider/device tests and signed-off session/CORS/CSRF review. Browser requires **same-origin** Node hosting. Native cookie is memory-only. Do not deploy or merge without independent security review, authentic OTP delivery and release GO.

## Flutter places destination picker — stacked branch, 2026-11-04 UTC

- Review [autocomplete task](tasks/2026-11-04-flutter-place-autocomplete.md) on `feat/flutter-places-autocomplete-2026-11-04` stacked on PR #21. Flutter analyzer + 39/39 tests PASS (`6cbff8e`), Node 5/5 mock provider tests PASS (`1860647`). Latest Web/Android package build pending CI #41802050615. Next: approve Google Cloud key/quota/attribution, validate on an isolated local or approved staging setup, capture real Swargate selection/device screenshots and test abuse limits. The optional public read-only proxy is **OFF by default** and does not authorize production activation. Keep unmerged while cost/privacy/terms requirements remain unverified.

## Flutter Places mobile QA — 2026-11-04 UTC (branch-only)

- [Mobile keyboard + cost-cap task](tasks/2026-11-04-flutter-places-mobile-qa.md) on `feat/flutter-places-mobile-qa-2026-11-04`: Flutter analyzer and 41 tests PASS, Node Places 6 tests PASS at `e0ebb45`; packaging pending CI #41805066120. Next: inspect web/unsigned Android build artifact, then QA real Android keyboard and scrolling; confirm official logo assets/Terms and Google Cloud billing budget before a controlled provider-enabled test. No release GO, merge or deploy implied.

## Mobility UI source reconciliation — 2026-11-05

Historical branch-only checkpoints are retained below. Private travel-intent UI remains feature-gated and is not live; migration 008 and student data rollout require protected backup/restore, consent, device acceptance and rollback evidence.

## Independent P1 development handoff — authenticated mobility UI (2026-11-03 UTC)

- [Feature-gated mobility intent panel](tasks/2026-11-03-mobility-intent-ui.md): new unmerged `feature/mobility-intent-ui-2026-11-03` branch off `main`, separate from nested security PRs #11–13. Implements the previously missing student-facing request, cancellation, private geometric candidate cards, existing booking handoff and optional opt-in geocoded driver offer fields (default off), without revealing raw GPS or contact data in candidate cards. Staging-only backend flag remains OFF by default; this is **not a deployed feature**.
- **Historical baseline:** PR #14's initial UI tests passed on `30e4fc2`; subsequent synthetic browser QA and privacy hardening are now documented in the later checkpoint below. No authorized staging browser test or physical-device acceptance has occurred. Independently audit accessibility/mobile UX and provider privacy, then run verified-student browser E2E against a separately authorized staging build. Do not enable public matching, migrate 008 or bypass the owner-operated backup/restore and rollback gates. Future route-aware matching and load benchmarking remain open; do not adopt Redis/H3 until measured evidence warrants it.

## New QA gate — real-browser mobility checks (2026-11-04, PR #14)

- [Disposable Chromium/Firefox/WebKit browser QA](tasks/2026-11-04-mobility-browser-qa.md) added on the unmerged mobility feature branch. The source review also fixed a real ride-ID contract mismatch: `ride_<uuid>` from PostgreSQL was rejected by candidate/booking UI guards. No staging or production service was touched.
- **Immediate action:** code commit `810ad64` PASSED browser E2E run #41701113565 (**21/21** across Chromium, Firefox, mobile WebKit), alongside all four standard CI checks. Obtain independent usability/privacy and keyboard/physical-mobile review, then separately authorized staging E2E; collect exact deployed SHA and rollback evidence before any rollout. Synthetic user sessions bypass real OTP provider delivery and cannot substitute for approved staging E2E. Keep PR #14 draft and release/migration 008 blocked until separately documented owner approval.

## Latest reviewed PR #14 checkpoint — browser state and accessibility (2026-11-03 19:38 UTC)

- [Mobility session-race, map and keyboard hardening](tasks/2026-11-04-mobility-ui-hardening.md) is implemented on the **unmerged draft** `feature/mobility-intent-ui-2026-11-03` branch. Tested code SHA: `76cd1a414bb942086ed7c81ba41c82835f58c19f`.
- **Verified isolated tests:** **30/30 browser cases PASS**, run #41704799368, for Chromium desktop, Firefox desktop and mobile WebKit; security #41704799389 PASS, PostgreSQL/PostGIS #41704799073 PASS, credential hygiene #41704799185 PASS, agent docs #41704799301 PASS. Browser regressions added for delayed successful matching after logout (discard stale response), DOM/form time clearing, genuine opt-in Leaflet map clicks with stubbed tiles and keyboard request creation/cancellation.
- **Immediate responsible action:** an *independent human* should review PR #14 (state race/CSRF, location privacy and retention, accessibility and mobile, failure paths, opt-in semantics and test harness) and record review approval or requested changes. No independent approval was recorded at task start. Engineering can continue isolated static/browser regression only; do not mark passing CI as reviewer authorization.
- **Staging owner / operator action after separately verified restoration gates:** confirm off-site encrypted staging backup, separate independently restored database with matching fingerprints, reviewed rollback, retained Render artifact and approved test accounts; then deploy exact reviewed SHA to isolated staging, run real delivery and physical-device QA and capture evidence. **Until then: no staging/production deploy, migration 008, public mobility enablement or payment activity.**

## Repo archive containment guard — 2026-11-05

- Review and test source-only archive exclusions and tracked-file checks, [task](tasks/2026-11-05-repo-dump-hygiene.md). Do not hide or commit the existing untracked WSL `-` file; do not treat Docker ignoring as secure erasure.
- Combine only with green CI and preserve the existing staging encrypted-backup/independent-restore/Render rollback NO-GO. No live deployment from this PR.

## 2026-11-05 — Mainline consolidation complete, next Render readiness gate

- `main` contains the reviewed security/cloud-backup, Flutter/Places, mobility and dump-hygiene source through PRs #32–#35; latest dated [consolidation handoff](tasks/2026-11-05-main-consolidation-render-handoff.md). GitHub had **zero open PRs** at the audit. Verify exact main SHA and current CI before any deploy.
- Clean up remote Git branches **only after reviewing ahead/behind and confirming no unique work**; this connector lacks a branch-delete action. Do not force-push, rewrite main, hide the owner's untracked plaintext `-` file or discard the separate R2 implementation inadvertently.
- Confirm private Render `OTP_SECRET` is fresh and strong; avoid exposing secret values or weakening the startup guard. Verify production data persistence, retained rollback artifact and staging environment credentials.
- Complete approved *manual-only* Azure cloud worker provisioning/recovery: lock/pin image dependencies, IAM/Key Vault, region/cost/network review; new encrypted staging archive, independent remote ciphertext retrieval/decryption, cold PG17/PostGIS restore with schema/roles/RLS/grants/migration/data parity.
- Only after source data protection and rollback GO: choose exact staging release SHA, run controlled migration 008 if authorized, verify genuine provider OTP login, idempotent mutations, private mobility and mobile UX; then a separate production go/no-go. **No deployment or migration was performed by the consolidation.**

## Main consolidated, next separate Render/recovery phase — 2026-11-05

- Completed source consolidation to `main`: PRs #29, #32, #33, #34, #35 passed their checks. No open PRs at audit time; existing legacy branch refs deliberately retained pending safe branch-history review. [Exact audit](tasks/2026-11-05-mainline-consolidation-audit.md).
- **First priority:** manual-only approved cloud backup worker, protected identity/Key Vault/TLS/recipient, nonleaking logs, pinned image/dependencies, verified ciphertext, **independently** decrypted and restored protected PG17/PostGIS with row-content, roles/RLS/grants/migration ledger comparisons and retained Render rollback proof. Existing 200-byte Azure object is not a usable backup; preserve it for reviewed disposition.
- **Then Render:** check protected OTP_SECRET is fresh 32+ characters; inspect production data persistence/SQLite fallback, real OTP delivery, health, staged migration plan and exact approved deployment SHA. Both Render services autoDeploy OFF. Do not initiate deployment or migration 008 before independent backup/restore and owner sign-off.
- Do not delete local WSL `-` file via Git clean or assume encryption/secure erasure. Branch deletion is not available in current connected GitHub tools; only review/anonymize/delete redundant heads later with authenticated GitHub UI/CLI and keep divergent history.

## Cloud worker image release blockers — 2026-11-05 UTC

1. Review new digest-pinned worker image and policy CI on `security/cloud-backup-worker-image-2026-11-05`. Do not presume pinned digest means vulnerability-free.
2. Generate/commit reproducible `ops/cloud-backup/package-lock.json`, replace `npm install` with `npm ci`, run dependency and container vulnerability scanning, sign and retain final immutable image digest.
3. Plan owner-approved private registry, minimal job-scoped identity, vault-backed secrets/CA and privacy-safe execution logging. The owner has so far only approved the **empty environment** in Malaysia West; no separate approval for a job/vault/registry/privilege grants or a real export.
4. Continue gate: independent encrypted staging recovery to separate protected PG17/PostGIS and verified Render rollback before migration/deployment. [Image task](tasks/2026-11-05-cloud-worker-image-hardening.md).

## Following locked cloud worker dependency CI — 2026-11-05 UTC

1. **Completed in draft PR #38:** reproducible `package-lock.json` (66 package entries), `npm ci` image build and blocking npm audit (0 advisories on 2026-11-05). Keep exact-commit CI green after handoff updates.
2. **Next code/security work:** trusted OS/base image scanner and SBOM, review pinned parent CVEs and final signed image digest; review privacy-safe Container Apps logs, managed identity, CA, vault secrets, outbound network and scoped Azure Blob RBAC.
3. **Owner approval required:** private registry, job, Key Vault, privilege grants, any resource cost and real staging export. Only an *empty* Consumption Container Apps environment `campuspool-backup-env` in Malaysia West has been approved/verified by owner CLI, with no log sink or jobs.
4. **Still NO-GO:** actual offsite encrypted staging backup, independently restored protected PG17/PostGIS archive, Render retained rollback; only then staging OTP rollout and subsequently production with real providers. [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) is not live.

## Cloud worker Trivy vulnerability NO-GO and infrastructure approval — 2026-11-05 UTC

1. Evaluate isolated `postgres:17.11-trixie` PG17 candidate scan; re-pin the best accepted image by exact index digest, preserve non-root and `--preflight`, rerun complete Trivy scan, and remediate/review remaining Debian OS high/critical CVEs. Strict CI release gate **fails** at 397 findings with 3 CRITICAL, 47 HIGH after removing unused `gosu`; no image push before owner security sign-off.
2. From [Azure provisioning preparation](../ops/AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md), obtain owner approval on *actual* Azure for Students costs/limits and least-privilege permission boundaries. Only empty `campuspool-backup-env` Consumption environment exists; new ACR, Key Vault, identity, RBAC, secure logs and manual job are **not authorized yet**. Basic ACR is auth-private but not private-endpoint capable.
3. Perform independent staging encrypted backup and cold restore only after separate explicit approval, protected source credentials/CA, safe logs, pinned signed release image and rollback. Render and OTP production release remain NO-GO.

## Image OS CVE remediation choice — 2026-11-05 UTC

- A Debian 13 Trixie candidate did build and scan, but yields 1 CRITICAL and 63 HIGH vs Bookworm 3 CRITICAL and 47 HIGH. Do not pick either just on total counts; review vendor status/exploitability and consider a minimal Node + PostgreSQL 17 client + AGE image to reduce needless OS dependencies. Keep strict high/critical gate active; no release image/push before reviewed evidence.

## After promotion of minimal client-only backup runtime — 2026-11-05 UTC

1. **Completed source-only:** Node slim + signed PGDG PG17 *client* + AGE, no server/runtime npm; committed lockfile; 262 final-image CVE findings versus initial 458, with zero scanner-fixable HIGH/CRITICAL after Debian patch updates. Worker build, fail-closed auth/smoke and npm audit checks pass, but strict Trivy gate intentionally **FAILS** (1 CRITICAL + 37 HIGH). Exact source [PR #38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38); [CVE triage](../ops/CLOUD_WORKER_CVE_TRIAGE_2026-11-05.md).
2. **Next independent security review:** verify actual runtime has no affected MiniZip binary/code for `CVE-2023-45853`, evaluate [Debian source guidance](https://security-tracker.debian.org/tracker/CVE-2023-45853) for potential targeted VEX and triage the remaining HIGH issues; don't globally suppress scanner alerts. Review signed PGDG key/package provenance, SBOM and final immutable signed image digest. No registry push until accepted.
3. **Owner billable-resource authorization still missing:** read-only Azure cost/credit proof and named tier/network approval for ACR, Standard Vault, secure logging, identity/role grants and manual-only job. Azure for Students credits are limited and should not be treated as an authorized commercial production hosting offer. [Azure plan](../ops/AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md).
4. Then protected owner-approved manual backup and separate independent PG17/PostGIS cold restore, secure Render OTP rollout with provider test and verified rollback. **No production deploy or migration 008 before gates.**

## Following verified MiniZip critical triage — 2026-11-05 UTC

1. **Critical CVE evidence obtained, not a source-code patch:** exact Debian 12 zlib package and absence of vulnerable MiniZip code checked in isolated image; one-CVE assessment passes, **raw Trivy is preserved**. [CI 42062150091](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42062150091) and [CVE note](../ops/CLOUD_WORKER_CVE_TRIAGE_2026-11-05.md).
2. **No release yet:** 37 HIGH OS advisories still trigger the strict Trivy release CI fail. Have a reviewer inspect individual Debian statuses and runtime relevance, document any package-specific fixes or VEX with source evidence. Do not introduce a global `--ignore-unfixed` or publish image before review. Obtain image signature/SBOM provenance.
3. **Azure:** confirm owner-approved monthly cost ceiling, Azure for Students eligibility, ACR/Key Vault/logging/RBAC permission decisions before creating any resources. Empty Consumption environment only.
4. **OTP:** no deploy until secure staging backup, independent restore, provider readiness and Render rollback are verified.

## After final Alpine runtime CVE remediation — 2026-11-05 UTC (CURRENT)

1. **Completed source-only:** Exact image digest-pinned Node 22 Alpine 3.23.7 + PG17 client + AGE, no runtime npm or PG server, current full Trivy reported **0 CVEs**, with scanner package/SBOM coverage gate (29 Alpine OS, 78 Node records) and HIGH/CRITICAL policy, [CI 42065551826](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42065551826) PASS. All prior 37 HIGH Debian rows grouped and vendor-assessed [here](../ops/CLOUD_WORKER_HIGH_CVE_REMEDIATION_2026-11-05.md). Previous Bookworm vulnerability counts remain historical, not current.
2. Review Alpine `zlib=1.3.2-r1` [vendor security update](https://security.alpinelinux.org/vuln/CVE-2026-85091) versus distinct upstream `CVE-2026-76844` (same `df84af2` patch reportedly fixes both) as additional independent source-level assurance; scan silence alone is not a source patch proof. Obtain independent review of final source/image/SBOM, sign built image digest and verify protected CA/PG17 TLS client behavior before authorized first export.
3. Owner-approved Azure budget/tier/networking and privileges are still missing. Review authenticated public ACR Basic vs Premium private endpoint, Standard Key Vault, safe logs, user-assigned AcrPull identity, container-scoped Blob no-delete role and manual-only job, then seek explicit approval before provisioning ANY additional resource. [Owner-gated Azure plan](../ops/AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md).
4. Real offsite encrypted staging export, independent protected PG17/PostGIS restore/content/RLS/grants proof, Render rollback and OTP provider checks still **NO-GO**; [OTP PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) not live. No production migration/deploy without those gates.

## After signed OCI review candidate and protected libpq secret guard — 2026-11-05 UTC (CURRENT)

1. **Source and synthetic CI complete:** exact Alpine zlib 1.3.2-r1 patch SHA-512 and upstream `df84af2` independently verified; the same fix is reported for distinct CVE-2026-76844 in Debian bug #1153063. X.509 CA validation and non-symlink 0600 owner-only RAM-based PGPASSFILE cloud mode PASS synthetic guard tests. Full image Trivy and Sigstore **OCI archive** signature verification PASS [CI 42069719355](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42069719355). [Security review](../ops/CLOUD_BACKUP_TLS_SECRET_SIGNING_REVIEW_2026-11-05.md).
2. **Owner approval and runtime validation:** validate the real Azure Key Vault secret-volume bootstrap to protected /dev/shm file owned by UID 65532; CA fingerprint/trust and real Supabase pooler PG17 TLS verify-full handshake with staging-only credentials; design/redact operational logs. These are **not** yet verified or authorized.
3. **Image distribution:** require approved ACR tier/cost and scoped pull/push roles, sign and verify the **actual pushed registry manifest digest** with a trusted release identity and compare to exact reviewed source/SBOM. The CI OIDC-signed tar archive is only a short-lived PR review artifact.
4. **Recovery gate:** after separate approval, real staging encrypted export with remote readback, AGE decrypt and independent protected PG17/PostGIS restore including roles/RLS/grants/content parity and Render rollback. Only then stage and deploy OTP PR #36 with real provider testing. **No migration or production deploy yet.**

## Next after staging Vault-to-tmpfs bootstrap coding — 2026-11-05 UTC

1. Verify stacked draft PR CI (Vault bootstrap fake API, no-token preflight, denied export, tmpfs 0600 cleanup, libpq escaping, synthetic PG17/AGE pipeline), full image scan, SBOM and OIDC review image signing. Fix any regressions before independent review. [Task](tasks/2026-11-05-vault-tmpfs-bootstrap.md).
2. Independently review the Key Vault URL allowlist, managed identity token scope and **exact current Azure permission** model. Verify the synthetic file lifecycle in the real target container runtime including /dev/shm tmpfs, UID 65532 ownership and interrupted-task cleanup; inspect secure CA chain and non-data live TLS handshake in approved staging isolation.
3. Confirm owner cost and IAM authorization for registry (ACR vs GHCR), Standard Key Vault, secure logs, manual-only Container Apps Job. No change to public image visibility or spending without approval.
4. Real AGE-encrypted staging dump → verified private Azure Blob → independent cold PostgreSQL 17/PostGIS restore/row digest/RLS/grant validation and Render rollback is mandatory **before OTP staging or production deploy**. PR #36 remains draft/unmerged.

## Next after secondary staging backup security review — 2026-11-05 UTC

1. Verify [PR #40](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/40) complete exact-head CI for AGE v1 plaintext rejection, bounded Vault secret stream and identity checks, separately approved synthetic `--check-tls`, rootless readonly image bootstrap, real PG17 + AGE **synthetic** restore, Trivy, Sigstore and docs. Audit [finding register](../ops/CLOUD_BACKUP_INDEPENDENT_SECURITY_REVIEW_2026-11-05.md).
2. Independent human security review and owner approval of **named** ACR Basic vs private-network registry, Standard Vault, redacted log sink, one-secret role, Blob container-specific no-delete data role, job identity and manual-only job **including monthly cost ceiling**. Existing empty Consumption environment only; no new Azure resources may be created from source code review alone.
3. After explicit stage-only permission, validate real CA fingerprint and execute controlled `AZURE_TLS_CHECK_APPROVED=YES ... --check-tls` from an isolated job, no student table reads, no export; log sanitized TLS-only evidence.
4. With separate actual backup approval, manually execute AGE encrypted PG17 staging export, Blob SHA256 readback, then independent download/decrypt/PGDMP/PG17+PostGIS cold restore. Verify RLS/roles/migration ledger/table data digests and Render rollback in [PR #37 evidence manifest](https://github.com/sohamsadegaonkar/mit-adt-campuspool/blob/ops/recovery-gate-evidence-audit-2026-11-05/docs/ops/RECOVERY_EVIDENCE_MANIFEST.md).
5. Only then approve staging OTP provider validation, merge/release [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) under rollback gate, and separately consider production. **No deployment/migration at present.**

## Owner-approved Azure budget — 2026-11-05 IST (LATEST)

1. Enforce owner-approved **₹500/month total Azure backup infrastructure budget**, inclusive of any registry, Key Vault, manual jobs, encrypted Blob, logging, transfers and taxes. Keep all production-quality security/recovery requirements. [Cost policy and approval gate](../ops/AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md).
2. Before any Azure write, perform authenticated **read-only** inventory and consult actual Malaysia West rate/owner billing currency, remaining Students credits and 31-day conservative forecast. Compare ACR Basic vs securely reviewed alternative; **do not silently change image visibility**, drop Key Vault or omit logging. If approved footprint cannot reliably stay at/below ₹500, **do not provision**; escalate design/cost approval.
3. Once a viable design has explicit resource/IAM authorization, configure supported monthly Azure Cost Management *alerts* at 50% ₹250, 80% ₹400 and 100% ₹500 with an owner-confirmed recipient. **Alerts do not stop billing**, and Azure has no user-adjustable custom ₹500 subscription hard cap. Freeze discretionary changes at projected 80% until reviewed; monitor costs manually.
4. After independent security sign-off and owner-approved rollout, test protected staging-only TLS and separate encrypted backup/recovery verification; preserve source data, role/RLS and Render rollback gates before OTP release. Current PR #40 still draft; **no cloud resources or real database operations performed**.

## After Azure cost-evidence gate implementation — 2026-11-06 IST (CURRENT)

1. Check [draft PR #41](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/41) exact-head CI for budget logic, unknown-price template intentional rejection, all existing backup security, PG17 AGE synthetic and OTP tests. Keep CI source-only with **no Azure credentials**. [Implementation handoff](tasks/2026-11-06-azure-budget-release-gate.md).
2. Owner-authenticated **read-only** Malaysia West subscription/pricing inquiry using existing `ops/cloud-backup/azure-readonly-preflight.sh`, Azure pricing calculator/Retail Prices API, current credit and applicable taxes/FX. Capture **private** line-item quote and calculate conservative 31-day upper bound with 15%/₹50 contingency against **₹500 total limit**. An unverified ACR Basic estimate is not authorization to spend.
3. If secure authenticated ACR cannot fit budget without sacrificing Vault, encrypted Blob, logging, resilience or signed immutable image, investigate comparable **secure GHCR**, with owner approval before any public visibility; otherwise stop and request decision. Do not provision based on alerts alone.
4. After separate named-tier/IAM/cost approval, independent human security signoff and controlled stage-only `--check-tls` under Vault managed identity. Owner must separately approve real AGE-encrypted staging dump and **independent protected PG17/PostGIS restore** including content/grants/RLS/roles and verified Render rollback, using recovery evidence PR #37.
5. OTP [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) remains not live, and production migrations/rollout remain **NO-GO** until actual recovery proof.

## Following Malaysia West private GHCR deployment review — 2026-11-06 IST (CURRENT)

1. Check exact [draft PR #42](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/42) CI: official public price retrieval, Bicep compile, static private GHCR policy and all existing Stage 1 OTP/secure-worker tests. [Source handoff](tasks/2026-11-06-private-ghcr-azure-deployment-review.md). Vendor retail confirms **ACR Basic ₹491.82 per 31 days pre-tax** in Malaysia West, over cap with required contingency.
2. **Owner-authenticated read-only** Azure for Students Cost Management check with `ops/cloud-backup/azure-subscription-cost-readonly.sh` or Portal Cost analysis; check remaining credits, existing Blob charges, all nine categories and taxes/FX with a conservative 31-day allowance. This must be checked privately before creating paid resources. Private GHCR current container image pricing is free; cost is not a warranty and pull credential/availability risks require independent review.
3. Evaluate [private GHCR Bicep job review](../ops/AZURE_MALAYSIAWEST_PRIVATE_GHCR_DEPLOYMENT_REVIEW_2026-11-06.md) as preferred no-ACR design: secret-free signed immutable manifest digest, Key Vault read:packages pull token with rotation, separate system identity for staged Vault/Blob, manual-only 1 replica, 0 retries, secure CA mount, no ingress, full monitoring. **No image publication/public visibility, IAM grant or job without explicit owner approval**.
4. After cost, named-resource and independent human security approvals, configure private Vault/roles/monitoring and validate actual target Container Apps `/dev/shm`, CA file and managed identity. Then separately approved non-data staging `--check-tls`; later first real AGE-encrypted staging backup, remote SHA256 and separately protected independent PG17/PostGIS restore with roles/RLS/content and Render rollback evidence. OTP [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) not live; no production migration/deployment.
