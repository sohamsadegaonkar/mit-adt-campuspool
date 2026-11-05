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
- The former Dockerfile had mutable base references and `npm install` without a committed lockfile. The branch now pins both base images, commits an npm lockfile and uses `npm ci`; OS/base-image vulnerability assessment and release attestation remain outstanding.

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
4. Generated a v3 lockfile from GitHub CI's npm resolution, validated 66 resolved package entries and committed `ops/cloud-backup/package-lock.json`. The Dockerfile now uses `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` and the policy CI checks it.
5. Added a blocking `npm audit --omit=dev --audit-level=high` job. GitHub Actions reported `found 0 vulnerabilities` for the locked dependency tree on 2026-11-05 UTC. The locked image build, auth guards and offline smoke all passed on implementation SHA `7f30dcce51d727f85c06489ea244911761e807df`.

## Important remaining blockers before any image release

- **Transitive dependency reproducibility: COMPLETED in source.** CI-generated `package-lock.json` committed; `npm ci` and `npm audit --omit=dev --audit-level=high` passed with no reported npm advisories on 2026-11-05. Do not interpret this as an operating-system/base-image vulnerability scan or final production provenance.
- Verify vulnerability findings for pinned image digests and updated releases; a digest guarantees content identity **not** absence of vulnerabilities. Prefer updated, reviewed digest if scanner reports unacceptable findings.
- Sign/attest exact final image digest, choose a reviewed private registry and authorize its possible charges and retention policies. Avoid publishing the image automatically merely because CI passes.
- Design log destination, monitored executions, container read-only filesystem, scoped managed identity, Key Vault/CA/AGE recipient handling, and Supabase staging outbound access. Do not store credentials in GitHub Secrets merely for CI.
- Real encrypted staging export, Azure remote readback, separate PG17/PostGIS restore, data/RLS/grants parity, and Render rollback still **NO-GO**.

## Verification

- On SHA `7f30dcce51d727f85c06489ea244911761e807df`, GitHub jobs `managed-identity-guards`, `worker-image`, and `dependency-supply-chain` all PASS. The latter reports `found 0 vulnerabilities` from npm audit. The exact finished PR SHA requires post-docs CI verification.
- Synthetic-only CI: no Azure/Supabase credentials or network calls were supplied to the worker. Current environment has no job.
- No live cloud operation performed.

## Progress log

- 2026-11-05 UTC — Owner confirmed empty Azure environment, no job and no logging sink.
- 2026-11-05 UTC — Pinned Node/PostgreSQL parent indexes; added offline image-policy tests and GitHub workflow coverage.
- 2026-11-05 UTC — First docs CI found missing canonical task headings. Added required structured handoff; no secrets or Azure resource writes.
- 2026-11-05 UTC — Generated locked transitive npm graph via PR CI, committed it, switched Docker build to `npm ci`, removed temporary artifact/bootstrap step, added blocking npm audit and lockfile policy checks. All cloud CI jobs passed on SHA `7f30dcc`; no image published.

## Next steps

1. Verify exact final PR SHA CI and independent code review, including release-container OS/base-image CVE scanning, SBOM and final image digest signing/attestation. `npm audit` passing is not a full image scan.
2. Review a private image registry, secure privacy-safe logging destination, least-privilege job identity, Key Vault/CA/AGE recipient and Supabase pooler network path. Obtain explicit authorization for any additional cost or permissions.
3. Only then provision a manual-only job with `--preflight` default. Real staging export needs a separate explicit approval, and independent off-site restore plus Render rollback proof before migrations/deployment.

## OS vulnerability assessment and cost-gated Azure provision preparation — 2026-11-05 UTC

- Created full image Trivy OS/library scanning and CycloneDX SBOM evidence upload in GitHub CI. Original full image scan [run 42050254779](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42050254779): **458** advisory findings (4 critical, 72 high), of which **26** high/critical fixable vulnerabilities came from the unused `gosu` executable inherited from the PostgreSQL image.
- Removed `gosu` from worker image; its absence and fail-closed preflight verified by Docker smoke. Post-removal full [run 42050852283](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42050852283): **397** Debian OS findings (3 critical, 47 high, 173 medium, 168 low, 6 unknown), **0 high/critical scanner-documented fixes**. The **strict all-HIGH/CRITICAL gate FAILS intentionally**. This is not a passed release image and zero fixable issues does not mean zero vulnerabilities.
- Next technical experiment: compare full image against Debian 13 `postgres:17.11-trixie` in isolated CI; no tag-only candidate may be shipped, and exact final release base must be immutable digest pinned and re-scanned. No blanket VEX or waiver assigned.
- Prepared [cost and access design](../../ops/AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md) and read-only `ops/cloud-backup/azure-readonly-preflight.sh`: auth-private (not network-private) ACR Basic, Key Vault Standard, separate ACR-pull/user-managed identity and job system identity, container-scoped Blob Data Contributor, Key Vault Secrets User, manual-only job with no retries, safe logging and explicit stage-only run approval. **These are proposals, not Azure resources.**
- No new Azure creations, registry pushes, RBAC grants, database credential reads, staging exports, restored databases, deployment or migration. Azure environment still empty. Production release/OTP remains NO-GO.

