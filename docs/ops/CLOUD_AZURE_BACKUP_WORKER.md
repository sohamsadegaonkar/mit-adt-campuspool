# CampusPool staging — cloud-operated encrypted backup worker (proposed)

**Status (2026-11-05): SOURCE PRESENT ON MAIN; EMPTY AZURE ENVIRONMENT CREATED BY OWNER.** The owner verified `campuspool-backup-env` as Succeeded in Malaysia West (Consumption), no jobs and null log destination. No staging export, production deploy, migration or restore has been run. The latest worker OS/library and zlib source-provenance scans in draft PR #38 are **PASSING**; no image registry/job/Key Vault is provisioned. This document does **not** authorize execution. The release gate remains NO-GO.

## Objective

Eliminate reliance on a student's Windows/WSL laptop for staging data processing and off-site backups. A **manual Azure Container Apps Job** runs a dedicated container with PostgreSQL 17 `pg_dump`, Node.js and AGE on cloud-hosted compute. It reads only the allowlisted CampusPool staging database, encrypts the stream in the job, uploads ciphertext to the existing private Azure Blob container using a **managed identity**, then streams ciphertext back to verify bytes/SHA-256. No local persistent plaintext database dump is ever intentionally created.

This improves the execution location and custody model but is **not a verified full recovery**. The archived schemas remain `public` and `supabase_migrations`, not global PostgreSQL roles, all Supabase-managed services, storage objects, etc.

## Architecture

```text
Supabase staging (Singapore; PG17)
    │ TLS verify-full; scoped secret supplied by approved vault
    ▼
Azure Container Apps Job (MANUAL only; ephemeral isolated worker)
    pg_dump --format=custom --schema=public --schema=supabase_migrations
        │ stdout PGDMP header guard
        ▼
    age --encrypt --recipient age1...   (private recovery key NEVER here)
        │ ciphertext bytes only
        ▼
Azure private Blob campuspool-staging-backups (Malaysia West)
        └─ managed identity / Blob Data Contributor, explicit if-none-match
    ↳ encrypted object download/readback SHA256 match
```

A **separate** recovery job/environment must retrieve and AGE-decrypt ciphertext to an independently provisioned, securely encrypted PostgreSQL 17/PostGIS destination and check migration ledger, table/row-content digests, roles, permissions, RLS, PostGIS extensions, and application login. Successful upload/readback alone is **not** a restore pass.

## Files

