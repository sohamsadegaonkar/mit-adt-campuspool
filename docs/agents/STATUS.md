# CampusPool — current engineering status

**Last independently checked:** 2026-11-03 (UTC). **GitHub baseline:** `main@3ee1f4a12e984cb6aecbf8ea09150d1e79556c87`. This snapshot records verified main and deployment baseline; pending branch work is explicitly described as unmerged.

**Overall:** secure backend foundations and PostGIS mobility matching are developed; production migration and student-facing launch are **NOT APPROVED**. A passing CI test is not evidence of a deployed feature.

## State matrix

| Area | Code and automated tests | Deployment / operational truth | Remaining gap |
|---|---|---|---|
| Node backend + existing single-page UI | On `main`, Node.js HTTP service, static HTML/CSS/JS | Production Render still runs an older build | No production release of latest source |
| Secret hygiene + hardening | Consolidated in `main`; current hygiene CI green | Historic public Git commits remain; revocation not verified | Account owner must confirm Gmail App Password revocation and rotated OTP secret |
| PostgreSQL OTP, sessions and identity | Implemented, tested against isolated Postgres in CI | Staging PostgreSQL configuration exists | Real controlled email/SMS OTP end-to-end delivery not verified |
| PostgreSQL Rides and bookings | Implemented and CI-tested behind `RIDES_BACKEND=postgres` | Production still on legacy SQLite behavior; no audited migration | Backup/restore, reconciled data import, rollout/rollback |
| Hyperlocal travel-intent matching | PostGIS, private intent/geometry, indexed radius/time search and API tests in `main` | Staging-only feature flag documented; no production activation | Student UI, real road-routing/detour checks, privacy/retention review |
| Authenticated domain request idempotency | **Unmerged branch** `security/transactional-idempotency-2026-11-03`: atomic SQL receipts for ride/booking/intent create and cancel in PG/SQLite; bounded throttled-replay recovery tested in isolated SQLite and PG/PostGIS CI at implementation `282df2c`; independent review pending | Staging Supabase was read-only audited: 008 absent, no deployment of this branch verified | Verify CI and plan staging-only migration before promotion; OTP/provider/GPS/payment are separate semantics |
| Errands marketplace | Standalone responsive demo in `prototypes/campuspool-2/` | No live errands backend or real payment processing | Auth-integrated backend, transactions, fraud/refunds, tested marketplace model |
| Payments and settlements | Unverified client-reported success intentionally blocked | Real provider settlement not enabled | Authorized provider, verified webhooks, reconciliation and compliance approval |
| Redis, H3, Kafka, independent microservices | Not adopted; existing grid/time + PostGIS and PostgreSQL shared limits | No additional infrastructure provisioned for them | Benchmark-driven decision rather than speculative complexity |

## Verified GitHub baseline

