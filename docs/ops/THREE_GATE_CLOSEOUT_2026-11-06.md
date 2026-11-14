# CampusPool — three release gates: authenticated Azure cost, private GHCR image, and real staging recovery

**Date:** 2026-11-06 (Asia/Kolkata)  
**Scope:** owner's explicit request to close all three gates without disguising unverified steps.  
**Decision:** **NO-GO pending owner-account and independent recovery evidence.** This is a factual execution checkpoint, not an account-billing or restoration claim. Never paste secrets, student data, billing IDs or private ciphertext into Git or chat.

## Gate 1 — owner Azure for Students: actual cost and next 31 days

**Current:** No authenticated Azure subscription Cost Management connection in the available integrations. No Azure CLI logged into the owner's subscription in this agent runtime. Azure public retail estimates are **not the account's bill**. The previous read-only MTD helper was not executed; the current owner-only 31-day version likewise remains **unexecuted** until run by the authenticated operator.

- New read-only Cloud Shell collector: `ops/cloud-backup/azure-31day-owner-readonly.sh`.
- It confirms the selected subscription is **Azure for Students**, checks resource group `campuspool-backup-rg`, and uses Azure Cost Management **Usage** (trailing 31 UTC days) and **Forecast** (next 31 full UTC days). It writes temporary raw JSON with owner-only permissions and removes it. Only sanitized service totals and INR appear in stdout.
- `scripts/azure_31day_cost_evidence.py` validates schema, INR currency, pagination, nonnegative numeric values, forecast statuses, and unknown/missing charges. It never prints original API objects or account IDs. It always reports `budget_pass:false`, because the vendor's forecast does **not** include yet-unprovisioned resources or taxes, other resource groups, package availability and owner spending signoff.
- Existing `scripts/check-azure-backup-budget.js` remains the separate **31-day worst-case, tax/FX, service line-item, 15%/₹50 contingency** reviewer. It requires private evidence for each component and a manually approved quote. It does not authorize resources.
- Previous public Malaysia West ACR Basic rate was **₹15.8651/day**, or **₹491.82 for 31 days before tax**. Private GHCR remains the preferred review candidate because ACR alone cannot meet the ₹500 total cap with contingency and services. Recheck this rate at the actual future ACR launch.

**Owner-only next evidence:** After opening Azure Cloud Shell authenticated in the correct **Azure for Students** subscription and checking billing visibility, run from the reviewed repository checkout:

```bash
bash ops/cloud-backup/azure-31day-owner-readonly.sh
```

Save output privately; review every cost line and source of forecast, and add the new worker, any Vault, logs, retention, network/egress, taxes and reserve to a **private** quote that passes the offline gate. If the API denies billing access or the forecast is missing, mark **UNKNOWN / BLOCKED** rather than zero. **A 31-day forecast is not a 31-day actual invoice.** No Azure resource creation, identities or job execution until owner-approved aggregate cap is documented.

## Gate 2 — independent security and GHCR worker

