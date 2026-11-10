# Agent handoff — 3 CampusPool Azure release gates, 2026-11-06

**User goal:** complete authenticated 31-day Azure cost under ₹500, independent GHCR worker security, genuine staging AGE/Blob backup plus cold restore. **Current:** remote evidence blocked by Azure account access. Do not infer approval from code CI, and never treat synthetic data as real staging recovery.

**Stack:** PR #44 review-only on #43→#42→#41→#40→#39→#38→main. Preserve all draft stacks and do not merge/deploy prior to independent source, IAM, cost and recovery signoffs.

**Source audit (connected tools):**
- Supabase `campuspool-staging-db` active PostgreSQL 17.11/PostGIS 3.3.7; 10 tables in dump scopes, 9 RLS-enabled and 9 policies, 7 applied migrations, a dedicated `campuspool_staging_app` role, source policy/flag hash `02300c7afe89d67a41576d6c207802e4`. App rows zero per metadata; does not prove restore.
- PR #43 (before branch fork) at `542ccfb0425621bb2c9559adcae6e07164b82d95` passed eight checks. Signed review OCI archive is **not** a signed pushed GHCR manifest.
- No GitHub PR reviews on #38-#43. No Azure native connector or Azure CLI owner login in this runtime. No authenticated Azure Cost Management, Vault, private Blob or Container Apps Job action was completed.
- Source PHP/SQL read-only checks are not an encrypted export or an independently recovered PG17/PostGIS database. Old 200-byte object invalid.
- Production Render and staging remain live but not the current new review worker. Their deployment details are documented separately.

**Implemented source-only handoff:**
- `ops/cloud-backup/azure-31day-owner-readonly.sh`: owner-only authenticated Azure Cost Management Usage and forecast queries; only sanitized totals.
- `scripts/azure_31day_cost_evidence.py`: fail-closed and redacted parser for authenticated data.
- `test_azure_31day_cost_evidence.py`: malformed, partial, mixed currency, forecast status and false-budget-pass negative tests.
- `docs/ops/THREE_GATE_CLOSEOUT_2026-11-06.md`: evidence/status and exact live recovery gates.

**Next secure operator actions (separate approval and independent evidence still needed):** owner runs cost collector from Cloud Shell without pasting account IDs/secrets; produces private tax-inclusive 31-day all-in upper bound and passes existing offline budget gate; independently verifies published image digest signature, Vault/IAM/no-delete role, actual CA/tmpfs and registry pull; separately authorizes staging TLS, genuine AGE-encrypted Blob export, independent ciphertext readback and PG17/PostGIS restore, then Render rollback verification. No repo write or local SQLite/WSL dump can replace this.

**No cloud spend, billing change, credentials, job run, scheduled backup, data copy, migration or production deploy was performed by this task.** Do not claim 3/3 closed.


## Authenticated owner cost-query attempt — 2026-11-06 IST

- Owner executed the read-only `ops/cloud-backup/azure-31day-owner-readonly.sh` in Azure Cloud Shell. The script printed `CAMPUSPOOL_AZURE_FOR_STUDENTS_BILLING_SCOPE=CONFIRMED`, `SCOPE=CAMPUSPOOL_BACKUP_RESOURCE_GROUP_ONLY` and `NO_AZURE_WRITES_OR_RESOURCE_CREATION`, then stopped at `COST_ACCESS_BLOCKED: historical Cost Management query unavailable`.
- This **does not prove missing charges, an account permissions problem or actual spend of ₹0**. The initial script intentionally hid raw Azure CLI errors. The precise HTTP status / Azure error code is unknown until retried. Microsoft documents both the resource-group Query API and Azure for Students Cost Analysis/ Education Hub support.
- New diagnostic helper `scripts/azure_cost_error_sanitize.py` prints only whitelisted billing failure status/code/category from a temporary error file; never logs raw account IDs, URLs, identities, invoices or bearer tokens. The owner-only Cloud Shell script now emits `COST_HTTP_STATUS`, `COST_ERROR_CODE`, `COST_CATEGORY`, redaction and `COST_BUDGET_GATE=BLOCKED` if historical or forecast request fails. Private temp files are removed on exit. Unit tests cover permission, invalid query, offer support, throttling and malicious tokens.
- **Owner follow-up (read-only only):** in the existing `~/campuspool-cost-check` checkout, run `git pull --ff-only` then `bash ops/cloud-backup/azure-31day-owner-readonly.sh`, and share only sanitized diagnostic lines (or sanitized cost summary). Do not run `az rest --debug` or paste raw `az rest` error output. If 403/AuthorizationFailed, inspect Cost Management Reader access or Education Hub billing visibility; if 400/BadRequest, inspect request schema and API version; if 404, inspect scope; if 429/503 retry later. No role grants without separate approval.
- **Portal fallback** if the API is unsupported or inaccessible: Azure Portal → Education Hub → Overview → View cost details (Cost Management) and inspect Cost Analysis for the specific subscription / resource group; separately inspect Azure for Students remaining credits. Summarize only non-identifying service/category totals and dates. A new subscription may not have enough history for an API forecast; use an independently reviewed line-item quote for the 31-day upper bound.


