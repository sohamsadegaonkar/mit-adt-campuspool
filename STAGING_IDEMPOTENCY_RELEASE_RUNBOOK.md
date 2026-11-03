# Staging-only migration 008 — verifiable backup, release and rollback

**Decision: NO-GO for staging mutation on 2026-11-03.** This is an operator runbook, not authorization to deploy production.

## Verified baseline

- Supabase `campuspool-staging-db` (`tnitksrlntrdxbvznxzf`): PG 17.11, migrations 001–007, **no** 008/idempotency table.
- Backend `campuspool_staging_app`: LOGIN true, not superuser, not BYPASSRLS, no CREATE on public/extensions, backend CRUD on private RLS-protected tables. Anon/authenticated lack direct SELECT. No security advisor notices.
- Exact counts in users, sessions, OTP challenges, rides, bookings, trip intents and ride geo: **0** at verification time. Zero is **not** a backup.
- Tested branch `security/transactional-idempotency-2026-11-03`, commit `282df2c`: isolated CI passed. Render service/branch/latest deploy SHA must still be independently confirmed.

## Gate A — select exact Render service and rollback reference

1. Owner confirms Render workspace name/ID and intended **staging-only** service. Verify its configured Git branch, deployed SHA, auto-deploy disabled, secrets present (never display values), `AUTH_OTP_BACKEND`, `RIDES_BACKEND`, Basic Auth and database hostname.
2. Record the **actual deployable previous staging artifact/commit**, health result and method to redeploy **that exact version**. Generic Render `trigger_deploy` deploys the configured service branch, not an arbitrary PR commit.
3. If staging remains on `main` or other branch rather than this CI-tested feature commit, stop. Do not silently merge to production branch.

## Gate B — protected off-site database export and isolated restore

