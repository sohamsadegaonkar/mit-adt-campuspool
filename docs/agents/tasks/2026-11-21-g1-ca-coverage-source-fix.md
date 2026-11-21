# RFC-CP-026 — Fail-closed CA projected-mount guard and backup-scope evidence

**Date:** 2026-11-21 IST · **Status:** source-only draft; no Azure run, migration, export, restoration, job mutation or IAM change authorized.

## Findings addressed in source and regression tests

### 1. Projected CA secret mount incompatibility

Before this patch `scripts/cloud-backup-runtime-security.js` demanded `realpath(file) === file` for every CA input. Secret-volume implementations sometimes expose certificate files via a link to an in-volume revision path (e.g. `ca.pem -> ..data/ca.pem`). A public CA file requires integrity rather than secrecy; a strictly internal projected symlink may therefore be safe **only if** the exact `/mnt/staging-ca/ca.pem` entry resolves to a regular certificate within the same canonical `/mnt/staging-ca` mount, the target is not group/other-writable, and the raw X.509 certificate matches the existing pinned `STAGING_CA_SHA256` fingerprint and validity window.

The patch keeps all non-mount paths and **every database password file** symlink-forbidden; it rejects out-of-mount links and mounts whose root resolves elsewhere. Synthetic tests cover an in-mount `..data` projection, out-of-mount escape, loose permissions, and the unrelated-certificate rejection. **This does not prove the actual Azure secret volume uses this shape or is readable by UID 65532.** The real mount requires an authorized *non-data* runtime preflight, including file type/mode/UID and CA fingerprint only; never expose CA PEM, database password or tokens in logs.

### 2. Scoped PGDMP archive misclassified as a full disaster recovery backup

The worker deliberately calls PostgreSQL 17 `pg_dump --format=custom --schema=public --schema=supabase_migrations --no-password`. As PostgreSQL documents, schema filtering does not capture all cross-schema dependencies, may exclude large objects, and `pg_dump` does not export cluster-global roles/tablespaces. We must **not** broaden the export to Supabase-managed auth/storage data or run `pg_dumpall --globals-only` using production/staging credentials without a separately approved sensitive-data and privilege review.

New `scripts/cloud-backup-scope.js` supplies a single immutable CLI argument array and an explicit machine-readable scope contract: selected schemas only, no global roles/tablespaces/large objects, no verified cross-schema dependencies or independent restore, `releaseReady:false`. The worker now uses this shared declaration for the actual dump args and includes the contract in offline preflight and sanitized encrypted-readback results. Regression tests prevent accidental scope expansion or false recovery claims. The worker's Dockerfile copies only this new allowlisted module, and worker CI exercises the new tests.

**Residual**: before marking G1 recoverable, an independent operator must safely export/inventory/reconstruct the exact required roles/grants/extensions/managed-schema dependencies and prove end-to-end restoration at the approved recovery point, including excluded or external identity data by a separately documented process. No `--execute` flow or synthetic archive can authorize that by itself.

### 3. Signed image and runtime source verification

[Private signed-worker review PR #3](https://github.com/sohamsadegaonkar/campuspool-backup-signer/pull/3) is separate, draft and not executed. Its manual verify-only workflow will check the signed GHCR image bytes and published image vulnerability scan against a pinned source candidate. The earlier signer verified `35e37da…` but Azure still references `694e39c…`, which did not match the expected signer. **Do not change Azure image digest, sign the old image, or start the manual job** based on this source patch.

## Review and release boundaries

- Code/tests are isolated on a draft branch; do not merge them into production or deploy until appropriate reviewer approves and exact-head CI is green.
- Source-level CA acceptance is not successful real CA mount/TLS verification. The Vault/KV RBAC, managed identity, Azure job args/role/secrets, selected image digest and ingress/trigger behavior must be independently read back.
- The worker still does not perform an independently operator-controlled encrypted Blob retrieval/decrypt/PG17+PostGIS restore, full role/RLS/migration/content parity or RPO/RTO measurement.
- The historical plaintext archive incident and temporary publication credentials require separate owner evidence and change approvals.

**G1 backup recovery = NOT VERIFIED. CampusPool staging/production schema migration or launch = NO-GO.** No student data, payment/penalty/fine actions, Azure resource writes or real backup operations in this change.

Sources: [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) · [pg_dumpall globals](https://www.postgresql.org/docs/17/app-pg-dumpall.html) · [Azure Container Apps mounted secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets) · [CampusPool launch roadmap](https://app.notion.com/p/41dca5237af5819ba7d3c3f9bff9b088).