## Cost query retried with sanitized diagnostics — 2026-11-06 IST

- After `git pull --ff-only`, the owner reran the collector in authenticated Azure Cloud Shell. Subscription and backup RG were confirmed, followed by `COST_ACCESS_BLOCKED: historical Cost Management query unavailable`, `COST_HTTP_STATUS=UNKNOWN`, `COST_ERROR_CODE=UNCLASSIFIED`, `COST_CATEGORY=UNKNOWN`, `COST_PRIVATE_AZURE_ERROR=REDACTED`, `COST_BUDGET_GATE=BLOCKED`. No numerical costs or forecast were obtained.
- Official Microsoft Cost Management REST documentation confirms **2025-03-01** is valid and both subscription and resource-group Usage Query routes are supported in the specification: https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage?view=rest-cost-management-2025-03-01 . The specific owner failure is **unclassified**, and must **not** be asserted to be HTTP 403, a student-offer restriction or invalid API version.
- Stop repetitive blind CLI attempts. Owner should inspect official Azure Education Hub → Overview → View cost details → Cost Analysis: https://learn.microsoft.com/en-us/azure/education-hub/navigate-costs . Select subscription scope; use recent actual period, group by service and filter backup RG, inspect available forecast and remaining student credit. Share **only currency, date range, redacted service totals and any generic access message**; no invoices, account IDs or student data. If portal also blocks, seek Azure support/billing permission review without granting new roles based on guesses.
- Any visible actual charges **cannot** close the 31-day tax-inclusive ₹500 worst-case gate by themselves. Planned GHCR/Key Vault/ACA/Blob/log/network charges, tax/FX and contingency remain an independent quote check; backup/restore remain NO-GO.


## Owner priority update — 2026-11-06 IST: GHCR and recovery before further billing investigation

- The owner explicitly directed **stop troubleshooting Azure Cost Management** and **use the previously selected configuration**: **private GitHub Container Registry (GHCR)** for the backup image, existing **Malaysia West Consumption Container Apps environment** with a **manual-only** backup job, **Key Vault** for protected runtime secrets, and the existing private **Azure Blob** container for AGE-encrypted ciphertext. **ACR remains a later full-scale-launch option.**
- This reprioritizes work. It does **not** demonstrate actual under-₹500 charges or authorize an unbounded bill; **cost evidence is DEFERRED / UNVERIFIED, not PASS**. Keep the previously agreed ₹500 total-spending constraint and do not create paid resources without clear cost understanding. Existing checks/CI must remain fail-closed.
- **Immediate concrete next step:** owner executes the existing read-only Cloud Shell inventory `bash ops/cloud-backup/azure-readonly-preflight.sh` from the existing checked-out branch and reports **sanitized resource inventory/status only**. This does not create/delete resources, grant IAM, access the database or trigger jobs. Do not share account IDs, storage keys, private secret values or full connection endpoints.
- **Private-package security caution:** GitHub documents nuanced GHCR package visibility and repository inheritance for packages created by `GITHUB_TOKEN`. Because the CampusPool GitHub repository is public, do **not** assume workflow-created package is private. Inspect/ensure initial package's privacy **before any confidential image distribution**, and verify access after publishing. Never make a private package public; keep image content free of secrets regardless.
- Next prerequisites after inventory: independent PR #38–#43 security review; private image signed **pushed manifest** digest; narrow GHCR pull token scoped in Vault, identity and no-delete Blob roles; trusted CA and `/dev/shm` on the target runtime. Only then stage-only TLS, first genuine encrypted Blob readback, and independent PG17/PostGIS cold restore. No schedule/production rollout.


## Authenticated Azure inventory — 2026-11-06 IST (confirmed by owner Cloud Shell)

Source: owner executed `bash ops/cloud-backup/azure-readonly-preflight.sh` from reviewed branch; no Azure writes. Output was sanitized (no credentials/tenant IDs shared).

