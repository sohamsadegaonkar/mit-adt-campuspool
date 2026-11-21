# RFC-CP-027 — Verifiable backup-worker release provenance (review-only)

**Date:** 2026-11-21 IST. **Status:** DRAFT / source-only review. **G1: OPEN. Production: NO-GO.** No registry push, new registry signature, Azure mutation, database connection, export, decrypt or restore is authorized by this design.

## Actual state and exact evidence boundaries

- [Backup source hardening PR #74](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/74) has CA projected-mount and honest scoped-PGDMP coverage fixes, verified at source SHA `72337ffae59f663fbbe03c5d8145be5333fd6eb4` by [worker CI #44909896141](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44909896141), [Stage 1 PG #44909896047](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44909896047) and [synthetic backup #44909896062](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44909896062). **PR #74 remains draft/unmerged**, and its source head is not a published OCI image.
- Azure's Manual job `campuspool-staging-backup-job` was read back using GHCR digest `sha256:694e39c24b89c91dfea8419ed669a70a9a62cef18d99038a87e84225e5468ce8`. [Verify-only signer run #44906606631](https://github.com/sohamsadegaonkar/campuspool-backup-signer/actions/runs/44906606631) did not find a signature matching our **expected identity/issuer** for this digest.
- A different old GHCR image `sha256:35e37da37bb4b7790b5582dc73b7c11aad24068d4040a0b6401034d656698a4c` has [a verified exact-keyless signature](https://github.com/sohamsadegaonkar/campuspool-backup-signer/actions/runs/44886779860), but that private signer did **not** build it or attest the original source checkout. It predates the PR #74 fixes. **Never repin Azure to it merely because it is signed.**
- The existing public `cloud-backup-worker-ci.yml` builds and keyless-signs a **PR-local OCI archive** (not a GHCR manifest). It uses the GitHub PR-merge checkout, not necessarily the PR head SHA or a protected release commit. The archive tar SHA-256 must **never** be presented as the OCI registry manifest SHA-256.

## Architecture review: source → immutable release image → Azure

### Gate A — source accepted (not currently satisfied for PR #74)

Review the full PR stack and approve/merge the actual fixes into the intended protected source ref. Independently verify a **full 40-character commit SHA** and exact code/lockfile/Dockerfile at that protected ref, successful Stage 1 and worker security/scan tests **at the same code**. The current PR merge-run SHA is not a release-source acceptance token.

### Gate B — build once and attest original artifact (future authorization)

From a protected **source-repository GitHub Actions workflow**, check out exactly the reviewed source SHA. Build a single immutable `linux/amd64` OCI candidate with pinned base image and lockfile; test non-root UID, `--preflight` default, PG 17.12, AGE, CA projected mount policy, encryption/Key Vault guard, and fail on HIGH/CRITICAL OS/Node vulnerabilities with complete scanner coverage. Produce a CycloneDX or SPDX SBOM, exact archive SHA, source/checksum inventory and artifact retention evidence.

Use native `actions/attest@v4` (or explicitly reviewed, version-pinned equivalent) to **attest the exact built OCI tar as a file subject**, with `contents:read`, `id-token:write`, `attestations:write`, only after an independent owner-approved workflow change. Public source GitHub repositories support artifact attestations across current plans; **private signer repositories require GitHub Enterprise Cloud** for GitHub's native artifact attestations. No private-repository attestation entitlement is assumed. Do not include secrets in Docker build args, logs or provenance.

**The PR-local signed OCI candidate from present CI is not Gate B.** Its current source is a PR merge ref; the new unsigned source inventory created by this review is merely a SHA-256/checkout map, and explicitly reports `authenticatedBuildProvenanceVerified:false`, `ghcrImageManifestDigest:null`, `releaseReady:false`.

### Gate C — verify and publish the *same* artifact privately (future authorization)

Use a **separately approved private publisher** with only the minimal existing GHCR package-specific write access, avoiding any package-visibility change or write grant to the public CampusPool source repository. Before publication, independently verify the source repository's attestation over the **exact OCI tar SHA**, source workflow identity and reviewed source revision. The publisher **must not rebuild the Dockerfile**; copy the approved OCI content with digest-preserving tooling, fail if any content/manifest digest changes unexpectedly, and independently read back the **new** pushed registry manifest digest. Record a verified mapping from attested tar subject to immutable GHCR manifest/index digest and chosen `linux/amd64` child manifest. OCI tar SHA and GHCR manifest SHA will ordinarily differ and are separate evidence fields.

The existing **private signer** may only sign the new exact digest following separate owner approval, minimum scope and reviewed trusted workflow OIDC identity. Require read-back Cosign verification of the new digest with exact certificate identity and issuer. Do not retro-sign the old Azure-configured image to pass a gate.

Native GitHub `actions/attest` may be unavailable in the private publisher repo without Enterprise Cloud; a separately reviewed Sigstore in-toto/Cosign attestation or the verified **public source artifact attestation + signed private publication mapping** is a candidate architecture. This is **not equivalent to a builder attestation unless the source artifact's authenticity and exact transfer are independently verified**.

### Gate D — independent pulled-image acceptance (future authorization)

Read the pushed digest from GHCR with existing approved read access. Verify image signature and authenticated source/transfer attestations, exact reference and platform; compare the **actual pulled payload** (all worker scripts, lockfile dependency versions, runtime config, PG17/AGE/CA guard) against the accepted source. Run a fresh full OS+Node vulnerability scan with a complete SBOM **for that digest**, not a fresh rebuild or a mutable tag. Refuse a release if evidence names any mismatched subject SHA, workflow, source commit or missing vulnerability scan.

[Private image inspection PR #3](https://github.com/sohamsadegaonkar/campuspool-backup-signer/pull/3) is draft and currently targets the **old** signed image. It should not be reported as a new-image or production release check.

### Gate E — Azure update and independent G1 recovery (separate operational authorizations)

Only after A–D independently pass may an owner review a *redacted*, exact-image proposed Azure job diff, including manual trigger, zero retries, no ingress, CA projection and fingerprint, Key Vault/data identity and TLS `verify-full`. The owner must separately authorize the actual digest change and a non-data runtime preflight. A separate G1 authorization is necessary for real encrypted backup, checksum/retention, independent blob retrieval, protected AGE decryption, isolated PostgreSQL 17/PostGIS restoration, data/roles/RLS/grants parity and RPO/RTO. **Even a perfect provenance audit does not close G1.**

## Review changes in this PR

1. Retire the obsolete branch-specific **public repo GHCR signing job** and its manual signing inputs from the public worker CI. Retain its existing PR-local signed OCI **candidate** job, explicitly non-release and not a GHCR signature. Never add `packages:write` to this public CI.
2. `scripts/cloud-backup-release-source-inventory.js` generates **only** an unsigned inventory of the checked-out Git commit, PR head SHA, CI workflow path, local OCI tar SHA-256 and exact Dockerfile, lockfile and worker-script SHA-256 values. It rejects malformed SHAs, unreviewed workflow identifiers, symlinked/invalid source files and misplaced archives; release booleans remain false.
3. `test_cloud_worker_release_policy.js` fails on reintroduced public GHCR write/sign/push permissions, absent PR-only local candidate restrictions, missing CA/backup-scope source safeguards or false full-release claims. Existing worker CI runs these offline tests and stores the inventory alongside the **local** OCI review artifact.

## Current decision / stop conditions

- **Source policy and unsigned candidate inventory are not actual build provenance**, nor new registry-image signature, nor vulnerability proof for a published new digest.
- No **new signed release image** exists as a verified result of this source review; no new GHCR digest is authorized for Azure, and no new snapshot is recovered.
- Approval to add native public source attestation, to publish/sign a private image, to change any GHCR ACL or Azure job, and to conduct real backup/recovery must be **separate and explicit**.

References (reviewed 2026-11-21): [GitHub artifact attestation docs](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) · [GitHub actions/attest](https://github.com/actions/attest) · [Docker build provenance/SBOM](https://docs.docker.com/build/ci/github-actions/attestations/) · [CampusPool production roadmap](https://app.notion.com/p/41dca5237af5819ba7d3c3f9bff9b088).