Supabase [Database Backups](https://supabase.com/docs/guides/platform/backups) states daily automatic backups are on Pro/Team/Enterprise. Free requires manually managed exports. Operator uses a trusted machine with a compatible PostgreSQL 17+ client and a private DB-owner connection, **not** chat or Git.

```bash
# Operator-only example; STAGING_DB_URL and OUT supplied securely by your shell.
umask 077
pg_dump --dbname="$STAGING_DB_URL" --format=custom --file="$OUT"
sha256sum "$OUT"
pg_restore --list "$OUT" > "$OUT.inventory"
```

Store encrypted and off-site. Never upload the dump, passwords, database URLs or student records to PRs, chat, CI logs or this task. The operator must **actually restore** to a separate disposable PostgreSQL/PostGIS-compatible target with role/extension prerequisites. Compare table names, primary keys/indexes, policies/RLS, app grants and exact counts; log only safe metadata and restore success/failure. Supabase-managed schemas/roles can require a compatible dedicated restore project. A partial restore or successful `pg_restore --list` alone does **not** prove full recovery. Confirm the dump hash matches the copy used.

**Hard gate:** No successful off-site export, checksum and independent restore = no staging migration.

## Gate C — additive staging migration 008

1. Re-read the staging migration list and table status; confirm exactly `tnitksrlntrdxbvznxzf`, reviewed 008 SQL, correct role, backup time and restore report.
2. Apply the audited `stage1-otp/migrations/008_transactional_idempotency.sql` only to this staging project using the approved migration workflow. Never run the full `migrate:otp` script against live staging without separately reviewing all 001–008.
3. Recheck `campus_idempotency_keys` RLS enabled, app-role CRUD, anon/authenticated denied direct SELECT, no privilege escalation, correct indexes and empty/expected row counts. Re-run Supabase security advisor. Stop on any error.

## Gate D — controlled staging deployment and E2E

Deploy the exact vetted commit to the confirmed staging service with auto deploy off. Frontend and backend must update together. Verify deployed SHA, /healthz, staging Basic Auth, verified sessions/CSRF, and synthetic-account tests: double click, network ambiguity/reload, cross-user keys, 428 missing header, 409 changed body, 429 capped replay, ride seat contention, cancellation, stale browser clients and restart persistence. No actual payments or unsolicited OTPs.

## Gate E — rollback rehearsal

1. Exercise the prevalidated return to the **previous staging build**, restoring its app flags and secrets without exposing secret values; verify the old SHA and service health after rollback.
2. Keep additive migration 008 table and receipts intact so a new build cannot inadvertently repeat an operation. **Do not DROP TABLE** as an emergency rollback.
3. Compare counts and permissions. If database recovery is unavoidable, use the verified off-site dump through an independently approved controlled restore with downtime/data-loss assessment; do not overwrite staging without authorisation.
4. Attach timestamps, test outcomes, operator approval and rollback SHA to the task handoff.

| Gate | State |
|---|---|
| Existing table grants and RLS | Verified read-only |
| Browser/PG isolated CI on tested implementation | Passed `282df2c` |
| Off-site export and independent restore | **Not performed / blocked** |
| Render workspace/service/previous SHA | **Verified** (see audit below); retained rollback build eligibility unverified |
| Live migration 008 | **Not performed** |
| Staging deploy, browser QA, rollback rehearsal | **Not performed** |

**Production is never part of this runbook.**

## Read-only automated migration preflight (new branch-local development)

After confirming that the private `OTP_DATABASE_URL` targets ONLY the dedicated staging project and **before migration 008**, the authorized operator can run:

```bash
# Run on the trusted operator machine with OTP_DATABASE_URL already supplied privately.
APP_ENV=staging OTP_DB_SSL=true npm run check:staging-migration -- --mode=before
```

It verifies the exact Supabase project ref (including pooler username suffix), server-only grants, app role privilege flags and RLS/policies. Its SQL transaction is `REPEATABLE READ READ ONLY`. It refuses unknown projects and never migrates, exports, alters or deploys anything. Its `releaseReady` value is intentionally `false` even on success because backup/restore and Render rollback proof are separate approval gates.

Only *after* a separately authorized additive 008 migration is completed, run `--mode=after` to check receipt table, index, RLS and privileges. **Do not use** the all-in-one `npm run migrate:otp` script as an unreviewed staging upgrade: it re-executes all 001–008 migrations and has no own applied-version ledger.

## CI verification — 2026-11-03

The preflight implementation passed the full isolated GitHub suite at code commit `4d66aa0`: PostgreSQL/PostGIS #41595567003, security smoke #41595567015, credentials #41595567125 and agent docs #41595567097. **This is not evidence of a completed staging dump, restore, Render rollout or applied migration 008.**

## Operator backup/restore notes verified against current Supabase guidance

The earlier generic `pg_dump` example is **not sufficient by itself** to claim a full Supabase recovery: a raw database dump may capture managed schemas which cannot cleanly be restored into a new Supabase instance. Current Supabase documentation recommends a **separate** `supabase db dump` of **roles**, **schema**, and **data**; schema-only defaults do **not** include data or custom roles. Review the current official guide before the real run:
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/deployment/ci/backups

The owner should arrange a trusted machine and privately supplied staging DB URL, run `supabase db dump --help` against the installed version, export roles/schema/data and necessary migration history, encrypt the exports locally (for example with an age recipient key managed by the owner), store only ciphertext off-site, compute ciphertext SHA-256 and prove decryption into an **isolated** scratch restore target. Record audit-friendly counts and RLS grants, **never** dump contents or credentials. The actual restore must include compatible Supabase schemas/extensions and permission setup; a successful `pg_restore --list` alone is insufficient.

A disposable CI-only regression test `npm run test:backup-restore-ci` exercises PostgreSQL custom-format archive, AES-256-GCM protection, SHA-256 integrity and a fresh scratch database restore with test-only data. **Its result cannot serve as actual staging backup or off-site restore evidence.**

## CI-only backup and restore rehearsal — passed

Commit `f59eb8b` passed GitHub PostGIS workflow #41597004644. The disposable PostGIS 16 test used matching PG16 archive tools **inside the container**, encrypted synthetic archive bytes using AES-256-GCM, verified SHA-256 integrity and restored into a fresh logical PostgreSQL database. It compared table counts, RLS policy counts and client/backend grants. Security, docs and credential workflows also passed.

**Not a staging backup or real rollback:** no Supabase staging export, actual staging independent restore, verified Render rollback SHA, migration 008 or live deployment occurred. Before a live migration, confirm `My Workspace` with the account owner, inspect the staging service and execute the encrypted actual-stage backup/restore gate.

## Read-only Render staging audit — 2026-11-03 UTC (workspace approved)

Account owner confirmed workspace `My Workspace`, `tea-d8sftp7avr4c73fo8pbg`. Render service metadata and deployments were inspected without changing any settings, executing deploys, secrets or SQL:

| Field | Verified value |
|---|---|
| Staging service | `mit-adt-campuspool-staging`, `srv-dbjof8fb9u1s73eks0bg` |
| Dashboard | https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg |
| Git repo and configured branch | `sohamsadegaonkar/mit-adt-campuspool`, `main` |
| Auto-deploy | OFF |
| Runtime / region | Node.js / Singapore |
| Health check path | None configured; deployed status is not a real HTTP health check |
| Current live deploy | `dep-dbke9uo8v5cc738cpnd0` — SHA `cceadbf6251f70634320e50b8288530ba77513c3` — successful at 2026-11-02 19:31:42 UTC |
| Prior successful but deactivated deploy | `dep-dbkdr5qjnfac738p2heg` — SHA `fe93c6be16b49864571da80c186fbb0577485878` — successful at 2026-11-02 19:00:09 UTC |

The correct rollback baseline **for a future staging idempotency release** is `dep-dbke9uo8v5cc738cpnd0` / `cceadbf6251f`, because this is the currently live successful build. Once a new code version is actually deployed, the operator should use **Render Dashboard → Staging service → Deploys → Rollback** to that exact baseline, after confirming that the prior artifact is still retained. See https://render.com/docs/rollbacks. A successful history entry is **not** proof that an old build artifact is available for rollback. No live rollback or button-eligibility check occurred.

Important: the staging service follows `main`, **not** draft PR #11. Render's Dashboard supports **Manual Deploy → Deploy a specific commit** by SHA from the linked repository; see https://render.com/docs/deploys. The connector's `trigger_deploy` tool does **not** take a SHA and would deploy the service's configured branch. **Never trigger it to publish PR #11**. Do not merge to `main` just to force staging deployment. Deploying a specific commit, and any migration, remain strictly deferred until after encrypted off-site staging backup + independent actual-data restore, release authorization and a verified eligible rollback target.

Render rollback restores a historical service build/configuration only; **it does not roll back PostgreSQL records or schema**. Keep migration 008 additive and intact during app rollback. The staging runtime's configured health-check path is currently blank; separately verify `/healthz`, browser security controls and synthetic user flows after an authorized staged deployment. No production changes were made.

## Owner-executed real staging backup gate — verified CLI procedure, NOT EXECUTED

**2026-11-03 live read-only recheck:** staging Supabase `tnitksrlntrdxbvznxzf` is PG17.11, on migrations 001–007, 008 absent, and user/ride/booking counts zero. Render staging service `srv-dbjof8fb9u1s73eks0bg` still has live deployment `dep-dbke9uo8v5cc738cpnd0` / `cceadbf6251f`. The Supabase organization is Free. **No database-owner export credential, secure off-site storage destination, verified independent scratch PG17 target or retained rollback artifact check is accessible from the current connected tools.** These operations are therefore **NOT DONE**; a synthetic CI backup is not an actual backup.

**Operator preparation, not a secret-sharing request:** Run on a personally controlled, encrypted Linux/WSL2/macOS machine with Docker, installed current Supabase CLI, PostgreSQL **17** client, `age` encryption and a separately configured encrypted off-site destination. Obtain the stage-only owner connection string privately from [Supabase staging Connect](https://supabase.com/dashboard/project/tnitksrlntrdxbvznxzf); prefer session pooler on IPv4 networks. Do not paste the URI/password or any dump into a chat, source control, logs or GitHub Actions. Before executing, run `supabase db dump --help` and verify the installed CLI supports `--role-only`, `--data-only` and `--use-copy`. Ensure `STAGING_DB_URL` is **exactly** project `tnitksrlntrdxbvznxzf` (direct host `db.tnitksrlntrdxbvznxzf.supabase.co`, or pooler username ending in `.tnitksrlntrdxbvznxzf`), never production.

The **following illustrative commands** must be executed *only by the approved operator*, using a temporary directory on their private encrypted filesystem, a preconfigured recipient public key in `AGE_RECIPIENT`, and an approved `OFFSITE_DIR` mounted from a secure remote provider:

```bash
set -euo pipefail
set +x                         # Never print database URLs or encryption material
umask 077
: "${STAGING_DB_URL:?secure operator environment required}"
: "${AGE_RECIPIENT:?age public recipient required}"
: "${OFFSITE_DIR:?approved off-site mounted directory required}"
supabase db dump --help
psql --version                 # Must use PG17 compatible client
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT  # Use only a trusted encrypted local volume
supabase db dump --db-url "$STAGING_DB_URL" --role-only -f "$work/roles.sql"
supabase db dump --db-url "$STAGING_DB_URL" -f "$work/schema.sql"
supabase db dump --db-url "$STAGING_DB_URL" --use-copy --data-only \
  -f "$work/data.sql"
archive="$OFFSITE_DIR/campuspool-staging-roles-schema-data-2026-11-03.tar.age"
tar -C "$work" -cf - roles.sql schema.sql data.sql |
  age --encrypt --recipient "$AGE_RECIPIENT" --output "$archive"
sha256sum "$archive" > "$archive.sha256"
# Verify the object and digest AFTER the off-site copy/upload completes.
```

**Off-site proof requires more than a locally mounted path:** verify the encrypted remote object exists under the intended account and that a *freshly downloaded* copy's SHA-256 matches the recorded ciphertext checksum. Confirm a working decryption key in a separate protected location. Do not regard this example as successful execution or remote verification.

**Independent restore:** A trusted operator provisions an approved **fresh separate** Supabase-compatible PostgreSQL 17/PostGIS target, records its different project ID and verifies that it is neither production nor the source staging project, and confirms it has no `campus_*` application tables. Decrypt the authenticated `.tar.age` archive into a private encrypted temporary directory, then restore **only to that scratch target** using Supabase's documented roles → schema → data SQL order. From the official [CLI backup/restore documentation](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore):

```bash
# On a trusted operator machine only, after verifying RESTORE_DB_URL points to
# a DIFFERENT disposable project than tnitksrlntrdxbvznxzf:
age --decrypt --identity "$AGE_IDENTITY_FILE" "$archive" | tar -C "$work" -xf -
psql --single-transaction --set ON_ERROR_STOP=1 \
  --dbname "$RESTORE_DB_URL" \
  --file "$work/roles.sql" \
  --file "$work/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$work/data.sql"
```

The target requires Supabase's baseline schemas/roles and the same supported extensions (PostGIS in `extensions`). Backup/restore is **not proven** if objects are skipped or SQL returns errors. A normal plain PostgreSQL instance lacking Supabase roles/schemas is not an equivalent full-fidelity restore. Never restore into `tnitksrlntrdxbvznxzf` itself as a rehearsal. Also verify the correct source migration history separately: Supabase-managed metadata may be excluded by CLI filtering.

**Verify on BOTH source and independent restored target**, comparing outputs that contain only safe metadata:

```sql
SELECT to_regclass('public.campus_users') IS NOT NULL AS users_table,
       to_regclass('public.campus_rides') IS NOT NULL AS rides_table,
       to_regclass('public.campus_idempotency_keys') IS NOT NULL AS migration_008_present;
SELECT (SELECT count(*) FROM public.campus_users) AS users,
       (SELECT count(*) FROM public.campus_sessions) AS sessions,
       (SELECT count(*) FROM public.campus_rides) AS rides,
       (SELECT count(*) FROM public.campus_bookings) AS bookings,
       (SELECT count(*) FROM public.campus_trip_intents) AS intents;
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
       has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
       has_table_privilege('campuspool_staging_app',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS app_crud
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('campus_users','campus_sessions','campus_rides',
                    'campus_bookings','campus_trip_intents')
ORDER BY c.relname;
SELECT tablename,policyname,cmd,roles,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename LIKE 'campus_%'
ORDER BY tablename,policyname;
SELECT rolname,rolcanlogin,rolsuper,rolbypassrls
FROM pg_roles WHERE rolname='campuspool_staging_app';
```

Also verify all other application tables, indexes, constraints, extension versions and column shape, not only this sample; compare no user records or passwords outside the protected restore workspace. Note that custom role passwords are not exported by Supabase and must be provisioned separately for authentication checks.

**Render rollback artifact gate, not yet proven:** The linked Render `get_deploy` reports the current successful `dep-dbke9uo8v5cc738cpnd0` but not whether a retained build will still exist after the next deployment. According to [Render Rollbacks](https://render.com/docs/rollbacks), the operator must open [Staging service's Events page](https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg), locate the successful baseline deployment and confirm the **Rollback** control is offered for a still-retained artifact. **Do not click Rollback during a read-only eligibility inspection.** After an authorized new deployment, verify the baseline is still retained before attempting rollback. Render's generic connector offers neither artifact-retention metadata nor rollback action. Render rollback also does not reverse database migration 008.

### Release decision

**NO-GO**: the required real off-site encrypted staging dump, independent PostgreSQL 17 restore, matching verification evidence and Render artifact eligibility are absent. Do not apply 008, change Render settings, deploy, or run rollback; the CLI snippets above are an operator procedure only.

## Private operator one-command backup export — proposed implementation on PR #11

A fail-closed local-operator wrapper now automates the earlier three separate `supabase db dump` examples. It is **not** a connected-service backup and is NEVER run in CI or Render. On an operator-owned, encrypted Linux/WSL2 machine, install Node 22+, Docker, current Supabase CLI, PostgreSQL **17** psql, age, tar and sha256sum. Provide a private `STAGING_DB_URL` from the exact staging project's Connect panel; do not put it in shell history, GitHub or chat.

The operator must prepare and verify **two separate already-existing paths**: `STAGING_ENCRYPTED_WORKDIR` (encrypted local scratch volume) and `OFFSITE_DIR` (encrypted remote filesystem mount). Configure the **public** age recipient string and attest each property only when verified (the program cannot authenticate physical storage encryption or remote provenance):

```bash
export STAGING_WORKDIR_ENCRYPTED=YES
export OFFSITE_MOUNT_VERIFIED=YES
# Also set privately: STAGING_DB_URL, STAGING_ENCRYPTED_WORKDIR,
# OFFSITE_DIR, AGE_RECIPIENT (age public recipient; no private key).
npm run check:staging-backup          # --preflight: validates, does NOT export
npm run backup:staging-operator       # --execute: authorized operator export
```

The implementation validates the Supabase direct/pooler URL project ref `tnitksrlntrdxbvznxzf` and private credentials, refuses explicitly disabled TLS and unsafe overlapping/repo paths, suppresses sensitive CLI output, places plaintext only in an operator-attested encrypted temporary directory with restrictive permissions, age-encrypts directly to the operator-attested remote mount, creates a SHA-256 sidecar and verifies the mounted ciphertext. **Do not interpret this as a remote download-and-hash proof, independent restored backup, secure role credentials or release approval.**

Operator next **downloads that encrypted remote object independently** (e.g. from the off-site provider's web interface, not through the same mount), checks the downloaded SHA-256 against the recorded sidecar, confirms private decryption works in a separately protected recovery environment and restores the actual roles/schema/data into a **different, disposable Supabase-compatible PG17/PostGIS** target. Compare tables, counts, indexes, RLS/grants/policies, required extensions and migration history before marking Gate B passed. Then separately verify Render's rollback artifact remains available. The command does not apply migration 008, deploy anything or trigger rollback.

Source: `scripts/staging-secure-backup.sh`, validation: `scripts/staging-backup-guard.js`, tests: `test_staging_secure_backup.js`. [Owner task](docs/agents/tasks/2026-11-03-secure-backup-operator-tool.md). Local synthetic preflight/unit tests passed and all four isolated CI workflows passed on code commit `3f723d1` (PostGIS #41602596062, security #41602595899, docs #41602596010, credentials #41602596048). **Actual staging backup and recovery are still NOT PERFORMED.**

## Independent scratch-restore read-only comparison (new unmerged child branch; NOT EXECUTED)

The recovery gate still requires a **real** off-site encrypted staging export, a separately downloaded matching ciphertext checksum, successful decryption and a complete **independent** restore of the roles/schema/data to a different approved Supabase-compatible PostgreSQL 17/PostGIS project. A synthetic CI restore, the export script's mounted checksum, or this comparator alone is not recovery proof.

After the operator verifies that **both** project URLs are private, stage-only and different, the new script can compare application objects and row counts without changing either database. It specifically requires an exact source Supabase project ref and a different exact restore project ref. Both URLs must specify sslmode=require or sslmode=verify-full, and the Node PostgreSQL connection enforces TLS certificate verification. Do not paste private database URLs into shell history, scripts, chat, CI or Git.

Operator supplies privately in the trusted, encrypted local shell:

    APP_ENV=staging
    RESTORE_TARGET_CONFIRMED=YES
    RESTORE_PROJECT_REF=(exact 20-character approved scratch Supabase project ref)
    STAGING_DB_URL=(private Supabase staging owner connection URL with sslmode=require)
    RESTORE_DB_URL=(private different scratch project owner connection URL with sslmode=require)

Run these commands from the branch workspace:

    npm run check:staging-restore -- --preflight
    npm run check:staging-restore -- --compare

The preflight validates the target without opening either database. The compare performs SELECT-only, repeatable-read READ ONLY transactions, with query timeouts. It compares public campus tables and columns, indexes, constraints, RLS policies, grants for anon/authenticated/backend role, relevant DB role flags, selected extensions, migration-history version entries (if visible) and per-table aggregate row counts. Its result **always** includes releaseReady:false. Any discrepancy, missing core table, read/permission failure or connection failure blocks approval; diagnostic output omits URLs/row values/SQL error text. The operator may record the metadata-only result after review but **must never post credentials or private dumps**.

**Scope and limitations:** This is *not* a write/replay test, a row-by-row data checksum, authentication of remote off-site provenance, validation of private role credentials, or a full inventory of Supabase-managed schemas. Matching counts can conceal different records. Querying two databases consecutively can also mismatch if the original is changing; use an approved staging write-free window for meaningful comparison. Compare all provider-managed objects and source migration history as part of the independent manual DBA checklist. The actual restore and role-secret provisioning must be validated separately, and Render staging's retained rollback artifact must still be independently confirmed before any migration 008 or exact-SHA staging deployment.

[Engineering task and limitations](docs/agents/tasks/2026-11-03-staging-restore-compare.md). This work is isolated to an unmerged branch based on draft PR #11. No real staging source/target was accessed, no migration or deploy was performed, and production remains NO-GO.

## Bounded content fingerprints (unmerged child branch; not executed on staging)

The recovery compare verifier's child change adds **internal-only order-independent SHA-256 fingerprints of entire logical row contents** (via `to_jsonb(row)::text`), alongside counts, catalog metadata, RLS, grants and migration-history checks. Every fingerprint is computed inside a PostgreSQL REPEATABLE READ READ ONLY snapshot; individual row data and digest strings are **never printed or copied into the Markdown evidence report**. It uses C collation for stable hash ordering and normalized UTC/DateStyle. It preserves repeated rows because each row contributes its own hash.

This operator tool intentionally refuses tables exceeding **25,000 rows** rather than perform an unbounded aggregation. It also retains a 15-second SQL statement timeout. A refusal or mismatch is a recovery **NO-GO**, not an instruction to remove rows or weaken controls. Larger staging datasets require a separately reviewed streaming/partitioned integrity tool. Staging writes must be frozen by an approved operator during source/restore comparison; two databases are otherwise read at different points in time.

**Evidence limits:** this detects equal-count changed records, but does not authenticate the age-encrypted off-site archive, independently prove decrypted full restore success, restore private role credentials, verify all Supabase-managed objects or waive the retained Render rollback artifact check. SHA-256 fingerprint equality is not itself authorization for staging migration 008, deployment, or production launch. See [task](docs/agents/tasks/2026-11-03-staging-content-integrity.md); this code is on an unmerged child branch of draft PR #12 and has not connected to staging.

## Incomplete-snapshot guard for the read-only recovery verifier (unmerged)

Recovery comparison must **fail closed**, even if both source and independently restored target happen to omit the same verification section. The comparator now rejects missing/malformed catalog, row counts, row-content SHA-256 digest evidence, mismatched table coverage, and a **missing or empty migration ledger on either side**. This means a database where the Supabase migration history is not available cannot receive a comparison match; the operator must establish and verify the migration history by a separately reviewed procedure, not bypass this check. Output reports section names only, no row hashes, passwords or SQL errors.

This is code under draft PR #13. The synthetic disposable PostgreSQL CI fixture creates only test-only migration entries. It is not authorized to create or alter migration metadata on actual staging or a real recovery target. The real backup, scratch restore, and Render rollback validation remain mandatory before considering migration 008.
