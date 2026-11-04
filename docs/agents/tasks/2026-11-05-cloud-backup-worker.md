# Task: Replace laptop-operated staging backups with cloud worker

- **Task ID:** `2026-11-05-cloud-backup-worker`
- **Status:** in review — all five synthetic and build checks pass at 2ebc327; cloud deployment/recovery unverified
- **Agent:** ChatGPT coding agent (scope is repository-only)
- **Last updated:** 2026-11-05 UTC
- **Baseline:** `fix/azure-pgdump-stdout-guard-2026-11-04`, draft PR #27 (unmerged)
- **Feature branch:** `ops/cloud-backup-worker-2026-11-05`
- **Dependencies:** Cloud-region/cost, credential storage, security review, PR #27, staging encrypted restore and retained Render rollback

## Goal

Enable a minimal **Azure Container Apps manual Job** to export the existing allowlisted CampusPool staging PostgreSQL schemas without executing database dumps or holding Azure CLI credentials on a personal Windows/WSL laptop. Use AGE streaming encryption before Azure Blob writes, managed identity with container-scoped data-plane permissions, and a fully reproducible synthetic test from GitHub Actions.

## Current state: confirmed vs planned

- Current source code has custom-format `pg_dump` stdout fix and `PGDMP` signature guard from PR #27. Operator-supplied local synthetic PG17→AGE→separate DB restore passed. PR #27 GitHub tests passed including a no-cloud Node subprocess/Blob mock.
- Existing local 48,600-byte potential staging dump remains a separate security incident. The operator verified Windows host volumes are not BitLocker encrypted. **No further staging exports on local host**.
- Only a 200-byte remote ciphertext object previously existed and failed PostgreSQL archive validation. Not a valid recovery point.
- The cloud-worker branch extends `scripts/azure-blob-backup.js` to select system-/user-assigned `ManagedIdentityCredential`, guarded by explicit `AZURE_AUTH_MODE=managed-identity`, `CAMPUSPOOL_CLOUD_WORKER=YES` and readable project CA; no Azure CLI login required. Other existing stage/source/container/AGE/approval checks stay mandatory.
- Dedicated Docker image includes Node 22 + PostgreSQL 17 + AGE, no blanket repository COPY, no AGE private key, no production secrets and a nonroot runtime. Default invocation is preflight only. New tests inject synthetic Azure clients, so no real Azure calls.
- **Not yet claimed:** deployed cloud job, Azure managed identity or role assignment, live staging export, independently restored real backup, cost/region approval, production release.

## Acceptance criteria

1. New worker tests and Docker image build pass in GitHub Actions; source unit suite remains green. Verify live code cannot select Azure CLI when cloud mode was explicitly configured.
2. Security review covers container image dependencies and pinning/lockfile, exact identity and source allowlists, certificate mount, Key Vault secret reference and no plaintext temp files.
3. Operator explicitly approves any Azure resource creation or billing change; deployment is **manual-only**, with no cron/schedule or automatic execution.
4. A single approved stage-only export produces independently downloadable and verifiable ciphertext; restore to a separate encrypted PG17/PostGIS with migration, content, roles, grants, extensions and RLS parity checks.
5. Verify retained Render rollback build and production release gates. No deployment, migration 008 or production rollout until evidence.

## Work done

- 2026-11-05: Research verified Azure Container Apps Jobs support manual runs, managed identities and usage-based billing (including a subscription-level free allowance; other resources may bill).
- 2026-11-05: Added managed identity cloud mode in `scripts/azure-blob-backup.js` and synthetic `test_cloud_backup_auth.js`.
- 2026-11-05: Created `ops/cloud-backup/Dockerfile`, minimal `package.json`, dedicated CI and cloud-runbook with release controls.
- 2026-11-05: Created draft PR #28 for review. No secrets, credentials, external resource writes or live migrations.
- 2026-11-05: **All five** PR #28 check runs at commit `2ebc327` completed successfully: `managed-identity-guards`, `worker-image`, `azure-realtools`, `azure-synthetic`, and `postgres-otp`. An intermediate `azure-realtools` CI run failed during disposable `createdb` setup; updated synthetic test to use the already-proven `psql CREATE DATABASE` path and retain sanitized failures. Re-run passed, with no actual stage/production/Azure connection. Image and dependency digest/lockfile hardening are still pending before deployment.

## Verification

| Check | Evidence | Status |
|---|---|---|
| Azure CLI local backend regression | PR #27 existing tests | passed prior branch |
| Cloud guard and identity selection | GitHub PR #28 `managed-identity-guards`, `2ebc327` | **PASS** |
| Worker Docker image/no-secret smoke | GitHub PR #28 `worker-image`, `2ebc327` | **PASS** |
| Cloud worker real archive upload | Not authorized | not run |
| Cold restoration of real staging data | Not authorized | not run |

## Security risks and decisions

- Cloud compute eliminates routine exposure of staging dumps to user hardware but doesn't remediate the earlier local plaintext incident.
- Azure Container Apps job-start permissions can allow an operator to override templates and misuse job secrets and managed identities; restrict start rights to highly trusted principals, preferably custom RBAC, and monitor use.
- Image dependency reproducibility, base digest pinning, SBOM/vulnerability scan and signed immutable artifact are **release blockers** prior to production. Initial Dockerfile is a build/testable baseline, not an approved image digest.
- Do not ship a recurring schedule or broader DB schema coverage without approval/recovery analysis. Costs across storage regions and subscriptions must be reviewed.
- Backup includes only `public` and `supabase_migrations`. Full Supabase recovery needs separately documented auth/storage/provider-managed objects and roles.

## Next steps — exact handoff

1. Review GitHub CI of cloud-worker PR; fix failures without touching staging.
2. Reproducible lockfile and pinned base image digests; validate exact Linux worker image, non-root and certificate mounting.
3. Obtain owner approval for Azure Container Apps/Key Vault/registry resource costs, regional compliance and IAM; create separate cloud environment with manually started job. No recurring automation without separate confirmation.
4. One protected, authorized cloud-side staging backup then independent cold restore and data parity, plus retained Render rollback artifact check.
5. Update `docs/agents/STATUS.md`, `NEXT_STEPS.md` and this task with evidence. Only after recovery gates may deployment/migration proposals proceed.

## References

- [Cloud worker runbook](../../ops/CLOUD_AZURE_BACKUP_WORKER.md)
- [Previous stdout fix PR #27](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/27)
- [Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [Container Apps cost](https://learn.microsoft.com/en-us/azure/container-apps/billing)
- Production impact: NONE
