# Task: Correct Azure backup pg_dump stdout and investigate accidental local archive

- **Task ID / file:** `2026-11-04-azure-pgdump-stdout-incident`
- **Status:** in review; local synthetic testing completed, operator remediation and live backup remain blocked
- **Agent / owner:** ChatGPT engineering agent (code); staging/Azure account owner (local incident containment)
- **Last updated:** 2026-11-04 UTC
- **Baseline:** Azure backup branch `ops/azure-blob-stream-backup-2026-11-04@5e007bf`; fix branch `fix/azure-pgdump-stdout-guard-2026-11-04`
- **Scope:** `scripts/azure-blob-backup.js`, `test_azure_blob_backup.js`, operator runbook and agent handoff. No staging database write, Azure write/delete, restore, deployment, or migration.
- **Dependencies:** `2026-11-04-azure-private-blob-backup.md`, Azure PR #26, secure operator workstation and private AGE key custody.

## Goal and acceptance criteria

Make the custom-format PostgreSQL 17 archive reach the AGE encryptor through **stdout**, rather than writing a file named `-` on disk. Refuse archive success when PostgreSQL supplies an empty stream or an invalid custom-archive signature, and retain no-plaintext-local-dump guarantee. Unit regression tests must reject an output-file flag and invalid/empty archive bytes; CI and authorized synthetic integration evidence are required before any live retry.

## Current state (verified vs assumed)

- PostgreSQL documentation specifies that omitting `--file` sends custom-format output to stdout. Prior `pg_dump --file=-` invocations instead created a literal file named `-` in the worktree. The user observed a 48,600-byte untracked file in the retry checkout and a zero-byte file in the older checkout; **contents were not inspected**, so treat files as potentially sensitive plaintext PostgreSQL archives.
- In the same recovery investigation, the operator reported successful TLS-authenticated `psql SELECT 1`, PostgreSQL 17.11, a passing apparent shell dump/AGE pipeline (now known to be misleading because stdout could be empty), and a **200-byte existing Azure object** whose decrypted output failed `pg_restore --list`. No usable Azure ciphertext archive or independent restore has been verified.
- The Azure backup implementation and its mock test expected `--file=-` and accepted encrypted output over 50 bytes, allowing an AGE-wrapped empty input to pass ciphertext checks. Verified remote ciphertext alone does not prove PostgreSQL archive validity.

## Fix on isolated branch

1. Remove `--file=-` from `pg_dump` arguments. PostgreSQL custom-format dump defaults to stdout when no output file is specified.
2. Stream through a bounded header check that requires the `PGDMP` magic prefix (including split-chunk handling) before feeding the AGE process; reject empty/malformed stdout with a stable, non-sensitive failure code.
3. Update mock tests to assert **no output-file argument** and simulate empty, truncated and malformed archive streams. Keep all existing Azure readback/tamper/error-path tests.
4. Update this task record, `STATUS.md`, `NEXT_STEPS.md` and `docs/ops/AZURE_BLOB_BACKUP.md`; no modifications to main.

## Verification

