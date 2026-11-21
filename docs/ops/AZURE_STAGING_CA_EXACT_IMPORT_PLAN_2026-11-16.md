# CampusPool — staging root CA exact-name Key Vault import plan (16 Nov 2026)

## Verified owner evidence

The owner downloaded Supabase Root 2021 CA from the staging project's SSL configuration, verified it in WSL, then uploaded only the public certificate to authenticated Azure Cloud Shell at /home/soham/prod-ca-2021.crt.

OpenSSL verification:
- Subject and issuer: Supabase Inc / CN=Supabase Root 2021 CA.
- Valid from 2021-04-28 through 2031-04-26.
- DER certificate SHA-256 fingerprint: 807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA.
- Basic Constraints: critical CA:TRUE; Key Usage: Certificate Sign, CRL Sign; self-verification: OK.
- Cloud Shell readback: CLOUD_SHELL_CA_FINGERPRINT_MATCH=YES, CLOUD_SHELL_CA_CONSTRAINTS_PASS=YES, NO_AZURE_IAM_SECRET_OR_JOB_CHANGES=YES.

The earlier exact staging-pg-root-ca Azure ARM read returned NOT_FOUND. This is not the staging database password secret. A root verifying itself is not a live database TLS hostname/chain check.

## Source-only operator

scripts/azure-staging-ca-operator.py is CA-specific; it never modifies the password-only importer.

- --plan: READ ONLY. Require expected CA fingerprint/PEM/X.509 constraints, correct Azure for Students subscription, exact vault RBAC security, exact role and role-assignment metadata, and exact secret ARM metadata. No secret VALUES retrieved.
- --grant-once: OWNER-GATED Azure IAM write. Creates only custom role CampusPool Temporary Staging CA SetSecret Exact Name with exactly Microsoft.KeyVault/vaults/secrets/setSecret/action DataAction and vault-scoped role assignment to current signed-in human conditioned by ABAC Request secret name equal to staging-pg-root-ca. Prompt: GRANT_TEMP_STAGING_CA_SETSECRET_ONLY.
- --import-once: SEPARATE OWNER-GATED Key Vault write. Refuses any existing or ambiguous CA secret, requires exact reviewed grant and fingerprint, uses az keyvault secret set --file from the public local CA with output suppressed; verifies enabled ARM metadata. Prompt: IMPORT_ONLY_VALIDATED_PUBLIC_STAGING_CA_ONCE.
- --revoke-once: SEPARATE OWNER-GATED IAM cleanup. Removes only the exact helper-owned conditional assignment, verifies absence and does not require CA file to be present. Prompt: REVOKE_TEMP_STAGING_CA_SETSECRET_GRANT.

No raw secret values, Azure error bodies, role IDs, credentials, student rows or passwords are logged. Any unknown Azure write outcome requires read-only --plan investigation; NEVER BLINDLY RETRY. No broad Secrets Officer/Admin fallback if preview ABAC fails. This temporary grant can create additional versions at the exact CA name while active; revoke immediately after import or abandonment.

## Immediate owner Cloud Shell command — OFFLINE TESTS + READ-ONLY PLAN ONLY

Copy the following commands in authenticated Azure Cloud Shell, using the already verified public CA file:

    (
      set -e
      cd "$HOME/campuspool-backup-setup"
      git fetch origin ops/backup-three-gates-evidence-2026-11-06
      git merge --ff-only FETCH_HEAD
      PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_azure_staging_ca_operator.py
      python3 scripts/azure-staging-ca-operator.py --plan
    )

Authoring evidence: 12/12 local mocked safety tests passed and real-OpenSSL synthetic CA validation passed; live owner tests/plan remain pending.

Expected initial categories, assuming no drift:

    CLOUD_SHELL_CA_FINGERPRINT_AND_CONSTRAINTS_VERIFIED=YES
    EXPECTED_VAULT_AND_HUMAN_VERIFIED=YES
    STAGING_CA_ARM_STATUS=NOT_FOUND
    TEMP_CA_SETSECRET_ROLE_EXISTS=NO
    TEMP_CA_EXACT_ABAC_ASSIGNMENT=ABSENT
    NO_AZURE_WRITES_OR_SECRET_VALUE_READ=YES

Any STOP or unexpected role/secret status blocks IAM and import. An existing custom role is acceptable only if its privileges match exactly. The plan grants no Azure permissions and does not import the CA.

## Subsequent separate approvals and release gates

1. Independently authorize the exact CA-only temporary IAM grant, verify readback.
2. Independently authorize one CA import from the already fingerprint-checked public PEM, verify metadata.
3. Revoke the human grant immediately and verify absence. Unused role definition alone does not grant access.
4. Arrange exact CA-secret-only Key Vault Secrets User access for the appropriate runtime data identity, not the GHCR pull identity. Both user-assigned identities must be explicitly attached where needed.
5. Correct the stale review-only Container Apps Job Bicep identity and CA secret reference, validate safe logging/retention and ₹500 per month budget. No production application or scheduler.
6. Independently test the runtime CA mount and staging PG verify-full hostname verification in an approved no-export preflight. Azure Container Apps Jobs have a reported Key Vault reference issue (#1804); do not equate ARM IAM success with runtime secret availability.
7. Only afterward approve a genuine staging AGE encrypted backup and independent PostgreSQL 17/PostGIS cold restore. Render and OTP production remain NO-GO.

No Azure IAM writes, Key Vault writes, Blob uploads, new job creation/start, Supabase access or backups are authorized by this plan.

## Sources

- Microsoft multiline secret from file: https://learn.microsoft.com/en-us/azure/key-vault/secrets/multiline-secrets
- Azure Container Apps secret-volume mounting: https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets
- Microsoft Key Vault RBAC/ABAC: https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide
- Supabase SSL enforcement: https://supabase.com/docs/guides/platform/ssl-enforcement
- ACA Jobs Key Vault issue: https://github.com/microsoft/azure-container-apps/issues/1804
