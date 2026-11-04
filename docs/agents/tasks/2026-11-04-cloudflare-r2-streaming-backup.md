# Task: Cloudflare R2 encrypted streaming staging backup

- **Task ID:** `2026-11-04-cloudflare-r2-streaming-backup`
- **Status:** implemented, tested (CI) — 5/5 synthetic R2 pipeline tests passed; private real Cloudflare setup/export/restore NOT RUN
- **Agent:** ChatGPT engineering agent; Cloudflare/R2 account creation and actual operator execution remain with account owner
- **Last updated:** 2026-11-04 UTC
- **Baseline:** `ops/staging-recovery-ledger-2026-11-04@460be03`, stacked after PR #22 → #13 → #12 → #11, not main
- **Branch:** `ops/cloudflare-r2-stream-backup-2026-11-04`
- **Scope:** New independent streaming backup utility, synthetic tests, operator runbook and documentation. No source Supabase writes, live Cloudflare bucket creation, remote credentials, paid resources, live export, restore, Render deploy, or existing backup-script replacement.

## Goal and acceptance criteria

Provide a safe **optional** Cloudflare R2 backup path requiring **no plaintext SQL files on unencrypted Windows C:/D:**. Use PostgreSQL 17's **single consistent logical snapshot** over CampusPool's `public` and `supabase_migrations` schemas in a custom-format archive; stream through AGE encryption to the user's own private R2 bucket through `rclone rcat`. Check encrypted-object roundtrip SHA-256 via `rclone cat` without decrypting locally, and fail closed if any stream stage or readback fails.

The complete independent restore/release gate **still requires** verified global roles, PostGIS/extensions, remote download on separate setup, AGE decryption, restoring into a different database, RLS/grants/migration and row-content comparison, plus a Render rollback artifact.

## Verified facts and design decisions

- User chose Cloudflare R2 as the off-site backup provider. Cloudflare pricing lists 10 GB-month Standard free storage and operation allowances, with possible overage. Account/bucket may require Cloudflare billing setup; do not enable without operator review.
- [Cloudflare S3 API](https://developers.cloudflare.com/r2/get-started/s3/) allows a private bucket and bucket-scoped Object Read & Write token.
- [Cloudflare rclone](https://developers.cloudflare.com/r2/examples/rclone/) supports private S3-compatible bucket operations; [rclone environmental remote configuration](https://rclone.org/docs/) avoids writing credentials to an unencrypted WSL home directory, which is important because both Windows C: and D: are currently unencrypted.
- [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) uses a consistent snapshot even with concurrent writers; combining both specified schemas in one `pg_dump` avoids the older five-separate-dumps write-quiescence issue for the **archive's included data**.
- `pg_dump` does **not** include cluster-global role definitions or all managed Supabase schema objects. This is **not** a full physical Supabase backup; independent operator role/extension setup and actual cold restore are mandatory before claiming recovery readiness.
- `rclone rcat` can overwrite its target and has limited upload retries, so use a unique per-run cryptographic object key, verify ciphertext roundtrip after upload, and never use a public bucket or an unscoped account token.
- The operator's local Ubuntu-D toolchain has previously verified PG17.11, Docker, age, Supabase CLI v2.122.1, and 5/5 existing backup tests. `rclone` installation and Cloudflare bucket/credentials are **not yet verified**.

## Plan

1. Add a strict project-allowlisted `--preflight` / `--execute` utility that spawns `pg_dump`, `age` and `rclone` with private credentials in process environment (never command args or stdout). Require TLS server certificate validation, private bucket attestation and explicit operator GO for execute.
2. Add synthetic fake-process tests for exact source ref/host/TLS/token boundaries, encrypted stream, cloud readback hash, injected corruption, and refusal when operator GO is absent. CI only uses synthetic values and no real connections.
3. Create Ubuntu-D private R2 setup procedure (Cloudflare dashboard bucket Standard storage, bucket-scoped token, ephemeral credentials, AGE public key stored securely, no plaintext config file) and account-owner proof checklist. No exports or deployments from CI.
4. Review PR and obtain user-operated private R2 configuration and synthetic test upload before allowing any actual live source backup. Source Supabase environment remains unchanged.

## Verification

| Test/check | Status |
|---|---|
| Strict source/Cloudflare validation | **PASS** — synthetic CI #41804980068 |
| Synthetic streaming pipeline and hash-match/corruption cases | **PASS** — 5 tests, zero failures, head `1485f0e9` |
| CI code syntax and isolated tests | **PASS** — R2 workflow #41804980068; no credentials used |
| R2 bucket created and token scoped privately | NOT VERIFIED |
| Real encrypted staging export to R2 | NOT RUN |
| Independent off-site retrieval and cold restore | NOT RUN |
| Source/restore role/metadata/data parity + Render rollback | NOT RUN |
| Production or staging service changed | NONE |

## Next steps — handoff

1. Independent review of code and synthetic CI, then operator checks Cloudflare account/bucket setup and any billing conditions. No public object access or secrets in GitHub.
2. In trusted Ubuntu-D, install rclone >=1.59. Configure **environment-only** S3 remote `campuspoolr2`, private Standard bucket `campuspool-staging-backups`, bucket-scoped keys, expected endpoint, verified TLS and AGE public recipient.
3. Run `node scripts/r2-stream-backup.js --preflight`; do not run `--execute` until operator confirms bucket/private scope and exact source. Later, review generated object/ciphertext hash and independently download/restore to distinct PG17/PostGIS target.
4. The old five-file `scripts/staging-secure-backup.sh` remains available on the parent branch for operators with an approved encrypted work volume; this new approach is optional and **not** a replacement until real cold-restore evidence exists.

## Links and files

- Branch: `ops/cloudflare-r2-stream-backup-2026-11-04`
- Expected files: `scripts/r2-stream-backup.js`, `test_r2_stream_backup.js`, `docs/agents/tasks/2026-11-04-cloudflare-r2-streaming-backup.md`, `docs/agents/STATUS.md`, `docs/agents/NEXT_STEPS.md`, `docs/ops/CLOUDFLARE_R2_BACKUP.md`, `.github/workflows/r2-backup-synthetic.yml`.

## Execution checkpoint — 2026-11-04 09:08 UTC

- GitHub Actions [R2 synthetic workflow #41804980068](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41804980068) at PR #25 head `1485f0e9` **PASS: 5/5 tests**, 0 failures. CI additionally verified fail-closed `--preflight` when source secrets are absent.
- Security smoke #41804980056 also **PASS**. PostgreSQL integration #41804979931 was still running at the first CI observation.
- Cloudflare connected storage API is not available through current ChatGPT plugins. Bucket, account and token creation require the account owner in Cloudflare dashboard. No Cloudflare credentials were requested, created, logged or shared; no live pg_dump, R2 object or cold restore was attempted.
- Next exact action: owner creates private Standard bucket `campuspool-staging-backups`, selects restricted Object Read & Write bucket-scoped token, then confirms setup **without sharing the token**. Verify rclone>=1.59 in Ubuntu-D and run safe synthetic credentialless tests, then private environment-only R2 connectivity check before any live source export.
