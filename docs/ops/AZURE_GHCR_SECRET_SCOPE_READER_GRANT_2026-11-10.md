# GHCR token single-secret RBAC grant and verification — 10 November 2026

## Live preflight result

Owner ran `python3 scripts/azure-ghcr-secret-scope-rbac-plan.py --plan` in authenticated **Azure for Students** Cloud Shell and supplied:

```text
AZURE_STUDENT_VAULT_RBAC_VERIFIED=YES
GHCR_PULL_TOKEN_ARM_METADATA_PRESENT=YES
GHCR_SECRET_VALUE_NOT_READ_OR_PRINTED=YES
GHCR_MANAGED_IDENTITY_VERIFIED=YES
EXISTING_UAI_SCOPE_ROLE_ASSIGNMENTS_FOUND=0
PROPOSED_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY
PROPOSED_ROLE=KEY_VAULT_SECRETS_USER
ROLE_GUID_MATCHES_MICROSOFT_DOCUMENTATION=YES
GROUP_PIM_DENY_AND_EFFECTIVE_PERMISSIONS_NOT_PROVEN=YES
AZURE_ROLE_GRANTS_OR_SECRET_VALUES_CHANGED=NO
GHCR_SECRET_SCOPE_RBAC_PLAN_COMPLETE=YES
NEXT=OWNER_REVIEW_EXACT_SECRET_SCOPE_BEFORE_ANY_ROLE_GRANT
```

This confirms that `ghcr-pull-token` exists in `campuspool-backup-kv-01`, the user-assigned identity `campuspool-ghcr-vault-reader` exists, and no direct assignments were returned for that UAI in the checked Vault and secret scopes. The one-shot GHCR token import completed previously with temporary **human** Secrets Officer role readback-verified revoked. These are separate subjects.

## Least-privilege security decision

Use one **Key Vault Secrets User** role (immutable Microsoft role GUID `4633458b-17de-408a-b874-0445c86b69e6`) assigned to the **managed identity principal**, with role-assignment scope exactly:

```text
/subscriptions/{subscription}/resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01/secrets/ghcr-pull-token
```

This role grants reading the value and metadata of **that secret**. It does **not** grant rights to other secrets by itself, nor modify secrets or manage Vault permissions. Do **not** assign it at the Vault, RG or subscription scope, and do **not** grant this identity access to `campuspool-staging-pg-password` or other DB secrets. Although Microsoft recommends per-app Vaults and generally Vault-wide roles, individual-secret RBAC is supported as an exception when secrets have different access needs. Longer-term a separate Key Vault for worker credentials can reduce policy complexity.

Azure role scope is intentionally persistent until explicitly removed; it does not have an automatic expiration. GitHub package authentication and use of this UAI from an Azure Container Apps job remain unverified.

## New guarded script

[`scripts/azure-ghcr-secret-scope-rbac-operator.py`](../../scripts/azure-ghcr-secret-scope-rbac-operator.py) uses only Azure ARM **control-plane** GET of `vaults/secrets/ghcr-pull-token` metadata and role assignments. The script refuses responses with any secret `value` field. It verifies Azure for Students subscription, Malaysia West resource group, exact RBAC Vault, principal ID for `campuspool-ghcr-vault-reader`, and no unexpected UAI IAM roles; it never prints Azure IDs or role JSON.

The four explicit modes:

- `--plan` — read-only preview (the owner already ran the separate full plan). Prints `GHCR_SECRET_READER_PLAN_COMPLETE=YES` and `NO_AZURE_CHANGES=YES`.
- `--grant` — only after the operator types **`GRANT_GHCR_TOKEN_SECRET_ONLY_TO_CAMPUSPOOL_UAI`** in interactive Cloud Shell. Uses Azure ARM REST roleAssignments PUT at only this secret resource, with built-in `Key Vault Secrets User`, `principalType=ServicePrincipal`, deterministic idempotent assignment ID, then performs ARM GET inventory readback. Prints `GHCR_SECRET_ONLY_READER_ROLE_GRANTED_AND_READBACK_VERIFIED=YES` only when the expected exact role is seen. Azure authorizes/denies actual role assignments. If the exact managed role is already present, performs no write and reports `GHCR_SECRET_READER_ALREADY_PRESENT_NO_CHANGE=YES`. Unexpected broader roles or identity/scope changes STOP.
- `--verify` — independent **read-only** inventory check: `GHCR_SECRET_ONLY_UAI_ROLE_ASSIGNMENT_VERIFIED=YES` if exact role exists. This is **not proof the managed identity has successfully retrieved the token or can pull private GHCR**.
- `--revoke` — separately typed **`REVOKE_GHCR_TOKEN_SECRET_ONLY_FROM_CAMPUSPOOL_UAI`** removes *only* this helper's deterministic exact assignment and readback verifies absence. Does not delete the GHCR secret value. A change to other unrelated operator/UAI roles causes STOP.

No GitHub token is read or printed; no Key Vault data-plane secrets get/set; no DB, Blob or worker job operations.

**If PUT returns a STOP after it was accepted**, such as `STOP_GRANT_ACCEPTED_BUT_READBACK_NOT_YET_VISIBLE`, do **NOT** blindly repeat the grant. Run `--verify`, then `--plan` and inspect Azure Portal **Access control (IAM)** at this exact GHCR secret privately; do not broaden scope to work around RBAC latency.

## Owner's next Cloud Shell action

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
python3 scripts/azure-ghcr-secret-scope-rbac-operator.py --plan
python3 scripts/azure-ghcr-secret-scope-rbac-operator.py --grant
```

The grant requires the explicit phrase above. No other resource, role or secret is requested. After successful grant, verify independently:

```bash
python3 scripts/azure-ghcr-secret-scope-rbac-operator.py --verify
```

If the owner does not approve permanent managed-identity access to this specific secret, stop after `--plan`.

## Remaining go/no-go gates

1. No evidence yet the imported GitHub classic PAT has only `read:packages` or successfully pulls the exact immutable private GHCR image. Keep security review open.
2. CA `staging-pg-root-ca` still not imported/verified; a separate individual-secret UAI read permission requires its own review. Staging Postgres password will be readable only by a **different, job-specific** identity.
3. Separate minimal Blob container-scoped read/add/write **without delete** role, secret-backed ACA job, signature/provenance/release attestation, no ingress/manual-only job, encrypted AGE staging backup and independent PostgreSQL17/PostGIS cold restore are all still pending.
4. Azure ₹500/month end-to-end cost review was owner deferred, not verified. Do not start production OTP migration or backup job based only on this IAM grant.

**Sources:** [Microsoft Key Vault RBAC guidance](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide), [Microsoft Key Vault Secrets User built-in role](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/security#key-vault-secrets-user), [Azure role-assignment REST create](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-rest), [Azure Authorization role-assignment scope](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments).
