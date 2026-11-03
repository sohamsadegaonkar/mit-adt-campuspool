# Task: Verify staging backup and release prerequisites

- **Task ID / file:** `2026-11-03-staging-backup-restore-gates`
- **Status:** blocked — Render workspace and deploy SHAs now verified read-only; live encrypted off-site backup, independent real-staging restore and artifact-eligible rollback rehearsal still unverified; synthetic CI rehearsal passed
- **Agent / owner:** ChatGPT engineering agent (code/CI); account owner responsible for workspace selection and private backup export
- **Last updated:** 2026-11-03 UTC
- **Baseline:** `main@3ee1f4a12e98`, draft PR #11 head `6fb7e55` at task start
- **Scope:** read-only Supabase schema and role checks; confirmed Render workspace, staging service and deploy history; CI **synthetic** PostgreSQL backup/restore rehearsal; release runbook improvements. No live SQL writes, staging deploy, production action or real staging backup.
- **Dependencies / related tasks:** [preflight](2026-11-03-staging-migration-preflight.md), [staging review](2026-11-03-staging-permissions-browser-retry.md), [runbook](../../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md).

## Goal and acceptance criteria

Carry forward staged release only after an encrypted **actual staging** export is cryptographically verified, independently restored to a different protected environment and the correct Render workspace/staging service and last-good deploy SHA are confirmed. A synthetic backup drill tests only tooling and **cannot** satisfy these gates.

## Current state (verified vs assumed)

- Supabase staging `tnitksrlntrdxbvznxzf` is ACTIVE_HEALTHY, PostgreSQL 17.11, migrations 001–007, no 008; current core user, ride, booking, intent and session counts = 0. Current backend role has LOGIN but no superuser/RLS bypass; protected core tables retain RLS and reject direct anon/authenticated SELECT; security advisor has no findings.
- **Confirmed by account owner and Render metadata on 2026-11-03:** workspace `My Workspace` (`tea-d8sftp7avr4c73fo8pbg`). Only the staging web service `mit-adt-campuspool-staging` (`srv-dbjof8fb9u1s73eks0bg`) was inspected; region Singapore, Node runtime, repo `sohamsadegaonkar/mit-adt-campuspool`, configured branch `main`, auto-deploy **off**, health-check path **not configured**, service status not suspended. Live deploy `dep-dbke9uo8v5cc738cpnd0`, Git SHA `cceadbf6251f70634320e50b8288530ba77513c3`, finished successfully on 2026-11-02 19:31:42 UTC. Prior successful but now deactivated deploy `dep-dbkdr5qjnfac738p2heg` at Git SHA `fe93c6be16b49864571da80c186fbb0577485878`, completed 2026-11-02 19:00:09 UTC. The Git commits were independently found in GitHub. A service-specific rollback artifact must still be verified eligible in the dashboard; a historical successful deploy record by itself does not prove an artifact remains retained.
- Supabase project is Free; automatic daily backups are unavailable. Connected Supabase actions do not provide a pg_dump artifact, verified external backup repository or separate restore destination. No actual backup or restoration was performed.
- PR #11 open, draft and unmerged. Current staging migration 008 absent. No staging deployment or rollback performed.

## Plan

1. Read-only verify project, migrations, RLS and release branch.
2. Confirm workspace choice from user and verify actual staging branch/live deploy SHA and prior successful deploy (completed).
3. Test archive/encryption/checksum and independent logical-database restoration on **disposable synthetic PostGIS CI**.
4. Revise operator procedure using Supabase-supported roles/schema/data backups, independent restoration and an encrypted private destination.
5. Do not execute migration 008 or deploy until the **real** restore and verified previous SHA are documented.

## Progress log

