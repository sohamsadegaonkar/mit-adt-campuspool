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
