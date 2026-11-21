# G1 evidence provenance check — offline, NEVER release GO

**21 November 2026.** This check extends the pre-existing 008–014 disposable PostgreSQL/PostGIS recovery drill in [RFC-CP-024](../agents/tasks/2026-11-21-migration-008-014-recovery-gates.md). This is a source-only, no-secret, no-network consistency check for independently collected evidence. It does not retrieve Azure blobs, run Cosign, connect to Supabase, or restore a real database.

## Current read-only evidence and hard blocker

- The manual Azure job `campuspool-staging-backup-job` was operator-read back with worker image `ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:694e39c24b89c91dfea8419ed669a70a9a62cef18d99038a87e84225e5468ce8`.
- The trusted signer identity previously verified a **different** worker: `sha256:35e37da37bb4b7790b5582dc73b7c11aad24068d4040a0b6401034d656698a4c` in [signed-worker run #44886779860](https://github.com/sohamsadegaonkar/campuspool-backup-signer/actions/runs/44886779860).
- [Private verify-only run #44906606631, attempt 2](https://github.com/sohamsadegaonkar/campuspool-backup-signer/actions/runs/44906606631) logs show `CONTROL_SIGNATURE=VERIFIED` and `AZURE_SIGNATURE=NOT_CONFIRMED`, `AZURE_EXIT_CODE=12`, `AZURE_ERROR=REVIEW_REQUIRED` for the exact configured image and expected identity/issuer. This means **no matching signature was verified** for that image/identity, NOT proof of malicious or entirely unsigned content.
- The signed worker image is separately undergoing source-parity/runtime/vulnerability review in [private draft PR #3](https://github.com/sohamsadegaonkar/campuspool-backup-signer/pull/3). That review is not an authorization to repin Azure or run a backup job.
- No independently authenticated, off-site, real encrypted backup version with separate retrieved SHA, independent AGE decrypt, isolated PG17/PostGIS restore, roles/RLS/grants/bookings parity, accepted RPO/RTO or write-freeze plan is verified. **G1 OPEN; staging migrations and production GO blocked.**

## Safe offline self-consistency check

Use `node --test test_recovery_g1_evidence_preflight.js` for synthetic fixtures. For an operator-provided **sanitized** evidence file stored privately and never committed, use:

```bash
node scripts/recovery-g1-evidence-preflight.js --evidence /private/path/sanitized-g1-evidence.json
```

The input is strictly metadata, organized as `provenance`, `archive`, `recovery`, `migration`, `operations`. Never include environment variables, access tokens, usernames, real student records, complete blob URLs with SAS tokens, OTPs, passwords, or raw database/content dumps.

The checker validates fields such as immutable worker digest agreement, signer issuer and identity, manual Azure job trigger, cipher blob checksum/version and >1 KB size, independent recovery operator, separate retrieval checksum, AGE decrypt, isolated `pg_restore`, matching PostgreSQL major, sensitive row-content and role/RLS/grant parity, 007–014 migration ledger/source manifest, application/schema compatibility, rollback rehearsal, freeze/RPO/RTO acceptance and independent review evidence references.

**Its only possible outcomes are** `BLOCKED_G1_EVIDENCE_INCOMPLETE` or `CLAIMS_COMPLETE_EXTERNAL_ATTESTATION_REQUIRED`; `releaseReady:false`, `independentRecoveryVerified:false`, `externalProofChecked:false` in both cases. CLI always exits nonzero to prevent scripts and CI from misreading unverified user-supplied claims as release approval. Real G1 can only be closed by independent authenticated review of the evidence, not by this tool.

## Actual independent recovery acceptance (separate owner approvals)

1. Verify exact Azure job definition image equals independently reviewed and trusted-signed digest; confirm PG17/AGE, CA mount, least privilege, worker provenance and manual job settings. Do not modify the job to match the signed digest without separate approval.
2. Authorize and execute exactly scoped staging-only export when the reviewed backup worker is safe; identify successful execution, unexposed custom PGDMP archive, AGE ciphertext version, nonzero size, hash, no plaintext leakage and secure recipient identity. Previous preflight-only success does not count.
3. Different approved recovery operator/identity retrieves versioned ciphertext independently, checks digest, decrypts outside writer, cold restores into a **new isolated approved PG17/PostGIS target**, validates migration ledger, RLS/roles/grants and equality of authorized snapshot data (active and cancelled bookings, Pending obligations, audit cases/appeals). Report exclusions and anonymized evidence IDs only.
4. Verify rollback eligibility **without destructive DOWN**. A pre-008 backup restored to scratch demonstrates earlier snapshot content, not that a post-014 app can safely run against it. Ensure schema/app SHA compatibility, freeze/reconciliation of any writes after backup, and measured owner-approved RPO/RTO.
5. Obtain independent reviewer and owner GO after resolving outstanding incident/credential handling. Until then migrations 008–014 remain unapproved on live databases.

**This source change does no real Azure/DB/Render writes and sends no real OTP.**
