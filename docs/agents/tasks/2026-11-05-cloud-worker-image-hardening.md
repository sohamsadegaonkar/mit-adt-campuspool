# Task: Cloud backup worker image supply-chain hardening

- **Date / scope:** 2026-11-05 UTC; code and CI only, no Azure deployment, database access or secrets.
- **Branch:** `security/cloud-backup-worker-image-2026-11-05`
- **Owner-confirmed Azure environment:** `campuspool-backup-env`, `campuspool-backup-rg`, Malaysia West, Consumption workload profile, provisioning `Succeeded`, no Azure Container Apps Jobs, and log destination returned `null` in the owner's Cloud Shell.
- **Sources:** [Main worker runbook](../../ops/CLOUD_AZURE_BACKUP_WORKER.md) and [recovery evidence checklist](../../ops/RECOVERY_EVIDENCE_MANIFEST.md) (draft PR #37).
- **Status:** source security improvement for review; no publish/execute permission.

## Goal and acceptance criteria

- Establish immutable parent image digest pinning and enforce fail-closed worker properties through CI without contacting Azure or PostgreSQL.
- Acceptance: GitHub cloud backup worker CI builds the image successfully, policy tests and existing synthetic auth/smoke pass, source handoff is valid, and deployment is still explicitly gated.

## Current state

- The user's Azure Cloud Shell reports a newly provisioned empty Consumption environment at Malaysia West, with no jobs and null log destination.
- The existing Dockerfile contained mutable base references and `npm install` without a committed lockfile. This task addresses base digest identity and policy CI only.

## Plan

1. Replace mutable base references with Docker Hub verified index digests and keep original readable tags.
2. Add offline static policy tests and wire into GitHub cloud-worker CI.
3. Record human/security review blockers for npm lockfile, vulnerability scans, image signature, secrets, run logging and approved release.
4. Re-run CI after every edit and stop if image build or security checks fail.

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

## Progress log

- 2026-11-05 UTC — Owner confirmed empty Azure environment, no job and no logging sink.
- 2026-11-05 UTC — Pinned Node/PostgreSQL parent indexes; added offline image-policy tests and GitHub workflow coverage.
- 2026-11-05 UTC — First docs CI found missing canonical task headings. Added required structured handoff; no secrets or Azure resource writes.

## Next steps

1. Verify all GitHub workflow checks at the latest PR implementation SHA and resolve build/test failures before independent review.
2. Generate and commit worker npm lockfile, switch Docker build to npm ci, perform vulnerability review and immutable image release attestation.
3. Separately authorize private registry, secure log destination, Key Vault/identity and manual job; do not create or execute before security design.
4. Independently verify actual protected staging ciphertext recovery/restore and Render rollback before migration or release.