| Item | Observed |
| --- | --- |
| Subscription | Azure for Students confirmed |
| Resource group | `campuspool-backup-rg`, Malaysia West |
| Container Apps environment | `campuspool-backup-env` in Malaysia West, `Succeeded`, Consumption workload profile, **Logs=null** |
| Storage account | `011campuspoolbackup`, Malaysia West, `AllowBlobPublicAccess=false`, `PublicNetwork=Enabled` |
| Provider Microsoft.App | Registered |
| Provider Microsoft.ContainerRegistry | NotRegistered; **intentionally leave it**, using GHCR not ACR |
| Provider Microsoft.KeyVault | NotRegistered; needed for planned Vault secret references |
| Provider Microsoft.ManagedIdentity | NotRegistered; needed for planned user-assigned CA/GHCR Vault reader identity |
| Resource inventory | **No ACR, Vault, user-assigned identity, or Container Apps backup job returned** within this RG |

**Security interpretation:** `AllowBlobPublicAccess=false` disallows anonymous blob data access; `PublicNetwork=Enabled` does **not** mean the Storage endpoint is network-private. Storage container properties, identity-based Blob roles, Key Vault, secrets, CA file behavior and the actual encryption/recovery path remain unverified. No active backup job exists. No need to register Container Registry in the GHCR design.

**Least-change next step (owner Azure Cloud Shell, subscription-level change; NOT an Azure resource creation or job start):** after verifying the selected subscription, register **only** `Microsoft.KeyVault` and `Microsoft.ManagedIdentity` with `az provider register --namespace ... --wait --output none` and read their `registrationState` with `az provider show`. An operator needs the Azure provider `/register/action` permission. Do not register ACR, create a Vault/identity or role assignments, publish images, enable logs or start a job in the same step. Azure resource-provider registration can add a service app in Entra; owner authorizes these two required namespace registrations explicitly.

**Then:** review exact GHCR package visibility and signed pushed image digest; select reviewed Key Vault configuration and least-privilege secret access; confirm the CA, Cloud worker nonroot `/dev/shm`, Blob private container write/read/no-delete and safe logs using a non-data test before staging TLS/AGE export. Cost confirmation remains deferred/unverified; no claim of ₹500 budget PASS. Further resource creation might incur charges and requires owner-specific go-ahead.


## Required Azure provider registrations completed — owner evidence, 2026-11-06 IST

- The owner executed `az provider register --namespace Microsoft.KeyVault --wait --output none` and `az provider register --namespace Microsoft.ManagedIdentity --wait --output none` in the previously validated **Azure for Students** subscription. The displayed final checks are **`Microsoft.KeyVault: Registered`** and **`Microsoft.ManagedIdentity: Registered`**. The pasted terminal line between commands is visually garbled, but the two Azure CLI status checks are the acceptance signal. These status checks close **provider registration only**.
- Leave `Microsoft.ContainerRegistry` unregistered: private GHCR remains the owner-selected registry. Provider registration does not prove any Vault/identity/job exists, or that there are suitable permissions, secret values, private GHCR package, encrypted archive or restore.
- **Next, read-only:** confirm package visibility and current deployment inventory; review first-time GHCR publishing policy and security: GitHub's documented workflow-created packages can inherit a public repository's visibility. Do not publish or expose the worker image until package privacy is guaranteed, signed pushed manifest workflow and independent reviewer approved. Key Vault and user-assigned identity creation, role grants, logs and real worker are separate changes with potentially billable impact; preserve the budget constraint and release NO-GO until approved.
- The needed next infrastructure work remains **Key Vault with scoped secret references, GHCR read-only pull credential, least-privilege managed identity + private Blob container rights, CA file/tmpfs runtime test, actual signed GHCR image**, followed by a manual-only preflight, stage TLS, separately authorized ciphertext backup and independent PG17/PostGIS restore.


## Local Docker verified and guarded GHCR first publication prepared — 2026-11-06 IST

