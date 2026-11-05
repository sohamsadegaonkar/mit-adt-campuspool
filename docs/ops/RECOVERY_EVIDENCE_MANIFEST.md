# Recovery evidence manifest — staging PG17/AGE/Azure and Render

**Evidence type:** operator-completed release gate, never a generated PASS from code alone.  
**Review date (UTC):** _pending_  
**Environment:** isolated CampusPool staging only; production excluded.  
**Current gate:** **NO-GO** (2026-11-05 verification).

This template tracks **non-secret metadata and signoff only**. Keep credentials, exact host paths, connection strings, access tokens, student data, complete ciphertext, AGE private keys, and screenshots showing private values out of Git and chat. Store confidential proofs in a restricted, approved evidence vault and refer by internal opaque evidence IDs.

## 1. Azure offsite encrypted backup — NOT VERIFIED

| Item | Required independent evidence | Status |
|---|---|---|
| Approved cloud resources | Azure subscription, region/cost authorization and tenant-owned private container attested by authorized reviewer | Pending |
| Protected worker | Manually started Container Apps job, vetted image digest, strict 1 replica/0 retry, managed identity container-scoped RBAC, vault-backed staging credentials, valid CA | Pending |
| Safe source | Source pinned to staging Supabase PG17, correct `public` + `supabase_migrations` scope, `verify-full` TLS, known valid AGE recipient public key | Pending |
| Ciphertext archive | Object exists and is nontrivial AGE ciphertext; precise byte size, sanitized opaque object ID and SHA-256 compared to fully read-back stream | Pending |
| Immutability/retention | Private access; upload does not overwrite prior backup; explicit retention/soft delete policy | Pending |
| Source snapshot | Database logical snapshot timestamp/window and source migration fingerprint; avoid application rows or personal data in evidence | Pending |

**Expected record fields once executed:** execution UTC, approved operator identity reference, source project alias, immutable job/image digest, sanitized blob key, encrypted bytes, ciphertext SHA-256, remote downloaded SHA-256, source snapshot and migration fingerprint, restricted evidence-vault ID. **Never claim backup PASS without actual Azure API readback.**

The previously reported 200-byte blob is **not accepted** as a valid custom-format PostgreSQL archive. Synthetic PG17/AGE tests cannot stand in for actual staging data.

## 2. Independent PG17/PostGIS cold restore — NOT VERIFIED

| Item | Acceptance criterion | Status |
|---|---|---|
| Independent destination | Separate explicitly approved encrypted PG17/PostGIS target, never original staging; isolated access | Pending |
| Independent download | Read ciphertext anew from **private** Azure object using recovery operator's separately scoped identity; SHA-256 equals accepted manifest | Pending |
| AGE decryption | Performed only in protected destination with separate private identity; verify PostgreSQL `PGDMP` custom-format header after decryption | Pending |
| Restore process | `pg_restore` reports no unreviewed errors; roles/extensions/profiles created with minimum grants; no production secrets copied | Pending |
| Schemas/ledger | Restored `public` + `supabase_migrations` migration ledger, expected tables, schema objects, indices and constraints match source snapshot | Pending |
| Privileges/RLS | RLS flags, policies, role memberships, grants and privilege parity compared to approved baseline; no anon/auth table data exposure | Pending |
| Data integrity | Independent content digests and row counts for all included application tables, captured from source's consistent backup snapshot; source/restore equality | Pending |
| Application recovery | Controlled synthetic test account logs in; sessions persist; no real student data copied to uncontrolled environment | Pending |

**Expected record fields:** target environment alias (not endpoint), restore UTC, PostgreSQL major/minor, PostGIS availability, restore exit code, exact migration numbers, table count, policy/privilege checks, consistent snapshot digest reference, mismatch count, isolated test result, restricted vault evidence ID. A source inspection of empty tables alone is not a restore.

## 3. Render rollback eligibility — NOT VERIFIED

| Item | Evidence needed | Status |
|---|---|---|
| Current staging live baseline | `dep-dbke9uo8v5cc738cpnd0` at `cceadbf6251f` (connected Render, 2026-11-05 UTC) | Metadata verified |
| Older staging successful build | `dep-dbkdr5qjnfac738p2heg` at `fe93c6be16b4` | Historical metadata verified |
| Existing build eligible | Owner sees **Rollback** available for intended prior artifact in [Render staging dashboard](https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg), records safe non-secret evidence **without clicking it** | Pending |
| Rollback dependencies | Previous image/npm dependencies and prior environment variables available; database migration compatibility and recovery contract documented | Pending |
| Restoration plan | Separate approved plan for rollback rehearsal and stop criteria, and distinct data-forward/recovery fallback | Pending |

Production currently live `1020e2e4a6d4`, older successful `63ae5510bbe2`; none of this independently proves retained-build eligibility. **Never use `trigger_deploy` as a substitute for a verified Rollback action.**

## 4. Final gate signoff — NOT AUTHORIZED

- [ ] Actual protected cloud-generated staging ciphertext accepted.
- [ ] Azure offsite readback proves ciphertext SHA-256 parity.
- [ ] Independent PG17/PostGIS cold restore passes schema/ledger/RLS/grants/content parity.
- [ ] Existing Render rollback build eligible and safe rollback plan approved.
- [ ] Historical credential incident contained and private security review complete.
- [ ] Separate exact-SHA staging deploy and migration approved by owner.
- [ ] Production release still **separately** blocked pending durable identity/Rides migration and real email/SMS delivery.

**Decision:** `NO-GO` unless every mandatory prerequisite is evidenced and signed off; code CI alone never grants permission.

## Related source and operator references

- [Cloud Azure worker runbook](CLOUD_AZURE_BACKUP_WORKER.md)
- [Azure Blob operator runbook](AZURE_BLOB_BACKUP.md)
- [Recovery gate agent audit](../agents/tasks/2026-11-05-recovery-gate-evidence-audit.md)
- [Existing independent restore comparison](../../scripts/staging-restore-compare.js)
