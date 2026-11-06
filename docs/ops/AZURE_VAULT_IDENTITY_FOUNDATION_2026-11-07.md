# CampusPool — owner-run Key Vault + managed identity foundation (November 7, 2026)

**Decision:** owner instructed the agent to start the next Azure Key Vault and identity step, after registering `Microsoft.KeyVault` and `Microsoft.ManagedIdentity`, privately publishing and cryptographically signing the immutable GHCR manifest, and revoking the temporary `write:packages` token.

**Scope:** Create **at most two Azure resources** in the existing Malaysia West backup resource group; **no secrets, role assignments, GHCR pull token, Container Apps Job, schedule, database access, Blob export or production change**. The GHCR signed image remains pinned to `sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2`; see [signed-image evidence](GHCR_SIGNED_MANIFEST_GATE_2026-11-07.md).

## Resource contract

| Item | Configuration |
| --- | --- |
| Subscription | `Azure for Students` only |
| Existing resource group | `campuspool-backup-rg`, Malaysia West |
| Existing Container Apps environment | `campuspool-backup-env`, Consumption, currently no job |
| Existing Blob account | `011campuspoolbackup`, anonymous blob access disabled |
| **New Vault** | `campuspool-backup-kv-01`, **Standard**, RBAC-only authorization, **no automatic operator data-plane privileges**, soft-delete **90 days** and purge protection **enabled** |
| **New user-assigned identity** | `campuspool-ghcr-vault-reader` used later for restricted GHCR pull token + trusted CA Key Vault references |
| Private registry | GHCR, not ACR; do **not** register or create Microsoft.ContainerRegistry |
| Vault network | Public endpoint **Enabled**, default network rule **Allow**, authentication enforced through RBAC/TLS. This is NOT a private-network Vault; it is a deliberate minimal-cost launch tradeoff, not an assertion of private networking |
| Identity and Vault access grants | **None created by this stage**; scoped grants separately reviewed after secrets and intended job identity exist |
| Security limitations | Purge protection is **irreversible** for the life of the Vault and 90-day retention can prevent reuse of the name. If that is unacceptable, do not apply. Azure Standard secret operations are metered; owner's actual ₹500 aggregate monthly spend remains **unverified/deferred** |

## Owner procedure in authenticated Azure Cloud Shell Bash

Run these from the **existing Cloud Shell checkout**, not PowerShell/WSL:

```bash
cd ~/campuspool-cost-check
git pull --ff-only

# Read-only checks — no resources created:
bash ops/cloud-backup/azure-vault-identity-foundation.sh --plan

# Only after reviewing the explicit security/retention/network warnings:
bash ops/cloud-backup/azure-vault-identity-foundation.sh --apply
```

The `--apply` operation requires the exact interactive confirmation phrase `CREATE_CAMPUSPOOL_VAULT_AND_READER`. It then creates only the Vault and one user-assigned identity, checks their settings, and prints sanitized status lines. The commands are **idempotent for matching resources** and fail closed on a wrong subscription, missing existing environment, anonymous Blob exposure, unregistered providers, Vault-name collision or existing Vault security mismatch. If one resource is already present in the right configuration, it is reused without update. Never run `--debug` or paste raw account IDs, principal IDs, subscriptions, token values or Azure error payloads into public PRs/chat.

**Expected sanitized success:**

```text
AZURE_SUBSCRIPTION=AZURE_FOR_STUDENTS_CONFIRMED
KEY_VAULT=campuspool-backup-kv-01
USER_ASSIGNED_VAULT_READER=campuspool-ghcr-vault-reader
KEY_VAULT_CONFIG_VERIFIED=YES
VAULT_READER_IDENTITY_VERIFIED=YES
FOUNDATION_CREATION_PASS=YES
NO_SECRETS_OR_AZURE_RBAC_GRANTS_CREATED=YES
NO_JOB_CREATED_OR_STARTED=YES
NO_DATABASE_CONNECTED_OR_EXPORTED=YES
```

If `STOP_GLOBAL_VAULT_NAME_UNAVAILABLE` appears, **do not improvise a Vault name**: change name in a separate reviewed source update, preserving the worker's permitted `campuspool-backup-kv-[a-z0-9]{1,3}` DNS allowlist, the GHCR deployment Bicep parameters and all runbooks. If `STOP_VAULT_CREATE_FAILED_INSPECT_AZURE_PORTAL_PRIVATELY` or `STOP_MANAGED_IDENTITY_CREATE_FAILED_INSPECT_AZURE_PORTAL_PRIVATELY` appears, inspect the Azure Portal for policy/quota/permissions; check read-only inventory before retrying. Partial creation may have occurred and is deliberately preserved.

## Next controlled release gate (not performed by this stage)

1. Verify Vault Standard/RBAC and UAI in the Azure resource group without sharing resource IDs.
2. Assign narrowly scoped Vault data-plane permissions **only** after owner-reviewed exact secret scopes: UAI may GET only `ghcr-pull-token` and `staging-pg-root-ca`; the job system identity later may GET only `campuspool-staging-pg-password`. Key Vault administrative secret creation requires a separate trusted human/operator role. **Do not give the GHCR registry reader the staging PostgreSQL password.**
3. Issue a **new distinct** classic GitHub PAT with `read:packages` only, short expiry, store solely in the Vault; do not revive the revoked write-scoped PAT or print it in Cloud Shell history. Import CA material safely without copying secrets to persistent WSL/Windows folders.
4. Independently verify private GHCR digest signature/provenance and least-privilege Blob **read/add/write without delete**, then review target Container Apps Job (manual, one replica, no retries, no ingress, `--preflight` only) before any provisioning. Don't use broad `Storage Blob Data Contributor` by default if a no-delete custom role is required.
5. Separately authorize staging TLS `verify-full`, first actual encrypted AGE dump and private Azure Blob SHA-256 readback, then an **independent** protected PostgreSQL 17/PostGIS cold restore with grants/RLS/table-content parity and Render rollback validation.

**No private AGE decryption key is required inside or should ever be uploaded to the backup worker.** No production deployment or automatic job runs are authorized by this runbook.

### Documentation

- [Azure Key Vault CLI `az keyvault create` and irreversible purge protection](https://learn.microsoft.com/en-us/cli/azure/keyvault)
- [Azure Container Apps identities and job permission risks](https://learn.microsoft.com/en-us/azure/container-apps/security)
- [Azure Container Apps Key Vault secret references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Azure Key Vault RBAC least privilege](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
