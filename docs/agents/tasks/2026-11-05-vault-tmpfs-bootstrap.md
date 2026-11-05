# Task: staging backup Key Vault → protected libpq tmpfs secret bootstrap

**Date:** 2026-11-05 UTC. **Status:** draft source-only implementation; not deployed. **Base:** backup worker [draft PR #38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38). **Branch:** `security/cloud-vault-tmpfs-bootstrap-2026-11-05`.

## Goal and acceptance criteria

Close the concrete cloud-worker gap where `PGPASSFILE` had to be supplied externally, but the Azure job had no approved secure secret bootstrap. Preserve CampusPool's **quality-first, minimum responsible cost** rule, no added standing cloud service, and absolutely no staging/production access during development.

- Offline `--preflight` validates staging allowlist, CA TLS and exact vault configuration but never fetches a secret, contacts Azure Blob, or starts `pg_dump`.
- `--execute` first checks explicit owner operator approval `AZURE_EXPORT_APPROVED=YES`, then uses scoped **managed identity** to read only the fixed `campuspool-staging-pg-password` secret from a reviewed `https://campuspool-backup-kv-XX.vault.azure.net` host.
- Generate a libpq `PGPASSFILE` only under proven Linux `/dev/shm` tmpfs with worker UID ownership, 0600 permission, exclusive no-follow creation and host/user/db/port matching; escape `:` and `\\` correctly. Delete file and its private directory even when the operation fails.
- Never pass `PGPASSWORD`, a secret value or a bearer token into command lines, AGE's environment, GitHub CI or logs. No implicit redirects or untrusted vault hosts.
- Prove safety in synthetic tests including fake vault, no-approval/no-network, malformed URL, secret escaping, cleanup on failure, and end-to-end mock stream+readback; all existing image/auth/vulnerability guard CI must remain green.

## Current state

- Owner-confirmed only the **empty** Azure Container Apps Consumption environment in Malaysia West exists, with no job/log destination. ACR, Key Vault, identities, RBAC/logging and cloud backup remain **unapproved** and unprovisioned.
- Draft PR #38 has a signed OCI *review archive*, not a signed registry image, with Alpine/PG17/AGE CVE scan and TLS/secret-file guard source tests. `PGPASSFILE` was required but not yet delivered by a managed-identity secret retrieval path.
- OTP PR #36 is unmerged. No real staging archive, independent restore, source login/provider verification or Render rollback release gate passed.

## Implementation and verification plan

1. Implement `scripts/cloud-backup-vault-bootstrap.js` using Azure managed-identity token + native HTTPS fetch scoped to a fixed staging Vault secret name; fail closed on credential/response/network errors with stable non-sensitive codes.
2. Integrate it into `scripts/azure-blob-backup.js` only for cloud-mode managed identity; `--preflight` stays offline and execution stays approval-gated. Keep legacy operator-specific paths unchanged for this code-only milestone.
3. Copy allowlisted module into Alpine Docker image, extend immutable-source policy and GitHub workflow triggers, run node synthetic regression tests and full CVE/SBOM/signing gates.
4. Review existing docs and create a stacked draft PR **against PR #38**, avoiding accidental merge to `main` before independent security review and recovery proof.

## Progress log

- 2026-11-05 UTC — Implemented scoped Vault URL/secret validation and native HTTPS client; owner-only `/dev/shm` pgpass lifecycle with cleanup and libpq special-character escaping. Integrated cloud `--preflight` vs `--execute` paths with separate approval before any secret request.
- 2026-11-05 UTC — Added fake token/Key Vault API and PostgreSQL/AGE/Azure stream synthetic tests, image allowlist and workflow triggers. No real token, credential, staging database or Azure data plane accessed.

## Security and deployment blockers

- **Not a deployment-ready Key Vault setup.** Secret URL/name are proposed and must be explicitly approved with the actual Vault name. The value must remain in Key Vault; no CLI/manual ingestion method implemented here.
- Need owner approval for any billable Azure Vault, registry, job, logging or IAM grant; verify actual managed identity scoping and cache behavior, no export-command overrides, journal/log redaction.
- Need live non-data staging TLS `verify-full` handshake with a securely reviewed CA fingerprint, and a protected end-to-end offsite encrypted backup, independent PG17/PostGIS cold restore, RLS/roles/content parity and retained Render rollback before OTP release.
- The temporary password is plaintext **in volatile process memory and memory-backed libpq file** while the job runs; avoiding persisted files cannot eliminate this transient exposure. The container requires a real tmpfs mount and encrypted isolated compute. Cleanup on SIGKILL relies on ephemeral container tmpfs lifetime.

## Next steps

1. Inspect exact latest GitHub CI for new synthetic tests, full Alpine image CVE scan, signed review OCI and documentation contract; fix all regressions.
2. Independent security/code review of path creation, Vault response bounds, secret access and libpq escape semantics. Plan a separate isolated container runtime test for the real `/dev/shm` mount/permissions and TLS hostname validation.
3. Select resource cost ceiling and explicit ACR/GHCR visibility, Standard Vault, job identity and logging permissions. Do **not** create Azure resources until approved.
4. Only after encrypted staging backup plus independent recovery/rollback evidence, progress the OTP repair PR to staging and production.
