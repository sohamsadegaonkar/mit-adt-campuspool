# Task: Verify staging backup and release prerequisites

- **Task ID / file:** `2026-11-03-staging-backup-restore-gates`
- **Status:** blocked — live encrypted off-site backup, independent real-staging restore and Render workspace confirmation unavailable; synthetic CI rehearsal passed; real staging gates still blocked
- **Agent / owner:** ChatGPT engineering agent (code/CI); account owner responsible for workspace selection and private backup export
- **Last updated:** 2026-11-03 UTC
- **Baseline:** `main@3ee1f4a12e98`, draft PR #11 head `6fb7e55` at task start
- **Scope:** read-only Supabase schema and role checks; Render workspace discovery without choosing; CI **synthetic** PostgreSQL backup/restore rehearsal; release runbook improvements. No live SQL writes, staging deploy, production action or real staging backup.
- **Dependencies / related tasks:** [preflight](2026-11-03-staging-migration-preflight.md), [staging review](2026-11-03-staging-permissions-browser-retry.md), [runbook](../../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md).

## Goal and acceptance criteria

Carry forward staged release only after an encrypted **actual staging** export is cryptographically verified, independently restored to a different protected environment and the correct Render workspace/staging service and last-good deploy SHA are confirmed. A synthetic backup drill tests only tooling and **cannot** satisfy these gates.

## Current state (verified vs assumed)

- Supabase staging `tnitksrlntrdxbvznxzf` is ACTIVE_HEALTHY, PostgreSQL 17.11, migrations 001–007, no 008; current core user, ride, booking, intent and session counts = 0. Current backend role has LOGIN but no superuser/RLS bypass; protected core tables retain RLS and reject direct anon/authenticated SELECT; security advisor has no findings.
- Render connection shows **one available workspace** `My Workspace` (`tea-d8sftp7avr4c73fo8pbg`), but **the user has not confirmed it as target** and no workspace was selected. This must be confirmed before invoking service/deploy mutations or asserting any current Render SHA.
- Supabase project is Free; automatic daily backups are unavailable. Connected Supabase actions do not provide a pg_dump artifact, verified external backup repository or separate restore destination. No actual backup or restoration was performed.
- PR #11 open, draft and unmerged. Current staging migration 008 absent. No staging deployment or rollback performed.

## Plan

1. Read-only verify project, migrations, RLS and release branch.
2. Confirm workspace choice from user instead of inferring ownership from one available workspace.
3. Test archive/encryption/checksum and independent logical-database restoration on **disposable synthetic PostGIS CI**.
4. Revise operator procedure using Supabase-supported roles/schema/data backups, independent restoration and an encrypted private destination.
5. Do not execute migration 008 or deploy until the **real** restore and verified previous SHA are documented.

## Progress log

- 2026-11-03 UTC — Rechecked Supabase staging metadata, exact counts, role/grants and security advisor with read-only SQL and connected project tools. No 008.
- 2026-11-03 UTC — Render list_workspaces returns `My Workspace` as sole candidate; selected workspace not established, so no service history/rollback SHA is verified.
- 2026-11-03 UTC — Supabase 2026 backup docs confirm Free-tier manual export needed; recommended `supabase db dump` roles/schema/data and note that a normal schema-only dump excludes data and roles.
- 2026-11-03 UTC — Added synthetic-only `test_pg_backup_restore.js` in the disposable PostGIS CI job to rehearse encrypted archive/checksum and a freshly created logical DB restore. First CI rehearsal failed due to PostgreSQL client/server major-version mismatch (runner pg_restore 17 vs disposable PostGIS PG16). PostgreSQL 16 client tools were unavailable through the runner's apt sources; revised the drill to use matching PostgreSQL 16 pg_dump/pg_restore binaries inside the disposable PostGIS service container, without a runner-level install. The final disposable backup/restore test passed at `f59eb8b` (PostGIS #41597004644). All other workflows passed: security #41597004543, docs #41597004472, credentials #41597004588. No actual staging backup, off-site artifact, staging restore, migration or deploy was performed.

## Verification

| Gate | Evidence | State |
|---|---|---|
| Dedicated staging Supabase metadata/privileges | Fresh read-only Supabase connector queries | PASS on present schema |
| Live staging backup artifact/checksum | No private export mechanism or encrypted off-site target available in this session | **NOT VERIFIED — blocked** |
| Scratch restore of **actual** staging backup | No dump, independent target or private connection | **NOT PERFORMED — blocked** |
| CI synthetic dump/restore | `npm run test:backup-restore-ci`, local PostGIS 16 container tools | PASS at `f59eb8b` (#41597004644); **not staging backup** |
| Confirmed Render workspace/deploy SHA | Workspace candidate surfaced but not user-confirmed | **BLOCKED** |
| Staging migration 008/rollback | Gates unmet | **NOT PERFORMED** |

## Risks and decisions

- Backup/restore of synthetic CI data is categorically separate from backup/restore of actual staging; do not conflate.
- Supabase CLI `db dump` defaults to schema only; include roles, data and migration history where required and preserve backend grants/RLS in scratch verification.
- Never save real data, DB credentials or dump contents in GitHub artifacts, PRs, chat or public repository. Keep backup encrypted and stored off-site with restricted access.
- Any rollback to old application code retains additive migration 008 receipt table; live DB destructive restore only after separately reviewed downtime/data loss.

## Next steps — exact handoff

1. **Next action:** get explicit confirmation of Render workspace `My Workspace`, inspect its staging service + previously successful deploy SHA and verify the correct Git branch and exact rollback artifact. Account owner privately exports encrypted staging database and restores to a separate scratch PG/PostGIS environment.
2. **Who may do it:** verified workspace owner for Render/service and backup/restore; engineering reviewer for isolated CI and verification of evidence.
3. **Prerequisites and blockers:** confirmed workspace, secure staging owner connection, trusted off-site encryption destination, independent recovery target and rollback SHA.
4. **Expected evidence:** true staging ciphertext backup hash, independent restore success and matching schema/data counts, confirmed prior Render deploy SHA and deployment restoration method; then before/after stage preflight, migration 008 and E2E.
5. **Production impact:** none. No staging migration or deploy.
