# CampusPool staging — cloud-operated encrypted backup worker (proposed)

**Status (2026-11-05): IMPLEMENTATION BRANCH ONLY.** No cloud job, staging export, production deploy, migration or restore has been run by this milestone. This document does **not** authorize execution. The release gate remains NO-GO.

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

- `ops/cloud-backup/Dockerfile`: non-root minimal image based on the PostgreSQL 17 Debian image, Node 22 binary and AGE. Copies only two allowlisted scripts, not the repository or `-` files.
- `ops/cloud-backup/package.json`: Azure SDK dependencies used by the dedicated worker.
- `scripts/azure-blob-backup.js`: auth mode `managed-identity` (no Azure CLI/token cache), cloud worker guard, TLS CA presence guard, existing source allowlist, AGE stream and ciphertext readback.
- `test_cloud_backup_auth.js`: identity selection, CA and scope guards, synthetic readback without remote calls.
- `.github/workflows/cloud-backup-worker-ci.yml`: synthetic auth CI and container build/smoke test, no Azure/Supabase secrets.

## Manual rollout preparation — NOT execution instructions

1. **Security review:** Ensure PR #27's stdout fix and new cloud-worker PR are reviewed and passing. Scan dependencies/image for vulnerabilities; generate and commit a production lockfile, pin base images to audited digests, and sign the resulting worker image/digest. Verify minimal non-root runtime, ephemeral filesystem, log redaction, no plaintext to disk/swap and job execution error monitoring.
2. **Azure environment/cost:** Identify a supported Container Apps region and confirm storage region mismatch, cross-region transfer, Key Vault, registry, monitoring, network egress and consumption charges. Azure Container Apps Consumption has a per-subscription free allowance, but Azure Blob storage, logs, egress and related resources may incur charges. **Do not create resources without owner approval.**
3. **Isolation:** Create a dedicated, **manual-only**, one-execution-at-a-time Container Apps Job (replica count/parallelism 1, retry limit 0, finite timeout). Disallow schedules and remove network ingress. Choose network policy allowing only the intended staging PostgreSQL pooler and Azure identity/storage endpoints. Review IP allowlists for Supabase; protect compute and any attached volumes at rest.
4. **Managed identity:** Enable a system-assigned managed identity (or explicitly chosen user-assigned `AZURE_CLIENT_ID`). Assign the minimum Azure Storage Blob Data Contributor role on the **specific private container scope**. Verify its public access remains disabled, container key isolation, encryption at rest and soft-delete/retention or immutability strategy. Do **not** provide storage account keys or SAS tokens.
5. **Database secret / CA:** Put the staging-only `PGPASSWORD` in a properly access-controlled secret provider (Key Vault referenced from job secrets). The precise project CA must be made available to the worker as a readable mounted file via approved configuration; set `PGSSLROOTCERT` to its absolute path and `PGSSLMODE=verify-full`. Do not store passwords in source, container layers, image build args, plaintext files or command history. Limit secret-reader and job-starter roles; Container Apps job start permissions can be powerful enough to access identities/secrets using execution overrides.
6. **Runtime config:** Set exact allowlisted `PGUSER`, `PGHOST`, `PGDATABASE=postgres`, `PGPORT=5432`, `PGSSLMODE=verify-full`, `PGSSLROOTCERT`, `AGE_RECIPIENT` **public key only**, `AZURE_STORAGE_ACCOUNT`, `AZURE_BACKUP_CONTAINER`, `AZURE_PRIVATE_CONTAINER_CONFIRMED=YES`, `AZURE_AUTH_MODE=managed-identity`, `CAMPUSPOOL_CLOUD_WORKER=YES`. `AZURE_CLIENT_ID` is optional for user-assigned identity. **Never mount the AGE private identity on the backup worker.**
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
| Cloud managed-identity guard unit tests | `node --test test_cloud_backup_auth.js` | PENDING cloud-worker CI |
| Cloud image build and smoke | GitHub job `worker-image` | PENDING cloud-worker CI |
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
