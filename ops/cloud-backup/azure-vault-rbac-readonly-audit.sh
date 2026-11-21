#!/usr/bin/env bash
# CampusPool Azure IAM inventory (read-only). Emits sanitized status markers, no IDs.
# Does not request storage keys, Key Vault secret values or any database credentials.
set +x
set -euo pipefail
umask 077

fail() { printf 'STOP_%s\n' "$1" >&2; exit 3; }
[[ $# -eq 0 ]] || { echo "Usage: bash ops/cloud-backup/azure-vault-rbac-readonly-audit.sh" >&2; exit 2; }
command -v az >/dev/null 2>&1 || fail AZ_NOT_AVAILABLE
command -v python3 >/dev/null 2>&1 || fail PYTHON_NOT_AVAILABLE

RG="campuspool-backup-rg"
VAULT="campuspool-backup-kv-01"
IDENTITY="campuspool-ghcr-vault-reader"
ACCOUNT="011campuspoolbackup"
CONTAINER="campuspool-staging-backups"
ENV="campuspool-backup-env"

[[ "$(az account show --query name -o tsv 2>/dev/null)" == "Azure for Students" ]] || fail SUBSCRIPTION_MISMATCH
[[ "$(az group show -n "$RG" --query location -o tsv 2>/dev/null)" == "malaysiawest" ]] || fail REGION_MISMATCH
[[ "$(az containerapp env show -g "$RG" -n "$ENV" --query properties.provisioningState -o tsv 2>/dev/null)" == "Succeeded" ]] || fail ENVIRONMENT_MISSING
[[ "$(az keyvault show -g "$RG" -n "$VAULT" --query properties.enableRbacAuthorization -o tsv 2>/dev/null)" == "true" ]] || fail VAULT_NOT_RBAC
[[ "$(az keyvault show -g "$RG" -n "$VAULT" --query properties.enablePurgeProtection -o tsv 2>/dev/null)" == "true" ]] || fail VAULT_PURGE_PROTECTION_MISSING
[[ "$(az keyvault show -g "$RG" -n "$VAULT" --query location -o tsv 2>/dev/null)" == "malaysiawest" ]] || fail VAULT_REGION
[[ "$(az identity show -g "$RG" -n "$IDENTITY" --query location -o tsv 2>/dev/null)" == "malaysiawest" ]] || fail IDENTITY_REGION
principal_id="$(az identity show -g "$RG" -n "$IDENTITY" --query principalId -o tsv 2>/dev/null)" || fail IDENTITY_PRINCIPAL_UNAVAILABLE
[[ "$principal_id" =~ ^[0-9a-fA-F-]{36}$ ]] || fail IDENTITY_PRINCIPAL_NOT_READY

[[ "$(az storage account show -g "$RG" -n "$ACCOUNT" --query allowBlobPublicAccess -o tsv 2>/dev/null)" == false ]] || fail STORAGE_ALLOWS_ANONYMOUS
[[ "$(az storage container-rm show --storage-account "$ACCOUNT" -g "$RG" -n "$CONTAINER" --query name -o tsv 2>/dev/null)" == "$CONTAINER" ]] || fail BACKUP_CONTAINER_NOT_FOUND

# Reads management-plane RBAC only. The principal GUID is passed privately to az;
# it is never echoed or written to a file.
assignments="$(az role assignment list --assignee-object-id "$principal_id" --all --include-inherited --only-show-errors -o json 2>/dev/null)" ||
  fail IDENTITY_RBAC_AUDIT_UNAVAILABLE
count="$(printf '%s' "$assignments" | python3 -c '
import json, sys
data=json.load(sys.stdin)
if not isinstance(data,list): sys.exit(3)
for item in data:
    if not isinstance(item,dict) or not isinstance(item.get("scope"),str):
        sys.exit(3)
print(len(data))
')" || fail IDENTITY_RBAC_AUDIT_PARSE_FAILED

job_count="$(az containerapp job list -g "$RG" --query 'length(@)' -o tsv 2>/dev/null)" || fail JOB_AUDIT_UNAVAILABLE
[[ "$job_count" =~ ^[0-9]+$ ]] || fail JOB_AUDIT_BAD_RESPONSE

echo "AZURE_FOR_STUDENTS_SUBSCRIPTION_VERIFIED=YES"
echo "MALAYSIA_WEST_RESOURCE_GROUP_VERIFIED=YES"
echo "VAULT_STANDARD_RBAC_PURGE_PROTECTION_VERIFIED=YES"
echo "GHCR_VAULT_READER_IDENTITY_PRESENT=YES"
echo "BLOB_ACCOUNT_ANONYMOUS_ACCESS_DISABLED=YES"
echo "BACKUP_BLOB_CONTAINER_PRESENT=YES"
echo "GHCR_READER_EXISTING_ROLE_ASSIGNMENTS=$count"
echo "AZURE_CONTAINER_APPS_JOB_COUNT=$job_count"
echo "READ_ONLY_IAM_AUDIT_COMPLETE=YES"
echo "NO_SECRETS_ROLE_GRANTS_KEYS_OR_DATABASE_ACCESS=YES"
if [[ "$count" != "0" ]]; then
  echo "STOP_GHCR_READER_ALREADY_HAS_UNREVIEWED_ROLES" >&2
  exit 4
fi
if [[ "$job_count" != "0" ]]; then
  echo "STOP_JOB_INVENTORY_CHANGED_REVIEW_BEFORE_CONTINUING" >&2
  exit 4
fi
echo "READY_FOR_SEPARATE_SECRET_SCOPE_RBAC_DESIGN=YES"