- Owner's WSL Docker Engine/Client both **29.6.1**, `linux/amd64`, daemon running. No images published by the assistant; Docker engine is on owner's device and not remotely connected to this assistant.
- At reviewed source head `476761899e9c3f7eb444600090e5e6edf86750a8`, **8/8 relevant GitHub CI checks PASSED**, including exact worker build/smoke, OS/library vulnerability scan, Node dependency audit, zlib source evidence, managed-identity guards and signed **review-only** OCI archive. The review archive is not signed final GHCR manifest.
- New [owner-run guarded first-publish helper](../../ops/cloud-backup/ghcr-private-first-publish.sh), [authenticated private personal package metadata checker](../../scripts/ghcr_private_package_check.py), [privacy negative tests](../../test_ghcr_private_package_check.py) and [isolated offline CI](../../.github/workflows/ghcr-private-first-publish-guard.yml). `--build-check` first; `--publish-private` only with owner-supplied short-lived `write:packages` **classic PAT** at hidden prompt on RAM-backed `/dev/shm` Docker auth config. Reject source-label repository inheritance and wrong/public package; print exact remote digest and privacy only after successful owner-authenticated REST verification. No PAT stored in Git/Notion/chat, no `:latest`, no Azure writes, no database access.
- See detailed [GHCR private first publication operator runbook](../../docs/ops/GHCR_PRIVATE_FIRST_PUBLISH_2026-11-06.md). **Next owner step:** clone a *fresh clean* repo checkout in WSL and run `bash ops/cloud-backup/ghcr-private-first-publish.sh --build-check` after final CI green. Then generate scoped temporary PAT and run explicit `--publish-private`; independently inspect package marked Private and record pushed manifest digest. Obtain independent signer/security review before Azure job preflight. Do not schedule or export.
- **Remaining:** package not yet published/verified, digest not yet signed, Key Vault and identities not created, owner under-₹500 cost not verified (deferred), first genuine AGE offsite backup/readback and isolated PG17/PostGIS restore NOT performed. Never mark recovery gate passed from build or CI alone.


## First owner-published GHCR package — 2026-11-07 IST

- Owner completed `bash ops/cloud-backup/ghcr-private-first-publish.sh --publish-private` on local WSL. Pre-push authenticated package GET reported missing (expected for new package); Docker push of `review-6c571396fff0` succeeded; post-push authenticated package GET confirmed **Private**. Result digest `sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2`. This closes **private first publication**, NOT manifest signature or cloud recovery.
- Helper's temporary Docker auth warning refers to `/dev/shm`, the intended RAM-backed filesystem, and helper removes isolated Docker config on exit. Do not claim independent forensic proof of deletion from the transcript alone; revoke upload token when done.
- Source-only exact-digest keyless signing helper, tests and [owner runbook](../../docs/ops/GHCR_SIGNED_MANIFEST_GATE_2026-11-07.md) prepared. Owner keyless signing will publish an OIDC signer email into a public Sigstore transparency record; script requires explicit consent and then verifies exact digest, expected owner identity, GitHub issuer and private package visibility. No signature, Azure job, secret, data export or restore performed by assistant.
- **Next:** check `cosign version` in WSL, install a verified official build if necessary, run guarded signer only if comfortable with transparency identity disclosure. For formal release, independent security reviewer still must accept the signer identity and approve real Vault/managed identity/Blob roles, stage TLS, AGE backup and cold separate PG17/PostGIS recovery. No recurring jobs.


## Owner completed exact digest Sigstore signing — 2026-11-07 IST

- Actual owner-run signing output: `Retrieving signed certificate`, `Successfully verified SCT`, `tlog entry created with index: 3723930561`, `Pushing signature to: ghcr.io/sohamsadegaonkar/campuspool-backup-worker`; after sign the owner-run helper reported `GHCR_PERSONAL_CONTAINER_PACKAGE_PRIVATE_VERIFIED`, `SIGNATURE_CRYPTOGRAPHICALLY_VERIFIED=YES`, immutable `VERIFIED_IMAGE=ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2` and `EXPECTED_SIGNER_ISSUER=https://github.com/login/oauth`.
- **Completed:** owner-keyless Sigstore signature on actual GHCR pushed manifest digest and same-owner identity/issuer cryptographic verification; authenticated package still Private. Signer's personal identity was redacted from agent evidence and must not be committed.
- **Not completed:** formal independent trusted-release-workflow attestation/security review (the helper explicitly retained this warning), vault provisioning, tightly scoped GHCR pull/DB secret/Blob data roles, real target Container Apps CA/tmpfs, staging TLS, actual encrypted Blob backup and independent cold restore/rollback. Don't merge or deploy on signature alone.
- **Immediate hygiene:** owner revokes the temporary `write:packages` signing/publishing PAT(s), logs out; later create a distinct `read:packages` token exclusively for Azure private pull via approved Key Vault. Prefer an independently controlled `--verify` execution with the expected GitHub signing identity on the exact digest before job deployment, using sanitized status only.


