#!/usr/bin/env bash
# CampusPool STAGING backup data identity exact-scope RBAC operator.
# --plan = read-only. --grant-once = owner-confirmed, narrowly scoped IAM changes.
# No DB credentials are accessed; no Blob objects or jobs are touched.
set -euo pipefail

MODE="$1"
RG="campuspool-backup-rg"
ID_NAME="campuspool-staging-backup-data-id"
VAULT="campuspool-backup-kv-01"
SECRET="campuspool-staging-pg-password"
STORAGE="011campuspoolbackup"
CONTAINER="campuspool-staging-backups"
ROLE="CampusPool Staging Backup Blob Writer No Delete"

stop(){ printf 'STOP_%s\n' "$1" >&2; exit 2; }
[[ "$MODE" == "--plan" || "$MODE" == "--grant-once" ]] || stop "UNKNOWN_MODE"
[[ "$(az account show --query name -o tsv 2>/dev/null)" == "Azure for Students" ]] ||
    stop "UNEXPECTED_SUBSCRIPTION"
[[ "$(az account show --query state -o tsv 2>/dev/null)" == "Enabled" ]] ||
    stop "SUBSCRIPTION_NOT_ENABLED"

vault_id="$(az keyvault show -g "$RG" -n "$VAULT" --query id -o tsv 2>/dev/null)" ||
    stop "VAULT_MISSING"
storage_id="$(az storage account show -g "$RG" -n "$STORAGE" --query id -o tsv 2>/dev/null)" ||
    stop "STORAGE_ACCOUNT_MISSING"
[[ "$vault_id" == */resourceGroups/"$RG"/providers/Microsoft.KeyVault/vaults/"$VAULT" ]] ||
    stop "VAULT_SCOPE_UNEXPECTED"
[[ "$storage_id" == */resourceGroups/"$RG"/providers/Microsoft.Storage/storageAccounts/"$STORAGE" ]] ||
    stop "STORAGE_SCOPE_UNEXPECTED"
[[ "$(az keyvault show -g "$RG" -n "$VAULT" --query properties.enableRbacAuthorization -o tsv 2>/dev/null)" == "True" ]] ||
    stop "VAULT_RBAC_REQUIRED"
[[ "$(az storage account show -g "$RG" -n "$STORAGE" --query allowSharedKeyAccess -o tsv 2>/dev/null)" == "False" ]] ||
    stop "SHARED_KEY_ACCESS_MUST_BE_DISABLED"
[[ "$(az storage account show -g "$RG" -n "$STORAGE" --query allowBlobPublicAccess -o tsv 2>/dev/null)" == "False" ]] ||
    stop "ANONYMOUS_BLOB_MUST_BE_DISABLED"

secret_scope="$vault_id/secrets/$SECRET"
blob_scope="$storage_id/blobServices/default/containers/$CONTAINER"
if ! az identity show -g "$RG" -n "$ID_NAME" --only-show-errors -o none >/dev/null 2>&1; then
    stop "DEDICATED_DATA_IDENTITY_NOT_FOUND"
fi
principal_id="$(az identity show -g "$RG" -n "$ID_NAME" --query principalId -o tsv 2>/dev/null)" ||
    stop "IDENTITY_PRINCIPAL_UNREADABLE"
[[ "$principal_id" =~ ^[0-9a-fA-F-]{36}$ ]] || stop "IDENTITY_PRINCIPAL_INVALID"

# Verify existing custom role is exactly the three data actions and one metadata-read action.
role_json="$(az role definition list --name "$ROLE" --only-show-errors -o json 2>/dev/null)" ||
    stop "CUSTOM_ROLE_READ_FAILED"
STORAGE_SCOPE="$storage_id" ROLE_NAME="$ROLE" ROLE_DOC="$role_json" python3 - <<'PY' ||
    stop "CUSTOM_ROLE_UNEXPECTED_PERMISSIONS"
import json,os,sys
roles=json.loads(os.environ["ROLE_DOC"])
if not isinstance(roles,list) or len(roles)>1:
    sys.exit(2)
if not roles: sys.exit(0)
x=roles[0]
p=x.get("permissions") or []
wanted={
  "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
  "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write",
  "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action"
}
if (x.get("roleType")!="CustomRole" or
    x.get("roleName")!=os.environ["ROLE_NAME"] or
    set(x.get("assignableScopes",[]))!={os.environ["STORAGE_SCOPE"]} or
    len(p)!=1 or
    set(p[0].get("actions",[]))!={"Microsoft.Storage/storageAccounts/blobServices/containers/read"} or
    set(p[0].get("dataActions",[]))!=wanted or
    p[0].get("notActions") or p[0].get("notDataActions")):
    sys.exit(2)
PY

# Report only safe status categories, not principal IDs, secret versions, or roles at other scopes.
if [[ "$role_json" == "[]" ]]; then role_exists="NO"; else role_exists="YES"; fi
echo "NO_DELETE_CUSTOM_ROLE_EXISTS=$role_exists"

