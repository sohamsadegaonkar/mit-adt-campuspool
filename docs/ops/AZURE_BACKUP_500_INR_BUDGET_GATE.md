# CampusPool Azure staging backup — ₹500 total monthly cost review gate

**Date:** 2026-11-06 IST. **Status:** source-only design and implementation, no Azure billing access or provisioning. **Owner decision:** maximum **₹500 INR/month aggregate** backup-infrastructure consumption; quality/recovery/security must not be compromised.

## Why this gate exists

The proposed registry, Key Vault, existing private Blob storage, manual-only Container Apps job and privacy-safe logs may together exceed ₹500. ACR Basic has an ongoing price even when unused. Azure's [Cost Management budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets) **notify** rather than stopping resources. The [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) gives reference prices but not the exact owner subscription's taxes, credits or negotiated billing. **Never represent an estimate or a GitHub CI check as guaranteed billing enforcement.**

## Implemented in [draft PR #41](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/41)

- `scripts/check-azure-backup-budget.js` is a **local, offline** JSON quote reviewer. It has no Azure SDK dependency, does not call cloud endpoints, and cannot create, start, stop or mutate anything.
- `ops/cloud-backup/azure-cost-review.template.json` intentionally has **null prices and unconfirmed scope**. It is required to fail until prices and evidence are obtained through an owner-approved read-only Cloud Shell / Pricing Calculator review.
- `test_azure_backup_budget.js` includes synthetic tests for missing costs, stale evidence, invalid currencies/regions, 30-day forecasts, tax and FX omission, exceeding the cap and misuse of student credit, and guarantees **provisioningAuthorized=false even for an under-budget scenario**.
- `.github/workflows/azure-backup-budget-review-ci.yml` runs those tests and verifies the empty template remains BLOCKED, with **no cloud credentials**.

### Input contract

Create a **private** JSON copy of the template, not a repo commit. Fill every category with the **worst-case 31-day INR upper bound**, the official pricing source URL, dated quote evidence ID, and assumptions (for example, job executions, log ingestion, encrypted backup retention and regional transfer). Do not put personal information, account IDs, billing screenshots, payment details, secrets, student data or endpoints in Git.

The categories are:

| Category | Must cover |
| --- | --- |
| `image_registry` | ACR Basic standing 31-day charge or securely reviewed alternative, storage and pull/push/egress costs |
| `key_vault` | Standard vault secret reads, secret/operation prices, encryption key-related cost if any |
| `container_job` | Monthly maximum manual executions, CPU/memory runtime, subscription-shared free grant exhaustion |
| `blob_storage` | Existing private ciphertext storage + redundancy, retention, versioning/immutability |
| `blob_transactions` | Upload, readback, download/recovery test, lifecycle/restore operations |
| `monitoring_and_alerts` | Safe logs, ingestion, retention, alerts; never remove required monitoring to save money |
| `network_and_egress` | Cross-region/provider/network/restore transfers and potential private networking |
| `existing_backup_charges` | Existing resource allocations and dependent backup-related charges in the same billing scope |
| `taxes_and_fx` | Applicable taxes, FX buffer, charge/tax policy and 31-day forecast adjustments |

Then add **contingency** of at least **15% of itemized charges or ₹50, whichever is greater**. A successful cost calculation requires the entire 31-day upper bound **including this reserve** to remain at or below ₹500. **Student credits are not deducted from consumption** when testing this budget.

Run privately (no remote Azure calls):

```bash
node scripts/check-azure-backup-budget.js /secure/path/to/owner-verified-azure-quote.json
```

The checker emits `BLOCKED` for unknown or excessive cost, or `COST_REVIEW_ELIGIBLE` for complete in-range evidence. Both **always** include `provisioningAuthorized:false`. A nominal `COST_REVIEW_ELIGIBLE` is **not proof of an authentic quote**; an authorized owner must independently inspect source screenshots/exports privately and approve every tier/IAM/network/security tradeoff. The checker does not create Azure Cost Management alerts.

## Mandatory quality and release gates

1. Read-only owner Cloud Shell [inventory preflight](../../ops/cloud-backup/azure-readonly-preflight.sh), verify current student subscription/remaining credit, region and existing cost scope, using owner login rather than pasted IDs.
2. Capture current official subscription-specific quote from the [Azure calculator](https://azure.microsoft.com/en-us/pricing/calculator/) and, if needed, corroborate public meter reference with the [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). Include 31-day standing charges, taxes and all categories. If a vendor price cannot be verified, status is **BLOCKED**, not a guessed zero.
3. If authenticated ACR Basic consumes the cap, evaluate a **private** or separately authorized **public, secret-free** GHCR image using the **same** immutable digest verification, Sigstore release signer identity and operational availability review. Do not change package visibility silently. If no secure option fits the owner budget, stop and request a new decision rather than degrade reliability/security.
4. After review and resource/IAM approval, create a **budget alert** at ₹250, ₹400 and ₹500 where billing scope/currency supports it; confirm delivery to the owner. These alerts **do not enforce** spending. Manual 80% projected-cost review and discretionary job freeze are operator controls.
5. No real backup jobs or data access until a separate security signoff: PRs #38–#40, privileged staging-only TLS verification, job secret mount with owner-only tmpfs PGPASSFILE, non-delete Blob scope, AGE ciphertext format, independent encrypted download/decrypt/PG17/PostGIS cold restore and Render rollback evidence. [Security review](CLOUD_BACKUP_INDEPENDENT_SECURITY_REVIEW_2026-11-05.md) and [recovery acceptance PR #37](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/37).

**Current outcome: UNKNOWN COST → BLOCKED.** No Azure resources, IAM roles, budgets, secrets or jobs have been created or changed. No staging or production data accessed.