## Next development milestone: guarded Azure Vault/UAI provisioning — 2026-11-07 IST
- Owner explicitly asked to **start** Key Vault and identities rather than revisit skipped Azure Cost Management API. Chosen minimum first step: [reviewed script](../../ops/cloud-backup/azure-vault-identity-foundation.sh) with `--plan` (no writes) and owner-confirmed `--apply` (two resources at most), implemented on PR #44; [runbook](../../docs/ops/AZURE_VAULT_IDENTITY_FOUNDATION_2026-11-07.md).
- Names: `campuspool-backup-kv-01` (satisfies Cloud-worker tight Vault DNS allowlist) and `campuspool-ghcr-vault-reader` (user-assigned identity for later GHCR PAT / CA retrieval); Malaysia West; Standard RBAC Vault, purge protection and 90-day soft-delete; public network endpoint required under current no-VNet cost-conscious consumption design, but *network is not private*. No access granted automatically. Purge protection irreversible; exact confirmation required.
- Security: repo script fails if subscription != `Azure for Students`, storage anonymous Blob access is not disabled, backup environment not succeeded, providers unregistered, Vault global name taken, unexpected existing resource config; repeat execution preserves verified resources. Mock CLI tests disallow secret setting, role assignments, job creation/start and any DB operations.
- **Owner action:** run `bash ops/cloud-backup/azure-vault-identity-foundation.sh --plan` in existing Azure Cloud Shell after `git pull --ff-only`; then, if values and irreversible retention tradeoff accepted, run `--apply` and type explicit `CREATE_CAMPUSPOOL_VAULT_AND_READER`. Share sanitized status only; never send principal IDs, subscriptions, tokens, or raw CLI errors. CLI output is live evidence; no actual Azure mutation performed by the assistant.
- Next verify data-plane permission model and create necessary secrets safely under scoped RBAC (separate trusted operator, GHCR/CA reader vs DB password reader), and prove manual-only secure runtime before genuine encrypted staging export and independent restore. No cost verification pass claimed.


## Owner Cloud Shell Foundation Plan PASS — 2026-11-07 IST

- Owner created `~/campuspool-vault-setup` from the draft PR #44 branch in Cloud Shell (previous `~/campuspool-cost-check` directory missing). `az account show --query name -o tsv` printed `Azure for Students`; the script was found.
- Read-only `--plan` returned `KEY_VAULT_EXISTS=NO`, `READER_IDENTITY_EXISTS=NO`, `PLAN_VALIDATED=YES`, `PLAN_MODE_NO_AZURE_WRITES=YES` in `campuspool-backup-rg` Malaysia West. This is ONLY a plan PASS, not provisioned resources, secret access, job launch, backup or cold restore evidence.
- Exact next operator command: `bash ops/cloud-backup/azure-vault-identity-foundation.sh --apply` in `~/campuspool-vault-setup`, then type `CREATE_CAMPUSPOOL_VAULT_AND_READER` after approving irreversible 90-day purge protection and Standard metered operations. Do not relax security on STOP errors. Preserve sanitized results and mark live resources only after `FOUNDATION_CREATION_PASS=YES` together with individual security verification markers.


## Owner guarded Vault/UAI creation succeeded — 2026-11-07 IST

- Live owner Azure Cloud Shell `--apply` printed prior `KEY_VAULT_EXISTS=NO` and `READER_IDENTITY_EXISTS=NO`, warned about irreversible 90-day purge protection, metered Standard Vault operations and public endpoint, and received explicit phrase `CREATE_CAMPUSPOOL_VAULT_AND_READER`.
- Final verified markers: `KEY_VAULT_CONFIG_VERIFIED=YES`, `VAULT_READER_IDENTITY_VERIFIED=YES`, `FOUNDATION_CREATION_PASS=YES`, `NO_SECRETS_OR_AZURE_RBAC_GRANTS_CREATED=YES`, `NO_JOB_CREATED_OR_STARTED=YES`, `NO_DATABASE_CONNECTED_OR_EXPORTED=YES`. **Mark Key Vault `campuspool-backup-kv-01` and UAI `campuspool-ghcr-vault-reader` created.** No Azure backup, secret deployment or RBAC access was created.
- Next safe action: read-only secrets metadata (names only, not values), Vault RBAC and identity/Blob assignments, with hashed/non-sensitive status; design secret-scoped reader grants distinct from future job password and recovery role. Avoid broad `Key Vault Secrets User` at Vault scope and `Storage Blob Data Contributor` if no-delete access required. No active backup job, migration or OTP rollout.


