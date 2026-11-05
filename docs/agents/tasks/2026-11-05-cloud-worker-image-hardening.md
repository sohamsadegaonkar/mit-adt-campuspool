# Task: Cloud backup worker image supply-chain hardening

- **Date / scope:** 2026-11-05 UTC; code and CI only, no Azure deployment, database access or secrets.
- **Branch:** `security/cloud-backup-worker-image-2026-11-05`
- **Owner-confirmed Azure environment:** `campuspool-backup-env`, `campuspool-backup-rg`, Malaysia West, Consumption workload profile, provisioning `Succeeded`, no Azure Container Apps Jobs, and log destination returned `null` in the owner's Cloud Shell.
- **Sources:** [Main worker runbook](../../ops/CLOUD_AZURE_BACKUP_WORKER.md) and [recovery evidence checklist](../../ops/RECOVERY_EVIDENCE_MANIFEST.md) (draft PR #37).
- **Status:** source security improvement for review; no publish/execute permission.

## Why

The worker's initial Dockerfile referenced mutable parent tags and installed dependencies using unpinned transitive npm resolution. Creating an empty Azure environment does not justify publishing or executing this image. Protect against unexpected base image changes and ensure the worker defaults to `--preflight`.

## Work completed

1. Pin two base images to Docker Hub-published multi-platform SHA-256 **index digests** (Node 22.23.2 bookworm-slim and PostgreSQL 17 bookworm) while retaining human-readable version tags. Verify the image actually resolves at the pinned digests in CI.
2. Add an offline `node:test` policy for immutable bases, exact Azure SDK direct versions, non-root user, scoped COPYs, no secrets in Dockerfile, and entrypoint default `--preflight`.
3. Wire the policy into the existing cloud worker GitHub workflow. No job/image publishing, Azure IAM changes or data exports.

## Important remaining blockers before any image release

- **Transitive dependency reproducibility:** `ops/cloud-backup/package-lock.json` is not in source yet. Current Docker build still uses `npm install`; generate and commit the lockfile with trusted npm tooling, then use `npm ci --omit=dev --ignore-scripts` and run audit + image vulnerability scan. Do not claim fully reproducible image or production-ready provenance until this is done.
- Verify vulnerability findings for pinned image digests and updated releases; a digest guarantees content identity **not** absence of vulnerabilities. Prefer updated, reviewed digest if scanner reports unacceptable findings.
- Sign/attest exact final image digest, choose a reviewed private registry and authorize its possible charges and retention policies. Avoid publishing the image automatically merely because CI passes.
- Design log destination, monitored executions, container read-only filesystem, scoped managed identity, Key Vault/CA/AGE recipient handling, and Supabase staging outbound access. Do not store credentials in GitHub Secrets merely for CI.
- Real encrypted staging export, Azure remote readback, separate PG17/PostGIS restore, data/RLS/grants parity, and Render rollback still **NO-GO**.

## Verification

- Existing project CI (prior to these edits): Docker smoke and synthetic auth tests passed; this change will be assessed on new PR commit and GitHub checks.
- No live cloud operation performed.
