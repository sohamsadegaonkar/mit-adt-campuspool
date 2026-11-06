#!/usr/bin/env bash
# Owner Azure Cloud Shell ONLY; one-time minimal staging identity foundation.
# --plan is READ-ONLY; --apply creates ONLY the Standard Vault and one user-assigned identity.
# No secrets, registry tokens, role grants, Container Apps Jobs, schedules, or database access.
set +x
set -euo pipefail
umask 077

RG="campuspool-backup-rg"
REGION="malaysiawest"
EXPECTED_SUBSCRIPTION="Azure for Students"
APP_ENV="campuspool-backup-env"
BLOB_ACCOUNT="011campuspoolbackup"
VAULT="campuspool-backup-kv-01"
READER="campuspool-ghcr-vault-reader"
CONFIRM="CREATE_CAMPUSPOOL_VAULT_AND_READER"

fail(){ printf 'STOP_%s\n' "$1" >&2; exit 3; }
[[ $# -eq 1 && ("$1" == "--plan" || "$1" == "--apply") ]] || {
  echo "Usage: bash ops/cloud-backup/azure-vault-identity-foundation.sh --plan|--apply" >&2
  exit 2
}
MODE="$1"
command -v az >/dev/null 2>&1 || fail AZ_CLI_UNAVAILABLE
[[ "$(az account show --query name -o tsv 2>/dev/null)" == "$EXPECTED_SUBSCRIPTION" ]] || fail WRONG_SUBSCRIPTION
[[ "$(az group show -n "$RG" --query location -o tsv 2>/dev/null)" == "$REGION" ]] || fail WRONG_RESOURCE_GROUP
[[ "$(az containerapp env show -g "$RG" -n "$APP_ENV" --query properties.provisioningState -o tsv 2>/dev/null)" == "Succeeded" ]] || fail BACKUP_ENV_NOT_READY
[[ "$(az storage account show -g "$RG" -n "$BLOB_ACCOUNT" --query allowBlobPublicAccess -o tsv 2>/dev/null)" == "false" ]] || fail STORAGE_ANONYMOUS_ACCESS_NOT_DISABLED
for provider in Microsoft.KeyVault Microsoft.ManagedIdentity; do
  [[ "$(az provider show -n "$provider" --query registrationState -o tsv 2>/dev/null)" == "Registered" ]] || fail REQUIRED_PROVIDER_NOT_REGISTERED
done
# Reject unexpected resources: the plan intentionally controls exactly one Vault and one UAI.
list_vaults="$(az keyvault list -g "$RG" --query '[].name' -o tsv 2>/dev/null)" || fail VAULT_INVENTORY_DENIED
list_identities="$(az identity list -g "$RG" --query '[].name' -o tsv 2>/dev/null)" || fail IDENTITY_INVENTORY_DENIED

vault_present=NO
identity_present=NO
if grep -Fxq "$VAULT" <<<"$list_vaults"; then vault_present=YES; fi
if grep -Fxq "$READER" <<<"$list_identities"; then identity_present=YES; fi

check_vault(){
  # Existing resources MUST conform; never silently update a pre-existing vault.
  local rb subscription_location sku purge retention public_access network_rule
  rb="$(az keyvault show -g "$RG" -n "$VAULT" --query properties.enableRbacAuthorization -o tsv 2>/dev/null)" || fail VAULT_DETAILS_UNAVAILABLE
  subscription_location="$(az keyvault show -g "$RG" -n "$VAULT" --query location -o tsv 2>/dev/null)" || fail VAULT_DETAILS_UNAVAILABLE
  sku="$(az keyvault show -g "$RG" -n "$VAULT" --query properties.sku.name -o tsv 2>/dev/null)" || fail VAULT_DETAILS_UNAVAILABLE
  purge="$(az keyvault show -g "$RG" -n "$VAULT" --query properties.enablePurgeProtection -o tsv 2>/dev/null)" || fail VAULT_DETAILS_UNAVAILABLE
  retention="$(az keyvault show -g "$RG" -n "$VAULT" --query properties.softDeleteRetentionInDays -o tsv 2>/dev/null)" || fail VAULT_DETAILS_UNAVAILABLE
  public_access="$(az keyvault show -g "$RG" -n "$VAULT" --query properties.publicNetworkAccess -o tsv 2>/dev/null)" || fail VAULT_DETAILS_UNAVAILABLE
  network_rule="$(az keyvault show -g "$RG" -n "$VAULT" --query properties.networkAcls.defaultAction -o tsv 2>/dev/null)" || fail VAULT_DETAILS_UNAVAILABLE
  [[ "$rb" == true && "$subscription_location" == "$REGION" && "$sku" == standard &&
     "$purge" == true && "$retention" == 90 && "$public_access" == Enabled && "$network_rule" == Allow ]] ||
     fail VAULT_SECURITY_SETTINGS_MISMATCH
}
check_reader(){
  [[ "$(az identity show -g "$RG" -n "$READER" --query location -o tsv 2>/dev/null)" == "$REGION" ]] ||
    fail READER_IDENTITY_WRONG_REGION
}

if [[ "$vault_present" == YES ]]; then
  check_vault
elif [[ "$(az keyvault check-name --name "$VAULT" --query nameAvailable -o tsv 2>/dev/null)" != true ]]; then
  fail GLOBAL_VAULT_NAME_UNAVAILABLE
fi
if [[ "$identity_present" == YES ]]; then
  check_reader
fi

echo "AZURE_SUBSCRIPTION=AZURE_FOR_STUDENTS_CONFIRMED"
echo "RESOURCE_GROUP=$RG"
echo "REGION=MALAYSIA_WEST"
echo "PRIVATE_IMAGE_REGISTRY=GHCR_NOT_ACR"
echo "KEY_VAULT=$VAULT"
echo "KEY_VAULT_EXISTS=$vault_present"
echo "USER_ASSIGNED_VAULT_READER=$READER"
echo "READER_IDENTITY_EXISTS=$identity_present"
echo "VAULT_SETTINGS=STANDARD_RBAC_PURGE_PROTECTION_90_DAY_RETENTION"
echo "NETWORK_POSTURE=PUBLIC_ENDPOINT_ENABLED_RBAC_REQUIRED"
echo "NO_SECRETS_ROLE_ASSIGNMENTS_IMAGE_CHANGES_JOBS_OR_DATABASE_WRITES"

if [[ "$MODE" == "--plan" ]]; then
  echo "PLAN_VALIDATED=YES"
  echo "PLAN_MODE_NO_AZURE_WRITES=YES"
  exit 0
fi

# Warning: Key Vault purge protection is irreversible for this vault; soft-deleted
# names may be unavailable for up to 90 days. Standard secrets operations are metered.
echo "You are authorizing creation of up to TWO Azure resources, not a backup job."
echo "WARNING: 90-day Key Vault purge protection is IRREVERSIBLE and may delay deletion."
echo "WARNING: Key Vault secret operations are metered; actual INR cost is unverified."
echo "WARNING: The Vault data endpoint remains public-network reachable with RBAC security."
IFS= read -r -p "Type $CONFIRM to create only these resources: " confirmation
[[ "$confirmation" == "$CONFIRM" ]] || fail OPERATOR_NOT_CONFIRMED
unset confirmation

if [[ "$vault_present" == NO ]]; then
  if ! az keyvault create \
    --name "$VAULT" --resource-group "$RG" --location "$REGION" \
    --sku standard --enable-rbac-authorization true \
    --enable-purge-protection true --retention-days 90 \
    --public-network-access Enabled --default-action Allow --bypass None \
    --tags project=campuspool stage=staging purpose=manual-encrypted-backup \
    --only-show-errors --output none 2>/dev/null; then
    fail VAULT_CREATE_FAILED_INSPECT_AZURE_PORTAL_PRIVATELY
  fi
fi
check_vault
echo "KEY_VAULT_CONFIG_VERIFIED=YES"

if [[ "$identity_present" == NO ]]; then
  if ! az identity create -n "$READER" -g "$RG" -l "$REGION" \
    --tags project=campuspool stage=staging purpose=private-ghcr-ca-vault-reader \
    --only-show-errors --output none 2>/dev/null; then
    fail MANAGED_IDENTITY_CREATE_FAILED_INSPECT_AZURE_PORTAL_PRIVATELY
  fi
fi
check_reader
echo "VAULT_READER_IDENTITY_VERIFIED=YES"
echo "FOUNDATION_CREATION_PASS=YES"
echo "NO_SECRETS_OR_AZURE_RBAC_GRANTS_CREATED=YES"
echo "NO_JOB_CREATED_OR_STARTED=YES"
echo "NO_DATABASE_CONNECTED_OR_EXPORTED=YES"
echo "NEXT=REVIEW_VAULT_SECRET_SCOPE_AND_OPERATOR_PERMISSIONS_BEFORE_IMPORTING_CREDENTIALS"
