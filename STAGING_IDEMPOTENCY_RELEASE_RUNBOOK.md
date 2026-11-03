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
| Render workspace/service exact previous SHA | **Not confirmed / blocked** |
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