- Repo source chain remains **draft/open/unmerged**: PR [#38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38) OS/library image hardening → [#39](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/39) managed-identity Key Vault to tmpfs password file → [#40](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/40) fail-closed AGE/TLS/secret tests → [#41](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/41) ₹500 fail-closed cost → [#42](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/42) private GHCR Bicep → [#43](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/43) GHCR default/ACR future.
- Latest #43 head before this task: `542ccfb0425621bb2c9559adcae6e07164b82d95`, **8/8 GitHub checks green**. This includes worker image build, OS CVE scan, dependency supply-chain review, managed identity tests, zlib provenance, source/Bicep portability review, OTP tests, and a **signed review OCI archive** (NOT a published GHCR image manifest).
- **Independent PR approvals:** GitHub returned **no submitted reviews** on PRs #38–#43 at this checkpoint. The manual reviewer must review as-built code, signing workflow identity, Vault bootstrap, data-path guards, restore scope and image-pull token storage.
- **Unverified live controls:** GHCR container package has not been attested private with the exact final signed published manifest digest; no scoped read-only pull credential was verified in Key Vault; Azure user-assigned Vault reader, system-assigned Blob/data principal, no-delete storage role, job-starter scope, CA Secret volume, `/dev/shm` and target registry pull were not authenticated. **Do not claim these are verified from Bicep compilation or synthetic tests.**
- The approved image should be built once, OS/library scanned at the **exact pushed digest**, published **private**, signed with a trusted release GitHub OIDC identity, then independently verified by digest plus certificate identity. GHCR token limited to package read and Vault Get only; image must never be publicly exposed for convenience.
- **No registry publication, Azure resource provisioning, IAM, secrets or job change was performed here.**

## Gate 3 — real offsite encrypted staging backup and separate recovery

Source Supabase staging `campuspool-staging-db` read-only metadata (2026-11-06):
- **ACTIVE_HEALTHY**, PostgreSQL **17.11**, PostGIS extension **3.3.7**.
- Within `public` + `supabase_migrations`: **10 tables**, **9** with RLS on, **9** RLS policies, **7** migration-ledger rows, staging role `campuspool_staging_app` exists, nine matching backend access policies. Source policy/flag **metadata fingerprint**: `02300c7afe89d67a41576d6c207802e4`. Supabase `list_tables` reported the nine public application tables had zero rows at inspection time.
- Supabase-managed `auth` schema contained **27** internal tables not covered by the current worker `pg_dump --schema=public --schema=supabase_migrations`; acceptance must explicitly address this exclusion and all roles/privileges not in the dump. The system-managed `supabase_migrations.schema_migrations` does not use application RLS.
- Security advisor returned no notices. This is **schema-only evidence**, not a `pg_dump`, AGE encryption, verified remote ciphertext, a recovery identity or a cold restore. It does not prove recoverability.

**Required real operator sequence (never fake):**
1. Verify under owner review: subscription cost, private GHCR image signing/pull, Key Vault and scoped IAM, root CA and actual Container Apps tmpfs mount; no live action if any failed.
2. Separately authorize a staging-only `--check-tls` handshake with `PGSSLMODE=verify-full` and CA, no student-row retrieval.
3. Authorize one manual-only `--execute` cloud backup with `AZURE_EXPORT_APPROVED=YES`, no plaintext persistent dump, secret-free logs, `pg_dump` PGDMP guard, AGE public-recipient stream, Blob put **if absent**, full remote ciphertext SHA-256 readback and retained immutable evidence.
4. Using a **different authorized recovery identity**, independently retrieve encrypted ciphertext, compare SHA-256, decrypt AGE with private key only on an **encrypted, isolated** recovery system, perform `pg_restore` into fresh PG17/PostGIS, and validate migration ledger, table content snapshot digests, app roles, grants, RLS/policies, extensions and private auth smoke. Source read-only metadata hashes can be compared only against the *same consistent snapshot* (not a later mutable source).
5. Confirm staging Render retained rollback build and compatible database rollback plan. Production and migration 008 stay blocked until independent acceptance.

Existing older approximately 200-byte Blob is **not a restorable PostgreSQL archive**. No real offsite ciphertext backup or independent restore has been verified, so the recovery gate remains **NO-GO**. Avoid the previously identified plaintext WSL local-export route and the unencrypted host drives.

### Authoritative links

- [Owner ₹500 cost gate](AZURE_BACKUP_500_INR_BUDGET_GATE.md)
- [Private GHCR job review](AZURE_MALAYSIAWEST_PRIVATE_GHCR_DEPLOYMENT_REVIEW_2026-11-06.md)
- [Independent security report](CLOUD_BACKUP_INDEPENDENT_SECURITY_REVIEW_2026-11-05.md)
- [Registry-neutral ACR transition](AZURE_BACKUP_GHCR_ACR_TRANSITION.md)
- [Draft independent recovery evidence template, PR #37](https://github.com/sohamsadegaonkar/mit-adt-campuspool/blob/ops/recovery-gate-evidence-audit-2026-11-05/docs/ops/RECOVERY_EVIDENCE_MANIFEST.md)

**Do not close a gate because code passed CI; each needs authenticated external evidence and distinct human signoff.**
