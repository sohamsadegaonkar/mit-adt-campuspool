# Task: Malaysia West public retail verification and private GHCR backup Job review

**Date:** 2026-11-06 IST. **PR:** [#42](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/42), stacked over [cost gate #41](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/41) → [security #40](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/40) → [Vault bootstrap #39](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/39) → [signed Alpine worker #38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38). **Release:** NO-GO.

## Accepted owner constraints

Quality-first CampusPool 2.0; **₹500/month total Azure staging-backup cost ceiling**, not per-resource, including tax/FX/transfer, logs/alerts, Vault, Blob and a ≥15%/₹50 contingency. No paid resource or public-image visibility changes without explicit permission. No real TLS/DB/backup until independent security/recovery gates pass.

## Verified evidence

- Microsoft [unauthenticated Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) is not an authenticated Azure for Students subscription price sheet. A source-only GitHub Actions runner retrieved official **Malaysia West ACR Basic** `Basic Registry Unit` 1/Day retail meter **₹15.8651/day** and **₹491.82/31-day month before tax**. [Actual run evidence](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42092043338) and archived public rate sample. With ≥15% reserve, ACR Basic *alone* exceeds ₹500. **Retail ACR option fails**, barring a separately evidenced subscription discount that changes the total cost; no ACR created.
- GitHub [container registry current billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages) currently says GHCR container-image storage/bandwidth is free (policy can change), with private packages available. Azure [supports private GHCR image pulls](https://learn.microsoft.com/en-us/azure/container-apps/github-actions) using authentication. **Private GHCR is the preferred review candidate**, not an approved/installed private GHCR package. No visibility changes or credentials created.
- Owner's **actual** Azure for Students bill, credits, subscription-specific negotiated rates, taxes, and existing Blob/log/transfer charges remain **unverified** by ChatGPT; no Azure tenant/billing connector available. Not all remaining services have verified cost ceilings, so full ₹500 requirement **NOT YET MET**.

## Engineering implemented

1. `scripts/azure-malaysiawest-retail-meters.js` (public Microsoft Retail Prices GET only, Malaysia West, INR, bound results and fixed domain), plus `test_azure_malaysiawest_retail_meters.js`; never extrapolates unpriced meters into zero or a subscription cost.
2. `ops/cloud-backup/azure-subscription-cost-readonly.sh` is an **owner-run** Azure Cloud Shell helper that checks subscription name, scope and queries *pre-tax month-to-date* Cost Management totals by service, then prints sanitized amounts (no account/subscription/resource IDs). It uses Azure's documented **read-only Cost Management Query** `POST`. If RBAC/subscription denies it, script fails closed; zero current rows never prove zero future costs.
3. `ops/cloud-backup/containerapp-job.private-ghcr.review.bicep` is a **review-only** single Manual Container Apps Job in the existing environment: 1 replica, 0 retries, 1,800 seconds, 0.5 vCPU/1Gi, preflight default, private GHCR registry pull token **Key Vault reference**, required digest-only image parameter, separate user-assigned Vault-reader and job system identity, PEM CA mount, stage-only PG `verify-full`, AGE public recipient and existing private Blob scope. Does not define Vault/registry/logging/role creation or grant any permission. Bicep compilation in GitHub CI PASS; **not deployed**.
4. `scripts/review-private-ghcr-azure-job.js` and `test_private_ghcr_azure_job_review.js` reject duplicate sensitive job policy keys, unattended execution, cron/ingress, unencrypted PG credentials, missing Vault token and unreviewed resources. Actual pushed manifest digest/signature and identity roles must still be reviewed.
5. [Detailed operation and architecture review](../../ops/AZURE_MALAYSIAWEST_PRIVATE_GHCR_DEPLOYMENT_REVIEW_2026-11-06.md) documents vendor citations, price conflict, GHCR token lifecycle, actual subscription cost check, CA mount symlink caveat, owner approvals and independent cold restore requirements.
6. [CI run 42092043338](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42092043338): **public price + source tests + Bicep compilation PASS**. Subsequent commits require exact final-head CI rerun. No Azure cloud writes occurred.

## Remaining deployment gates (do not silently satisfy)

- Owner checks actual subscription Azure Cost Management + Billing Cost analysis in private, takes 31-day pricing and taxes/FX and remaining credit, fills private cost template, validates with PR #41 check returning `COST_REVIEW_ELIGIBLE` (**never** `provisioningAuthorized`).
- Human security review approves private GHCR credential (scoped read:packages, securely stored, rotation/revocation), job identity/Key Vault scopes and no-delete Blob role, monitoring, signed **pushed** GHCR image manifest digest, plus fallback signed OCI archive outside GHCR. If private GHCR token lifecycle/availability risks unacceptable, stop and reevaluate paid ACR against exact subscription price.
- Owner explicitly approves named resource/IAM changes; existing Malaysia West Consumption environment alone does not authorize Vault, identity or Job creation. Validate actual CA file non-symlink/PEM chain and `/dev/shm` in target Container Apps Job, and logs/costs before any job run.
- Controlled non-data `AZURE_TLS_CHECK_APPROVED=YES --check-tls` after specific approval; separately consent to first real `AZURE_EXPORT_APPROVED=YES --execute`; private encrypted Blob SHA256 readback then independently protected AGE decrypt/PG17/PostGIS cold restore, roles/RLS/data digests/Render rollback verified using recovery evidence PR #37.
- OTP and production migration remain **NO-GO** until genuine backup and independent restore pass, and staging provider testing/rollback are approved.

**No account resources, paid subscriptions, GitHub image visibility, Azure jobs, identities, secrets, real staging connections or exports were changed by this task.**


## Source-only continuation — 2026-11-06 IST

The original template accepted `signedGhcrImageDigest` as an unrestricted entire image reference; the independent `reviewedImageDigest()` test helper did not enforce a parameter constraint at deployment time. The review branch now pins the **GHCR host and exact worker repository** directly in Bicep, exposes only `ghcrImageSha256` as a **length-64** parameter, restricts the test helper to the same repository, and checks the compiled ARM model for a single allowed workload, no init/extra containers, no inline secrets and unchanged Vault/CA/manual-job restrictions. This is source and CI hardening only. Lowercase hex, signer identity and pushed manifest still need operator/human verification. CI on the new head is pending; the earlier run evidence relates to the previous head and cannot approve this one.

**Release gate unchanged:** do not run owner Azure Cost Management query on an agent's behalf, deploy the Bicep file, create GHCR tokens, connect to staging, execute backups, migrate or deploy Render without the separately required cost/security/restore approvals.
