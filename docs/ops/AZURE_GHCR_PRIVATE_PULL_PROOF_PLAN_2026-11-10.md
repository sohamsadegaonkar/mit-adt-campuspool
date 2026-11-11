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


## 10 November 2026: owner preflight PASS, create-only operator prepared

**Owner-provided real Azure Cloud Shell result for the existing read-only `scripts/azure-ghcr-pull-proof-readonly-plan.py --plan`:**

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
NEXT=REVIEW_COST_AND_MANUAL_ONLY_JOB_MANIFEST_BEFORE_CREATE_OR_START
```

The user provided **no GitHub PAT owner login**; do NOT assume the repository namespace is the token owner. The operator will prompt interactively for the **username that created the PAT**. This is normal non-secret account metadata. Do not retrieve the token itself.

### Ready for exact owner-controlled job creation (no start)

Added [`scripts/azure-ghcr-pull-proof-job-operator.py`](../../scripts/azure-ghcr-pull-proof-job-operator.py) and [mock security tests](../../test_azure_ghcr_pull_proof_job_operator.py) to [draft PR #44](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/44).

The script modes:
- `--plan` invokes only the existing **read-only** prerequisite check: confirms correct student subscription/region, active UAI single-secret role, ready environment and no jobs.
- `--create` repeats the identity/environment checks and confirms **zero jobs**, prompts for PAT **GitHub username, NOT PAT**, builds fixed ARM `Microsoft.App/jobs@2026-01-01` manifest, displays strong security/billing warnings, and requires exact phrase `CREATE_MANUAL_GHCR_PULL_PROOF_JOB_NO_START` before writing. It performs **one control-plane role-authenticated PUT** for **only** `campuspool-ghcr-pull-proof`. It does **not** call `az containerapp job start`, does **not** create a schedule/event trigger, and cannot access the staging database or Blob via this manifest. If the Azure PUT response is uncertain, **do not repeat `--create` blindly; run `--verify`**.
- `--verify` uses only ARM job GET and Azure job execution inventory, checks exact identity, secret-only Key Vault reference, `ghcr.io` registry username and passwordSecretRef, immutable image digest, safe Node override, manual trigger, 120 second max, zero retries, 1 replica, 0.25 vCPU/0.5 GiB; rejects extra secrets, env vars, containers, init containers, volumes and any existing executions. It prints `GHCR_PULL_PROOF_READY_FOR_SEPARATE_MANUAL_START_REVIEW=YES` on verified success. It **does not start any job**.
- `--delete` verifies the exact same target job and no **active or unknown-status** execution, requires exact phrase `DELETE_ONLY_CAMPUSPOOL_GHCR_PULL_PROOF_JOB`, deletes **only** this proof job, and reads job inventory to confirm deletion. It allows cleanup after verified *completed* (`Succeeded`/`Failed`/`Stopped`) runs. Does **not** delete the GHCR token or UAI role.

**Security warning:** Azure docs state anyone with `Microsoft.App/jobs/start/action` can override a job's execution template to reference its secrets and managed identity. This means **even a manual-only proof job is a sensitive resource** while it exists; audit start permissions and promptly remove the proof job after the eventual controlled execution. Do not give broad Container Apps Jobs Operator rights to untrusted identities. No database, storage or Key Vault other-secret grants are made by this script. The job's only secret comes from a **Key Vault reference**, never embedded plain text in ARM, CLI args, files, git or console.

**Cost review:** The verified environment has a **Consumption** workload profile. Microsoft states Container Apps **jobs are billed only during executions for resource consumption** (plus potential other resource/network/logging costs). The proposed 120-sec limit at 0.25 vCPU/0.5 GiB corresponds to at most **30 vCPU-seconds and 60 GiB-seconds** of requested resources for a single full-duration replica. Azure's monthly consumption free grants are 180,000 vCPU-seconds and 360,000 GiB-seconds per subscription, **if available**. These facts do NOT prove any exact INR bill, do not prove the remaining monthly credits, and do not eliminate network, registry, logging or other Azure resource costs. The ₹500/month live cost cap remains **unverified and user-deferred**. Creation is separate from execution; **no job start is authorized merely by approval to create**.

Before any real Azure write, the owner should review the [exact source](../../scripts/azure-ghcr-pull-proof-job-operator.py), [mock CI status](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/44/checks), and the sensitive job-start rights. Once approved:

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
python3 scripts/azure-ghcr-pull-proof-job-operator.py --plan
python3 scripts/azure-ghcr-pull-proof-job-operator.py --create
```

