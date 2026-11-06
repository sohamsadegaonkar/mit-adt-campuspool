#!/usr/bin/env bash
# CampusPool: operator's Azure RBAC capability inventory, no mutations/data reads.
# Names, emails, tokens, principal IDs, role IDs and secret metadata are not printed.
set +x
set -euo pipefail
umask 077
fail(){ echo "STOP_$1" >&2; exit 3; }
[[ $# -eq 0 ]] || { echo "Usage: bash ops/cloud-backup/azure-vault-operator-role-readonly.sh" >&2; exit 2; }
command -v az >/dev/null || fail AZ_CLI_MISSING
command -v python3 >/dev/null || fail PYTHON_MISSING
[[ "$(az account show --query name -o tsv 2>/dev/null)" == "Azure for Students" ]] || fail WRONG_SUBSCRIPTION
[[ "$(az account show --query user.type -o tsv 2>/dev/null)" == "user" ]] || fail NOT_INTERACTIVE_USER
[[ "$(az group show -n campuspool-backup-rg --query location -o tsv 2>/dev/null)" == malaysiawest ]] || fail WRONG_RESOURCE_GROUP
vaultid="$(az keyvault show -g campuspool-backup-rg -n campuspool-backup-kv-01 --query id -o tsv 2>/dev/null)" || fail VAULT_NOT_FOUND
[[ "$vaultid" == /subscriptions/*/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01 ]] || fail VAULT_SCOPE_INVALID
[[ "$(az keyvault show -g campuspool-backup-rg -n campuspool-backup-kv-01 --query properties.enableRbacAuthorization -o tsv 2>/dev/null)" == true ]] || fail VAULT_RBAC_NOT_ENABLED

# Azure Entra Graph lookup. If blocked, fail closed; don't claim operator access.
operator_object_id="$(az ad signed-in-user show --query id -o tsv 2>/dev/null)" || fail SIGNED_IN_USER_LOOKUP_DENIED
[[ "$operator_object_id" =~ ^[a-fA-F0-9-]{36}$ ]] || fail SIGNED_IN_USER_OBJECT_INVALID
roles_json="$(az role assignment list --assignee-object-id "$operator_object_id" --scope "$vaultid" --all --include-inherited --include-groups --only-show-errors -o json 2>/dev/null)" || fail OPERATOR_ROLE_ENUMERATION_DENIED
printf '%s' "$roles_json" | python3 -c '
import json, sys
try:
    roles=json.load(sys.stdin)
    if not isinstance(roles,list): raise ValueError("not array")
    names=[]
    for r in roles:
        if not isinstance(r,dict) or not isinstance(r.get("scope"),str) or not isinstance(r.get("roleDefinitionName"),str):
            raise ValueError("invalid role")
        names.append(r["roleDefinitionName"].strip().casefold())
    # These only signal POTENTIAL eligibility; conditions, deny assignments, PIM
    # eligibility and custom roles may change actual permissions.
    admin={"owner","user access administrator","role based access control administrator","key vault data access administrator"}
    writer={"key vault secrets officer","key vault administrator"}
    print("AZURE_OPERATOR_RELATED_ROLE_ASSIGNMENTS="+str(len(names)))
    print("ROLE_ASSIGNMENT_ADMIN_CANDIDATE="+("YES" if any(n in admin for n in names) else "NO_OR_CUSTOM_ROLE"))
    print("SECRET_WRITE_ROLE_CANDIDATE="+("YES" if any(n in writer for n in names) else "NO_OR_CUSTOM_ROLE"))
except (ValueError,TypeError,KeyError):
    sys.exit(3)
' || fail OPERATOR_ROLE_RESPONSE_INVALID

echo "AZURE_VAULT_OPERATOR_ROLE_AUDIT_COMPLETE=YES"
echo "ROLE_CANDIDATES_ARE_NOT_EFFECTIVE_PERMISSION_PROOF=YES"
echo "NO_ROLE_ASSIGNMENTS_SECRET_VALUES_OR_DATABASE_ACTIONS_PERFORMED=YES"
echo "NEXT=REVIEW_EPHEMERAL_SECRET_WRITER_AND_SECRET_SCOPED_UAI_READ_PERMISSIONS"
