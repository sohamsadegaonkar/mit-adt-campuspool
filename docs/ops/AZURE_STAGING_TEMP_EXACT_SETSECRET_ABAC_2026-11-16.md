# 2026-11-16 — Temporary exact-secret setSecret ABAC for staging Key Vault

**Scope:** Owner authorized preparing/applying a narrowly scoped, temporary Azure IAM permission **only** to let the current signed-in human account set the exact staging PG secret in `campuspool-backup-kv-01`. The assistant has no direct Azure subscription connector. Owner performs each operation in authenticated Azure Cloud Shell. The user did **not** authorize broader vault access, a retry of a database secret write, backup jobs, worker identity deployment or schedule.

## Verified evidence

- Azure vault `campuspool-backup-kv-01` has RBAC enabled; public network enabled with network default Allow.
- Caller group-inclusive and inherited role check returned **Owner** only; this is Azure **management-plane** authority and does not grant Key Vault `setSecret` data-plane permission.
- The proposed `campuspool-staging-pg-password` was last inspected with ARM status **NOT_FOUND** after a previous one-attempt `az keyvault secret set` returned `STOP_SECRET_SET_RESULT_UNCERTAIN_STOP_NO_RETRY`; the password had passed libpq `PGSSLMODE=verify-full` and read-only `SELECT 1`. Do not retry that CLI command merely because a role is granted.
- Microsoft documentation: [Key Vault RBAC guide](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide), [ABAC Request secret name attribute and custom roles](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-abac), [CLI role assignments with conditions](https://learn.microsoft.com/en-us/azure/key-vault/general/howto-abac-conditions-cli), [custom roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles) and [role assignment CLI](https://learn.microsoft.com/en-us/cli/azure/role/assignment). **ABAC for Key Vault is preview**, so do not assume this Azure subscription supports it. Failure must stop before any unconditioned assignment.

## Exactly authorized grant

The operator `scripts/azure-staging-setsecret-abac-operator.py` has three isolated modes: `--plan` (read-only), `--grant-once` (interactive explicit authorization), `--revoke-once` (interactive cleanup).

- New custom role `CampusPool Staging Temporary SetSecret Exact Name`.
- Role definition **AssignableScopes:** the existing `campuspool-backup-rg` resource group. This makes the custom role *available* to be assigned there, but does **not** grant permissions at resource-group scope.
- **DataActions:** exactly `Microsoft.KeyVault/vaults/secrets/setSecret/action`. `Actions`, `NotActions` and `NotDataActions` empty. No secret value read/list, delete, recover, backup, purge, Azure IAM management or Blob permission.
- **Assignment scope:** exact existing vault ARM ID `.../resourceGroups/campuspool-backup-rg/providers/Microsoft.KeyVault/vaults/campuspool-backup-kv-01`, for the currently signed-in human `User` only.
- **Mandatory role assignment condition (version 2.0):** `((!(ActionMatches{'Microsoft.KeyVault/vaults/secrets/setSecret/action'})) OR (@Request[Microsoft.KeyVault/vaults/secrets:name] StringEquals 'campuspool-staging-pg-password'))`. The exact-name Request attribute works for first-time secret creation; a Resource attribute would not be appropriate for a nonexistent secret. No prefix matching.
- **No grants are performed without exact role validation, empty existing exact assignment, ARM NOT_FOUND secret state, and owner typing `GRANT_EXACT_STAGING_SETSECRET_ONLY_TEMPORARILY`.**
- Readback checks exact user, role GUID, vault scope, condition text, and version from the assignment ARM resource. If Azure rejects the preview condition, the operator STOPS and does not retry or switch to built-in Secrets Officer. In that case, the custom role *definition* may remain inert (not assigned); do not treat role-definition creation as an active grant.
- The role permits creating a new version of the **same exact secret name** while assigned; it cannot guarantee one-time-only authorization. Revoke promptly when the separately approved secret creation succeeds or is abandoned. Azure IAM propagation may take several minutes.

## Owner Cloud Shell execution, in order

```bash
(
  set -e
  cd "$HOME/campuspool-backup-setup"
  git fetch origin ops/backup-three-gates-evidence-2026-11-06
  git merge --ff-only FETCH_HEAD

  echo "=== OFFLINE CODE VALIDATION — NO AZURE WRITES ==="
  PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile scripts/azure-staging-setsecret-abac-operator.py
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v \
    test_azure_staging_setsecret_abac_operator.py

  echo "=== REAL READ-ONLY AZURE PERMISSION PLAN ==="
  python3 scripts/azure-staging-setsecret-abac-operator.py --plan
)
```

Expected offline 10 tests `OK`, real `EXPECTED_VAULT_AND_SIGNED_IN_USER_VERIFIED=YES`, `STAGING_SECRET_ARM_STATUS=NOT_FOUND`, `TEMP_SETSECRET_ONLY_ROLE_EXISTS=NO`, `TEMP_EXACT_ABAC_ASSIGNMENT=ABSENT`, and `NO_AZURE_WRITES_OR_SECRET_VALUE_READ=YES`. Do not proceed if any expected state differs. If Cloud Shell is ephemeral, re-clone into a fresh directory without deleting untracked files and rerun tests, then plan.

**After the above passes, and under the owner's explicit IAM approval**, execute only:

```bash
cd "$HOME/campuspool-backup-setup"
python3 scripts/azure-staging-setsecret-abac-operator.py --grant-once
```

Type `GRANT_EXACT_STAGING_SETSECRET_ONLY_TEMPORARILY` at the interactive prompt. It may create the custom role and then make a single conditional role assignment. Require `EXACT_STAGING_SETSECRET_ABAC_GRANT_VERIFIED=YES`; no secret values are read or written. **Any STOP: do not rerun `--grant-once` blindly**; use `--plan` for read-only readback. If the role definition exists but assignment is absent, no permissions were granted. If assignment exists but is not exactly conditioned, DO NOT use the role to write any secret and investigate safely.

## After grant success — distinct secret action and mandatory revocation

- Do **not** automatically execute `--set-once`. Obtain separate authorization for **one** new staging password secret-write attempt only after read-only ARM `--check` reconfirms NOT_FOUND. A previous write failed, so the attempt is not an automatic retry. Password prompt must be hidden; never put password in chat, argv, environment, debug logs, or repo. Azure data-plane RBAC propagation may require 1–5 minutes.
- After secret creation success/abandonment, revoke only this precise assignment:

```bash
cd "$HOME/campuspool-backup-setup"
python3 scripts/azure-staging-setsecret-abac-operator.py --revoke-once
python3 scripts/azure-staging-setsecret-abac-operator.py --plan
```

Type `REVOKE_EXACT_STAGING_SETSECRET_TEMP_GRANT`. Require `EXACT_TEMP_STAGING_SETSECRET_GRANT_REVOKED=YES` or `NO_ACTIVE_TEMP_STAGING_SETSECRET_GRANT=YES` from read-only plan. Revocation deliberately leaves an **unused custom role definition** for later safe role-definition cleanup review; a role definition without an active assignment grants no permissions. Do not delete broader roles or change key vault RBAC mode.

## Fail-closed constraints

No broad Secrets Officer or Administrator role, no subscription/resource-group-level assignment, no access to production credentials, no source password retrieval, no worker data identity or private Blob grant yet. Do not create backup jobs or schedule. Future encrypted backup, independent PG17/PostGIS restore and OTP production remain separately gated. CampusPool Azure project total internal budget remains ₹500/month.

**Prepared/committed only:** GitHub files are source preparation. Neither ABAC grant nor secret set has yet been executed from the assistant session. Owner Cloud Shell output is required to verify actual Azure result.
