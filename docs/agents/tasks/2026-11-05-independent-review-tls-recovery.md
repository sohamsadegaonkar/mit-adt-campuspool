# Task: independent second-pass security review, protected TLS probe and recovery evidence gate

**Date:** 2026-11-05 UTC. **Source PR:** [#40](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/40), stacked on [#39](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/39) → [#38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38). **Owner rule:** quality-first, minimum responsible infrastructure cost. **Release:** NO-GO.

## Goal and acceptance criteria

- Perform a separate, documented review of staging backup confidentiality/integrity, Key Vault read handling, TLS credentials and independent restore evidence; do not equate passing CI with cloud security certification.
- Prove that ciphertext reaching Azure has a structurally valid **AGE v1 X25519 header**; reject accidental plaintext before upload. Preserve actual decrypt/cold restore as separate required evidence.
- Bound Key Vault response streams and validate object identity plus enabled/not-before/expiry; never expose tokens/passwords or trust an unbounded/mismatched secret body.
- Provide an **operator-authorized, non-data staging-only TLS probe** with `--check-tls`, distinct `AZURE_TLS_CHECK_APPROVED=YES` from export approval. Require managed Vault/PGPASSFILE and libpq `verify-full`; run only a fixed `pg_stat_ssl` query.
- Run all CI checks for the exact change chain; no new Azure resources/identity grants, real credentials, production deploy or backup without separate approvals.

## Current state

- PR #38: digest-pinned Alpine PG17 client + AGE, full Trivy/SBOM, verified zlib source patch, keyless signed **OCI review archive**, not a signed ACR registry manifest.
- PR #39: synthetic Key Vault→0600 `/dev/shm` PGPASSFILE bootstrap, offline preflight; zero real Azure/DB contact.
- PR #37: independent recovery [evidence manifest](https://github.com/sohamsadegaonkar/mit-adt-campuspool/blob/ops/recovery-gate-evidence-audit-2026-11-05/docs/ops/RECOVERY_EVIDENCE_MANIFEST.md); actual staging offsite ciphertext, cold PG17/PostGIS restore, row digests/roles/RLS, Render rollback still not verified.
- Owner-created empty Malaysia West Consumption environment `campuspool-backup-env` verified previously, without jobs/log sink. No additional resource price/permission authorization provided. Source production OTP [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) not live.

## Implementation and verification

- Created `scripts/age-ciphertext-guard.js` with an AGE v1 envelope gate in `scripts/azure-blob-backup.js` (holds data until version, X25519 recipient stanza and header MAC line match). It blocks plaintext/custom PGDMP masquerading as encrypted output. Tests cover split header, malformed, truncated, oversized and plaintext.
- Restricted Key Vault secret reads to at most 16KiB streamed bytes, verified exact requested Vault/secret/version ID and active timestamp/flag. Synthetic tests reject mismatched, disabled, expired and oversized responses and check cancellation.
- Created `scripts/cloud-backup-tls-probe.js` and optional CLI `--check-tls` requiring separate explicit owner approval before any token/secret request. Runs `psql -X -w -tA` fixed `pg_stat_ssl` TLS protocol query only, 15-second process timeout and bounded result output; libpq continues to enforce CA/hostname `verify-full`. Never dumps schemas or reads student tables.
- Extended Docker allowlist, CI workflow triggers, rootless container tmpfs synthetic smoke and application regression tests, with no secret or cloud credentials in CI.
- [Second-pass finding register and Azure/recovery stages](../../ops/CLOUD_BACKUP_INDEPENDENT_SECURITY_REVIEW_2026-11-05.md) records distinct SEC-01 to SEC-08 and cites relevant official specs/docs. The code inspection is assistant-conducted, not independent qualified human audit or production approval.

## Security and deployment blockers

- AGE structural header check does not prove actual decryption/valid recipient nor a successful independent cold restore. SHA256 remote readback only proves transport consistency; the earlier 200-byte invalid blob cannot count as backup.
- Real staging `--check-tls` cannot run without an approved Azure Vault, scoped managed identity, private CA fingerprint and credentials. Existing Azure environment has no job or sink; user must approve a specific cost envelope and IAM scopes.
- Backup table coverage is only `public` plus `supabase_migrations`; independent recovery must account for excluded Supabase auth/storage/global roles/extensions. No student data in unapproved restore environment.
- Container Apps job start permission allows execution overrides with configured identities. Limit to approved operators; custom Blob create/read/write no-delete role preferred to built-in Data Contributor; no public image release without review.
- Real backup/decryption/independent restoration and Render rollback evidence must all pass before OTP staging or production. No migration/deploy under this task.

## Progress log

- 2026-11-05 UTC — Completed separate code inspection of PRs #38/#39 and vendor reference checks. Identified plaintext AGE-stream hazard and unbounded Vault response; implemented guarded fixes and tests in PR #40.
- 2026-11-05 UTC — Implemented separate staging-only TLS probe requiring distinct explicit operator approval, no table data reads, and added synthetic integration/tests. Wrote finding register and preserved PR #37 recovery acceptance baseline.

## Next steps

1. Verify latest PR #40 exact head SHA status for AES/AGE and Vault synthetic, PG17 real-binary-to-AGE fake-data restore CI, full image Trivy, Sigstore review signing, docs contract. Fix any failing checks.
2. Obtain independent human security reviewer acknowledgment and approved ACR/Key Vault/identity/logging/manual job cost/IAM grant scope. Do **not** merge or create resources on mere CI green.
3. Controlled staging TLS `--check-tls` after explicit approval; then separately approved manual encrypted `--execute` with readback.
4. Independently download/decrypt/test a protected PostgreSQL 17/PostGIS restore, including content/RLS/roles/migrations and retained Render rollback. Only then staging OTP and production release decisions.