| Test/check | Evidence | Result |
|---|---|---|
| PostgreSQL pg_dump output semantics | PostgreSQL 17 documentation, `--file` option | CONFIRMED: omit file to use stdout |
| Original local operator files | Operator-reported name/byte count only | 48,600 bytes and 0 bytes; treat as sensitive; file content uninspected |
| Old remote Azure blob | Operator-reported AGE/pg_restore check | 200-byte ciphertext; archive invalid; preserve pending reviewed cleanup |
| Updated unit tests | Operator Ubuntu-D 2026-11-04, `node --test test_azure_blob_backup.js`, `aa7c558` | **PASS 11/11**, 0 failures (operator output) |
| GitHub CI (PR #27) | `azure-synthetic` and `postgres-otp` checks at `aa7c558` | **PASS** both checks; does not contact real cloud/storage or recover actual staging data |
| Real synthetic PostgreSQL 17 + AGE cold restore | Ubuntu-D disposable Docker `postgres:17`, no network, synthetic public table and migration ledger; custom `pg_dump` stdout → AGE → AGE decrypt → `pg_restore --clean --if-exists --exit-on-error` into separate disposable database | **PASS** operator-reported `SYNTHETIC_PG17_AGE_RESTORE_PASS`; records count 2; ledger `synthetic_001`; no real source/blob touched |
| Independent staging backup and restore | Different encrypted PG17/PostGIS target + comparisons | NOT DONE |
| Production or staging database modification | No authorized operation | NONE |

## Risks and decisions

- **Local plaintext exposure risk:** Both Windows host volumes were reported unencrypted; chmod controls live Linux access but not physical disk / VHDX / snapshot / swap remnants. No `git add -A`, `git clean`, shell file dumps, data copies, `shred` success claims or uploads of the accidental files. Operator must choose a documented sensitive-file disposal and host encryption/remediation strategy.
- The prior AGE smoke result was misleading; tests must bind proof to actual PostgreSQL custom-archive bytes.
- Treat the existing Azure object as an unverified failed attempt. Do not delete other remote objects or blindly rerun backup. Selected-schema archive remains **not full Supabase disaster recovery**.
- The regression header check validates stream identity, **not full data completeness or restorable database state**. Independent ciphertext retrieval and PG17/PostGIS cold restore are still mandatory.
- No migration 008, Render deployment or production activity.

## Progress — synthetic real-tool recovery test (2026-11-04)

- User confirmed `postgres:17` Docker image installed and reported `SYNTHETIC_ENCRYPTION_PASS`, `ARCHIVE_STRUCTURE_PASS` and `SYNTHETIC_PG17_AGE_RESTORE_PASS` from no-network tmpfs-backed PG17 source/target and ephemeral AGE key. The first synthetic restore hit expected `schema \"public\" already exists`; re-run using `--clean --if-exists` **only against the disposable synthetic database** succeeded with 2 records and 1 synthetic migration ledger entry.
- GitHub PR #27 remains draft, unmerged, mergeable; both `postgres-otp` and `azure-synthetic` checks pass at `aa7c558`. Local unit test run 11/11 PASS.
- This verifies a *shell-level* real PG17 + AGE pipeline, but does **not** exercise the Node uploader's real spawn with a live Azure SDK transfer or prove an off-site archive of actual staging data. No staging/production/Azure write conducted in this test. The local unencrypted file incident remains open.

## Worktree containment and additional Node uploader test (2026-11-04)

- Operator verified `chmod 600` on the potential local plaintext `-` archive (48,600 bytes) and the older empty `-` artifact (0 bytes). The retry checkout `git status --short` prints only `?? -`; corrected `~/campuspool-azure-fixed` checkout is clean. **No archive deletion or secure host-disk erasure is claimed.**
- Added `test_azure_blob_real_tools.js`: network-isolated disposable PG17 Docker container, synthetic tables, temporary AGE key in `/dev/shm`, actual `run()` orchestration with real `pg_dump` and AGE subprocesses, *in-memory* Blob SDK stand-in, independent AGE decrypt, `pg_restore`, restored row/ledger checks and no local file named `-`. This tests execution of the Node streaming pipeline beyond the original mock-only suite but **never uses real Azure or Supabase**.
- Added `azure-realtools` GitHub Actions job to install only public test dependencies on an ephemeral runner. Initial CI at `ff97912` **in progress** when the job was recorded. Do not mark it PASS until GitHub reports success.
- The new test does not independently authenticate real remote ciphertext or demonstrate complete Supabase recovery. Code review, local file remediation and actual staging restore gates remain blocked.

## Operator drive-at-rest encryption check (2026-11-04)

- Operator confirmed privately that the Windows volumes backing local WSL/Docker do **not** have active full-volume encryption. This is now an independently identified **security gate blocker** for further exports containing real staging data. Exact device and volume details are kept in the private recovery record rather than this public repository.
- The potential plaintext local dump remains restricted (owner-only, mode 0600) but may still exist on unencrypted storage and in VHDX/snapshots/backups. Do not assume file permissions, moving files, deleting `-`, or enabling disk encryption retrospectively eliminates previous copies.
- **Operator choice before live work:** enable and verify supported Windows full-volume/device encryption for all relevant host volumes, safeguarding recovery keys separately before making changes; or move sensitive backup execution to an appropriately secured, disposable, access-controlled environment with encrypted storage and tightly managed credentials. Use encrypted destination media for recovery exports, not the current unencrypted host.
- No automated system encryption changes, host cleanup, new Azure blob operations or staging data exports performed by the agent. Reconfirm drive protection and independently recoverable encryption/recovery key custody before updating NO-GO status.

## Next steps — exact handoff

1. **Operator:** restrict access to accidentally created local file using `chmod 600 -- "$HOME/campuspool-azure-retry/-"`; decide on secure cleanup without claiming deleted disk blocks are unrecoverable; do not commit or upload its contents.
2. **Reviewer:** inspect fix branch diff, verify regression tests and CI; avoid running old `--file=-` script. Test the corrected binary with a **synthetic disposable PostgreSQL 17** source before live staging.
3. **Operator after explicit approval:** clean worktree, secure AGE recipient and verified TLS, real-config preflight, then a single protected encrypted backup attempt. Verify nonzero ciphertext readback and independently inspect the decrypted custom archive in protected environment before restoring to separate PG17/PostGIS.
4. **Release blocker:** full isolated recovery comparisons and retained Render rollback artifact must be validated before any migration or deployment.

## Links and files changed

- [PostgreSQL 17 pg_dump reference](https://www.postgresql.org/docs/17/app-pgdump.html)
- [Original Azure backup task](2026-11-04-azure-private-blob-backup.md)
- Fix branch: [fix/azure-pgdump-stdout-guard-2026-11-04](https://github.com/sohamsadegaonkar/mit-adt-campuspool/tree/fix/azure-pgdump-stdout-guard-2026-11-04)
- Production impact: NONE
