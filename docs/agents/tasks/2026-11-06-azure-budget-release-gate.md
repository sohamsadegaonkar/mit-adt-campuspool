# Agent task — cost-gated Azure backup infrastructure release

**Date:** 2026-11-06 IST. **Branch:** `ops/azure-budget-release-gate-2026-11-06` ([draft PR #41](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/41)). **Stack:** #41 on security #40 → Vault #39 → base image #38. **Status:** source-only, no Azure writes. **Owner budget:** ₹500/month aggregate, all expected charges included.

## Purpose

CampusPool 2.0 owner explicitly requires the lowest **responsible** infrastructure cost, never at the expense of product quality, security, operational monitoring, performance or independently proven recovery. A prior ACR Basic+Key Vault+Blob+logs estimate may exceed the ₹500 ceiling. The next development priority is therefore an auditable **stop/go cost evidence gate before ANY billable Azure provisioning**, not inventing a monthly quote or weakening controls.

## Implementation

- `scripts/check-azure-backup-budget.js`: offline Node.js standard-library-only strict reviewer. Hard-codes 31-day worst-case `malaysiawest` / INR / ₹500 project cap, requires nine complete component categories and dated official Azure evidence for each. Rejects zero-by-omission, missing tax/FX, unverified scope, unpriced line items, stale quotes, unexpected foreign regions and subtracting student credit from consumption totals.
- A minimum **₹50 or 15%** risk margin is included as an allocation inside the ₹500 maximum, not extra spending permission. All amounts checked in integer paise for deterministic totals.
- `ops/cloud-backup/azure-cost-review.template.json` intentionally contains no numbers, dates or owner confirmation. It **must fail** until owner has obtained private, subscription-specific quotes and verified existing charges.
- `test_azure_backup_budget.js` covers synthetic under-budget scenario (cost review eligible only), over-limit, missing/duplicated categories, missing contingency, evidence/scope/credits, amounts in invalid types and stale dates. **Every outcome** has `provisioningAuthorized:false`: no CI pass can grant IAM, launch a job or access data.
- `.github/workflows/azure-backup-budget-review-ci.yml` runs tests and proves the unknown-price template BLOCKS. No Azure CLI, credentials, API calls, recurring schedule or jobs.
- [Operator runbook](../../ops/AZURE_BACKUP_500_INR_BUDGET_GATE.md) includes safe private quote gathering and security-first alternatives. Official sources: [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Cost Management budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets). Budget alerts **do not stop charges**.

## Verification, caveats and next tasks

1. Verify PR #41 exact head CI: all cost tests PASS and empty quote template deliberately BLOCKS; check backup/OTP CI does not regress. Archive no secrets or Azure invoice screenshots to Git.
2. Authorized owner uses existing read-only Azure preflight and subscription pricing calculator privately to obtain current Malaysia West pricing and existing spend, with 31-day usage and tax/FX. Do not assume free grant, a $100 Azure for Students initial credit, or subscription-private pricing without verification. Return **only safe aggregate numbers/evidence IDs**.
3. If secure registry distribution with ACR Basic cannot fit with Key Vault, logs, Blob and margin inside ₹500, compare **private** GHCR or optionally owner-approved public **secret-free** image only after image supply-chain/security/reliability signoff. Never change visibility silently. If no secure design fits, **stop** and seek owner decision rather than dropping safeguards.
4. Explicit independent security reviewer assessment for #38 → #40 (Sigstore final release image digest still not signed in ACR, staging TLS not run, actual Key Vault RBAC missing).
5. After separate owner confirmation of named resource costs/IAM, controlled manual job `--preflight`, stage-only `--check-tls`, then distinct export approval and **actual** AGE encrypted Blob backup / cold independent PG17/PostGIS restore content+RLS+roles migration parity, Render rollback. Maintain OTP deployment/migration NO-GO until recovery evidence is accepted.

**Progress 2026-11-06:** Created offline cost gate, unknown-price template, unit tests, CI, runbook. No Azure resources/budgets/alerts/identities created; no real staging/production database operations.