- Baseline `main` contains merged multi-agent documentation contract `3ee1f4a12e98`. Draft idempotency [PR #11](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/11) remains **unmerged**. The latest tested implementation is `3c050be` (2026-11-03 UTC), with successful isolated GitHub CI workflow runs 41588934566, 41588934664, 41588934558 and 41588934552. No staging/production deployment was verified from this review.
- Latest underlying application implementation on `main`: `0345b6aeff86` — mobility search rate-limit/cancellation behavior; later docs-only commit `3ee1f4a12e98`.
- Latest PostgreSQL OTP/PostGIS workflow on that commit: **success**; latest credential/secret-hygiene workflow: **success**.
- Root `README.md`, `MOBILITY_MATCHING_ROLLOUT.md`, `RIDES_POSTGRES_ROLLOUT.md` and `PRODUCTION_RELEASE_GATE.md` contain the detailed application notes. Some older runbooks reference closed PR chains and must not be treated as newer evidence.

## Verified Render deployment baseline

- Production: `mit-adt-campuspool`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `63ae5510bbe2` (from 2026-10-31). **Not** the current `main`.
- Staging: `mit-adt-campuspool-staging`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `cceadbf6251f` (from 2026-11-02). **Not** the current `main` SHA.
- This is service/deploy metadata verification; it does **not** by itself prove a particular user flow, provider delivery, migration or database state is healthy today.
- Dedicated staging Supabase PostgreSQL is documented. Do not reuse other application databases or test against production.

## In-progress engineering task

- [Transactional idempotency, 2026-11-03](tasks/2026-11-03-transactional-idempotency.md) — branch-local receipts, API keys and green isolated CI; bounded read-only completed-key replay under the mutation limit was implemented on the feature branch; isolated PostgreSQL/PostGIS and SQLite CI passed on implementation `3c050be`. Excess probes and new keys still receive 429. Not deployed, merged or approved. [Contract](../../IDEMPOTENCY_CONTRACT.md).

## Security and release blockers (must not be silently waived)

1. Confirm historical Gmail App Password was revoked and all exposed signing secrets rotated. Do not assume removing files from latest Git history did this.
2. Verify real Resend/MSG91 delivery with controlled student accounts and no OTP bypasses.
3. Backup, cold-restore test and reconcile legacy SQLite Rides/bookings into a durable production database before switching.
4. Run browser/mobile E2E QA of auth, matched rides, seat contention, cancellation, ownership, CSRF and failure paths.
5. Review location retention, student safety, abuse controls and legal/payment provider requirements.
6. Obtain explicit production release approval, verify deploy SHA, monitor and retain rollback capability.

**Incident/release decision remains: NO-GO until the above are evidenced.**

## How to update this file

For every implementation PR: replace outdated evidence, record new commit SHA and CI, distinguish code vs staging vs production, add/remove blockers based on actual verification and link the relevant `tasks/` record. Do not copy optimistic claims from feature PRs into production columns.

## Staging permissions and browser retry review — 2026-11-03 UTC

- Verified dedicated Supabase project `campuspool-staging-db` (`tnitksrlntrdxbvznxzf`), PostgreSQL 17.11. Migrations 001–007 are recorded; `public.campus_idempotency_keys` from 008 is absent.
- `campuspool_staging_app` LOGIN=true, SUPERUSER=false, BYPASSRLS=false; app role has USAGE but not CREATE on public/extensions schemas. Existing nine app tables have RLS, deny direct anon/authenticated SELECT, and grant backend CRUD. Supabase security advisor returned no findings.
- Exact counts were zero for users, sessions, OTP challenges, rides, bookings, trip intents and ride geo. **This does not prove a restorable backup.**
- Supabase Free lacks automatic daily backups. No secure off-site logical export and independent restore verification exists. Render workspace has not been confirmed for service discovery and the previous staging release SHA/branch/env have not been independently rechecked. **Staging migration and deploy remain NO-GO.**
- Browser recovery across same-tab reload and PostgreSQL role access checks passed isolated CI on `282df2c`: PostGIS #41590954300, security #41590954587, secrets #41590954364, documentation #41590954266. This does not prove live staging behavior.
- See [review task](tasks/2026-11-03-staging-permissions-browser-retry.md) and [staging runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md). No live SQL writes, Render deploys or production modifications were performed.

## New engineering checkpoint — 2026-11-03 (read-only preflight)

The unmerged idempotency branch now includes a **read-only** stage migration preflight (`scripts/staging-migration-preflight.js`) with exact Supabase project allowlist, no DML/DDL, and fail-closed RLS/role checks before or after proposed migration 008. The old `stage1-otp/migrate.js` is unchanged and blindly replays migrations 001–008; do not use it ad hoc on staging. Exact implementation `4d66aa0` passed four isolated CI runs (PostGIS #41595567003, security #41595567015, secrets #41595567125, docs #41595567097). The real staging database has not been changed; no backup, independent restore or Render deployment was performed. See [task](tasks/2026-11-03-staging-migration-preflight.md).

## Release-gate audit — 2026-11-03 UTC

Fresh staging Supabase read-only verification: `tnitksrlntrdxbvznxzf` ACTIVE_HEALTHY, migrations 001–007 only, 008 absent, core users/rides/bookings/intents/sessions all 0, non-bypass staging app role and RLS protected tables; zero security-advisor findings. Render reports one candidate workspace `My Workspace` but it is **not owner-confirmed**; no current Render service/deploy SHA verified. No encrypted live staging backup or independent restore artifact is available via the connected tools. Live migration/rollback remain NO-GO. Branch-local synthetic backup/encrypt/checksum/restore rehearsal added to disposable PostGIS CI; this is not a staging backup. [Handoff](tasks/2026-11-03-staging-backup-restore-gates.md).

## Verified synthetic-only backup/restore CI — 2026-11-03 UTC

Implementation `f59eb8b` on unmerged draft PR #11 passed all GitHub workflows: PostGIS #41597004644 (including encrypted synthetic archive and new logical database restore), security #41597004543, docs #41597004472, and credential hygiene #41597004588. Initial attempts exposed runner PG17/target PG16 restore incompatibility and unavailable apt PG16 client packages; the final check uses bundled PG16 tools inside the disposable PostGIS service container. **Synthetic CI is not an off-site staging backup or a restore of staging data.** Real staging encrypted dump, independent restore, Render workspace/deploy SHA confirmation, migration 008, rollout and rollback remain NOT PERFORMED. [Task](tasks/2026-11-03-staging-backup-restore-gates.md).

## Render staging workspace and rollback baseline — independently verified 2026-11-03 UTC

- Owner explicitly confirmed Render workspace `My Workspace` (`tea-d8sftp7avr4c73fo8pbg`). Connected Render `get_service`, `list_deploys`, `get_deploy` and events confirm staging service `srv-dbjof8fb9u1s73eks0bg`, Node/Singapore, `main` branch, auto-deploy **off**, no configured HTTP health-check path. Production was **not** altered.
- Live successful staging deployment is `dep-dbke9uo8v5cc738cpnd0`, Git SHA `cceadbf6251f70634320e50b8288530ba77513c3` (finished 2026-11-02 19:31:42 UTC). Earlier successfully deployed but deactivated build is `dep-dbkdr5qjnfac738p2heg`, SHA `fe93c6be16b49864571da80c186fbb0577485878`. Both commits independently exist in GitHub.
- For a future new staging deployment, **rollback baseline** is the currently live `cceadbf6251f` artifact. The Dashboard's Rollback option and build retention eligibility have **not** been verified by a rollback attempt; connected Render tools do not expose a rollback action. Render [rollback documentation](https://render.com/docs/rollbacks) states rollback needs the prior build artifact still retained. Render [deployment documentation](https://render.com/docs/deploys) states a specific PR commit SHA can be deployed manually via Dashboard; connected generic `trigger_deploy` would only deploy configured branch `main`, so do not call it for PR #11.
- Actual encrypted off-site staging backup, isolated restore, live migration 008, deployment, browser QA and rollback rehearsal remain **NOT PERFORMED / NO-GO**. The staging synthetic CI backup cannot waive those gates. [Release task](tasks/2026-11-03-staging-backup-restore-gates.md).

## Real staging recovery execution handoff — 2026-11-03 UTC

- Supabase organization is **Free** and staging PostgreSQL **17.11**, migration 008 absent. The connected tools do not expose private database-owner export capabilities, secure off-site storage or independent restore destination, so **actual backup/restore remains blocked**. See the exact operator CLI and metadata comparison queries in [runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md).
- The owner operates the commands locally with secrets held privately; verify an off-site ciphertext SHA-256 after downloading, a successfully decrypted/independently restored Supabase-compatible PG17/PostGIS snapshot and matching table/RLS/grants, and Render retained-build rollback eligibility for `dep-dbke9uo8v5cc738cpnd0`. Only then authorize migration 008/rollout. **Do not treat the CI synthetic PG16 drill or current Render live status as equivalent evidence.**

## Staging encrypted export command — 2026-11-03 UTC (branch-only, not executed)

Draft PR #11 now carries a **private operator-only** `scripts/staging-secure-backup.sh` + `scripts/staging-backup-guard.js`. The export guard refuses non-staging URLs; the shell command explicitly requires `--preflight` or `--execute`, operator-confirmed encrypted local temporary filesystem, off-site mount and age public encryption recipient. All cleartext remains off GitHub; the script has no credentials or live connection in CI. Local safety tests passed (4/4), and all four isolated GitHub workflows passed at `3f723d1` (PostGIS #41602596062, security #41602595899, docs #41602596010, credentials #41602596048). **No actual staging export/restore, stored backup or deployment has occurred.** Check [task](tasks/2026-11-03-secure-backup-operator-tool.md) and [runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md).

## Read-only independent staging restore comparison — 2026-11-03 UTC (branch-only)

- New **unmerged development branch** security/staging-restore-compare-2026-11-03 (based on PR #11) adds scripts/staging-restore-compare.js: an operator-only, two-project, read-only comparison of CampusPool public table metadata, RLS policies, grants, indexes, constraints, relevant roles/extensions, migration version entries and table row counts.
- The tool **rejects staging-to-itself**, unknown or unapproved restore-project identifiers, wrong APP_ENV and URLs lacking required TLS; it enters repeatable-read READ ONLY transactions. It returns releaseReady:false regardless of any matching comparison. Only safe result categories and project refs are printed, not DB URLs, SQL diagnostics or row contents.
- Unit tests use synthetic sources/queries and are hooked into security smoke CI; a separate disposable PostGIS integration test executes the real catalog SQL. Code head a0962f2 passed security workflow #41626504817 and Stage 1 PostgreSQL/PostGIS workflow #41626505003. No actual staging/scratch Supabase databases were accessed by this development step.
- **No change to prior release decision:** the real owner-operated encrypted off-site backup, independently downloaded ciphertext, complete independent actual-stage PG17/PostGIS restore, verified role credentials and Render rollback artifact eligibility remain **NOT VERIFIED / NO-GO**. Matching metadata and row counts do not prove the restored contents. [Task](tasks/2026-11-03-staging-restore-compare.md), [runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md).

## Same-count restore data integrity — unmerged child branch, 2026-11-03 UTC

- The read-only recovery comparison draft PR #12 originally compared metadata and counts only. New **child development branch** security/staging-restore-content-digests-2026-11-03 adds *bounded aggregate SHA-256 row-content fingerprints*, computed entirely in PostgreSQL in the same repeatable-read READ ONLY snapshot and compared in memory without printing the hashes or student records.
- It detects equal-count/different-record discrepancies; at over 25,000 rows/table the script stops safely rather than running an unbounded aggregation. Queries use normalized UTC/datestyles and deterministic C-collation fingerprint ordering. Isolated unit and disposable PostGIS CI validation PASSED at code+docs commit eb9200f8: security smoke #41627772559 and PostgreSQL/PostGIS #41627772557, including an equal-row-count changed-content test. The agent documentation contract only runs automatically for PRs targeting main, so it has not automatically validated this child PR.
- **Not staging proof:** real encrypted off-site staging dump, independent actual-data restore, verified role credentials and retained Render rollback eligibility still **NOT PERFORMED/NO-GO**. Do not deploy, migrate 008 or treat hashes as an authenticated backup. [Task](tasks/2026-11-03-staging-content-integrity.md).

## Independent recovery-check review hardening — 2026-11-03 UTC (unmerged)

- Review of draft PR #13 identified a logic gap: two equally incomplete source/restore evidence objects could previously compare as matching. New branch-local changes validate mandatory sections, row-fingerprint coverage/format and an actually present, nonempty migration ledger; absence on *both* sides now fails closed rather than producing a false match.
- The regression suite adds incomplete/malformed-snapshot cases and a **synthetic localhost-only** migration ledger to disposable PostGIS CI. Both fresh workflows PASSED for hardened code commit `6384a55295f5cf3711771bfa21a175592e0c429f`: security smoke #41629693100 and PostgreSQL/PostGIS #41629693149. No live source/restore connection, migration or deployment performed.
- [Task log](tasks/2026-11-03-staging-content-integrity.md). Real encrypted off-site backup, independent actual-data restore and Render rollback artifact proof remain NO-GO.

## Staging independent backup attempt preflight — 2026-11-04 UTC

- **Live source read-only check:** Supabase project `tnitksrlntrdxbvznxzf` at 2026-11-04 08:15:31 UTC reported PG17.11, 9 CampusPool app tables, 9/9 RLS enabled, restricted `campuspool_staging_app` role, migration 008 absent; existing ledger 001–007. No student records queried or source writes. Two other Supabase projects are unrelated/inactive and no distinct authorized recovery project exists; no new possibly billed service created.
- **Private actual recovery remains NO-GO:** the connected tools do not expose encrypted physical/logical export or an independent off-site archive and scratch import; this assistant cannot reach Ubuntu-D or its private DB credential/mount. No off-site ciphertext, independent re-download, restored PG17/PostGIS dataset or row-content comparison exists. Render rollback artifact eligibility remains unverified.
- **Operator-only backup correction (stacked on PR #13):** `ops/staging-recovery-ledger-2026-11-04` hardens the source-specific five-part AGE-encrypted export to include the required Supabase migration ledger and explicit write-quiescence attestation for sequential dumps; no live operation. [Task/evidence](tasks/2026-11-04-independent-staging-recovery-start.md). Follow the private operator runbook, not GitHub Actions, for real export.

## Azure for Students private Blob backup option — 2026-11-04 UTC (branch only)

- Account owner confirmed creating Azure Storage account `011campuspoolbackup` in Malaysia West on Azure for Students (Standard LRS), resource group `campuspool-backup-rg`, **and creating container `campuspool-staging-backups`**. Both are USER-REPORTED; private ACL, operator network access, Entra Blob Data Contributor RBAC and actual remote resource presence are not yet independently verified.
- **New independent branch** `ops/azure-blob-stream-backup-2026-11-04` (stacked on recovery PR #22, separate from Cloudflare draft PR #25) introduces operator-only pg_dump → AGE → private Azure SDK upload stream and ciphertext SHA-256 readback, Entra CLI authentication with tmpfs cache on unencrypted Windows C:/D:, strict staging account/ref allowlists and mocked no-credential CI. No live data export, cloud provisioning, migration or Render deploy done.
- **Important limitations:** archive includes public + supabase_migrations only and excludes global roles / Supabase-managed objects. Verified cold restore, independent decrypt, role/RLS/permission/data comparison and Rollback remain NO-GO. [Task](tasks/2026-11-04-azure-private-blob-backup.md), [runbook](../ops/AZURE_BLOB_BACKUP.md).

## Azure smoke test passed — Nov 4, 2026 (operator-reported)

- Exact private container `campuspool-staging-backups` was read through `az storage container show --auth-mode login` with `publicAccess:null`. Owner subsequently reports full AGE-encrypted non-student text sample upload, download, ciphertext match, decryption and sample blob deletion, both explicit PASS lines. **No Supabase source queried; no actual database backup attempted.**
- Draft Azure backup PR #26 remains unmerged, with 3/3 automated checks last observed green on pre-smoke documentation commit `d7246237`. Owner-side JavaScript SDK, AGE durable decryption key custody, data transfer review, independent real PG17 restore and Render rollback still unverified. [Task](tasks/2026-11-04-azure-private-blob-backup.md).

## Azure backup local test checkpoint — 2026-11-04 UTC

- Owner reports **6/6 local synthetic Azure backup tests passed** on isolated Ubuntu-D worktree following encrypted Azure sample write/read/decrypt/delete PASS. This is not a real DB backup or restoration.
- Next step is credential-free/local-only `--preflight` using fake sentinel source credentials + age recipient, to verify installed PG17, AGE, Azure CLI, Azure SDK and guarded configuration. Real source credentials, durable AGE key custody and applicable transfer/cost review remain blockers. [Task](tasks/2026-11-04-azure-private-blob-backup.md).

## Azure backup credential-free preflight verified — 2026-11-04 UTC

- Owner reports `AZURE_PREFLIGHT_PASS; no database or blob contacted` on Ubuntu-D with synthetic credentials, after AGE smoke test and 6/6 local synthetic tests. This confirms only installed local tools and source/destination validation; no real PostgreSQL export, actual Azure SDK backup run or independent restore.
- Next gate is a **recoverable AGE identity**: generate key in private tmpfs, encrypt identity with a strong unique passphrase before any local persistent write, verify decrypting a synthetic file through the encrypted identity, and independently save the encrypted key in a separate secure vault. Any plaintext identity in WSL tmpfs may still face WSL swap risk on unencrypted Windows disks; do not claim full disk confidentiality. [Task](tasks/2026-11-04-azure-private-blob-backup.md).

## AGE identity generated, independent custody pending — 2026-11-04 UTC

- Owner reports two **PASS** results for generating permanent AGE recipient and passphrase-encrypting the private identity, followed by successful synthetic decryption on Ubuntu-D. The private identity and passphrase were **not** shared with the agent. A separately stored and retrieved recovery copy is still **NOT VERIFIED**.
- Prior Azure encrypted sample upload/download/delete and 6/6 local mocks, plus credential-free `AZURE_PREFLIGHT_PASS`, were reported successful. Real staging export, independent cold restore, student-data transfer review, and Render rollback remain **NO-GO**. [Azure recovery task](tasks/2026-11-04-azure-private-blob-backup.md).

## Owner reports three final Azure staging recovery steps complete — 2026-11-04 UTC

- Owner reports **independent encrypted AGE identity copy**, **Malaysia staging-data transfer and Azure for Students cost review**, and **actual PostgreSQL staging backup and independent restore** all complete. Evidence is **owner-reported, unverified**; do not overwrite this statement with the outdated "not run" status from earlier checkpoints.
- Current independent read-only observations: Supabase stage `tnitksrlntrdxbvznxzf` healthy with 7 migration entries (008 not observed); no separate newly provisioned recovery project in connected Supabase account (local/different-account recovery still possible). Render staging previous deploy `cceadbf6251f` remains `live`. Azure PR #26 remains **draft/unmerged**.
- Next task: reconcile backup provenance and restored-data verification from owner-side evidence, including ciphertext checksum, actual independent restored target, RLS/grants/roles/migration parity, private-key retrieval and Render rollback eligibility, before any guarded release. Azure backup code covers `public`+`supabase_migrations` only, not complete Supabase-managed recovery. [Task](tasks/2026-11-04-azure-private-blob-backup.md).

## Correction — independent PostgreSQL restore still pending (Nov 4, 2026 UTC)

- Owner clarifies: **independent PostgreSQL restore is remaining, not completed**. This supersedes the preceding owner-reported-complete wording. Owner reported an independent AGE key copy and Malaysia data transfer/cost review complete; staging archive creation was reported but is still not verified with Azure object metadata/checksum in connected tools.
- Current release state remains **NO-GO** until real separate PG17/PostGIS cold restore and table content/migration/RLS/role parity, plus Render rollback eligibility. Source staging remained live; no migration 008 or new Render deployment occurred in agent read-only checks. [Task](tasks/2026-11-04-azure-private-blob-backup.md).