The `--create` mode prompts: `GitHub username that owns the already imported GHCR PAT:` (type **only the username**), then type `CREATE_MANUAL_GHCR_PULL_PROOF_JOB_NO_START`. A successful ARM response reports `GHCR_PROOF_JOB_CREATE_REQUEST_ACCEPTED=YES`; it does **not** mean that the job ran or pulled an image. Confirm independently:

```bash
python3 scripts/azure-ghcr-pull-proof-job-operator.py --verify
```

Expected: `GHCR_PROOF_JOB_EXACT_MANUAL_CONFIG_VERIFIED=YES`, `GHCR_PROOF_JOB_EXECUTIONS=0`, `NO_GHCR_SECRET_VALUES_QUERIED=YES`, `NO_AZURE_CHANGES_OR_JOB_START=YES`, `GHCR_PULL_PROOF_READY_FOR_SEPARATE_MANUAL_START_REVIEW=YES`.

**Do NOT start it yet.** A start will need another explicit owner permission and a reviewed script that checks the exact proof configuration and avoids overriding the template with malicious environment/command changes. After any later successful or failed controlled execution, use separate explicit `--delete` to remove the proof job. **Do not merge PR into main, run staging backup, or enable OTP production just because creation succeeded.**

Sources: [Azure Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing), [Container Apps job start permission warning](https://learn.microsoft.com/en-us/azure/container-apps/jobs#permissions), [Jobs API schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2026-01-01/jobs).


## November 11, 2026 — first live create returned unknown; do not retry

Owner executed `python3 scripts/azure-ghcr-pull-proof-job-operator.py --create` in **real Azure for Students Cloud Shell** after successful plan and explicit typed consent `CREATE_MANUAL_GHCR_PULL_PROOF_JOB_NO_START`; owner correctly entered GitHub PAT owner **username `sohamsadegaonkar`** (not token). The helper confirmed `GHCR_SECRET_ONLY_UAI_ROLE_VERIFIED=YES`, `PROOF_JOB_NAME=campuspool-ghcr-pull-proof`, `PROOF_JOB_REGISTRY_SECRET=KEY_VAULT_REFERENCE_NO_RAW_PAT`, `PROOF_JOB_NO_DB_OR_BLOB_ACCESS_CONFIGURED=YES`, then printed:

```text
STOP_JOB_CREATE_OUTCOME_UNKNOWN_REVIEW_WITH_VERIFY_BEFORE_RETRY
```

**Important**: The script catches any `Stop` from the ARM `PUT`, including Azure reject/permission failure, timeout, invalid manifest or normalized parse failure, and deliberately suppresses raw Azure error details because they might include confidential resource metadata. This **does not show** if the job was created. It did **not call job start**, but no release readiness or private GHCR image pull has been proven. **Never blindly repeat `--create`.**

**Next existing read-only commands on owner's Cloud Shell:**

```bash
python3 scripts/azure-ghcr-pull-proof-job-operator.py --verify
az containerapp job list -g campuspool-backup-rg \
  --query "[].{Name:name,State:properties.provisioningState}" -o table
```

`--verify` may STOP if absent, still provisioning, or Azure reformats the job manifest; the inventory distinguishes the first question (**exists vs absent**) regardless. Do **not** print the full job document, raw activity logs, `--debug`, secret values, or tokens.

**Additional tested read-only diagnostic**, added after the incident:

```bash
cd ~/campuspool-vault-setup
git pull --ff-only
python3 scripts/azure-ghcr-pull-proof-create-failure-diagnostic.py --inspect
```

This only verifies the existing exact one-secret IAM role, reads job inventory, selected nonsecret job provisioning state/trigger if present, and calls the Azure Monitor **Activity Log** for job `Microsoft.App/jobs/write` events for the last 24 hours. It outputs fixed markers of success/failure statuses and **sanitized, whitelisted error classifications**, with no raw status messages/paths/identifiers/correlation IDs/secret values. No PUT, job start, token read, network database or Blob access. It can distinguish possible `AZURE_JOB_KEY_VAULT_REFERENCE_FETCH` / `AZURE_JOB_INVALID_CONTAINER_TEMPLATE` / authorization/quota categories only if the matching event contains corresponding text. If activity logs have no write event or no recognizable details, report **uncertain**, not a cause. Tested in mock CI on draft PR #44.

An **Azure Container Apps Jobs platform issue** with exactly this class of managed-identity Key Vault-reference failure was publicly reported 11 August 2026: [microsoft/azure-container-apps#1804](https://github.com/microsoft/azure-container-apps/issues/1804). Microsoft also documents possible provisioning Key Vault reference failures and RBAC propagation up to 10 minutes: [troubleshooting](https://learn.microsoft.com/en-us/azure/container-apps/troubleshoot-deployment-errors). These are **hypotheses only**, not the proven cause of this owner's failed request. Do not grant Vault-wide permissions, reimport token, or copy token values inline to "fix" a 403/secret-sync issue. Need actual sanitized Azure evidence first.

**Release and cost gates remain unchanged**: no GHCR private image pull proof, no staging backup, no AGE remote ciphertext, no independent PG17 restore. Do not start the smoke job; no repeat create until state and cause understood. The role `campuspool-ghcr-vault-reader` still has only `ghcr-pull-token` Secrets User access as of owner's previous readback. Whether a proof job exists after Azure request remains **unknown**.


## 11 November 2026 — RESOLVED root cause: Express environment rejects Container Apps Jobs

**Owner-provided Azure Activity Log evidence (redacted here; do not copy raw event):** the 2026-11-10T18:53Z `Microsoft.App/jobs/write` call failed HTTP 400 with `error.code=ExpressEnvironmentResourceNotSupported` and a provider explanation that Jobs cannot run in Express environments. The target proof job is absent; no job execution, encrypted staging backup or database read was performed. This is **an environment capability incompatibility**, not evidence of a failed GHCR PAT, missing Key Vault secret grant, image digest problem or database issue. The preceding `--plan` incorrectly marked the environment ready because it checked successful provisioning, Malaysia West, identity and role, but never checked `properties.environmentMode`. The event is sufficient to explain this attempted job creation.

**Current Microsoft documentation:** [Express overview](https://learn.microsoft.com/en-us/azure/container-apps/express-overview) explicitly excludes Container Apps Jobs, Key Vault secret references and workload profiles. [Container Apps environments](https://learn.microsoft.com/en-us/azure/container-apps/environment) and [workload profiles](https://learn.microsoft.com/en-us/azure/container-apps/structure) recommend a standard WorkloadProfiles (v2) environment with the built-in Consumption profile for compatible on-demand jobs. [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/containerapp/env) documents `--environment-mode WorkloadProfiles` at new-environment creation. **Do not assume an active Express environment can be converted in place**; archived restore functionality is not proof of supported direct Express→WorkloadProfiles conversion.

**Source safety fix on [draft PR #44](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/44):** both read-only GHCR job planning and the consent-gated create operator now query `properties.environmentMode`, reject `Express` with `STOP_CONTAINER_APPS_EXPRESS_JOBS_UNSUPPORTED`, and fail closed on unknown/archived modes. Acceptance is limited to `WorkloadProfiles` or legacy `ConsumptionOnly`. Added mock tests proving the check stops before any ARM PUT. Diagnostic also maps the precise `ExpressEnvironmentResourceNotSupported` code to a non-sensitive enum. Verify the latest CI status; mock tests do not prove quota or cloud mode.

**Next owner step — read-only, no CLI writes:**

```bash
az containerapp env show -g campuspool-backup-rg -n campuspool-backup-env \
  --query "{Mode:properties.environmentMode,State:properties.provisioningState,Region:location}" -o json
az containerapp env list -g campuspool-backup-rg \
  --query "[].{Name:name,Mode:properties.environmentMode}" -o table
az containerapp list -g campuspool-backup-rg --query "length(@)" -o tsv
az containerapp job list -g campuspool-backup-rg --query "length(@)" -o tsv
```

These commands inspect only resource mode, state and counts (no secret values, identities or subscriptions). Before deciding whether to request an environment quota increase, create a second environment, or replace an unused Express environment, independently validate subscription quota (earlier `ManagedEnvironmentCount=0/1` before first environment), any existing apps/consumers, Malaysia West availability, network/logging constraints, current 31-day actual spend plus taxes and `₹500` cap, and explicit owner authorization. **Do not delete existing environment, create a new one, change its mode, alter IAM or reattempt proof job yet.** After a supported environment exists and a newly reviewed cost/security plan, recompute job manifest's environment ID and run the manual-only smoke proof under separate approval. Preserve no DB/CA/Blob permissions; stage backup, independent PG17/PostGIS restore and OTP release remain NO-GO.

**Privacy:** raw Azure Activity Logs include caller email, IP address, subscription/tenant IDs and session claims. Never copy the raw event into repo/Notion or public issues; only the error code and resource capability conclusion are retained here.


## 11 November 2026 — Confirm actual environment mode and regional quota via selected read-only ARM fields

Owner's latest Azure CLI inventory: existing `campuspool-backup-env` is `Succeeded` in Malaysia West, but `properties.environmentMode` was **null in the CLI projection**; zero Container Apps and zero Jobs are present **in `campuspool-backup-rg`**. The earlier independent `ExpressEnvironmentResourceNotSupported` from the actual failed ARM create remains decisive. A `null` field is not evidence of a Standard environment; the updated job preflight intentionally fails closed on unknown mode.

Use only named properties from ARM `GET` (avoid dumping the entire environment document), and retrieve subscription/ARM IDs into shell variables **without printing them**:

```bash
ENV_ID=$(az containerapp env show -g campuspool-backup-rg -n campuspool-backup-env --query id -o tsv)
az rest --method get \
  --url "https://management.azure.com${ENV_ID}?api-version=2026-07-01" \
  --query "{Mode:properties.environmentMode,Kind:kind,State:properties.provisioningState}" -o json

SUB_ID=$(az account show --query id -o tsv)
az rest --method get \
  --url "https://management.azure.com/subscriptions/${SUB_ID}/providers/Microsoft.App/locations/malaysiawest/usages?api-version=2026-01-01" \
  --query "value[?name.value=='ManagedEnvironmentCount'].{Used:currentValue,Limit:limit}" -o table
```

Published sources: [managed environments GET 2026-07-01](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/managed-environments/get?view=rest-resource-manager-containerapps-2026-07-01), [regional usage quota GET 2026-01-01](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/usages/list?view=rest-resource-manager-containerapps-2026-01-01), and [Express FAQ](https://learn.microsoft.com/en-us/azure/container-apps/express-faq). If the newer read API is unavailable or returns null, record **mode unverified** rather than guessing. Quota `Used/Limit` may affect eligibility to create a separate replacement environment. Do **not** delete or convert Express, create a new environment, retry the GHCR job, grant IAM, incur new resources, perform staging backup or release OTP until owner gives separate explicit approval after cost/security review.


## 2026-11-11 — Owner ARM confirms Express and **standard managed environment quota 0/1**

- Owner executed real, **read-only** ARM GET against `2026-07-01` for `campuspool-backup-env`: returned `{Kind:null, Mode:"Express", State:"Succeeded"}`. Independent Malaysia West `Microsoft.App/locations/malaysiawest/usages` GET using `2026-01-01` reported `ManagedEnvironmentCount Used=0, Limit=1`. Prior resource-group inventory showed 0 apps and 0 jobs. **Mode is now independently verified as Express**, explaining prior `ExpressEnvironmentResourceNotSupported` failure. Although Express exists, regular managed-environment quota reports an available slot; this is encouraging, **not provisioning approval** or a guarantee of enough regional capacity.
- Current Microsoft guidance: [ACA quotas](https://learn.microsoft.com/en-us/azure/container-apps/quotas) covers separate Express constraints; [billing](https://learn.microsoft.com/en-us/azure/container-apps/billing) says Consumption jobs incur compute charges only while executions run and documents shared per-subscription free grants, but network, logging, storage and other resources can still cost money. [WorkloadProfiles v2](https://learn.microsoft.com/en-us/azure/container-apps/environment-type-consumption-only) with built-in Consumption is recommended over legacy ConsumptionOnly. No dedicated profile; avoid dedicated plan management charges and nonessential networking/infrastructure.
- **Code correction:** new GHCR proof guard previously read `properties.environmentMode` via `az containerapp env show`, which returned `null` for this Express environment. On [draft PR #44](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/44), updated the read-only preflight and owner-gated operator to GET the selected canonical ARM `properties.environmentMode` using `2026-07-01`; fail closed unless `WorkloadProfiles` or `ConsumptionOnly`. Added and corrected offline tests ensuring no unsafe ARM PUT and GET-only mode lookup (latest source commit `b92ef5cb1b6bbae8b0786cc69583f84e617ad58f`). Check exact-head CI completion before claiming full pass.
- **Next operational gate:** request owner to review current Azure spend/remaining credit and realistic 31-day budget including possible logs/network/Blob/Key Vault costs, ensure availability and subscription permission for a second non-Express environment, and approve exact resource name and config before creating. The Express environment has no listed workloads; **do not delete it**, broaden IAM, retry proof job, expose GHCR token, perform encrypted staging backup or enable production OTP. New standard environment requires independent creation consent; manual job create and job start each require separate consent.


## 11 November 2026 — Owner authorizes cost-bearing standard environment creation (not job start)

Owner explicitly stated charges are acceptable for now, allowing the next technical provisioning step without waiting for a ₹500 cost analysis. This authorizes **only the new standard environment** after the verified real ARM GET reported `campuspool-backup-env` is `Express/Succeeded` and Malaysia West `ManagedEnvironmentCount Used=0, Limit=1`. It is **not** approval for broader IAM, job execution, production OTP, data migration or payments.

**Owner-operated Azure Cloud Shell command** (Bash; one create operation only, idempotent target check; no secrets printed):

```bash
set -euo pipefail
RG=campuspool-backup-rg
NEW_ENV=campuspool-backup-standard-env
FOUND=$(az containerapp env list -g "$RG" --query "[?name=='${NEW_ENV}'].name | [0]" -o tsv)
if [ -z "$FOUND" ]; then
  az containerapp env create \
    --name "$NEW_ENV" --resource-group "$RG" \
    --location malaysiawest \
    --environment-mode WorkloadProfiles \
    --logs-destination log-analytics \
    --query "{Name:name,Region:location,State:properties.provisioningState}" -o json
else
  echo "TARGET_ALREADY_EXISTS_VERIFYING_ONLY"
fi
ENV_ID=$(az containerapp env show -g "$RG" -n "$NEW_ENV" --query id -o tsv)
az rest --method get \
  --url "https://management.azure.com${ENV_ID}?api-version=2026-07-01" \
  --query "{Mode:properties.environmentMode,State:properties.provisioningState,Profiles:properties.workloadProfiles[].{Name:name,Type:workloadProfileType}}" -o json
echo "STANDARD_ENVIRONMENT_CHECK_COMPLETE"
```

`az containerapp env create --environment-mode WorkloadProfiles` is documented by [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/containerapp/env). The default Log Analytics destination can provision an additional workspace, which may incur charges, and is deliberate here so future job execution is auditable. **This runbook entry is a command proposal, NOT evidence of Azure creation.** There is no direct Azure ARM connector available in this agent session; owner executes in Cloud Shell and shares only selected verification fields. After a successful result, refresh environment name references in the existing job operator, then separately review and authorize GHCR-only manual proof job create. Do not start the job or perform database backup until distinct consent and required identity/registry/recovery checks. Preserve existing Express env.


## 2026-11-11 — Cloud Shell strict-mode interruption: target absent, retry procedure revised

**Latest owner evidence:** After an earlier copy-pasted `set -euo pipefail` creation attempt closed Cloud Shell, the owner reopened a new shell, disabled strict options and performed safe, read-only `az containerapp env list` / ARM target check. `ENV_LIST_EXIT_CODE=0`, no table entry, `STANDARD_ENV_NOT_FOUND_OR_NOT_YET_VISIBLE`. At this observation time the requested `campuspool-backup-standard-env` is **NOT confirmed created**; do not mark it ready or attempt GHCR proof.

**Risk:** Bash `set -e` in an interactive Cloud Shell may terminate the session on any failing Azure command, hiding the useful exit code. The cause of the original `az containerapp env create` failure is **not known**. Per [Azure CLI docs](https://learn.microsoft.com/en-us/cli/azure/containerapp/env), `--no-wait` avoids a long-running client session, and omitting `--logs-destination` retains the default `log-analytics` with a generated workspace. The earlier explicit logging flag is not proven to be the cause of failure.

**Replacement owner-executed, single-request, non-terminating procedure:**

```bash
set +e
set +u
set +o pipefail
RG=campuspool-backup-rg
NEW_ENV=campuspool-backup-standard-env
FOUND=$(az containerapp env list -g "$RG" --query "[?name=='${NEW_ENV}'].name | [0]" -o tsv)
LIST_RC=$?
echo "ENV_INVENTORY_RC=$LIST_RC"
if [ "$LIST_RC" -ne 0 ]; then
  echo "STOP_INVENTORY_FAILED_NO_CREATE"
elif [ -n "$FOUND" ]; then
  echo "TARGET_ALREADY_EXISTS_NO_CREATE"
else
  echo "SUBMITTING_STANDARD_ENVIRONMENT_CREATE"
  az containerapp env create \
    -g "$RG" -n "$NEW_ENV" \
    -l malaysiawest --environment-mode WorkloadProfiles \
    --no-wait --only-show-errors -o none
  CREATE_RC=$?
  echo "CREATE_REQUEST_RC=$CREATE_RC"
fi
echo "=== READ_ONLY_STATUS ==="
az containerapp env list -g "$RG" \
  --query "[?name=='${NEW_ENV}'].{Name:name,State:properties.provisioningState}" -o table
echo "ENV_STATUS_CHECK_COMPLETE"
```

If the request exits nonzero, stop and inspect the **redacted** Azure error and CLI version in Cloud Shell; do not blindly retry, switch subscription, relax IAM or remove the old Express environment. If exit code is zero, it means Azure **accepted the provisioning request**, not that the environment is `Succeeded`; verify later with selected-field ARM `GET 2026-07-01` and Consumption profile inventory. This procedure does not start jobs or perform backups; Azure resource creation may incur charges and was explicitly permitted by the owner.


## 11 November 2026 — Verification after missing environment: do not construct ARM URL from empty ID

- **Latest owner Cloud Shell output:** `az containerapp env list -g campuspool-backup-rg` lists only `campuspool-backup-env` (`Succeeded`). `az containerapp env show -n campuspool-backup-standard-env` returns `ResourceNotFound`. A subsequent ARM GET returned `MissingSubscription` **because** `ENV_ID` was empty after the failed lookup; this secondary error is not evidence of Azure subscription misconfiguration. No success or error output from the original **create request** has yet been provided; do not guess its root cause.
- [Microsoft Azure CLI documentation](https://learn.microsoft.com/en-us/cli/azure/containerapp/env) lists `--enable-workload-profiles true` (GA Core CLI) as an alternative to preview `--environment-mode WorkloadProfiles`. Owner is already authorized to create the single named Standard environment; use one guarded create with `--no-wait`, leave strict shell-exit options disabled, **retain stderr for private redacted classification**, print the create exit code, and stop on nonzero. Do not attempt verification if the target does not exist. This does not modify the existing Express environment.
- **Next owner step:** run a single idempotent create attempt as above, then read-only `az containerapp env list` scoped to the target. Exit 0 means submitted, **not successfully provisioned**. Once target exists, verify `environmentMode=WorkloadProfiles` and `provisioningState=Succeeded` via ARM GET API 2026-07-01. If create fails, stop, privately inspect Azure CLI error and return only safe code/property, not raw ARM JSON, subscription/account IDs or tokens. Cloud resources/Jobs/backup still unverified.


## 2026-11-11 — Actual Standard creation error identified: Microsoft.OperationalInsights NotRegistered

- The user's Cloud Shell first confirmed `campuspool-backup-standard-env` absent. A guarded single create request with `--enable-workload-profiles true --no-wait` reported `CREATE_REQUEST_RC=1`, with Azure's actionable message: **`Microsoft.OperationalInsights` resource provider is not registered**. No Standard environment was created as a result of that request. This is a concrete failure reason, unlike the earlier `MissingSubscription` caused by an empty environment ID.
- User accidentally entered `az provider register -n Microsoft.OperationalInsights --wait"` (unmatched quote, Bash continuation prompt), canceled it, and then correctly invoked `az provider register -n Microsoft.OperationalInsights --wait`. The latter returned to the prompt without an error, but **registration state was not yet verified**.
- Next owner **read-only** check: `az provider show -n Microsoft.OperationalInsights --query registrationState -o tsv`. If `Registered`, perform at most one guarded create attempt with existing name/resource group/location, `--enable-workload-profiles true --no-wait`, and capture exit code. If `Registering` or `NotRegistered`, do **not** blindly retry creation; assess provider status/permissions. Never construct an ARM URL from empty ENV_ID. After creation, separately verify `Mode=WorkloadProfiles` and `State=Succeeded` via selected-field ARM `GET 2026-07-01`. Preserve Express and existing job/backup/OTP safety gates.
- Microsoft [resource provider registration reference](https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-register-resource-provider) documents the registration state query; [Azure CLI Container Apps environment reference](https://learn.microsoft.com/en-us/cli/azure/containerapp/env) supports workload profiles and no-wait. Do not repeat the unredacted subscription identifier from the pasted output in docs.


## 2026-11-11 — Express quota proves previous workload-profile boolean request was treated as Express

- **New owner evidence after `Microsoft.OperationalInsights=Registered`:** `az containerapp env create --enable-workload-profiles true --no-wait` returned Azure error `MaxNumberOfRegionalExpressEnvironmentsInSubExceeded` and `CREATE_REQUEST_RC=1`. Microsoft.App interpreted the submitted create as a *second Express environment* in Malaysia West, hitting this subscription's regional **one-Express-environment** quota. The command did not create `campuspool-backup-standard-env`. The user-provided subscription ID is intentionally excluded from this public handoff. Cause of CLI mode selection (CLI extension/command implementation vs service behavior) remains **unconfirmed**; do not claim the Standard managed-environment quota was exhausted.
- [Microsoft's environment CLI reference](https://learn.microsoft.com/en-us/cli/azure/containerapp/env) specifically documents `--environment-mode WorkloadProfiles`, distinct from the older `--enable-workload-profiles` toggle. [Microsoft Express FAQ](https://learn.microsoft.com/en-us/azure/container-apps/express-faq) confirms Express cannot run Container Apps Jobs; [ARM 2026-07-01 ManagedEnvironment schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2026-07-01/managedenvironments) supports explicit `properties.environmentMode: WorkloadProfiles`.
- **Next approved, guarded attempt (owner Cloud Shell only):** Stop on inventory errors. Check `az containerapp env create --help` exposes `--environment-mode`; only then issue one `az containerapp env create -g campuspool-backup-rg -n campuspool-backup-standard-env -l malaysiawest --environment-mode WorkloadProfiles --logs-destination log-analytics --no-wait --only-show-errors -o none` with Bash `set +e`, print `CREATE_REQUEST_RC`. No jobs started, and existing `campuspool-backup-env` Express remains untouched. If CLI help lacks the mode parameter or the explicit attempt again yields Express quota, **STOP** and inspect `az version`, installed `containerapp` extension details and **read-only ARM status** before any new create. Never delete Express to evade its quota, expand RBAC, use staging secrets, or migrate data. If accepted, verify `properties.environmentMode==WorkloadProfiles` and `properties.provisioningState==Succeeded` by ARM GET before any GHCR proof operation.
- **Prior runbook correction:** The earlier advice treating `--enable-workload-profiles true` as operationally equivalent to explicit mode is **not valid in this observed Azure subscription/toolchain**. Prefer explicit mode and never use the boolean as another retry here. If explicit CLI fails, a separate reviewed ARM/Bicep deployment specifying `environmentMode` is a possible next engineering option, *not* automatically authorized.