# Secret ARM metadata inspection never retrieves a Key Vault secret VALUE.
secret_enabled="$(az rest --method get \
    --url "https://management.azure.com$secret_scope?api-version=2024-11-01" \
    --query properties.attributes.enabled -o tsv --only-show-errors 2>/dev/null)" ||
      secret_enabled="NOT_FOUND_OR_DENIED"
echo "EXACT_STAGING_SECRET_ENABLED=$secret_enabled"

# Role assignment metadata is scoped to the exact object, never RG-wide.
role_list(){
    az role assignment list --scope "$1" --assignee-object-id "$principal_id" \
      --fill-principal-name false --only-show-errors \
      --query '[].{Role:roleDefinitionName,Scope:scope}' -o json 2>/dev/null
}
secret_grants="$(role_list "$secret_scope")" || stop "SECRET_ROLE_READ_FAILED"
blob_grants="$(role_list "$blob_scope")" || stop "BLOB_ROLE_READ_FAILED"
SECRET_GRANTS="$secret_grants" BLOB_GRANTS="$blob_grants" \
SECRET_SCOPE="$secret_scope" BLOB_SCOPE="$blob_scope" ROLE_NAME="$ROLE" python3 - <<'PY' ||
    stop "UNEXPECTED_OR_TOO_BROAD_EXISTING_SCOPED_GRANT"
import os,json,sys
for key,scope,allowed in [
    ("SECRET_GRANTS",os.environ["SECRET_SCOPE"],"Key Vault Secrets User"),
    ("BLOB_GRANTS",os.environ["BLOB_SCOPE"],os.environ["ROLE_NAME"])]:
    entries=json.loads(os.environ[key])
    if not isinstance(entries,list):sys.exit(2)
    if any(x.get("Scope")!=scope or x.get("Role")!=allowed for x in entries):
        sys.exit(2)
PY

echo "EXACT_SECRET_GRANT_EXISTS=$([[ "$secret_grants" != "[]" ]] && echo YES || echo NO)"
echo "EXACT_BLOB_GRANT_EXISTS=$([[ "$blob_grants" != "[]" ]] && echo YES || echo NO)"
if [[ "$MODE" == "--plan" ]]; then
    echo "NO_AZURE_WRITES=YES"
    exit 0
fi

[[ "$secret_enabled" == "True" ]] || stop "EXACT_STAGING_SECRET_MISSING_OR_NOT_ENABLED"
[[ -t 0 ]] || stop "INTERACTIVE_CONFIRMATION_REQUIRED"
read -r -p "Type GRANT_ONLY_STAGING_SECRET_AND_NO_DELETE_BLOB: " approval
[[ "$approval" == "GRANT_ONLY_STAGING_SECRET_AND_NO_DELETE_BLOB" ]] ||
    stop "EXPLICIT_CONFIRMATION_REQUIRED"

if [[ "$role_exists" == "NO" ]]; then
    # JSON contains ONLY permission names and account resource ID, no passwords.
    role_file="$(mktemp /dev/shm/campuspool-staging-role-XXXXXXXX.json)" ||
        stop "ROLE_TMPFS_UNAVAILABLE"
    trap 'rm -f "$role_file"' EXIT
    STORAGE_SCOPE="$storage_id" ROLE_NAME="$ROLE" python3 - > "$role_file" <<'PY'
import os,json
print(json.dumps({
  "Name":os.environ["ROLE_NAME"],
  "IsCustom":True,
  "Description":"Staging backup encrypted Blob create/read/write without delete, move, keys or container changes",
  "Actions":["Microsoft.Storage/storageAccounts/blobServices/containers/read"],
  "NotActions":[],
  "DataActions":[
    "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
    "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write",
    "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action"
  ],
  "NotDataActions":[],
  "AssignableScopes":[os.environ["STORAGE_SCOPE"]]
}))
PY
    az role definition create --role-definition "$role_file" \
      --only-show-errors -o none >/dev/null 2>&1 ||
        stop "ROLE_CREATE_RESULT_UNCERTAIN_DO_NOT_BLINDLY_RETRY"
    echo "NO_DELETE_ROLE_CREATION_REQUEST_ACCEPTED=YES"
fi

if [[ "$secret_grants" == "[]" ]]; then
    az role assignment create --assignee-object-id "$principal_id" \
      --assignee-principal-type ServicePrincipal \
      --role "Key Vault Secrets User" --scope "$secret_scope" \
      --only-show-errors -o none >/dev/null 2>&1 ||
        stop "SECRET_ROLE_GRANT_RESULT_UNCERTAIN_STOP"
fi
if [[ "$blob_grants" == "[]" ]]; then
    az role assignment create --assignee-object-id "$principal_id" \
      --assignee-principal-type ServicePrincipal \
      --role "$ROLE" --scope "$blob_scope" \
      --only-show-errors -o none >/dev/null 2>&1 ||
        stop "BLOB_ROLE_GRANT_RESULT_UNCERTAIN_STOP"
fi
echo "EXPECTED_SCOPED_ROLE_ASSIGNMENT_REQUESTS_COMPLETED=YES"
echo "VERIFY_GRANT_READBACK_BEFORE_ANY_JOB_START=REQUIRED"
echo "NO_DATABASE_BLOB_OBJECT_OR_JOB_EXECUTION=YES"