- 2026-11-03 UTC — Rechecked Supabase staging metadata, exact counts, role/grants and security advisor with read-only SQL and connected project tools. No 008.
- 2026-11-03 UTC — Initial workspace discovery left the target unconfirmed; account owner subsequently explicitly confirmed `My Workspace`. Render service and deployment history now verified with read-only connected tools (details above).
- 2026-11-03 UTC — Supabase 2026 backup docs confirm Free-tier manual export needed; recommended `supabase db dump` roles/schema/data and note that a normal schema-only dump excludes data and roles.
- 2026-11-03 UTC — Added synthetic-only `test_pg_backup_restore.js` in the disposable PostGIS CI job to rehearse encrypted archive/checksum and a freshly created logical DB restore. First CI rehearsal failed due to PostgreSQL client/server major-version mismatch (runner pg_restore 17 vs disposable PostGIS PG16). PostgreSQL 16 client tools were unavailable through the runner's apt sources; revised the drill to use matching PostgreSQL 16 pg_dump/pg_restore binaries inside the disposable PostGIS service container, without a runner-level install. The final disposable backup/restore test passed at `f59eb8b` (PostGIS #41597004644). All other workflows passed: security #41597004543, docs #41597004472, credentials #41597004588. No actual staging backup, off-site artifact, staging restore, migration or deploy was performed.

- 2026-11-03 UTC — Render provider records and GitHub independently confirm live code commit `cceadbf6251f` and its deploy ID `dep-dbke9uo8v5cc738cpnd0`, which is the rollback **baseline for any later staging deployment**. Secondary previously successful deploy `fe93c6be16b4`, `dep-dbkdr5qjnfac738p2heg`. Render docs https://render.com/docs/rollbacks document Dashboard → Deploys → Rollback to this deploy, limited by retained build artifact. Current connector has no rollback action; no dashboard button eligibility, historical environment values, live health response or actual rollback was verified. https://render.com/docs/deploys documents Manual Deploy → Deploy a specific commit by SHA; using connector `trigger_deploy` without SHA would deploy configured `main`, not PR #11. Auto deploy remains off. No service settings changed.

## Verification

| Gate | Evidence | State |
|---|---|---|
| Dedicated staging Supabase metadata/privileges | Fresh read-only Supabase connector queries | PASS on present schema |
| Live staging backup artifact/checksum | No private export mechanism or encrypted off-site target available in this session | **NOT VERIFIED — blocked** |
| Scratch restore of **actual** staging backup | No dump, independent target or private connection | **NOT PERFORMED — blocked** |
| CI synthetic dump/restore | `npm run test:backup-restore-ci`, local PostGIS 16 container tools | PASS at `f59eb8b` (#41597004644); **not staging backup** |
| Confirmed Render workspace/deploy SHA | User confirmation + Render service, get_deploy and GitHub commit records | **PASS** workspace, service, branch, live/prior SHA; actual rollback artifact eligibility remains unverified |
| Render rollback rehearsal | Render docs support Dashboard rollback of retained successful build, but artifact eligibility unverified | **NOT PERFORMED — awaiting backup/restore and operator release gate** |
| Staging migration 008/deploy | Gates unmet | **NOT PERFORMED** |

## Risks and decisions

- Backup/restore of synthetic CI data is categorically separate from backup/restore of actual staging; do not conflate.
- Supabase CLI `db dump` defaults to schema only; include roles, data and migration history where required and preserve backend grants/RLS in scratch verification.
- Never save real data, DB credentials or dump contents in GitHub artifacts, PRs, chat or public repository. Keep backup encrypted and stored off-site with restricted access.
- Any rollback to old application code retains additive migration 008 receipt table; live DB destructive restore only after separately reviewed downtime/data loss.

## Next steps — exact handoff

1. **Next action:** account owner securely exports the **actual** staging PostgreSQL 17 database, encrypts an off-site copy, checks its SHA-256 hash and independently restores roles/schema/data to compatible isolated PostgreSQL/PostGIS target. Then verify the Render Dashboard still offers Rollback to deployment `dep-dbke9uo8v5cc738cpnd0` at `cceadbf6251f` (do **not** click before release approval), and record the confirmation. Current workspace and SHA no longer need selection.
2. **Who may do it:** verified workspace owner for Render/service and backup/restore; engineering reviewer for isolated CI and verification of evidence.
3. **Prerequisites and blockers:** workspace and SHA are confirmed; missing secure staging owner connection, trusted off-site encryption destination, independent actual-data recovery target and build-artifact rollback eligibility.
4. **Expected evidence:** true staging ciphertext backup hash, isolated actual-data restore success and matching schema/data counts, dashboard eligibility to roll back to `dep-dbke9uo8v5cc738cpnd0`, read-only preflight; then separately approved stage migration 008, exact-SHA deploy, E2E and rollback rehearsal.
5. **Production impact:** none. No staging migration or deploy.
