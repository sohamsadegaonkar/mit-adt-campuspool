# Azure Vault IAM operator-role preflight — read only (2026-11-07 IST)

## Last verified live evidence

The owner executed the sanitized `azure-vault-rbac-readonly-audit.sh` in Azure Cloud Shell, and it returned:

```text
AZURE_FOR_STUDENTS_SUBSCRIPTION_VERIFIED=YES
MALAYSIA_WEST_RESOURCE_GROUP_VERIFIED=YES
VAULT_STANDARD_RBAC_PURGE_PROTECTION_VERIFIED=YES
GHCR_VAULT_READER_IDENTITY_PRESENT=YES
BLOB_ACCOUNT_ANONYMOUS_ACCESS_DISABLED=YES
BACKUP_BLOB_CONTAINER_PRESENT=YES
GHCR_READER_EXISTING_ROLE_ASSIGNMENTS=0
AZURE_CONTAINER_APPS_JOB_COUNT=0
READ_ONLY_IAM_AUDIT_COMPLETE=YES
NO_SECRETS_ROLE_GRANTS_KEYS_OR_DATABASE_ACCESS=YES
READY_FOR_SEPARATE_SECRET_SCOPE_RBAC_DESIGN=YES
```

**Interpretation:** the Vault and identity exist, backup container metadata exists, and the new GHCR Vault reader UAI has zero assignments returned by the audit. No job or runtime secret permissions were set up. This does not mean the human operator has authorization to set secrets or assign RBAC roles.

## Secret-access model

- `campuspool-backup-kv-01`: Standard, 90-day purge-protected RBAC Vault. Endpoint is public TLS with Azure RBAC controls; not a private endpoint or VNet. Keep `--no-self-perms` foundation behavior.
- `campuspool-ghcr-vault-reader`: **read-only** `Key Vault Secrets User` scoped **only to two exact individual secrets** `ghcr-pull-token` and `staging-pg-root-ca`, after those secrets exist and after granting narrowly scoped identity access. Never grant Vault-wide `Key Vault Secrets User`; never give it `campuspool-staging-pg-password`.
- A **different job system identity**, to be provisioned with the manual Container Apps job, may read **only** `campuspool-staging-pg-password` after staging-only approval. Blob worker should have a container-scoped custom read/create/write without delete. `Storage Blob Data Contributor` is too broad because of delete.
- Owner must **not generate a new GHCR `read:packages` PAT until a verified secure path to Vault ingestion exists.** The temporary `write:packages` PAT was deleted already. For eventual import, prefer a short-lived operator identity and Key Vault CLI `az keyvault secret set --file` from an ephemeral protected source with stdout suppressed. Never place the PAT in CLI `--value`, shell history, public Git, screenshots or chat.
- Azure documentation permits secret-level RBAC assignments as an exception for limited sharing cases, and its console walkthrough begins from a **previously created secret**. The protected secret must be provisioned safely before the GHCR reader's per-secret role grant is applied. The Vault-level temporary operator secret-writer grant, if needed, requires separate authorization, minimal duration and verified removal. An independent reviewer must inspect effective permissions (direct, inherited, group membership and deny assignments) and role-management audit.
- **No role grants or secret uploads are performed by this milestone.** Avoid a Vault-wide Secrets User grant to get past deployment errors.

## Next owner command in Azure Cloud Shell — read-only operator capability audit

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
bash ops/cloud-backup/azure-vault-operator-role-readonly.sh
```

Script checks that Azure Cloud Shell is connected to a user identity on `Azure for Students`, that the Vault is still in the exact resource group with RBAC enabled, resolves the operator's Microsoft Entra user object ID internally (never prints it), then asks the Azure CLI for roles on the Vault scope including inherited/group assignments. Outputs only an assignment count and conservative flags:

```text
AZURE_OPERATOR_RELATED_ROLE_ASSIGNMENTS=<integer>
ROLE_ASSIGNMENT_ADMIN_CANDIDATE=YES|NO_OR_CUSTOM_ROLE
SECRET_WRITE_ROLE_CANDIDATE=YES|NO_OR_CUSTOM_ROLE
AZURE_VAULT_OPERATOR_ROLE_AUDIT_COMPLETE=YES
ROLE_CANDIDATES_ARE_NOT_EFFECTIVE_PERMISSION_PROOF=YES
NO_ROLE_ASSIGNMENTS_SECRET_VALUES_OR_DATABASE_ACTIONS_PERFORMED=YES
NEXT=REVIEW_EPHEMERAL_SECRET_WRITER_AND_SECRET_SCOPED_UAI_READ_PERMISSIONS
```

If Graph lookup or scoped role enumeration fails, it reports a `STOP_...` code; do not grant broader roles or try a wildcard identity to bypass it. Those role-name flags are **not proof** of entitlement; conditional/PIM, custom roles, deny assignments or pending propagation can change actual access.

## Sources

- [Microsoft Key Vault RBAC guide — secret-scoped roles](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [Azure CLI Key Vault secret set — `--file` without token on command line](https://learn.microsoft.com/en-us/cli/azure/keyvault/secret)
- [Azure CLI role assignment list — `--all --include-inherited --include-groups`](https://learn.microsoft.com/en-us/cli/azure/role/assignment)
- [Azure Container Apps Key Vault references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Azure Blob role definitions](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage)
