# Azure Blob Storage — CampusPool staging recovery operator runbook

**Status:** proposed, private storage account reported created by owner; account/container configuration not verified by agent. Never treat an encrypted upload as a successful independent database restore.

## Azure destination

- Subscription: **Azure for Students**, per owner's portal summary. Check remaining credits and resource quotas; Blob storage is billed by capacity, transactions and retrieval. Student subscriptions can expire.
- Resource group: `campuspool-backup-rg`
- Storage account (reported): `011campuspoolbackup` in **Malaysia West** with Standard LRS
- Container to create **manually** inside storage account → Data storage → Containers → **+ Container**:
  - Name: `campuspool-staging-backups`
  - **Anonymous access: Private (no anonymous access)**.
- Keep public anonymous blob access disabled at the **account** level, secure transfer required, minimum TLS 1.2, no SFTP/NFS. Do not make individual blobs public. Account setting **Public network access** is unrelated to anonymous access: using selected networks means allow the operator's *current IP*; using all networks still requires authentication but has a wider network attack surface. This runbook does not change Azure firewall rules.
- **Identity/RBAC:** grant the signed-in student owner `Storage Blob Data Contributor` on **only the backup container** (or the narrowest compatible scope). Management-plane `Contributor` alone doesn't grant blob data access. Using Microsoft Entra auth avoids sharing account keys or SAS tokens with scripts. If storage account key access is disabled, this is expected.
- No scheduled backups, auto-lifecycle rules, cross-border exports, cost-incurring recoveries or new Azure resources are created by the script.

## Local development and credential protection

Previous operator environment: Ubuntu-D WSL2, PG17.11, AGE CLI, Node 22. Azure CLI and Azure JavaScript SDK have **not** been verified.

Install Azure CLI from Microsoft's documented Linux/Ubuntu method, and install the Azure Node client libraries **outside the project repository**:
```bash
mkdir -p "$HOME/.local/share/campuspool-azure-sdk"
cd "$HOME/.local/share/campuspool-azure-sdk"
npm init -y >/dev/null
npm install --save-exact @azure/storage-blob @azure/identity
export NODE_PATH="$HOME/.local/share/campuspool-azure-sdk/node_modules"
```
Confirm `az --version` and `node -e "require('@azure/storage-blob');require('@azure/identity');console.log('Azure Node SDK OK')"`; omit verbose error outputs that may expose credentials.

**Important on Windows Home + WSL:** Both C: and D: were confirmed unencrypted. Keep Azure CLI authentication token cache in private RAM-backed tmpfs, not in `~/.azure` on D:. In the **same Ubuntu terminal session**:
```bash
export AZURE_CONFIG_DIR="/dev/shm/campuspool-azure-$(id -u)"
mkdir -p "$AZURE_CONFIG_DIR"
chmod 700 "$AZURE_CONFIG_DIR"
# Check mount: /dev/shm should be tmpfs; do not proceed if it is not.
findmnt -T "$AZURE_CONFIG_DIR"
az login --use-device-code
# Verify correct Azure for Students subscription in az account list; do NOT share subscription/tenant IDs.
az account show --query "{name:name,state:state}" --output table
```
The SDK uses **AzureCliCredential**, which invokes `az` using the operator's RAM-backed cache. Azure RBAC role assignments can take several minutes to propagate. Configure roles in Azure portal rather than attempting to bypass permissions with shared account keys.

## Safe local code tests

Use a **separate worktree** from the existing `~/campuspool-staging-recovery` checkout:
```bash
cd ~/mit-adt-campuspool
git fetch origin
git worktree add --detach ~/campuspool-azure-recovery \
  origin/ops/azure-blob-stream-backup-2026-11-04
cd ~/campuspool-azure-recovery
node --test test_azure_blob_backup.js
```
These are synthetic mocked tests with no real source/cloud access.

## Source-only staging configuration

Supply values in the same private Ubuntu terminal (never send them in chat, Git or CI):
```bash
export AZURE_STORAGE_ACCOUNT='011campuspoolbackup'
export AZURE_BACKUP_CONTAINER='campuspool-staging-backups'
# Attest YES only after personally verifying Azure portal container has Private access.
export AZURE_PRIVATE_CONTAINER_CONFIRMED=YES
export PGUSER='postgres.tnitksrlntrdxbvznxzf'
export PGDATABASE='postgres'
export PGPORT=5432
export PGSSLMODE='verify-full'
read -r -p 'Verified Supabase staging session pooler host: ' PGHOST
export PGHOST
read -r -s -p 'Staging PG password: ' PGPASSWORD; echo
export PGPASSWORD
# Only PUBLIC age1... recipient; keep AGE private identity off the unencrypted laptop.
read -r -p 'AGE public recipient: ' AGE_RECIPIENT
export AGE_RECIPIENT

node scripts/azure-blob-backup.js --preflight
```
Preflight verifies **local** tool versions, SDK, and restricted config, without touching Supabase or Azure network. Do not print environment variables or paste credentials into terminals recorded by monitoring.

Only after private-container access is confirmed and a harmless encrypted sample was uploaded/read back through the Azure portal/CLI, the operator may separately authorize a real export:
```bash
export AZURE_EXPORT_APPROVED=YES
node scripts/azure-blob-backup.js --execute
unset AZURE_EXPORT_APPROVED
```

The script calls PostgreSQL 17 `pg_dump --format=custom --schema=public --schema=supabase_migrations` once, preserving a consistent database snapshot; streams binary dump through AGE into a **unique** Azure Blob without storing plaintext files on C:/D:; downloads ciphertext and compares SHA256. Uses `ifNoneMatch:'*'` to refuse blob overwrite; prints only ciphertext object key, ciphertext size and SHA256. If export/upload/readback fails or role permissions are missing, it stops without claiming success.

**Security limits and restore requirements:** This logical archive includes the selected schemas only. It does **not** include global PG roles, full Supabase-managed schemas/auth/storage, customer uploaded files, passwords, extension provisioning, or a separately verified restore. A cold restore still requires an owner-approved **distinct**, empty PostgreSQL 17/PostGIS-compatible target; verified roles/RLS/grants/migration history; independent offsite retrieval and AGE decryption; content equality; and Render rollback proof. No migration 008, Render deployment or production data action until approved gates are satisfied. Malaysia West is outside India; review applicable personal-data transfer obligations before live student records are uploaded.

Do not share SQL, unencrypted dumps, access tokens, keys, passwords, private identity, blob signed URLs or student records. Keep the AGE decryption identity in a separate secure vault, not in Azure storage or local unencrypted D:.

## References

- [Azure Blob Storage client library uploadStream](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload-javascript)
- [Azure Blob Storage and Microsoft Entra identity](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-nodejs)
- [Prevent anonymous blob access](https://learn.microsoft.com/en-us/azure/storage/blobs/anonymous-read-access-prevent)
- [Azure CLI Ubuntu install](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux)
- [Azure for Students](https://azure.microsoft.com/en-us/free/students/)
- [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
