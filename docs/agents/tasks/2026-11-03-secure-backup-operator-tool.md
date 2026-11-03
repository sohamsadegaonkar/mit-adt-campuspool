# Task — Secure staging backup operator command

- **Status:** implementation committed on unmerged draft PR #11; independent CI pending; actual staging export **BLOCKED**
- **Date / owner:** 2026-11-03 UTC / ChatGPT engineering agent (code); authorized account operator (private export)
- **Baseline:** main `3ee1f4a12e984cb6aecbf8ea09150d1e79556c87`; PR #11 parent `58a584942773107afb689797ea3ddecfd7d3379b`
- **Dependencies:** [actual-backup gate](2026-11-03-staging-backup-restore-gates.md), [full runbook](../../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md), Render staging current live `cceadbf6251f`
- **Scope:** create a local-operator command for exporting only the dedicated Supabase staging PG17 database (roles/schema/data) to an age-encrypted file on an operator-confirmed off-site mount, recording SHA-256. Add CI-only guard tests. **Not** authorized to run real DB exports in GitHub Actions, chat, Render or this tool session.

## Goal and acceptance criteria

Reduce error-prone manual backup steps. The tool must refuse a different Supabase project, missing TLS/password, unsafe or overlapping paths, absent encrypted temporary volume/off-site confirmation and invalid age recipient; never write plaintext exports to the repository. Run `--preflight` without DB writes; require explicit `--execute` for operator export; clearly distinguish ciphertext written from independently verified remote copy and restored recovery evidence.

## Current state

- Current staging Supabase 17.11 has migrations 001–007 only; migration 008 is not applied.
- Live Render staging code remains `cceadbf6251f`, with auto-deploy disabled. Draft PR #11 is not deployed.
- Connected Supabase/Render integrations cannot provide a private owner credentials export, authenticated off-site storage, or an independent recovery target.
- Real encrypted off-site backup, separate download verification and scratch restore have **not** been performed.

## Plan

1. Implement a separate, explicitly invoked operator-only export script with a stage-only connection guard.
2. Add synthetic failure-mode tests; integrate security, documentation and PostgreSQL CI workflows.
3. Review safety properties and record exact command and next accountable operator action.
4. Leave production, Render staging and Supabase staging untouched; keep migration 008 NO-GO until actual backed-up restore evidence is approved.

## Progress log

- 2026-11-03 UTC — Verified PR #11 baseline and mandatory agent handoff contract.
- 2026-11-03 UTC — Implemented guard and explicit preflight/execute backup scripts; restricted plaintext temp directory, age encryption, SHA-256 mounted copy check, no confidential source in Git.
- 2026-11-03 UTC — Ran local Node 22.16.0 tests (4/4 pass), Node syntax and Bash syntax checks.
- 2026-11-03 UTC — Initial GitHub documentation contract failed solely because task section labels did not match required headings; corrected template naming. New-head CI pending.

## Changes

- `scripts/staging-backup-guard.js`: fail-closed validation for project `tnitksrlntrdxbvznxzf` from direct/session-pooler URL, mandatory operator confirmations and outside-repo disjoint existing directory paths. No DB connection and sanitized error text.
- `scripts/staging-secure-backup.sh`: trusted operator only. Needs current Supabase CLI, Docker, PostgreSQL 17 `psql`, `age`, `sha256sum`, `tar`. Runs CLI exports with private URI, suppresses possibly sensitive tool logs, uses restrictive temporary plaintext on operator-asserted encrypted filesystem, age-encrypts archive directly to operator-attested off-site mount, SHA-256 checks mounted copy, cleans up plaintext even on failure. This is **not** independently downloaded remote copy verification.
- `test_staging_secure_backup.js`: stage-only target allowlist, wrong-project and unencrypted-path refusal, secret-redacted errors, shell syntax and explicit modes. No staging credentials, network or student rows.
- CI scripts and runbook/handoff updated; no migration runner changes or new infrastructure.

## Verification

- Local Node 22.16.0 `node --test test_staging_secure_backup.js`: 4 passed; `bash -n` and `node --check` passed before commit.
- Exact-head CI GitHub workflows: **pending**, record after completion.
- Actual stage export, ciphertext off-site copy, remote independently downloaded SHA-256, scratch restore and policy comparison: **NOT PERFORMED**.
- Render retained-build rollback eligibility: still unconfirmed; staging and production remain unchanged.
- Local operator must personally confirm remote mount and encrypted scratch volume; code cannot prove a path is remote or encrypted. `AGE_RECIPIENT` is a public encryption recipient; the private identity is never provided to this script. `STAGING_DB_URL` stays in a private operator environment (may be visible to privileged processes on that machine while CLI runs).

## Next steps

1. Review exact code/CI and ensure GitHub security/docs/PostGIS workflows green.
2. On approved private encrypted Linux/WSL2 machine, obtain owner-only `STAGING_DB_URL` and public `AGE_RECIPIENT`; independently identify an encrypted temporary directory and **remote** mount, setting the attestation flags only after checking.
3. Run `npm run check:staging-backup`, then `npm run backup:staging-operator` **only as the authorized account owner**. No credentials/SQL/files in chat, GitHub, Render or CI.
4. Download remote ciphertext **again**, compare SHA-256, decrypt and restore in an independently verified separate Supabase-compatible PG17/PostGIS target, compare data/roles/schema/permissions, and check Render's retained rollback artifact in Dashboard.
5. Only after all proof and separate staging approval consider migration 008/deploy/rollback E2E. Keep real production NO-GO.
