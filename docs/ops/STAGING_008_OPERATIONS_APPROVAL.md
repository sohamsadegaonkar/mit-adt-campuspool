# Staging 008 operator gate: environments, export identity, CA, image pins, real write freeze

**Date:** 23 November 2026. **Status:** SOURCE-ONLY AUDIT; operational backup/restore approval **DENIED / NOT READY**. No live DDL, freeze, source export, restore or migration was performed by this review.

## 1. Two protected GitHub environments — factual status

A read-only, signed-in GitHub settings page was inspected for
\`staging-008-backup\` (repository \`sohamsadegaonkar/mit-adt-campuspool\`):

| Control | Readback | Required decision |
|---|---|---|
| Environment exists | YES | Keep |
| Required reviewers | ON | Keep ON |
| Prevent self-review | ON | Keep ON |
| Only listed reviewer | repository owner | **Blocked** if owner also triggers run; distinct reviewer required |
| Deployment branches | **No restriction** | Select **main-only** |
| Administrator bypass | **Allowed** | Disable for both recovery environments |
| \`STAGING_BACKUP_DATABASE_URL\` | Name present | Contents inaccessible; **never claim vetted** |
| \`STAGING_BACKUP_CA_PEM_B64\` | Not listed | Missing |
| \`STAGING_BACKUP_AGE_RECIPIENT\` | No environment variables listed | Missing |
| \`STAGING_008_BACKUP_ADMIN_ACK\` | Not listed | Missing if privileged export is chosen |

The second \`staging-008-restore\` environment's authenticated settings **could not be accessed** through the connected GitHub app. It is **NOT VERIFIED**, even though its name appears in workflow YAML. No protected-environment configuration was changed.

Before dispatch, **separately** inspect the restore environment: \`main\` only, required human reviewer independent of backup author/export operator, self-review prevented, admin bypass disabled, restore-only \`STAGING_008_AGE_IDENTITY\` secret present (but never show contents), and zero backup/source URL/CA secrets in the restore environment. Require separate human review if branch restrictions/permission changes are proposed.

## 2. Database export identity — read-only live Supabase evidence

Exact staging project: \`tnitksrlntrdxbvznxzf\`, healthy PostgreSQL **17.11** on 2026-11-23, migration ledger \`001–007\`; no \`008\` receipt relation.

From a scoped **READ ONLY** catalog check:

- \`campuspool_staging_app\`: LOGIN true, no SUPERUSER/CREATEROLE/CREATEDB/BYPASSRLS; backend SELECT/INSERT/UPDATE/DELETE **all true** on **nine** CampusPool tables; no \`USAGE\` or \`SELECT\` on \`supabase_migrations.schema_migrations\`.
- \`postgres\`: LOGIN true, CREATEROLE/CREATEDB/REPLICATION and BYPASSRLS true; \`SELECT\` on migration ledger **true**. Thus using \`postgres\` in a backup workflow is an **admin-risk decision**, not an approved least-privilege export identity.
- \`anon\` and \`authenticated\`: no write grants on those nine CampusPool tables; all nine RLS-enabled with a policy.
- No app-role sessions were observed at the time of the read, but app-role DML grants remain enabled. **This does not establish a write freeze.**

**Decision:** do **not** approve existing \`postgres\` credentials for the backup workflow merely because the secret name exists. Require owner-reviewed, staging-only scope/credential, short exposure and expiry, no logs, limited use to a one-time encrypted export, and independent role permission evidence. A new dedicated export role or a temporary approved elevated connection may be evaluated *separately*. Do not widen the running app role to read migration history or give it BYPASSRLS solely to make \`pg_dump\` work.

## 3. CA / TLS — policy verified, actual runner chain not verified

\`scripts/staging-008-backup-guard.js\` verifies:
- exact staging DB target/user and \`sslmode=verify-full\`,
- a single X.509 PEM of bounded size and validity,
- SHA-256 of the **certificate DER** matches pinned hash
  \`807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA\`,
- \`ssl: {ca, rejectUnauthorized:true}\` before any staging catalog read.

An independent Supabase API SQL connection reported server \`ssl=on\` and its own SQL connection used SSL, **but this does not authenticate the backup runner's future CA or hostname**. The backup environment's \`STAGING_BACKUP_CA_PEM_B64\` secret is missing. Do **not** approve TLS until an owner retrieves the correct CA from that Supabase project's Database settings, privately verifies the DER SHA-256 matches the pin and validity, stores it as an environment secret (never in Git, chat or logs), and the exact protected runner proves \`verify-full\` against the intended staging host. [Official Supabase connection instructions](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 4. Immutable review-only Docker image pins

Read-only official Docker Hub tag API, 2026-11-23:

| Source tag | Pinned OCI multiarch **index digest** | linux/amd64 manifest |
|---|---|---|
| \`postgres:17-bookworm\` | \`sha256:837bed18782820fe967067cb5328b02b0d9992c1be9a37ee0c9c492cfc03af3b\` | \`sha256:8d174ddfb292f26b6ec8d97f55d944ccab547fa8bfe9e4fd3c24afdc819ee423\` |
| \`postgis/postgis:17-3.5\` | \`sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6\` | \`sha256:8dfee83d8bd4c2873dc4a233c13ba2799a44f2edb16a0552d58715917fac32ba\` |

Sources: [Docker official postgres tag API](https://hub.docker.com/v2/repositories/library/postgres/tags/17-bookworm) and [PostGIS tag API](https://hub.docker.com/v2/repositories/postgis/postgis/tags/17-3.5). Both manual and synthetic workflow \`image:\`, \`docker run/pull\` and container-selection filters now require \`tag@sha256:<index digest>\` rather than mutable tag alone. [Pinned-image exact-head offline CI](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/45147942456) passed all three recovery test jobs, plus other independent branch workflows. Pinning authenticates immutable image identity **not** its total absence of vulnerabilities.

## 5. Establish a **real** staging app-write freeze (not executed)

Current live staging **is not frozen**: Render staging service is not suspended, auto-deploy OFF does **not** block writes; \`campuspool_staging_app\` has LOGIN and CRUD on all nine app tables. No app-role sessions were observed at the read instant, but the role can connect again and write.

A reversible **operator-controlled staging maintenance window** is required:
1. Independently approve a specific freeze time, source commit, intended workload/zero app rows/007 ledger inventory, *recovery/thaw operator*, and a plan to stop **all** application/API/scheduled/external writes. Determine and record all privileged or service-role writers; database admin access is still write-capable.
2. After approving the change and validating the exact DB project, drain/suspend staging application traffic (not just switch autoDeploy off). Under separately approved staging admin authority, make the single named \`campuspool_staging_app\` role **NOLOGIN** and remove its \`INSERT,UPDATE,DELETE\` on the nine app tables and write-access to any app-owned sequences. Do **not** alter production or globally revoke Supabase-managed roles. Record the prefreeze grants for reversible regrant after the approved change.
3. Confirm any old pooled app-role sessions are drained; new connection attempts should fail, \`has_table_privilege\` of all nine tables should show SELECT true and all three DML privileges false, and no app-role sessions remain. Confirm the 008 table is still absent. **No source DB write was performed in this review**.
4. New code \`scripts/staging-008-freeze-verify.js\` checks that exact DB snapshot and app-role session readback **READ ONLY**; the protected backup's \`staging-008-backup-guard.js\` now **refuses export unless the app-role freeze is actually observed**. Pure tests reject current live unfrozen role, undrained sessions, exposure, incomplete RLS and mutable permissions. The gate always reports \`databaseWideWriteFreezeVerified:false\` because privileged/external writes cannot be ruled out by this role check alone.
5. Independent operator separately verifies no remaining admin/app/service writers, owner-approved RPO/RTO and backup/rollback change-window policy. Only then can any **separately approved** one-off export be initiated. After an accepted independent cold restore and separate 008 approval, reverse the freeze using the recorded exact source grants and confirm normal authorized app behavior. **No automatic thaw or in-place rollback over newer user bookings.**

**Important:** Applying \`NOLOGIN\`/DML revocation now, before the GitHub environments and export credentials work, could make staging unavailable indefinitely. **No freeze DDL was executed**, and a typed workflow acknowledgment is not proof of a freeze. Source changes here are controls, not operational completion.

## Release verdict

- **PASS:** tagged image identity pinned to official index digests; policy/negative checks and synthetic cold restore.
- **FAIL/UNVERIFIED:** backup environment main-only rule, independent reviewer and bypass control; restore environment entire rule/secret audit; CA and AGE recipient secret existence; permitted export identity; genuine live write-freeze, trusted independent real encrypted backup and scratch cold restore.
- **NO-GO:** running the manual protected workflow, applying staging 008, deploying Render staging, Azure/GHCR changes, production rollout.

Owner can open [GitHub environment settings](https://github.com/sohamsadegaonkar/mit-adt-campuspool/settings/environments) to inspect both; do not paste secret values or modify reviewers/sharing without explicit agreement.
