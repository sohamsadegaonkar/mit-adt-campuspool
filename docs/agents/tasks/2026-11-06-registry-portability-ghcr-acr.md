# Agent task — GHCR-default, ACR-ready Azure backup image pull

**Date:** 2026-11-06 IST. **Status:** source-only draft; CI and human review pending. **Base:** draft PR #42 `ops/azure-private-ghcr-deployment-review-2026-11-06`. **Branch:** `ops/azure-ghcr-acr-portability-review-2026-11-06`.

## Decision and constraints

- User agreed to **keep private GHCR now** and consider **ACR only at full-scale launch**, while minimizing migration code changes. This does not approve an Azure resource, paid ACR tier, any IAM role assignment, automatic backup scheduling, or deployment.
- Current aggregate Azure staging-backup ceiling is **₹500/month including tax and contingency**. It is an approval maximum, not a hard Azure spending cap. A future ACR launch needs fresh subscription pricing and separate owner sign-off.
- Existing preproduction backup reliability, staging TLS and independent PG17/PostGIS cold recovery remain **NO-GO**. OTP/Render stays separate.

## Deliverables

- New review-only portable Container Apps Job Bicep; one shared worker and manual-only job, with provider `ghcr` default or `acr`, digest-pinned images, GHCR Vault token isolated to GHCR branch and user-assigned ACR pull identity isolated to ACR branch.
- Independent source and compiled ARM checks, mode transition preflight and negative tests.
- Operational handoff: [GHCR → ACR migration runbook](../../ops/AZURE_BACKUP_GHCR_ACR_TRANSITION.md).

## Verification and next agent actions

1. Confirm **new PR head** and all new CI checks. Fix code/test/ARM compile failures at exact commit; never assume a previous SHA's green checks cover subsequent commits.
2. Verify no data-path drift against `ops/cloud-backup/containerapp-job.private-ghcr.review.bicep`: same one worker, args, environment, PG TLS and root CA, credentials, Blob target, managed identities, timeout, compute and retry policy.
3. Independent reviewer must examine ACR ABAC repository reader vs non-ABAC AcrPull role, whether a second user-assigned identity can be bound to an existing Container Apps Job, registry name/network/private endpoint requirements and exact *published* signed digest. All identities and the GHCR rollback package require cost/security review.
4. Do **not** merge stacked review PRs or deploy real Azure work until separately authorized. Preserve the existing GHCR implementation, neither publish images nor start any daily schedule.

**Never store tokens, private database URLs, AGE private identities, invoices or student data in the repo.** Review-only scripts and CI have no Azure credentials.