## Azure RBAC and Blob container sanitized audit prepared — 2026-11-07 IST
- After owner-confirmed live Key Vault and UAI creation (`FOUNDATION_CREATION_PASS=YES`), **no secrets, role grants or jobs exist from that setup**. New read-only Azure audit `ops/cloud-backup/azure-vault-rbac-readonly-audit.sh` with offline mocked tests and CI verifies Vault RBAC/purge protection, identity presence and **aggregate** existing role assignments (no principal IDs printed), Blob storage account anonymous access and container `campuspool-staging-backups` metadata (management plane, no account keys), and existing jobs. Script has **no Azure writes** or DB connections and fails closed on unexpected access or job count. [Runbook](../ops/AZURE_VAULT_RBAC_READONLY_AUDIT_2026-11-07.md).
- **Next owner command in Azure Cloud Shell Bash:** `cd ~/campuspool-vault-setup && git pull --ff-only && bash ops/cloud-backup/azure-vault-rbac-readonly-audit.sh`. Expected ideal `GHCR_READER_EXISTING_ROLE_ASSIGNMENTS=0`, `AZURE_CONTAINER_APPS_JOB_COUNT=0`, `READY_FOR_SEPARATE_SECRET_SCOPE_RBAC_DESIGN=YES`. Do not assume these until user supplies output. Subsequent secret-specific grants and custom no-delete Blob role need separate review; no Vault-wide reader, database export or schedule authorized.


## Owner Azure Vault RBAC audit clean; operator access check next — 2026-11-07 IST

- Live Azure Cloud Shell read-only RBAC audit **passed**: correct subscription/RG/region, RBAC purge-protected Key Vault, UAI, private anonymous Blob setting and existing container all verified. **No role assignments returned for GHCR Vault reader** and **zero Container Apps Jobs**. Exact observed `GHCR_READER_EXISTING_ROLE_ASSIGNMENTS=0`, `AZURE_CONTAINER_APPS_JOB_COUNT=0`, `READY_FOR_SEPARATE_SECRET_SCOPE_RBAC_DESIGN=YES`.
- Prepared separate **read-only human operator role check** `ops/cloud-backup/azure-vault-operator-role-readonly.sh`, mock tests and CI. It queries signed-in Entra identity and Vault-scope RBAC including inherited/groups but emits counts/boolean candidate flags only; no secret data, user IDs, tokens or role changes. Role flags do **not** guarantee effective privilege. [Review and implementation plan](../../docs/ops/AZURE_OPERATOR_VAULT_ROLE_PREFLIGHT_2026-11-07.md).
- Operator next `git pull --ff-only` in `~/campuspool-vault-setup`, then `bash ops/cloud-backup/azure-vault-operator-role-readonly.sh`. No secure GHCR pull token or secret imported; don't generate a `read:packages` token until narrow protected ingestion and short-lived operator secret-writer approvals are complete. GHCR reader may later get `Key Vault Secrets User` at the two **individual** secret scopes, never Vault-wide and never staging PostgreSQL password.


## Vault operator role audit diagnosis and repaired read-only command — 2026-11-07 IST
- Owner-run previous operator audit returned `STOP_OPERATOR_ROLE_ENUMERATION_DENIED` after already verifying subscription, login and RBAC Vault, **with no Azure writes**. The command combined `--assignee-object-id` with `--include-groups`; the source of denial may be CLI/Graph or ARM role-read permissions. Do not claim privilege denial without isolating calls.
- Patched same script in PR #44 to split read-only direct `--assignee-object-id` listing from optional Graph-backed `--assignee ... --include-groups`, parse multiline JSON, explicitly state `AUDIT_LIMITATION=GROUP_INHERITED_PERMISSION_NOT_VERIFIED` if needed, and hard stop on direct-list failure. Mock CI tests passed. Operator to `git pull --ff-only` then rerun. Do NOT change IAM or inject tokens to pass an audit.


## Graph principal-name default diagnosed in Azure role list — 2026-11-07 IST
- Second owner-run operator-role audit returned `STOP_OPERATOR_DIRECT_ROLE_LOOKUP_FAILED`; repeated `--assignee-object-id` direct query did not establish operator role eligibility. **No mutations**. Microsoft official CLI docs confirmed `--fill-principal-name` defaults to `true` and invokes Microsoft Graph to enrich role results, even with `--assignee-object-id`, which can fail under restricted Graph permissions.
- Fixed script with `--fill-principal-name false` on direct and optional group queries; updated mock Azure CLI tests to fail if omitted; added sanitized fixed-category output if the direct call still fails. Repo CI `mocked-operator-roles` green. **Not yet verified in real Azure**.
- Operator rerun `git pull --ff-only` and `bash ops/cloud-backup/azure-vault-operator-role-readonly.sh`; share only `ROLE_LOOKUP_ERROR_CATEGORY` and other summarized lines. No custom/broad IAM role changes, PAT import or staging database backup until operator access and individual-secret permission design reviewed.


## Owner operator role audit CLI option unsupported; ARM REST next — 2026-11-07 IST

