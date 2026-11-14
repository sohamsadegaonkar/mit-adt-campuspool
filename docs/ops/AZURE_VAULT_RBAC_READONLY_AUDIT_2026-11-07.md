## Azure Key Vault + managed identity foundation LIVE — 2026-11-07 IST

**Owner-executed Azure Cloud Shell output proves the two resources were created** under validated `Azure for Students` subscription in Malaysia West:

```text
KEY_VAULT=campuspool-backup-kv-01
KEY_VAULT_EXISTS=NO
USER_ASSIGNED_VAULT_READER=campuspool-ghcr-vault-reader
READER_IDENTITY_EXISTS=NO
KEY_VAULT_CONFIG_VERIFIED=YES
VAULT_READER_IDENTITY_VERIFIED=YES
FOUNDATION_CREATION_PASS=YES
NO_SECRETS_OR_AZURE_RBAC_GRANTS_CREATED=YES
NO_JOB_CREATED_OR_STARTED=YES
NO_DATABASE_CONNECTED_OR_EXPORTED=YES
```

`KEY_VAULT_EXISTS=NO` and `READER_IDENTITY_EXISTS=NO` were **pre-creation inventory**, not post-creation; the final `*_VERIFIED=YES` and `FOUNDATION_CREATION_PASS=YES` are the authoritative completion markers.

**Exact security settings:** Standard Azure RBAC Key Vault with no automatic operator secret privileges, 90-day soft-delete retention and irreversible purge protection; user-assigned `campuspool-ghcr-vault-reader`. The Vault's network endpoint is public (Azure RBAC required, no private VNet/endpoint); cost is metered and the overall ₹500 INR monthly ceiling is deferred/unverified. **No secret values, GHCR tokens or additional job identities have been created, no IAM role grants or staging data access performed.** Existing private signed GHCR image remains `sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2`.

### Next operator command: sanitized RBAC & Blob container audit (NO writes)

Run in **Azure Cloud Shell Bash**, same `~/campuspool-vault-setup` directory, not Windows PowerShell:

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
bash ops/cloud-backup/azure-vault-rbac-readonly-audit.sh
```

The helper validates the current subscription and actual Vault RBAC/purge protection; confirms identity is in Malaysia West and obtains the principal ID **internally only**; checks storage account disallows anonymous Blob reads and uses **management-plane** `az storage container-rm show` to verify `campuspool-staging-backups` exists **without fetching storage account keys or Blob contents**; audits existing user-assigned identity role assignments with `--assignee-object-id --all --include-inherited`, and checks any backup jobs. Only sanitized booleans and aggregate counts are output. Nonzero role grants or existing job causes a STOP instead of blindly proceeding.

**Expected ideal output** (dependent on live Azure state):
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

**Halt** on `STOP_...`. An identity with 0 direct assigned roles does not by itself prove the absence of all possible access routes (e.g., group/inherited/outside subscription), but confirms the queried Azure RBAC state for this identity. The assistant cannot run this command inside the owner's Azure subscription; owner output is the ground truth.

**Only after audit:** review secret-specific `Key Vault Secrets User` GET (not Vault-wide) for future `ghcr-pull-token` and `staging-pg-root-ca` held by user-assigned identity. Reserve future job system identity for `campuspool-staging-pg-password`; never grant it to GHCR reader. A role grant at secret scope may require secret resource to be created first by an explicitly authorized operator; no accidental secret value in shell argv/history. For backup storage writer use custom data-plane read/write/add role without delete/move, container scope only. Azure's built-in `Storage Blob Data Contributor` contains delete permissions and is not acceptable by default. Independent release/security approval still pending; no job, backup or restore authorized.

Official sources: [Key Vault RBAC including secret-scope roles](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide), [Blob data contributor includes delete](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage), [management-plane storage container show](https://learn.microsoft.com/en-us/cli/azure/storage/container-rm), [Azure role assignment list](https://learn.microsoft.com/en-us/cli/azure/role/assignment).
