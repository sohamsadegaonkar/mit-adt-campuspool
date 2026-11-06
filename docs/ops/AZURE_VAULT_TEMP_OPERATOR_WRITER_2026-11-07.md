# Vault operator temporary secret-import role — reviewed owner procedure (2026-11-07)

## Latest owner evidence (real Azure)

The owner ran the new read-only Azure ARM REST operator access audit from `~/campuspool-vault-setup`, after earlier faulty `az role assignment list --assignee-object-id` usage was removed. **Result:**

```text
AZURE_OPERATOR_ROLE_ARM_REST_AUDIT=PASS
DIRECT_OPERATOR_ROLE_ASSIGNMENTS=1
DIRECT_ROLE_ASSIGNMENT_ADMIN_CANDIDATE=YES
DIRECT_SECRET_WRITER_CANDIDATE=NO_OR_UNKNOWN
CONDITIONAL_ASSIGNMENT_REVIEW_NEEDED=NO
GROUP_TRANSITIVE_PIM_DENY_AND_CUSTOM_PERMISSIONS_NOT_VERIFIED=YES
CANDIDATES_NOT_EFFECTIVE_PERMISSION_PROOF=YES
NO_AZURE_WRITES_SECRETS_OR_DATABASE_ACCESS=YES
NEXT=REVIEW_OPERATOR_VAULT_ACCESS_BEFORE_SECRET_GRANTS
```

**Interpretation:** one direct ARM role assignment matches a potential access administrator. No direct built-in Vault secret writer was observed. This is **not** proof of effective grant rights or absence of group/PIM/deny/custom permissions. Azure RBAC and actual create API still enforce authorization.

## Permission decision and boundaries

A one-time human operator may need **Key Vault Secrets Officer** `b86a8fe4-44ce-4948-aee5-eccb2c155cd7` on exactly Vault `campuspool-backup-kv-01` to seed the GHCR read-only pull token, trusted staging CA and, in a distinct approved step, staging-only PG secret. The Vault was deliberately created with `--no-self-perms`. The Secrets Officer role enables **all secret operations** in that Vault including read/update/delete, not only creation; it **does not assign roles**. Only request this temporary wider secret permission after explicitly accepting the risk, and **revoke it promptly when secure seeding is complete**. It has **no automatic expiry**; Azure for Students/this job does not have a verified PIM expiry mechanism.

The [exact-scope grant/revoke helper](../../scripts/azure-vault-temporary-operator-secrets-officer.py) has three modes:

- `--plan`: Azure student subscription, Malaysia West RG, intended RBAC/purge-protected Vault and current signed-in human all verified; uses documented ARM REST GET for scope role assignments; prints no identities or secret values and makes no writes; also refuses to manage a preexisting Secrets Officer role not owned by this helper.
- `--grant`: only with typed `GRANT_CAMPUSPOOL_TEMP_SECRET_WRITER`, makes a **single deterministic PUT** of `Key Vault Secrets Officer` for the current operator at **that Vault scope only**; never RG/subscription scope. Returns no raw Azure metadata; explicitly indicates that RBAC propagation/effective access remain unverified. Re-running is idempotent for the helper-owned assignment. This **does not seed secrets** or authorize creation of another resource.
- `--revoke`: only with typed `REVOKE_CAMPUSPOOL_TEMP_SECRET_WRITER`, deletes **only the deterministic helper-owned assignment**, then verifies its absence through ARM GET. Never remove another operator's different role. If ARM is eventually consistent or delete fails, STOP, inspect privately, and retry read-only `--plan` before proceeding.

The dedicated GHCR reader identity `campuspool-ghcr-vault-reader` remains **without role grants** until two individual secrets exist and independent per-secret read-only assignments are reviewed. Never give it Vault-wide Secrets User or DB password. A separate future manual job system identity may read only the `campuspool-staging-pg-password` secret. The Blob backup data identity should receive a container-only no-delete read/add/write custom role. The Vault endpoint is public-network reachable under RBAC/TLS, not a private endpoint.

## Next owner action — plan only, no changes

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
python3 scripts/azure-vault-temporary-operator-secrets-officer.py --plan
```

If safe, its sanitized output contains:

```text
AZURE_STUDENT_VAULT_SCOPE_VERIFIED=YES
TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=NO
ROLE_TO_MANAGE=KEY_VAULT_SECRETS_OFFICER_VAULT_SCOPE_ONLY
ROLE_CAPABILITIES=ALL_VAULT_SECRET_OPERATIONS_UNTIL_REVOKED
ASSIGNMENT_AUTOMATIC_EXPIRY=NO
OWNER_ACTION=PLAN_ONLY_NO_AZURE_WRITES
ROLE_PLAN_COMPLETE=YES
```

**STOP** on any `STOP_...`; do not apply any broad role manually to make the plan pass. Do not generate or paste a GHCR PAT until operator role grant **and safe vault ingestion flow** are approved. Avoid a situation where a PAT is held in persistent Cloud Shell/Windows shell history. The helper intentionally has **no** token ingestion feature: that requires separate reviewed procedure.

**Review gate after plan:** Confirm the owner's intention to temporarily obtain Vault Secrets Officer at Vault scope with manual, audited revocation; then perform the guarded `--grant`. After secure secret creation, `--revoke` and readback verify. Do not schedule unattended cleanup as a substitute for explicit revocation. If the user does not accept the temporary broad secret operations, investigate custom/ABAC-limited creation rights under an independent reviewer instead.

Sources: [Key Vault built-in data-plane roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/security), [Azure Key Vault RBAC permission patterns](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide), [Azure CLI role assignment create parameters](https://learn.microsoft.com/en-us/cli/azure/role/assignment), [Azure ARM Role Assignment Create/Update](https://learn.microsoft.com/en-us/rest/api/authorization/role-assignments/create?view=rest-authorization-2022-04-01).

**Current non-goals:** No Azure role created during code publication, no Vault secret value imported, no GHCR token generated, no Container Apps Job, no first AGE encrypted staging backup or independent PG17/PostGIS cold restore; ₹500 aggregate Azure cost still unverified/deferred. The signed private GHCR digest remains `sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2`.