- `ops/cloud-backup/Dockerfile`: non-root minimal digest-pinned Alpine 3.23 Node 22 with PostgreSQL 17 **client**, AGE, and a validated TLS/passfile runtime guard. Copies only two allowlisted scripts, not the repository or `-` files.
- `ops/cloud-backup/package.json` and `ops/cloud-backup/package-lock.json`: locked Azure SDK production dependencies installed with `npm ci` (draft PR #38).
- `scripts/azure-blob-backup.js`: auth mode `managed-identity` (no Azure CLI/token cache), cloud worker guard, TLS CA presence guard, existing source allowlist, AGE stream and ciphertext readback.
- `test_cloud_backup_auth.js`: identity selection, CA and scope guards, synthetic readback without remote calls.
- `.github/workflows/cloud-backup-worker-ci.yml`: synthetic auth CI and container build/smoke test, no Azure/Supabase secrets.

## Manual rollout preparation — NOT execution instructions

1. **Security review:** Draft PR #38 now uses digest-pinned Alpine 3.23, production npm lockfile, full Trivy OS/library checks and SBOM; the exact review-source image scan **passes with zero known CVEs** at the latest check. An upstream Alpine zlib patch-provenance check also passes, and the OCI review archive was signed using GitHub keyless OIDC. This does NOT approve registry publication: review final published digest, CA/secret materialization, logs and staging connection path first. See [zlib/TLS/signing review](CLOUD_BACKUP_TLS_SECRET_SIGNING_REVIEW_2026-11-05.md).
2. **Azure environment/cost:** Identify a supported Container Apps region and confirm storage region mismatch, cross-region transfer, Key Vault, registry, monitoring, network egress and consumption charges. Azure Container Apps Consumption has a per-subscription free allowance, but Azure Blob storage, logs, egress and related resources may incur charges. **Do not create resources without owner approval.**
3. **Isolation:** Create a dedicated, **manual-only**, one-execution-at-a-time Container Apps Job (replica count/parallelism 1, retry limit 0, finite timeout). Disallow schedules and remove network ingress. Choose network policy allowing only the intended staging PostgreSQL pooler and Azure identity/storage endpoints. Review IP allowlists for Supabase; protect compute and any attached volumes at rest.
4. **Managed identity:** Enable a system-assigned managed identity (or explicitly chosen user-assigned `AZURE_CLIENT_ID`). Assign the minimum Azure Storage Blob Data Contributor role on the **specific private container scope**. Verify its public access remains disabled, container key isolation, encryption at rest and soft-delete/retention or immutability strategy. Do **not** provide storage account keys or SAS tokens.
5. **Database secret / CA:** The updated cloud worker **rejects PGPASSWORD** and requires a PostgreSQL libpq PGPASSFILE owned by UID 65532, mode 0400/0600, on /dev/shm tmpfs, with one exact staging connection entry. Draft PR #39 implements a **source-only, managed-identity Key Vault read → owner-only `/dev/shm` passfile bootstrap**, validated with synthetic CI; the real vault, permissions and target Azure runtime remain **unprovisioned and unverified**. Never provide passwords in environment variables, CLI args, image layers, Git or logs. Mount a parseable, valid X.509 CA PEM file read-only and set PGSSLROOTCERT to its absolute path with PGSSLMODE=verify-full. Limit job-starter and vault permissions; a real TLS handshake remains an independent deployment gate.
6. **Runtime config:** Set exact allowlisted `PGUSER`, `PGHOST`, `PGDATABASE=postgres`, `PGPORT=5432`, `PGSSLMODE=verify-full`, `PGSSLROOTCERT`, owner-only RAM-backed `PGPASSFILE` (NOT PGPASSWORD), `AGE_RECIPIENT` **public key only**, `AZURE_STORAGE_ACCOUNT`, `AZURE_BACKUP_CONTAINER`, `AZURE_PRIVATE_CONTAINER_CONFIRMED=YES`, `AZURE_AUTH_MODE=managed-identity`, `CAMPUSPOOL_CLOUD_WORKER=YES`. `AZURE_CLIENT_ID` is optional for user-assigned identity. **Never mount the AGE private identity on the backup worker.**
7. **Explicit run approval:** Image defaults to `--preflight`, which does not access the database or storage; `--execute` is separately selected in the job template and additionally needs `AZURE_EXPORT_APPROVED=YES`. Review image digest and job template before each operator-authorized stage-only execution. Grant job start only to trusted owners; do not automate recurring backup starts until owner explicitly approves cadence and costs.
8. **Acceptance:** Verify new ciphertext size substantially exceeds an AGE-wrapped empty stream, SHA-256 remote readback, object retained in private storage, independent AGE decrypt and real separate encrypted PG17/PostGIS cold restore with content digests, roles/grants/RLS/extensions and rollback proof. Keep old 200-byte unverified object intact pending approved cleanup. Restrict release until the full evidence exists.

## Local incident remains separate

A 48,600-byte potential plaintext staging archive named `-` was found on an older Windows-backed WSL checkout and secured with Unix mode 0600. Host drives C: and D: were confirmed unencrypted. Moving *future* backup execution to cloud does **not** erase existing host disk blocks, backups or snapshots. Do not open, upload, commit or represent the file as securely erased. Address local secure cleanup and any possible exposure separately; do not transfer this artifact into the cloud.

## Test / release evidence

| Gate | Evidence | Status |
|---|---|---|
| Original streamer unit tests | PR #27, 11/11 operator tests | PASS |
| Original streamer actual PG17/AGE synthetic restore | Operator-provided synthetic recovery proof | PASS |
| Original Node real-tool mock Azure CI | PR #27 realtools job | PASS |
| Cloud managed-identity guard unit tests | GitHub PR #28 `managed-identity-guards`, commit `2ebc327` | **PASS** |
| Cloud image build and smoke | GitHub PR #28 `worker-image`, commit `2ebc327` | **PASS** |
| Cloud staging job created / real encrypted export | Azure owner approval and protected environment | NOT DONE |
| Independently decrypted real off-site staging restore | Encrypted independent PG17/PostGIS | NOT DONE |
| Production rollout | Requires staged recovery and rollback evidence | BLOCKED |

## References

- [Azure Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)
- [ManagedIdentityCredential for Node.js](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/managedidentitycredential)
- [Container Apps secret/Key Vault references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
- [Prior Azure backup runbook](AZURE_BLOB_BACKUP.md)
- [Cloud worker task](../agents/tasks/2026-11-05-cloud-backup-worker.md)

## Image scan and provisioning design checkpoint — 2026-11-05 UTC

- [PR #38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38) generated [GitHub Actions Trivy scan](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42050254779) of the *complete image* (Debian 12 OS packages and application dependencies). Initial report: **458** findings, **4 CRITICAL / 72 HIGH**; **26** fixable HIGH/CRITICAL stemmed from an unused inherited `/usr/local/bin/gosu` binary compiled with outdated Go stdlib. Its removal was verified by an isolated container smoke test.
- [Post-removal CI scan](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42050852283) reports **397 Debian 12 OS findings**: **3 CRITICAL, 47 HIGH, 173 MEDIUM, 168 LOW, 6 UNKNOWN**, **zero scanner-documented fixes** for the high/critical set at that scan time. The stricter vulnerability check **FAILS** by policy, and **release is blocked**. This is a dated Trivy vendor-database assessment, not proof of exploitation or absence of all risks.
- The OS and library scan JSON and CycloneDX SBOM are kept as GitHub Actions artifacts (14-day retention) for review. npm production dependency audit is clean, but does **not** cover Debian vulnerabilities.
- Prepared a separate [ACR, Key Vault, managed-identity and manual-job cost/permissions design](AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md) and read-only `ops/cloud-backup/azure-readonly-preflight.sh`. Neither is a deploy authorization. No new Azure resource or RBAC changes were performed.
- Next technical gate: evaluate updated/patched PostgreSQL 17 runtime base or minimized runtime image and re-run complete scanner; do **not** waive critical/high by automatically setting ignore-unfixed. Only then submit exact owner cost/tier/permission request for ACR, vault, identity and job.

### Alternative PostgreSQL 17 base experiment — 2026-11-05 UTC

- [Trixie CI experiment](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42051538206) built `postgres:17.11-trixie` with current Node worker, AGE and guard code successfully and scanned the resulting Debian 13.7 image. Resolved source index digest during CI was `sha256:748a18a54d3842d43bc156f0840d78029b8d349e0feca98c12b9c4ce3404a6b3`. This was a **nonrelease experiment** and the final Dockerfile still references the pinned Bookworm base.
- Trixie scan: **336** findings (1 critical, 63 high, 128 medium, 138 low, 6 unknown). It improves the critical count versus Bookworm (3 critical) but **increases high severity** (47 → 63). No candidate is approved for release; both need vulnerability triage and a stricter accepted release policy rather than raw advisory-count optimization.
- An alternative minimal PG17 client+AGE+Node runtime can be evaluated in a new isolated branch to remove unused PostgreSQL server packages, while maintaining verified CA/TLS, pinned digest and reproducible dependencies. **Do not** publish any of these image candidates to an Azure registry yet.

## Final Alpine worker CVE remediation — 2026-11-05 UTC (latest, supersedes earlier Bookworm/Trixie status)

- The canonical `ops/cloud-backup/Dockerfile` now uses **pinned Alpine 3.23.7 Node 22** on the official multi-platform index digest `sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db` in both stages (build and runtime). Final image contains PostgreSQL **client 17.11** and AGE **1.2.1** plus trusted CA, without PG server, runtime npm, `gosu` or Debian packages; runs non-root and defaults to guarded `--preflight`.
- [Exact final source-image CI 42065551826](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42065551826) reports **0 Trivy vulnerabilities** while independently asserting OS family/version, 29 Alpine OS packages, 78 Node package records, exact APK versions, and preserving a mandatory fail-on-HIGH/CRITICAL gate; full CycloneDX SBOM and JSON scan artifacts uploaded. The original 37 HIGH Debian rows have been grouped and vendor-assessed by CVE in [the 37-HIGH remediation report](CLOUD_WORKER_HIGH_CVE_REMEDIATION_2026-11-05.md). The older Bookworm/Trixie scanner failures remain historical. A clean scanner result is a time-bound known-CVE assessment only.
- Independent Alpine zlib `CVE-2026-76844` patch-source review, signed **built image** digest, operational privacy-safe logging, staging PostgreSQL TLS/CA and access review remain. No registry push or cloud job execution is authorized, regardless of passing image CI. New Azure resources and billable IAM require owner budget and scoped approval; encrypted backup and independent cold restore/Render rollback still **NO-GO**.

## Current source review checkpoint — 2026-11-05 UTC

- [Upstream zlib/TLS/secret custody and OCI archive signing review](CLOUD_BACKUP_TLS_SECRET_SIGNING_REVIEW_2026-11-05.md) records independently fetched Alpine 3.23 zlib patch matching upstream `df84af2`, source-provenance CI, parsed CA certificate and owner-only tmpfs PGPASSFILE guard, and a Sigstore-verified OCI **review archive** (not a published registry-image signature). [CI evidence](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42069719355).
- **Unresolved cloud deploy blockers:** Real Azure Key Vault/identity permissions and protected UID 65532 `/dev/shm` mount validation, CA fingerprint and TLS handshake against the staging pooler, final ACR published image digest signing, protected logging and owner budget/permission approval. No student data, staging DB, Azure registry/job/vault, or Render OTP deployment touched.

## Draft PR #39: managed identity Key Vault secret bootstrap — 2026-11-05 UTC

- [Draft stacked PR #39](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/39) implements a pinned staging-only Key Vault hostname and fixed secret name `campuspool-staging-pg-password`. The worker now supports `AZURE_KEYVAULT_URL=https://campuspool-backup-kv-XX.vault.azure.net` and `AZURE_PG_SECRET_NAME=campuspool-staging-pg-password`. This is a **proposed name**, not an existing cloud resource.
- `--preflight` remains no-network/no-secret, while `--execute` requires explicit `AZURE_EXPORT_APPROVED=YES` **before** obtaining the managed identity access token. Direct Key Vault `GET /secrets/{name}?api-version=7.4` is HTTPS-only, redirect-blocked and response/timeout-bounded. No password/tokens written to logs or subprocess environments.
- Secret becomes a libpq-compatible, escaped password file only under verified `/dev/shm` tmpfs, with exclusive creation, mode 0600, UID 65532 and deletion in `finally` after success/failure. PG17 receives `PGPASSFILE` path, AGE does not.
- Synthetic tests exercise malformed hosts, `:` and backslash escaping, no-approval/no-network checks, cleanup and actual PGDMP/AGE/mock Blob readback. [CI run](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42078620888) verifies non-cloud credentials, image scan and source review.
- **Still not deployed:** Actual Vault existence, secret insertion, Azure RBAC, stage-only TLS handshake, CA fingerprint, log redaction, image publication, independent restore and Render rollback. Keep staging/production release **NO-GO**.
