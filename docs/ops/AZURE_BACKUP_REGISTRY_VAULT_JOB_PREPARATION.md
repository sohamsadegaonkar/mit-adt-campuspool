# CampusPool staging backup — private ACR, Key Vault and manual Container Apps Job preparation

**Date:** 2026-11-05 UTC. **Status:** PLAN / NO PROVISIONING AUTHORIZATION for additional resources. This document is not a deploy script. Owner-confirmed Azure environment only: `campuspool-backup-env` in `campuspool-backup-rg`, Malaysia West, **Succeeded** Consumption workload profile, **no jobs**, log destination **null**. Existing storage account `011campuspoolbackup` and private container `campuspool-staging-backups` are unchanged.

**CRITICAL:** The OS/container image scan (PR #38 Trivy) identified high/critical issues on the original image. **Do not publish or deploy this image** until the exact final-image scan, findings/remediation and explicit risk acceptance pass; npm audit passing is not equivalent to an OS package scan. No staging dump or release is approved.

## Goal and boundaries

Use a private *authentication-controlled* image registry, restricted secrets manager, and a **manual-only** finite-duration isolated cloud job. No always-running web app, ingress, schedule, live source DB access, or backup/restore execution before owner approval. Worker must be pinned by final immutable **image digest** rather than a mutable tag. User-supplied owner confirmation is the only available Azure evidence; ChatGPT's connected tools cannot execute Azure CLI in the owner's subscription.

## Option and cost review (not a quote)

| Proposed Azure component | Region/tier | Expected charges | Security/approval |
| --- | --- | --- | --- |
| Container Registry | Malaysia West, **Basic**, Entra/RBAC-authenticated, `adminUserEnabled=false` | **Daily base price even idle**, 10 GiB included; storage overage, image builds, data transfer may add costs | Basic is **not a private-network registry**: no private endpoint/IP firewall rules. Private here means authenticated image access; if network-private endpoint is mandatory, choose Premium with more cost/VNet design. |
| Key Vault | Malaysia West, **Standard**, Azure RBAC, soft-delete + purge protection | Secret operation charges (priced per 10,000 operations); network/log charges possible | Disallow public anonymous access, restrict operator and runtime secret readers. Purge protection is irreversible for retention period and must be approved. |
| Managed identity | Dedicated user-assigned ACR **pull-only** identity and system-assigned worker identity | No separate standing charge generally; any identity-dependent service may be billed | Keep ACR pull rights separate from Blob/Key Vault rights. |
| Container Apps Job | Existing Consumption environment; **Manual** only | Running vCPU/GiB seconds, not idle job executions; subscription-shared free allocation applies, but not all services are free | No public ingress, zero retries, one replica, timeout 1800s, safe preflight default, protected start permissions. |
| Logs/Monitoring | Currently **null**; design a scoped retention/redaction plan before real executions | Log Analytics ingestion/retention and alerting costs | Logs must **never** include passwords, student records, OTPs or decrypted data. Current lack of log destination is a blocker for real exports. |
| Blob/transfer | Existing private Malaysia West container; source Supabase in Singapore | Blob operations/storage, cross-region/provider egress and independent restore charges | Ciphertext only, if-none-match, content SHA-256, restricted container scope. |

Use the owner's **Azure pricing calculator** in their billing currency and check their Azure for Students remaining credit before accepting monetary estimates. Azure pricing pages can be regional or personalized; there is **no verified cost ceiling** yet. Do **not** assume free cost for idle ACR. Approval must enumerate each created resource, tier, region, role grant, expected monthly upper bound, and private/public network tradeoff. ACR Basic's authenticated public endpoint may not meet a strict network-private requirement.

Official pricing: [Container Registry](https://azure.microsoft.com/en-in/pricing/details/container-registry/), [Key Vault](https://azure.microsoft.com/en-in/pricing/details/key-vault/), [Container Apps Consumption billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).

## Proposed resources (all NOT CREATED)

| Purpose | Proposed name | Owner consent required |
| --- | --- | --- |
| Auth-private image registry | `campuspoolbackupacr` (Azure registry names are globally unique; name may need another suffix) | Basic SKU / public authenticated endpoint / admin disabled / fixed daily price |
| Secret vault | `campuspool-backup-kv-<unique>` | Standard SKU / RBAC / soft-delete / purge-protection / vault network policy |
| Registry pull identity | `campuspool-backup-pull-id` | User-assigned identity with **AcrPull** only; for ABAC registry use repository-scoped Reader |
| Cloud worker job | `campuspool-staging-backup-job` | Manual trigger, one replica, zero retries, 1800-second timeout, 0.5 vCPU, 1Gi memory; deployment by pinned image digest |
| Data-plane identity | System-assigned to **only** that job | Vault secret read and Blob writer for one existing container; **no** RG-wide Contributor and no storage account key |
| Secure logging | Explicit owner-approved scoped monitor/log sink | Must confirm retention, collection and cost before any real job execution |

Names/roles are proposals, not Azure changes.

## Least privilege and implementation order (approval-gated)

1. **Read-only preflight:** From authenticated Azure Cloud Shell Bash run `bash ops/cloud-backup/azure-readonly-preflight.sh` in a trusted checkout. Verify subscription, provider registrations (`Microsoft.ContainerRegistry`, `Microsoft.KeyVault`, `Microsoft.ManagedIdentity`), existing resources and logs. This script makes no changes. Registration of missing resource providers requires a separate review.
2. **Source release gate:** Fix/triage every Trivy HIGH and CRITICAL issue or record a specific, reviewed VEX/risk decision; generate SBOM and attestation for the reviewed candidate. Keep GitHub image CI without Azure credentials. Do not push an unscanned artifact or an image tagged `latest`.
3. **Before provisioning:** Review owner cost estimates for ACR Basic (or Premium if network-private endpoint required), Key Vault Standard, secure logs, image build charges, Azure Blob, network transfer and job compute. Confirm quota and subscription Azure for Students supports these SKUs.
4. **ACR:** Create a Basic registry in Malaysia West **only after approval**, with admin user disabled. Do not grant anonymous image pulls. Use **AcrPull at ACR scope only** for dedicated user-assigned image-pull identity, or a specific repository Reader if using registry ABAC. Image producer must use short-lived federated identity scoped to *push only*; no admin password, permanent registry credentials or GitHub personal access token.
5. **Key Vault:** Create Standard RBAC vault **only after approval**, with reviewed networking, soft-delete/purge-protection and restricted data/control-plane access. Stage the **staging-only** database password interactively through an approved secure secret flow; **never** paste into chat, Git, Azure CLI command-line argument/history, logs, GitHub Actions or shell artifacts. Secure public TLS CA certificate may be mounted/read-only using a separately verified mechanism.
6. **Manual job:** After signed/pinned image is available, attach registry-pull user-assigned identity and **job-specific system-assigned identity**. Configure `triggerType=Manual`, `parallelism=1`, `replicaCompletionCount=1`, `replicaRetryLimit=0`, `replicaTimeout=1800`, `cpu=0.5`, `memory=1Gi`, no HTTP ingress, no scheduled/event triggers. At create time use `--preflight` with **no** database secret and **no** `AZURE_EXPORT_APPROVED`. **Creating** a job is not approval to **start** it.
7. **Runtime RBAC AFTER job creation:** Assign its system principal:
   - `Storage Blob Data Contributor` **only** on `/subscriptions/<SUB_ID>/resourceGroups/campuspool-backup-rg/providers/Microsoft.Storage/storageAccounts/011campuspoolbackup/blobServices/default/containers/campuspool-staging-backups`.
   - `Key Vault Secrets User` on the **specific vault/secret** as supported, not the subscription or resource group. Only approved staging password is accessible.
   - Do **not** grant `Owner`, `Contributor` or shared storage-account keys. Identity for ACR image pull should **not** hold Blob/Vault roles.
8. **Sealed job config:** Use Key Vault secret reference for `PGPASSWORD`, file-mounted CA with `PGSSLMODE=verify-full` and `PGSSLROOTCERT` pointing to an existing readable file; only AGE **public recipient** is on the backup worker. Keep `AZURE_AUTH_MODE=managed-identity` and `CAMPUSPOOL_CLOUD_WORKER=YES`; omit `AZURE_CLIENT_ID` for system-assigned data identity. Make sure worker selects system identity if both system and user identity are attached; verify with a **no-data** auth dry-run.
9. **Source credential minimization:** Existing worker allowlists the privileged Supabase pooler login `postgres.<staging-ref>`; provision a reviewed staging-only read/export role if possible, update the allowlist and retest. Never provide an unrestricted production role or privileged password by default.
10. **Job operation policy:** Azure's built-in Container Apps Jobs Operator/Contributor roles have secret-reading wildcard actions. More importantly, **permission to start a job can allow execution-template overrides and exposure of its identities/secrets**. Restrict starters to a tightly trusted operator; monitor RBAC changes and never delegate start casually. For read-only observers, use role actions without `start` or `listSecrets`.
11. **Explicit backup-run approval:** A separate authorization is required to set `AZURE_EXPORT_APPROVED=YES` and intentionally invoke `--execute`, with expected source, destination, time and image digest reviewed. Independent encrypted PG17/PostGIS cold restore with content/RLS/grants/migration parity and Render rollback remains the production release gate.

## Security invariants (must be verified before start)

- Verified immutable image digest + SBOM, no untriaged unacceptable CRITICAL/HIGH; file copy allowlist; nonroot worker; no `gosu` helper or embedded credentials.
- Vault grants and registry pull grants separate, storage scope only one private backup container; no shared keys/SAS.
- No plaintext backup written to disk, no student content in logs, secret-based staging PostgreSQL connection with TLS hostname verification.
- Safe readable CA path exists at runtime; independent AGE **private identity** stored exclusively in a separate protected recovery environment.
- Source-to-Azure outbound allowed only as needed; current Consumption environment **does not imply egress allowlists**. Plan for Supabase Singapore pooler, Azure Entra, Key Vault and Blob endpoints, with any VNet/firewall costs reviewed.
- Encrypted backup has independent cold restore proof, not just Blob upload/readback. Preserve old invalid 200-byte object pending reviewed disposition.
- Azure account role assignments and remaining student credit independently verified. **No create, role assignment, job start, data export, migrate or deploy** from this plan.

## Owner approval checklist (no action until completed)

- [ ] Exact ACR tier and daily/monthly estimate approved, including Basic's authenticated **public network endpoint** or Premium's additional private-network cost.
- [ ] Standard Key Vault secret-operation budget and purge-protection/retention approved.
- [ ] Secure logging and retention budget approved; log destination configured.
- [ ] Separate ACR pull and scoped Vault/Blob write identities approved (no broad role grants).
- [ ] No critical/high unreviewed image vulnerabilities; signed image digest reviewed.
- [ ] Source read-only credential / TLS / CA and secrets injection model reviewed.
- [ ] Manual-only job configuration, timeout/parallelism and per-run cost approved.
- [ ] Explicit separate authorization for first staging export; protected independent restore environment and rollback plan prepared.

**Useful Microsoft docs:** [Container Apps Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs), [Job permissions and override risk](https://learn.microsoft.com/en-us/azure/container-apps/jobs#permissions), [ACR managed identity](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-authentication-managed-identity), [ACR tier limitations](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus), [Key Vault references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets), [Managed identity separation](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/scenarios/app-platform/container-apps/identity).
