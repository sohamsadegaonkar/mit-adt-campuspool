#!/usr/bin/env bash
# CampusPool dedicated STAGING backup data identity. No jobs, secrets, or RBAC grants.
# --plan = read-only; --create-once = one owner-confirmed UAI creation.
set -euo pipefail
MODE="$1"
RG="campuspool-backup-rg"
ID_NAME="campuspool-staging-backup-data-id"
VAULT="campuspool-backup-kv-01"
STORAGE="011campuspoolbackup"
EXPECTED_SUBSCRIPTION="Azure for Students"

stop() { printf 'STOP_%s\n' "$1" >&2; exit 2; }
[[ "$MODE" == "--plan" || "$MODE" == "--create-once" ]] || stop "UNKNOWN_MODE"
[[ "$(az account show --query name -o tsv 2>/dev/null)" == "$EXPECTED_SUBSCRIPTION" ]] ||
    stop "UNEXPECTED_SUBSCRIPTION"
[[ "$(az account show --query state -o tsv 2>/dev/null)" == "Enabled" ]] ||
    stop "SUBSCRIPTION_NOT_ENABLED"
[[ "$(az keyvault show -g "$RG" -n "$VAULT" --query properties.enableRbacAuthorization -o tsv 2>/dev/null)" == "True" ]] ||
    stop "EXPECTED_RBAC_VAULT_MISSING"
[[ "$(az storage account show -g "$RG" -n "$STORAGE" --query allowSharedKeyAccess -o tsv 2>/dev/null)" == "False" ]] ||
    stop "EXPECTED_PRIVATE_ACCOUNT_MISSING"

if az identity show -g "$RG" -n "$ID_NAME" --only-show-errors -o none >/dev/null 2>&1; then
    exists="YES"
else
    exists="NO"
fi

echo "BACKUP_DATA_IDENTITY_ALREADY_EXISTS=$exists"
if [[ "$MODE" == "--plan" ]]; then
    echo "NO_CLOUD_WRITES_OR_IAM_CHANGES=YES"
    exit 0
fi

[[ "$exists" == "NO" ]] || stop "IDENTITY_EXISTS_DO_NOT_RECREATE"
[[ -t 0 ]] || stop "TTY_CONFIRMATION_REQUIRED"
read -r -p "Type CREATE_ONLY_STAGING_BACKUP_DATA_IDENTITY: " answer
[[ "$answer" == "CREATE_ONLY_STAGING_BACKUP_DATA_IDENTITY" ]] ||
    stop "EXPLICIT_OWNER_CONFIRMATION_REQUIRED"

# Creates a distinct user-assigned managed identity, *not* an Azure Container Apps job.
az identity create -g "$RG" -n "$ID_NAME" -l malaysiawest \
  --only-show-errors -o none >/dev/null 2>&1 ||
    stop "IDENTITY_CREATE_RESULT_UNKNOWN_DO_NOT_BLINDLY_RETRY"
az identity show -g "$RG" -n "$ID_NAME" --only-show-errors -o none >/dev/null 2>&1 ||
    stop "IDENTITY_CREATED_BUT_NOT_VERIFIED"
echo "STAGING_DATA_IDENTITY_CREATED_AND_EXISTS=YES"
echo "NO_SECRETS_ROLES_BLOBS_DB_OR_JOBS_TOUCHED=YES"
