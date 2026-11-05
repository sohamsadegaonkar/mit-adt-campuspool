#!/usr/bin/env bash
# CampusPool Azure worker provisioning preflight.
# Read-only: no secrets, no RBAC updates, no Azure resource creations.
set -euo pipefail

SUBSCRIPTION_EXPECTED="Azure for Students"
RG="campuspool-backup-rg"
REGION="malaysiawest"
ENVIRONMENT="campuspool-backup-env"
STORAGE="011campuspoolbackup"

echo "=== CAMPUSPOOL AZURE READ-ONLY PREFLIGHT ==="
SUBSCRIPTION="$(az account show --query name -o tsv)"
if [[ "$SUBSCRIPTION" != "$SUBSCRIPTION_EXPECTED" ]]; then
  echo "STOP: unexpected selected Azure subscription" >&2
  exit 2
fi
echo "SUBSCRIPTION_MATCH=YES"
az group show --name "$RG" \
  --query '{Name:name,Location:location}' -o table
az containerapp env show -g "$RG" -n "$ENVIRONMENT" \
  --query '{Name:name,Region:location,Provisioning:properties.provisioningState,Logs:properties.appLogsConfiguration.destination,Profiles:properties.workloadProfiles[].name}' \
  -o json
az storage account show -g "$RG" -n "$STORAGE" \
  --query '{Name:name,Location:location,PublicNetwork:publicNetworkAccess,AllowBlobPublicAccess:allowBlobPublicAccess}' \
  -o json
for provider in Microsoft.App Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.ManagedIdentity; do
  state="$(az provider show --namespace "$provider" --query registrationState -o tsv)"
  printf 'PROVIDER_%s=%s\n' "$provider" "$state"
done
echo "=== RESOURCE INVENTORY (NO MUTATIONS) ==="
az acr list -g "$RG" --query '[].{Name:name,Sku:sku.name,Admin:adminUserEnabled}' -o table
az keyvault list -g "$RG" --query '[].{Name:name,Location:location,Rbac:properties.enableRbacAuthorization}' -o table
az identity list -g "$RG" --query '[].{Name:name,Region:location}' -o table
az containerapp job list -g "$RG" --query '[].{Name:name,Trigger:properties.configuration.triggerType}' -o table
echo "PREFLIGHT_READ_ONLY_COMPLETE"
echo "NO_AZURE_WRITE_OR_DATABASE_CONNECTION_ATTEMPTED"
