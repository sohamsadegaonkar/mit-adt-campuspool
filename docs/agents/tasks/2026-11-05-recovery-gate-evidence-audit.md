# Task: Verify encrypted staging backup, isolated restore and Render rollback evidence

- **Task ID / file:** `2026-11-05-recovery-gate-evidence-audit`
- **Status:** in progress — metadata audited; recovery not demonstrated
- **Agent / owner:** ChatGPT for read-only GitHub, Render and Supabase inspection; trusted cloud infrastructure operator unassigned for Azure execution/recovery
- **Last updated:** 2026-11-05 UTC
- **Baseline:** `main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb`; `ops/recovery-gate-evidence-audit-2026-11-05`
- **Scope:** verify staging Supabase schema/migration metadata, current and historical Render deploy records; identify missing encrypted backup, independent cold restore and executable rollback evidence; provide safe operator evidence template
- **Out of scope:** live Azure resources/storage data access, staging export, restore, DDL/DML, new cloud resources or billing, Render deployment/rollback execution, secrets or personal records
- **Dependencies:** [cloud worker](../../ops/CLOUD_AZURE_BACKUP_WORKER.md), [OTP PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36), [release gate](../../PRODUCTION_RELEASE_GATE.md)

## Goal and acceptance criteria

Close the **recovery gate only when all three independent proofs exist**: (a) cloud-produced AGE ciphertext from actual allowlisted staging PG17 schemas, with private Azure storage permissions and matching SHA-256 remote readback; (b) independent offsite retrieval, AGE decryption and successful separate protected PG17/PostGIS cold restore with schema, migration ledger, roles, RLS/grants, extensions and content parity; (c) eligible retained Render staging rollback artifact, rollback plan and separately verified state/data compatibility. Synthetic mocks, empty tables or a deployment record are not proofs.

## Current state (verified vs assumed)

- **Source:** `main@1020e2e` contains the Azure managed-identity cloud-worker design, encryption-stream guards and mocked synthetic tests. Repository runbook explicitly says the manual Azure Container Apps Job, actual staging encrypted upload, separate restore and protected Azure role/cost approval are pending. No active Azure Blob/Container Apps connector is attached; existence or freshness of ciphertext in the owner's Azure account could **not** be read directly.
- **Staging:** Supabase `campuspool-staging-db` is `ACTIVE_HEALTHY`, PostgreSQL 17.11 in Singapore. The connected Supabase account lists three projects (the staging project plus two unrelated inactive projects), **no visible independent recovery project**; a recovery environment could exist outside connected Supabase, which is not verified. `list_migrations` returned `campuspool_001` through `campuspool_007`, **not 008**. `list_tables` reported nine public application tables, **9/9 RLS-enabled**, each with **zero estimated rows** at inspection. No student data was queried.
- **Render staging:** `mit-adt-campuspool-staging` branch `main`, autoDeploy OFF, latest live deployment `dep-dbke9uo8v5cc738cpnd0` at `cceadbf6251f`. Previous successful deactivated deployment `dep-dbkdr5qjnfac738p2heg` at `fe93c6be16b4`. Their build **rollback eligibility is not exposed** through connected Render `list_deploys/get_deploy` and cannot be inferred from history alone.
- **Render production:** branch `main`, autoDeploy OFF, live deployment `dep-dbloou4ipgvc73cb7n90` at `1020e2e4a6d4`; prior successful deactivated `dep-dbj5auss728c738sa94g` at `63ae5510bbe2`. OTP PR #36 remains unmerged and not deployed. Production rollback is also not proven.
- **Historical incident:** previously observed 200-byte encrypted Azure blob was not a valid `PGDMP` archive, and old local stdout behavior produced a sensitive untracked archive. Subsequent guarded PG17/AGE CI demonstrates *synthetic* restoration only. Do not write private machine security details into this public repository.
- **Outcome:** recovery release gate **NO-GO**, not an assertion that Azure has no objects. No cloud job/backup execution, database SQL write, migration or deployment was performed by this audit.

## Plan

1. Confirm latest PostgreSQL migration set, table-level RLS metadata and exact Render service/deployment baselines via connected read-only APIs. Record dates and SHA identifiers without logging sensitive data.
2. Confirm that no available connector exposes actual Azure Blob data, Container Apps execution logs or a protected cold-restore destination; identify precise operator-owned checkpoints without inventing their completion.
3. Store a sanitized [evidence manifest](../../ops/RECOVERY_EVIDENCE_MANIFEST.md) and update agent status/next steps. Owner/approved operator must perform actual cloud backup + independent recovery in a protected environment, with billable resource and geographic data transfer approval beforehand.
4. Wait for positive artifact, restore and rollback evidence before any migration 008 or new staging/production deployment.

