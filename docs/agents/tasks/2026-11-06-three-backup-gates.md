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
