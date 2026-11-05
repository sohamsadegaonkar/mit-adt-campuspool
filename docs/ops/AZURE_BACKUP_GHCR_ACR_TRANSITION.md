# CampusPool — registry-neutral backup worker: GHCR now, ACR after full-scale approval

**Decision:** 2026-11-06 IST. **Mode for launch-phase review: private GHCR.** **Future mode: private Azure Container Registry with user-assigned managed-identity pull.** This is source-only readiness; no Azure resources, image packages or identities are being created, and no backup schedule is being enabled.

## Contract that stays stable

- The **same** reviewed `ops/cloud-backup/Dockerfile`, Node backup worker entrypoint, PostgreSQL 17/AGE tools and encrypted stream go to **the same existing private Azure Blob container**. Registry selection changes *how the identical image is pulled*, never database reads, encryption, Blob writes or independent restore.
- The single manual Azure Container Apps Job remains in `malaysiawest`, with **one replica, zero automatic retries, 1800-second timeout, 0.5 CPU / 1 GiB**, no ingress and **`--preflight` only** until separately approved. The migration does **not** authorize daily scheduling or any live staging access.
- Both modes require an immutable image digest in the same repository name `campuspool-backup-worker`, not `:latest`. The digest **of the image actually pushed into the target registry** must be independently verified and approved; it may differ across registries.
- The worker's job **system-assigned identity** is reserved for staging Key Vault DB credential access and private Blob data roles. A separate scoped user-assigned identity reads the approved staging root CA from Key Vault, mounted as `/mnt/staging-ca/ca.pem`. The CA reader parameter keeps its historical name `registryPullVaultReaderIdentityResourceId` for compatibility.

## Future-compatible deployment input

New review-only template: `ops/cloud-backup/containerapp-job.registry-portable.review.bicep`. It uses a **single job definition** and a two-option provider parameter, avoiding separate duplicated application or backup logic:

| Input / control | Launch-phase GHCR (default) | Future ACR |
| --- | --- | --- |
| `registryProvider` | `ghcr` | `acr` |
| `imageSha256` | Verified signed GHCR image manifest digest | **Verified signed pushed ACR** image manifest digest |
| Registry address | `ghcr.io/sohamsadegaonkar/campuspool-backup-worker` | `<approvedacrname>.azurecr.io/campuspool-backup-worker` |
| Registry pull authentication | GHCR read-only token via **Key Vault reference** | Separate user-assigned pull identity via `registries[].identity`; **no GHCR token secret** |
| Mode-specific inputs | `ghcrReadOnlyUsername`, `ghcrPullTokenKeyVaultSecretUrl` | `acrRegistryName`, `acrPullIdentityResourceId` |
| Common job settings | Same manual-only worker | Same manual-only worker |

The target ACR must be privately configured, with login server validated and public/anonymous access disabled. For a **non-ABAC** ACR grant only `AcrPull`; for an **ABAC-enabled** registry grant the appropriate `Container Registry Repository Reader` role at the permitted scope. Do not grant `AcrPush`, Owner or registry admin to the job. See [Microsoft identity-based ACR pulls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull) and [ACR identity roles](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-authentication-managed-identity).

## Migration steps — only after full-scale launch decision and separate cost/security approval

1. Verify the **current** tax-inclusive monthly Azure subscription budget including ACR and a contingency, get a new owner-approved spending limit if the current **₹500/month aggregate cap** is insufficient, and record security/rollback approvals. Current retail ACR Basic alone exceeds that planning cap with contingency.
2. Approve the ACR registry name, regional availability, network access and retention, the job's separate **ACR reader identity**, and its *pull-only* role assignment. Preserve the existing CA Vault reader and the system-assigned data identity. No creation is authorized by this document.
3. Build or copy the **same reviewed worker image** to the private ACR, generate SBOM, run Trivy OS/application scanner, sign the **pushed ACR manifest** and verify its digest and trusted workflow identity. Never assume the GHCR digest and ACR digest match.
4. Change the job's **deployment parameters only**: `registryProvider=acr`, `imageSha256=<validated 64-hex ACR manifest SHA256>`, `acrRegistryName=<name>`, `acrPullIdentityResourceId=<scoped approved identity>`. Do **not** pass GHCR username or pull-token URL in ACR mode. The old GHCR package can be retained privately as a fallback until the ACR route is proven.
5. Independently review the resulting ARM diff: one unchanged manual job, approved ACR registry/identity, no GHCR token secret, unchanged CA mount, no new containers/schedules/ingress, `--preflight` only. Check real registry pull/CA/tmpfs/log redaction in a **separately authorized** isolated non-data test.
6. Separately approve staging TLS and backup/restore tests, then validate an actual encrypted Blob archive, remote checksum and cold independent PG17/PostGIS restore with roles/RLS/data digests and Render rollback. Do not promote a release until recovery and payment/OTP security gates pass.
7. Only after ACR and fallback are proven, revoke the now-unneeded GHCR job pull token and remove its dedicated Vault secret under a separate change record. Do not revoke it while rollback still requires it.

## Review-only safeguards and no-go boundaries

- `scripts/review-registry-portability.js` checks mode-specific redacted configuration and rejects mutable or malformed image digests, unapproved registry identities, inline credentials and settings from the wrong provider. It never connects to Azure or executes a backup; successful output means **review eligible only**.
- `test_registry_portability.js` exercises both modes, bad IDs/digests/secret leakage and worker policy drift. GitHub Actions builds Bicep to an ARM template and rejects extra containers, schedules, live flags or changed worker controls. **Compile tests are not an ACR pull test**.
- The existing reviewed `containerapp-job.private-ghcr.review.bicep` and its CI are preserved. The portable template is a **future deployment candidate** pending its own review and actual subscription checks. No need to migrate a working GHCR staging job solely to achieve conceptual portability.
- **Blocked:** paid resources, registry publication/visibility changes, GHCR token creation/rotation, ACR creation, IAM grants, Bicep deployment, job starts, recurring schedules, real staging database/TLS access, backup and restore, Render/OTP production release.

## Related evidence

- [Draft PR #42: GHCR template, security and Malaysia West public prices](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/42)
- [Draft PR #41: owner ₹500 total cost gate](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/41)
- [Azure GHCR design review](AZURE_MALAYSIAWEST_PRIVATE_GHCR_DEPLOYMENT_REVIEW_2026-11-06.md)
