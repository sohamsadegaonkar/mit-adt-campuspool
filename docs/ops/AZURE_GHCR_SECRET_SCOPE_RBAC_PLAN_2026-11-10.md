# GHCR secret-scoped managed identity IAM — read-only preflight (10 Nov 2026)

## Evidence and decision

The owner completed `python3 scripts/azure-vault-ghcr-token-one-shot-import.py --run-once` against the intended `Azure for Students` Vault, with live output:
```text
TEMP_VAULT_WRITER_GRANT_ACCEPTED=YES
VAULT_SECRET_METADATA_READ_AUTHORIZED=YES
GHCR_TOKEN_SECRET_PREEXISTING=NO
GHCR_PULL_TOKEN_IMPORTED_TO_KEY_VAULT=YES
GHCR_TOKEN_SCOPE_NOT_INDEPENDENTLY_VERIFIED=YES
TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES
ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES
NO_DB_CREDENTIAL_CA_JOB_BLOB_OR_ROLE_READER_GRANTS_CHANGED=YES
```

This confirms successful **secret insertion** and **verified immediate removal** of the temporary human `Key Vault Secrets Officer` assignment. It does **not** prove the PAT has the GitHub `read:packages` scope or can actually pull the private OCI image; verify that separately by controlled GHCR auth before any job.

The user-assigned identity `campuspool-ghcr-vault-reader` should read **only** the GHCR pull token and later a separately reviewed CA if needed, **never** the staging database password. Azure supports individual-secret RBAC role assignments while recommending vault-level roles by default; sharing a vault across sensitive application purposes is a narrow exception requiring review. The proposed role is built-in `Key Vault Secrets User` (`4633458b-17de-408a-b874-0445c86b69e6`) at **the GHCR token secret resource scope only**. No Vault-, resource group-, or subscription-wide reader grant.

## Plan-only command

In owner-authenticated Azure Cloud Shell Bash:

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
python3 scripts/azure-ghcr-secret-scope-rbac-plan.py --plan
```

The new script:
- Verifies correct Azure for Students subscription, Malaysia West resource group, Key Vault RBAC and exact UAI principal ID internally; never prints identity or subscription IDs.
- Uses documented **ARM control-plane GET** for `Microsoft.KeyVault/vaults/secrets/ghcr-pull-token@2024-11-01`. Microsoft specifies secret values are **never returned** from ARM control-plane secret operations. The script refuses any unexpected `properties.value` and prints only static status markers. It does not use Key Vault data-plane `secrets/get`.
- Lists ARM role assignments at the **Vault and secret** scope with `$filter=atScope()` to check inherited roles for the matching UAI principal. If any existing assignment is present, stops for private review rather than falsely inferring missing or narrow access. If pagination, 403, missing metadata, malformed scope or unexpected identity, stops safely. This is **not** a complete effective authorization/deny/PIM/Entra group audit.
- Prints `GHCR_SECRET_SCOPE_RBAC_PLAN_COMPLETE=YES` only if the exact proposed secret exists and no direct UAI role assignment was observed. **No role creation or deletion, secret reading, GitHub auth, data export or Azure job deployment**.

Expected sanitized success:
```text
AZURE_STUDENT_VAULT_RBAC_VERIFIED=YES
GHCR_PULL_TOKEN_ARM_METADATA_PRESENT=YES
GHCR_SECRET_VALUE_NOT_READ_OR_PRINTED=YES
GHCR_MANAGED_IDENTITY_VERIFIED=YES
EXISTING_UAI_SCOPE_ROLE_ASSIGNMENTS_FOUND=0
PROPOSED_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY
PROPOSED_ROLE=KEY_VAULT_SECRETS_USER
GROUP_PIM_DENY_AND_EFFECTIVE_PERMISSIONS_NOT_PROVEN=YES
AZURE_ROLE_GRANTS_OR_SECRET_VALUES_CHANGED=NO
GHCR_SECRET_SCOPE_RBAC_PLAN_COMPLETE=YES
```

Only after successful plan evidence and owner review, prepare a **separate** exact secret-scoped guarded ARM assignment with positive consent and readback, never a broadly scoped Key Vault Secrets User. Do not grant the UAI access to staging PostgreSQL password. Remaining security gates: root CA provenance/storage, isolated DB password job identity, container-scoped Blob read/add/write without delete, runtime verification of private GHCR digest and TLS, manual-only job, AGE encrypted offsite backup hash and independent PG17/PostGIS restore, independent release signoff.

## Source provenance update

Previous `zlib-source-provenance` check failed because Alpine `3.23-stable/main/zlib` upgraded from `1.3.2-r1` with a stand-alone patch to `1.4-r0`, removing the old `CVE-2026-85091.patch` file. On 10 Nov 2026, `scripts/verify-alpine-zlib-patch.js` was updated to require *exactly* `1.4-r0`, fixed Alpine source TAR SHA-512 `13f02285da85956ff722d814695b96807aff7a511ebf4b6d98cf708c353920666093cc18b6653cd7992c8e75c103f7b4baf2de3a105c2db9dcd62bab2c940859`, the vendor's existing `CVE-2026-85091` secfix history, and pinned Git blob hashes for upstream zlib v1.4 `ChangeLog` and fixed `gzwrite.c`. The revised GitHub `zlib-source-provenance` check **passed**. This is **source-level evidence only**, not runtime penetration-test proof or automatic deployment security approval. No scanner exceptions/waivers were added.

Sources: [Azure Key Vault RBAC scope guidance](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide), [ARM `Microsoft.KeyVault/vaults/secrets@2024-11-01` value never returned](https://learn.microsoft.com/en-us/azure/templates/microsoft.keyvault/2024-11-01/vaults/secrets), [Alpine 3.23 security release](https://alpinelinux.org/posts/alpine-3.21.9-3.22.7-3.23.7-3.24.3-released/), [zlib v1.4 release notes](https://github.com/madler/zlib/blob/v1.4/ChangeLog).
