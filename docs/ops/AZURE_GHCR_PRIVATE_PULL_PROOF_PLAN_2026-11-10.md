# Private GHCR image-pull validation — manual-only ACA job preflight (10 Nov 2026)

## Latest live Azure state

The owner independently executed `python3 scripts/azure-ghcr-secret-scope-rbac-operator.py --verify` in authenticated Azure for Students Cloud Shell and reported:

```text
AZURE_STUDENT_AND_GHCR_SECRET_METADATA_VERIFIED=YES
IDENTITY=campuspool-ghcr-vault-reader
ROLE=KEY_VAULT_SECRETS_USER
ASSIGNMENT_SCOPE=GHCR_PULL_TOKEN_SECRET_ONLY
TARGET_ASSIGNMENT_PRESENT=YES
INHERITED_DIRECT_UAI_ROLES_CHECKED=YES
GROUP_PIM_DENY_CUSTOM_AND_EFFECTIVE_ACCESS_NOT_PROVEN=YES
NO_SECRET_VALUES_OR_DATABASE_CREDENTIALS_READ=YES
GHCR_SECRET_ONLY_UAI_ROLE_ASSIGNMENT_VERIFIED=YES
NO_AZURE_CHANGES=YES
PRIVATE_GHCR_PULL_NOT_TESTED=YES
```

This is **independent Azure ARM verification** of the persistent **single-secret** UAI role assignment. The imported private GHCR PAT value is never read here, and the one-time *human* Secrets Officer role was separately revoked after successful import. The role does not imply successful Key Vault data-plane access or successful private package authentication.

## Safe architecture for the eventual runtime proof

Microsoft Container Apps Jobs API supports **manual trigger**, `configuration.secrets[].keyVaultUrl` with `configuration.secrets[].identity` referencing the UAI resource ID, `configuration.registries[].passwordSecretRef` with private-registry `server` and **GitHub username**, and job `identity.userAssignedIdentities` attachment. This is **not Azure Container Registry's `registries[].identity` ACR-specific authentication**. The GitHub username must own the PAT; do **not** assume the image repository owner and PAT owner are necessarily the same.

Proposed future **separate non-backup smoke job** (not yet created):
- Name `campuspool-ghcr-pull-proof` in existing `campuspool-backup-env` (Malaysia West). No new environment/logging account.
- Immutable image `ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2`. This is the formerly owner-verified signed digest; **do not update digest without new independent signature/provenance check**.
- Key Vault ref **only** `https://campuspool-backup-kv-01.vault.azure.net/secrets/ghcr-pull-token` with UAI identity; registry password comes from `passwordSecretRef`. **No raw PAT values, environment variables, CLI arguments, Git or JSON.**
- TriggerType `Manual`, parallelism 1, replica count 1, replicaRetryLimit 0, replicaTimeout 120 seconds, CPU 0.25 and memory 0.5 GiB; no job schedule or ingress. These limits are design targets, not verified Azure quota/cost values.
- Override the worker image's `ENTRYPOINT ["node","scripts/azure-blob-backup.js"]` with **container `command`** `["node","-e"]` and `args` `["process.stdout.write('GHCR_PRIVATE_IMAGE_PULL_SMOKE_PASS\\n')"]`. This runs harmless Node output instead of the backup entrypoint. Do not pass database host, PG password, Blob permissions, root CA, age recipient or any sensitive worker configuration; never run `scripts/azure-blob-backup.js`.
- **Creating a job and executing a job are distinct operations**. Both remain disabled pending owner review of security, GHCR username, Azure permissions and billing. A job may incur charges during execution; **no ₹500 31-day cost assurance**.
- Validate provisioned job's ARM configuration (no schedule/event, no env secrets except token registry secret ref, no wrong scope) **before** any separate manual start approval. Validate status/logs for image pull without dumping secret metadata, job config or environment variables. Tear down proof job after verification if approved.

## Next read-only owner Cloud Shell command

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
python3 scripts/azure-ghcr-pull-proof-readonly-plan.py --plan
```

The plan inspects the exact current secret-scoped IAM role, existing user-assigned identity, existing Container Apps environment in Malaysia West and zero jobs. It **does not use Key Vault data-plane calls**, print a PAT, or create/update/start any Azure resource.

Expected:

```text
AZURE_STUDENT_GHCR_SECRET_SCOPED_ROLE_VERIFIED=YES
GHCR_READER_IDENTITY_ARM_RESOURCE_VERIFIED=YES
CONTAINER_APPS_ENVIRONMENT_READY=YES
ENVIRONMENT_REGION=MALAYSIA_WEST
EXISTING_CONTAINER_APPS_JOBS=0
PROPOSED_JOB=campuspool-ghcr-pull-proof
PROPOSED_TRIGGER=MANUAL_ONLY
PROPOSED_REGISTRY=GHCR_PRIVATE_IMAGE
PROPOSED_IMAGE_PINNED_BY_SHA256=YES
PROPOSED_IMAGE_COMMAND=NON_DATABASE_NODE_SMOKE_ONLY
PROPOSED_CA_DB_BLOB_PERMISSIONS=NONE
PROPOSED_JOB_SECRETS=KEY_VAULT_GHCR_TOKEN_REFERENCE_ONLY
GHCR_PAT_ACCESS_AND_PACKAGE_PULL_NOT_YET_TESTED=YES
GHCR_PAT_OWNER_USERNAME_STILL_NEEDED_FOR_REGISTRY_AUTH=YES
CONTAINER_APPS_EXECUTION_MAY_INCUR_AZURE_CHARGES=YES
NO_AZURE_WRITE_OR_JOB_START=YES
GHCR_PRIVATE_PULL_JOB_PLAN_COMPLETE=YES
```

If any `STOP_` marker appears, do **not** create a job or broaden IAM; verify the drift privately. Plan success is **not** proof of GHCR pull. Later approved creation and **separate** manual execution are required for end-to-end verification.

**Unchanged recovery gates:** root CA `staging-pg-root-ca` provenance and separate single-secret role, isolated job PostgreSQL password access and least-privilege Blob writer excluding DELETE, manual-only staging encryption to remote Blob with SHA-256 readback, independent PG17/PostGIS restore (schema, data, roles, RLS) and rollback evidence, final human security signoff. OTP production release not authorized.

Sources:
- [Microsoft Container Apps job resource schema, including registries, managed identities and Key Vault secret reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2026-01-01/jobs)
- [Microsoft Container Apps Key Vault secret references](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Microsoft Container Apps manual jobs and execution separation](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [GitHub private GHCR package authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