## Progress log

- 2026-11-05 UTC — Inspected live connected Supabase staging project: PG17.11 ACTIVE_HEALTHY; seven recorded migrations; nine RLS-enabled public tables, no estimated rows. No table contents or secrets read.
- 2026-11-05 UTC — Verified current and prior successful Render production/staging deploy IDs and SHAs; auto-deploy OFF in both. No API-exposed rollback artifact eligibility.
- 2026-11-05 UTC — Inspected source cloud-worker design and recovery incident runbooks. No Azure storage/Container Apps connector or independent restorable archive available for direct verification; original incident remains open.
- 2026-11-05 UTC — Created branch-local recovery evidence template and handoff; NO release, migration, database writes or cloud provisioning.

## Verification

| Check | Evidence (2026-11-05 UTC) | Result / limitations |
|---|---|---|
| Supabase staging health | Connected `list_projects` | ACTIVE_HEALTHY / PG17.11 |
| Staging migrations | Connected `list_migrations` | 001–007 present; 008 absent |
| Staging public tables / RLS | Connected `list_tables` | 9 tables, 9/9 RLS; 0 estimated rows |
| Offsite encrypted backup / ciphertext hash | Actual Azure Container Apps / Blob account unavailable through connected tools | **UNVERIFIED**, synthetic CI not a substitute |
| Separate protected PG17/PostGIS cold restore | No independent restore destination or comparison evidence provided | **UNVERIFIED** |
| Staging current known-good deploy | Render `get_deploy` `dep-dbke9uo8v5cc738cpnd0` | live `cceadbf` |
| Staging prior successful deploy | Render `get_deploy` `dep-dbkdr5qjnfac738p2heg` | deactivated `fe93c6be` |
| Production current / prior deployment | Render current `1020e2e`, prior `63ae551` | metadata verified, artifact rollback eligibility UNKNOWN |
| Retained Render rollback build eligibility | No rollback capability field in Render connector; dashboard action not inspected | **UNVERIFIED** |
| Migration, cloud job, data export, deployment executed | No write actions taken | Not executed |

## Risks and decisions

- **NO-GO** for staging/production migration and deploy until both external recovery proofs and retained rollback exist. A read-only catalog inspection or GitHub test result cannot close this gate.
- The Azure worker proposed in `docs/ops/CLOUD_AZURE_BACKUP_WORKER.md` has operator-only `--execute` approval safeguards; do not create an Azure Container Apps job, scheduling, Key Vault or paid resources without explicit owner consent and reviewed location/cost.
- Backup scope is `public` + `supabase_migrations` only, not global roles, managed auth/storage, uploaded assets or full Supabase recovery. Independent rehydration must document these omissions and separately provision roles/extensions.
- Do not use `Supabase restore_project` against the staging source as a substitute for distinct cold restore; it can be destructive. Never expose student data, backup bytes, AGE identities or credentials in Git, Notion or chat.
- A rollback of source code does not automatically undo database schema/data mutations or restore changed environment variables.
- Production currently uses ephemeral SQLite and has distinct durability problems; staging recoverability evidence does not address production data safety.

## Next steps — exact handoff

1. **Next action:** Trusted Azure owner inspects existing account, private `campuspool-staging-backups` container, manual Container Apps job, managed-identity RBAC and any encrypted objects. Record **sanitized metadata only** in [evidence manifest](../../ops/RECOVERY_EVIDENCE_MANIFEST.md); no keys or ciphertext posted. If job is absent, obtain separate billing/resource approval before provisioning.
2. **Who may do it:** approved cloud security/operator team with private Azure access and a *separate* recovery destination. Release owner independently checks Render dashboard rollback eligibility **without clicking Rollback**.
3. **Prerequisites:** explicit cloud resource/cost/region consent; approved isolated encrypted job runner and PG17/PostGIS recovery target; AGE private identity held outside backup worker; correct source and destination allowlists.
4. **Expected evidence:** private blob access disabled for anonymous users; encrypted object size > empty AGE envelope; SHA-256 local/remote equality; independently re-downloaded ciphertext verified, decrypted and restored; public/schema/ledger/role/RLS/permissions/content parity; Render previous build shown eligible with tested *rehearsal plan*; accountable signoff.
5. **Production impact:** none, read-only source/metadata audit. Do not claim backup or restore complete before independent proof.

## Links and files changed

- Branch: `ops/recovery-gate-evidence-audit-2026-11-05`
- Operator [cloud worker runbook](../../ops/CLOUD_AZURE_BACKUP_WORKER.md) and [evidence manifest](../../ops/RECOVERY_EVIDENCE_MANIFEST.md)
- Current production pinned SHA `1020e2e4a6d4`, staging pinned SHA `cceadbf6251f`.