- Third owner-run role audit still stopped `ROLE_LOOKUP_ERROR_CATEGORY=UNCLASSIFIED`, `STOP_OPERATOR_DIRECT_ROLE_LOOKUP_FAILED`. Verified Azure CLI docs: `--assignee-object-id` is only documented for `az role assignment create`, not for `az role assignment list`, explaining why the previous source's list call remained broken regardless of `--fill-principal-name false`.
- New read-only Python Azure ARM REST audit `scripts/azure-vault-operator-arm-readonly.py` uses `GET {vaultId}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=atScope()` through `az rest`, filters signed-in operator GUID **internally**, optionally resolves direct-role definitions via REST, exposes only categorical potential admin/secret writer flags and counts. Group/deny/PIM/custom/condition access not proven; no assumptions of authorization from role candidates. Existing Bash entrypoint delegates to Python. [Official REST API](https://learn.microsoft.com/en-us/rest/api/authorization/role-assignments/list-for-scope?view=rest-authorization-2022-04-01).
- Offline mock tests for unauthorized ARM, pagination, ID sanitization, zero/direct role handling passed in GitHub CI. **No live REST result yet**. Next owner Cloud Shell `git pull --ff-only`, `bash ops/cloud-backup/azure-vault-operator-role-readonly.sh`; share only sanitized output. No broad roles, secret import or backup execution.


## Success: real Azure owner-role ARM audit; plan-only temp writer grant next — 2026-11-07 IST
- Owner's real `az rest` Vault operator role audit PASSED. One direct role with potential permission administration (YES), no direct built-in Secrets Officer or Vault Administrator observed (`DIRECT_SECRET_WRITER_CANDIDATE=NO_OR_UNKNOWN`); **not sufficient to assert effective rights**, including group/PIM/deny/custom role scope.
- Plan reviewed reversible Azure ARM REST `Key Vault Secrets Officer` short-lived manual grant for operator at exactly `campuspool-backup-kv-01` Vault resource (not RG/subscription) to allow authorized secret creation. Script `scripts/azure-vault-temporary-operator-secrets-officer.py` implements read-only `--plan`, explicitly confirmed `--grant`, then explicitly confirmed `--revoke` of only the deterministic helper-owned assignment. It has **no automatic expiration**; role permits all secret operations within Vault until manual revocation. Mocked tests and CI passed. [Owner runbook](../../docs/ops/AZURE_VAULT_TEMP_OPERATOR_WRITER_2026-11-07.md).
- **Next run ONLY `--plan`** after `git pull --ff-only`. No Azure IAM assignment has yet been created, no GHCR `read:packages` PAT created, no secret imported. Dedicated GHCR/CA UAI remains without read permissions. Strict later permission scopes: `ghcr-pull-token` + `staging-pg-root-ca` at individual secret scope to UAI; staging PG password only to future job-specific identity. No backup until separate approval, first genuine AGE encrypted Blob upload and independent PG17/PostGIS cold restore.


## Owner temporary Vault operator plan passed, protected GHCR token import prepared — 2026-11-10

- Owner's live `--plan` for human Vault-only Secrets Officer returned `ROLE_PLAN_COMPLETE=YES`, `TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=NO`, `OWNER_ACTION=PLAN_ONLY_NO_AZURE_WRITES`. **Never claim the actual grant, GHCR token or backup job exists yet.**
- New [single-command reviewed GHCR Vault import](../../scripts/azure-vault-ghcr-token-one-shot-import.py), [mock failure tests](../../test_azure_vault_ghcr_one_shot_import.py) and [runbook](../../docs/ops/AZURE_GHCR_ONE_SHOT_SECRET_IMPORT_2026-11-10.md). Requires explicit owner phrase, hidden in-terminal classic `read:packages` token, pinned Key Vault REST, no shell-history/env/disk token, aborts if secret already exists and auto-attempts manual helper-owned role cleanup via `finally` with RBAC readback. **Not crash-proof**; after role cleanup STOP, run standalone `--plan` and `--revoke` and do not continue until absent.
- Next owner Cloud Shell `git pull --ff-only` from checkout then `python3 scripts/azure-vault-ghcr-token-one-shot-import.py --run-once`, only if consciously accepting transient whole-Vault Secrets Officer ability; token may be generated immediately before import privately with ONLY classic `read:packages` (GitHub read permission), and is never sent to chat. Need observe `ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES` before applying specific UAI read grants; no UAI permissions or backup data export yet.


## November 10, 2026: release zlib source provenance check FAILED (not waived)

- On current PR #44 draft head after GHCR one-shot credential-import preparation, GitHub Actions `zlib-source-provenance` failed with `ZLIB_PROVENANCE_BLOCKED SOURCE_HTTP_STATUS_INVALID` while `scripts/verify-alpine-zlib-patch.js` fetched Alpine 3.23 stable source `APKBUILD` and `CVE-2026-85091.patch` from `raw.githubusercontent.com`. Its source checks deliberately require HTTP 200, fixed SHA-512, and exact patch semantics. One isolated retry of the failed job **also failed**. **Do not bypass or weaken this security gate**; investigate upstream resource availability / changed URL or packaging in a separate reviewed change before any worker release.
- The distinct `mocked-operator-roles` CI job including one-shot GHCR token-import failure/revoke tests **passed**. The zlib failure is not evidence of a GHCR token import regression but blocks overall release signoff. No Azure role or secret import has been run by the agent.


## November 10 2026 — first live GHCR secret import blocked; writer cleanup verified

- User ran `python3 scripts/azure-vault-ghcr-token-one-shot-import.py --run-once` in real Azure Cloud Shell after explicitly authorizing the temporary Vault-only role and entering a hidden classic GHCR `read:packages` token. Observed `VAULT_SCOPE_AND_OPERATOR_VERIFIED=YES`, `TEMP_WRITER_INITIAL_STATUS=ABSENT`, `TEMP_VAULT_WRITER_GRANT_ACCEPTED=YES`, **`TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES`**, then `STOP_VAULT_ACCESS_DENIED_OR_PROPAGATION`. Failure happened during Key Vault **metadata GET before any secret PUT**, so the token **was NOT imported**. The temporary operator assignment is confirmed removed via ARM readback. No token value was transmitted to chat. Treat the unused GitHub PAT as subject to revocation unless a securely stored controlled retry is intended.
- Microsoft Key Vault guidance documents role propagation 1–5 min and immediate 403 after assignment; actual cause not proven (firewall may also return 403). Updated importer to **retry only metadata GET for explicit `ForbiddenByRbac`**, bounded 16 attempts / 20 sec gaps; distinguish `ForbiddenByFirewall` and unclassified 403 with immediate stop, never print raw errors, never retry secret PUT, always attempt exact temporary role cleanup (except hard process failure). Offline mock CI now covers RBAC retry success, timeout, firewall denial and exact cleanup. [Runbook](../ops/AZURE_GHCR_ONE_SHOT_SECRET_IMPORT_2026-11-10.md). **Corrected importer has not yet been run in live Azure.**
- **Next owner action:** after `git pull --ff-only`, rerun standalone `python3 scripts/azure-vault-temporary-operator-secrets-officer.py --plan` and confirm `TEMP_SECRET_WRITER_MANAGED_ASSIGNMENT_PRESENT=NO`; only after consciously accepting temporary role and creating/reusing secure classic `read:packages` PAT run updated one-shot import with typed approval. On any STOP immediately check `--plan`/`--revoke`; verify `GHCR_PULL_TOKEN_IMPORTED_TO_KEY_VAULT=YES` and `TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES` before other work. Worker release `zlib-source-provenance` gate still failed, production export/backup/restore blocked.


## Owner GHCR Vault import PASS, next UAI single-secret reader PLAN; zlib source fixed — Nov 10

- Owner's one-shot GHCR PAT import succeeded in real Azure: `GHCR_PULL_TOKEN_IMPORTED_TO_KEY_VAULT=YES`, `TEMP_VAULT_WRITER_REVOKED_AND_READBACK_VERIFIED=YES`, `ONE_SHOT_GHCR_IMPORT_AND_ROLE_REVOCATION_PASS=YES`. **Human temporary Secrets Officer permission absent; GHCR token scope not independently tested.** No GHCR managed identity role granted, no database credentials accessed, no jobs created.
- Next **read-only** Cloud Shell action: `cd ~/campuspool-vault-setup && git pull --ff-only && python3 scripts/azure-ghcr-secret-scope-rbac-plan.py --plan`. This verifies exact UAI/principal, secret metadata and inherited role inventory, emitting only static markers and stopping on changes/denials. If PASS, owner may separately authorize an exact secret-scoped built-in `Key Vault Secrets User` grant; **not** a Vault-wide role. [Runbook](../../docs/ops/AZURE_GHCR_SECRET_SCOPE_RBAC_PLAN_2026-11-10.md).
- Separate failing zlib-source-provenance check explained by upstream Alpine switch to `zlib-1.4-r0` and deletion of obsolete `CVE-2026-85091.patch`. Strict upgraded upstream source/sha checks replaced obsolete patch assertions. GitHub source-provenance CI PASS. No image security scan waiver or actual runtime deployment. Full restore gates remain pending.