## Debian 13 alternative scan evidence — 2026-11-05 UTC

- Full ephemeral `postgres:17.11-trixie` candidate image successfully built in isolated GitHub CI and underwent complete Trivy scan: **336** OS advisories (1 critical, 63 high, 128 medium, 138 low, 6 unknown). Pinned candidate source manifest digest available in [the experiment logs](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42051538206), but the candidate was **not selected**: compared to current Bookworm image (3 critical, 47 high), tradeoff is fewer critical yet more high issues.
- Both image choices are blocked for production; keep the committed Bookworm reference pinned and strict all-high/critical scanner gate failing until a reviewed new base/minimized runtime and exact-digest scan is accepted. No waivers or privileged job grant.

## Promoted lean runtime and available OS patch remediation — 2026-11-05 UTC (supersedes prior image status)

- Canonical worker `ops/cloud-backup/Dockerfile` now uses **pinned Node 22 slim** base in both stages with official signed PGDG PostgreSQL **client 17** package, AGE, runtime Node, no bundled npm/corepack or PostgreSQL server, no broad files/privileged container helpers. The trial succeeded with PG17 and AGE CLI, nonroot and fail-closed `--execute`; the previous pinned full PostgreSQL-server Bookworm image remains only in Git history.
- Lean candidate [first scan](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42059534772): 268, 1 CRITICAL, 40 HIGH, 3 available package fixes. Added runtime `apt-get upgrade` and [CI 42060036992](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42060036992) shows **262** findings (1 CRITICAL, 37 HIGH, 113 MEDIUM, 111 LOW, none UNKNOWN); **0 fixable HIGH/CRITICAL** per Trivy database at that time. Worker image build, policy/auth tests and npm audit pass; **full CVE security gate remains FAILED**. No waiver or release approval.
- Individual critical zlib1g MiniZip advisory `CVE-2023-45853` must be evaluated using [Debian's Bookworm package notes](https://security-tracker.debian.org/tracker/CVE-2023-45853); Debian marks source issue ignored because the affected MiniZip source code is not included in the relevant zlib binary. This is a **potential reviewed not-applicable classification**, not yet an approved VEX override or automatic scan suppression. The remaining HIGH advisories require explicit evaluation/mitigation.
- [Full evidence and action list](../../ops/CLOUD_WORKER_CVE_TRIAGE_2026-11-05.md); [Azure owner cost and RBAC plan](../../ops/AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md). No Azure registry/vault/job/permissions created; user has not supplied a cost ceiling. No backup export, restore, migration or OTP release, and release remains NO-GO.

## Image-specific critical CVE verification — 2026-11-05 UTC

- [CI 42062150091](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42062150091) verified the built Bookworm worker's `zlib1g` exact Debian version `1:1.2.13.dfsg-1`, absence of MiniZip binary/library/package, and absence of vulnerable `zipOpenNewFileInZip4_64` symbol. Vendor primary-source rationale: [Debian CVE-2023-45853](https://security-tracker.debian.org/tracker/CVE-2023-45853), which records MiniZip not built into affected Bookworm binary packages.
- Added `ops/cloud-backup/verify-bookworm-zlib-minizip.sh`, narrow `scripts/assess-cloud-worker-critical.js` (only exact CVE, package, version, OS, and image proof may classify not affected), and `test_cloud_worker_critical_triage.js` synthetic reject tests. All new proof/assessment/test CI steps PASS. **No generic vulnerability suppression**. Full raw scanner and strict release job still FAIL due unresolved 37 HIGH; never call entire image secure/cleared.
- **Next:** independent reviewer approval of not-affected evidence if adopting formal VEX, triage remaining 37 HIGH, signature/provenance and billable Azure resource approval. No real staging/production changes.
