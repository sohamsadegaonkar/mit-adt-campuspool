# CampusPool — current engineering status

**Last independently checked:** 2026-11-03 (UTC). **GitHub baseline:** `main@0345b6aeff8631cbb2a55d09b9bb745ae4dbb93b`. This snapshot reflects the repository and reported deployment state before the agent-documentation PR; refresh SHA and dates when merging subsequent implementation work.

**Overall:** secure backend foundations and PostGIS mobility matching are developed; production migration and student-facing launch are **NOT APPROVED**. A passing CI test is not evidence of a deployed feature.

## State matrix

| Area | Code and automated tests | Deployment / operational truth | Remaining gap |
|---|---|---|---|
| Node backend + existing single-page UI | On `main`, Node.js HTTP service, static HTML/CSS/JS | Production Render still runs an older build | No production release of latest source |
| Secret hygiene + hardening | Consolidated in `main`; current hygiene CI green | Historic public Git commits remain; revocation not verified | Account owner must confirm Gmail App Password revocation and rotated OTP secret |
| PostgreSQL OTP, sessions and identity | Implemented, tested against isolated Postgres in CI | Staging PostgreSQL configuration exists | Real controlled email/SMS OTP end-to-end delivery not verified |
| PostgreSQL Rides and bookings | Implemented and CI-tested behind `RIDES_BACKEND=postgres` | Production still on legacy SQLite behavior; no audited migration | Backup/restore, reconciled data import, rollout/rollback |
| Hyperlocal travel-intent matching | PostGIS, private intent/geometry, indexed radius/time search and API tests in `main` | Staging-only feature flag documented; no production activation | Student UI, real road-routing/detour checks, privacy/retention review |
| Errands marketplace | Standalone responsive demo in `prototypes/campuspool-2/` | No live errands backend or real payment processing | Auth-integrated backend, transactions, fraud/refunds, tested marketplace model |
| Payments and settlements | Unverified client-reported success intentionally blocked | Real provider settlement not enabled | Authorized provider, verified webhooks, reconciliation and compliance approval |
| Redis, H3, Kafka, independent microservices | Not adopted; existing grid/time + PostGIS and PostgreSQL shared limits | No additional infrastructure provisioned for them | Benchmark-driven decision rather than speculative complexity |

## Verified GitHub baseline

- Single long-lived branch: `main`; no open PRs when checked 2026-11-03.
- Latest implementation commit: `0345b6aeff86` — PostgreSQL mobility search rate-limit/cancellation behavior.
- Latest PostgreSQL OTP/PostGIS workflow on that commit: **success**; latest credential/secret-hygiene workflow: **success**.
- Root `README.md`, `MOBILITY_MATCHING_ROLLOUT.md`, `RIDES_POSTGRES_ROLLOUT.md` and `PRODUCTION_RELEASE_GATE.md` contain the detailed application notes. Some older runbooks reference closed PR chains and must not be treated as newer evidence.

## Verified Render deployment baseline

- Production: `mit-adt-campuspool`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `63ae5510bbe2` (from 2026-10-31). **Not** the current `main`.
- Staging: `mit-adt-campuspool-staging`, branch `main`, **auto-deploy off**. Last observed live deployed SHA `cceadbf6251f` (from 2026-11-02). **Not** the current `main` SHA.
- This is service/deploy metadata verification; it does **not** by itself prove a particular user flow, provider delivery, migration or database state is healthy today.
- Dedicated staging Supabase PostgreSQL is documented. Do not reuse other application databases or test against production.

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

## Independent P1 synthetic PostGIS load development — 2026-11-04 UTC

- **BRANCH ONLY / NOT DEPLOYED:** `perf/mobility-load-baseline-2026-11-04` (from `main@3ee1f4a`) implements a new, isolated benchmark for 128 concurrent student matching requests against 512 deterministic synthetic rides and the existing PostGIS matching store. This is independent of draft UI PR #14 and security PRs #11–13.
- Guardrails: requires `BENCH_DISPOSABLE_DB=YES`, localhost PostgreSQL URL, exact dedicated `campuspool_mobility_bench` DB and backend role, empty benchmark tables (server-side Docker bridge address is not an authorization signal), intact spatial indexes; deletes only uniquely owned synthetic fixtures. No real student data, external network, Render/Supabase writes, production migration, or service changes.
- **Measured synthetic CI PASS** at code SHA `da7063a`, GitHub run #41710272878: 128/128 matching searches over 512 rides (p50 **229.11ms**, p95 **297.87ms**, p99 **300.88ms**, burst rate **423.83/s**), pool max24 and peak waiting queue104; 0 sampled lock waiters; EXPLAIN used the PostGIS dropoff GiST index. Same-account rate bucket contention allowed **30** and denied **5**. Four other workflows (PostGIS/backend, security, credentials, agent docs) passed on the same code SHA. This is single-burst **database-layer** evidence, not a production capacity promise.
- **Release status:** NO-GO unchanged. [Task](tasks/2026-11-04-mobility-load-benchmark.md).

## Live merge and Render release audit — verified 2026-11-03 UTC

- **Main updated safely:** User explicitly asked to merge healthy working branches before Render rollout. PR #15 (disposable PostgreSQL/PostGIS load benchmark only; no runtime server or SQL change) was squash-merged into `main@a76eaca895dc0a4df97d9a2d11e26f97441b9fec`. Main push checks PASS: Stage 1 PostGIS #41712374613, secret hygiene #41712374669, agent docs #41712374540. The benchmark's own five PR checks passed before merge.
- **Unmerged dependency/review blockers:** PR #11 (transactional idempotency + migration 008), child draft PR #12 (restore comparator), grandchild PR #13 (content digests), and draft PR #14 (student-facing UI) remain open. Their CI is green, and #14's 30/30 browser QA passed, but **no independent approving reviews are recorded**. Parent PRs must be integrated in order if ever approved; do not infer a child PR's base is `main`.
- **Current deployment metadata, NOT new release:** Render production `mit-adt-campuspool` live SHA `63ae5510bbe2` and isolated staging `mit-adt-campuspool-staging` live SHA `cceadbf6251f`; both follow `main`, auto-deploy OFF. A successful previous Render deploy record is NOT proof that its retained rollback artifact is still eligible.
- **Staging database:** connected Supabase PG17.11 reports `ACTIVE_HEALTHY`, migrations 001–007 listed, 008 absent, security-advisor currently zero lints. This does NOT establish actual encrypted off-site backup, independent restore, account secret revocation, usable Render rollback or real OTP delivery.
- **Release gate: NO-GO** for staging or production. No Render deploy, live SQL, student-data reads/copies, secrets, provider settings or payments were changed during this audit. Owner must produce actual staging encrypted backup/independent PG17 restore proof, prior-artifact rollback eligibility and security/provider evidence before a controlled stage deployment. [Exact audit](tasks/2026-11-04-release-merge-audit.md).

## Proposed read-only Render runtime configuration preflight — 2026-11-04

- **Tested in CI on a draft feature branch, not deployed:** `chore/runtime-env-preflight-2026-11-04` based on `main@056cd26` adds a read-only CLI `scripts/check-runtime-config.js` with two explicit profiles: `--target production` validates startup of the **current legacy SQLite** process and `--target staging` checks the PostgreSQL/TLS/private-CA/Resend/staging Basic Auth config. Uses no network calls, no live Render credentials or env mutation. It checks the known-exposed OTP fingerprint and fails short/missing secrets without printing values; status is `CONFIG_CHECKS_PASSED_RELEASE_NOT_APPROVED`, never release GO.
- **Incident addressed by test, not by rollout:** the last attempted production deploy `056cd26` failed at `OTP_SECRET` startup guard; previous `63ae551` still marked live as of last Render check. User reported adding `OTP_SECRET` via **Save only** and updating SMTP settings; content strength, revocation and actual running state **cannot be verified** from masked screenshots.
- **Verified on implementation SHA `33df5499`:** runtime config CI #41792580706 **10/10 PASS**; security #41792580514, secret hygiene #41792580531, PostgreSQL #41792580639, synthetic benchmark #41792580561, and agent docs #41792580707 all PASS. No live Render or provider secrets checked. Existing production launch check `check:release-production` remains completely separate and blocks while real provider delivery, durable PostgreSQL Rides, owner approval, independently restored backup and usable rollback are unverified. [Task](tasks/2026-11-04-runtime-env-preflight.md).

## User-authorized four-step release checkpoint — 2026-11-04 UTC

- **Source merge completed:** read-only Render runtime-preflight PR #18 merged into main as `3561bb54f38a3f5edce4cd17e24267733a196821`. Main's Postgres #41794863177, credential hygiene #41794863065 and agent docs #41794863241 all PASS; the original PR #18 ran six green workflows (10/10 synthetic preflight tests). No application runtime behavior, live secret or Render service was changed.
- **Read-only staging Supabase check completed:** project `tnitksrlntrdxbvznxzf` is healthy on PG17.11; 9/9 application tables enforce RLS, 0 direct SELECT grants to anon/authenticated, backend app role can read 9/9; migration 008 **not applied**; security advisor reported zero current lints. These are metadata checks, not actual recovery evidence.
- **Technical reviews completed, NOT approved for merge/release:** PR #11 (transactional idempotency + migration 008), stacked #12 (restore comparison), #13 (row digests), and #14 (mobility UI) each received a substantive COMMENT review. Their historical CI was green, including #14's 30/30 synthetic browser tests; no independently approved production/staging migration or real device/provider acceptance was evidenced. All four remain unmerged.
- **Staging NO-GO:** no available connector workflow can create, privately download and independently cold-restore the actual encrypted off-site staging backup. No separate restored project or authoritative checksum verdict supplied. Render staging previous deploy `cceadbf` is marked live, but its retained rollback artifact availability cannot be established through the connector. Staging and production were **not deployed or modified**. Production previously failed on `OTP_SECRET`; owner reported Save only, not a new successful rollout.
- **Exact operator handoff:** [Four-step release recovery checkpoint](tasks/2026-11-04-release-recovery-checkpoint.md). User authorization to proceed does not waive confidential data handling, paid resource approval or required recoverability evidence.

## 2026-11-05 — Render production audit: OTP startup guard blocks upgrade

- Read-only Render inspection: production `mit-adt-campuspool` auto-deploy disabled; last live image `63ae551`. Last attempted deploy `056cd26` is `update_failed` (2026-11-03); logs explicitly show `server.js:72`: `OTP_SECRET must be configured as a strong private environment variable`. `server.js` intentionally rejects missing/shorter-than-32 or historically compromised OTP secrets in production.
- Separate staging service is still live on `cceadbf`, auto-deploy disabled. Current main `b83107d` not yet proved deployed or smoke-tested.
- No secret values viewed/changed; no deploy/restart or migration. Owner must configure a fresh strong secret in protected Render environment after review and only then consider release **after** backup/restore/rollback gates. Production fallback SQLite/JSON persistence needs audit.
- [Detailed Render production readiness task](tasks/2026-11-05-render-production-readiness.md). **RELEASE NO-GO.**

## Consolidation note — 2026-11-05

The sections below preserve unique engineering evidence from the reviewed security/cloud-recovery branch. They are **historical checkpoints**, not new deployment approvals. The current release remains NO-GO until encrypted cloud backup and independent restore, credentials, privacy and rollback are verified. No Render deployment or migration was triggered by repository integration.

## In-progress engineering task

- [Transactional idempotency, 2026-11-03](tasks/2026-11-03-transactional-idempotency.md) — branch-local receipts, API keys and green isolated CI; bounded read-only completed-key replay under the mutation limit was implemented on the feature branch; isolated PostgreSQL/PostGIS and SQLite CI passed on implementation `3c050be`. Excess probes and new keys still receive 429. Not deployed, merged or approved. [Contract](../../IDEMPOTENCY_CONTRACT.md).

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

## Confirmed NO current Azure database backup object — owner read-only listing (2026-11-04)

- Owner reports exact container `011campuspoolbackup/campuspool-staging-backups` returned **0** `staging/` blobs and **[]** for the whole current blob listing. Thus the prior reported actual database backup is **contradicted by current Azure CLI evidence**; this recovery container has no visible backup and no independent restore to perform yet. The deleted smoke-test object was not a real dump.
- AGE permanent key and separate encrypted key copy, plus transfer/cost review, remain owner-reported complete; local fake-credential preflight and synthetic AGE upload test passed. Real staging PG17 two-schema backup via PR #26 is **next**, not done. Production/staging not modified by this evidence check.
- Staging migration 008, Render deploy and release remain **NO-GO**, pending real archive, ciphertext readback checksum, independent PG17/PostGIS cold restore and role/RLS/row-content parity, and rollback test. [Task](tasks/2026-11-04-azure-private-blob-backup.md).

## Real Azure staging backup attempt BLOCKED, no verified archive — 2026-11-04 UTC

- Operator ran the private real-source export after a synthetic-only preflight PASS and explicit `BACKUP` confirmation, but received `AZURE_BACKUP_BLOCKED; no verified restoration`. No stage-specific error was printed by the older script; root cause not established and encrypted object not yet rechecked. Do not claim staging backup stored or restored.
- Safe diagnostics implemented in draft PR #26 to distinguish libpq/`pg_dump`, AGE, upload and Azure readback errors without echoing provider diagnostics, with synthetic tests and Azure CI PASS at `1263ca2`. Next: run only a private `psql SELECT 1` read-only source probe with strict TLS, and inspect Azure blob count before any new backup attempt. No staging schema writes, migration 008, Render deployment or production work.

## PostgreSQL TLS diagnostic blocked — November 4, 2026 UTC

- Read-only `psql SELECT 1` against the exact staging pooler, run privately by the operator, returned `DB_TLS_BLOCKED`. Authentication and source database data access have **not** been verified; no new real backup or restore.
- Recommended local client-only correction is to download the **authentic Supabase CA** for project `tnitksrlntrdxbvznxzf` from the dashboard's SSL Configuration section and configure `PGSSLROOTCERT` while retaining `PGSSLMODE=verify-full`. The earlier Render issue was `SELF_SIGNED_CERT_IN_CHAIN`; this does not independently prove the Ubuntu-D failure has the same cause. No server-side TLS disablement, SSL relaxation, migrations or deploy. [Recovery task](tasks/2026-11-04-azure-private-blob-backup.md).

## Staging source CA/TLS connectivity verified — 2026-11-04 (operator-reported)

- Owner reports installed correct Supabase staging CA as `~/.config/campuspool/supabase-staging-ca.crt` and verified certificate parse; subsequent strict `PGSSLMODE=verify-full` `psql SELECT 1` returned **`DB_CONNECT_PASS`**. Thus the prior `DB_TLS_BLOCKED` local source-connection gate is resolved. This does **not** prove an actual database export exists.
- Next: single deliberate operator-authorized retry of encrypted staging export, with `PGSSLROOTCERT` explicitly passed to the `pg_dump` child, current PR #26 safe error categories, private AGE public recipient and Azure CLI tmpfs auth. Confirm ciphertext checksum and actual nonzero remote archive before restore. Independent restore and Render rollback remain NO-GO. [Task](tasks/2026-11-04-azure-private-blob-backup.md).

## Retry worktree ready — November 4, 2026

- Owner safely preserved earlier untracked `-` in the original Azure worktree and created a separate clean `~/campuspool-azure-retry` at commit `e6850ab`. Local Azure mocked safety tests: **10/10 passing**, 0 failed. Actual encrypted Azure stage export **not yet retried**, independent restore **not done**; release still NO-GO. [Task](tasks/2026-11-04-azure-private-blob-backup.md).

## Azure backup stream bug and local plaintext risk — 2026-11-04 UTC (unmerged fix)

- Operator's 10/10 synthetic Azure tests at `e6850ab` **did not** verify actual `pg_dump` stdout: the script and mock both used `--file=-`. PostgreSQL 17 defines `--file` as an output filename; the operator found a 48,600-byte untracked `-` file in a WSL checkout, presumed sensitive and not read by the agent. An older checkout has a zero-byte `-` file. Windows host disk encryption remains absent; chmod is only an access restriction, not secure disk-erasure proof.
- Verified stage TLS/auth remains PASS. Previous reported dump/AGE shell PASS is **withdrawn** as a reliability claim because stdout could be empty. The sole 200-byte `staging/` Azure Blob failed decrypted PostgreSQL archive validation; **NO verified usable off-site database backup** and **NO cold restore**.
- Separate branch `fix/azure-pgdump-stdout-guard-2026-11-04` changes custom-format pg_dump to stdout (omit file flag), checks `PGDMP` header before AGE, and updates synthetic tests. Code is **unmerged and not yet CI/operator-verified** at this checkpoint. See [incident task](tasks/2026-11-04-azure-pgdump-stdout-incident.md).
- No database migration 008, staging Render deploy, production change or authorized live retry. Release remains **NO-GO** pending local incident containment, code+CI review, verified new ciphertext and separate secure PG17/PostGIS recovery proof.

## 2026-11-05 — Cloud-operated encrypted backup worker (proposed, not deployed)

- User directed production-readiness work to avoid local staging exports; **do not interpret this as authorization to bypass the existing NO-GO release gates**. Unencrypted local host incident remains contained but not remediated.
- Cloud worker draft PR #28 `ops/cloud-backup-worker-2026-11-05` stacked on stdout fix draft PR #27. Implements managed identity auth in `scripts/azure-blob-backup.js`, minimal Node22/PG17/AGE Dockerfile, cloud guard tests and CI, runbook and task handoff. Container defaults to preflight only. All tests synthetic; no real Azure resources created or database exports performed.
- Requires CI review, image and dependency reproducibility, explicit approval for any Azure compute/secret/registry costs, job starter RBAC hardening, real encrypted staging archive in Azure and an independent secure PG17/PostGIS cold restore. No migration 008, Render staging deployment or production change. See [cloud worker task](tasks/2026-11-05-cloud-backup-worker.md).

## Mainline integration follow-up — 2026-11-05

Historical branch notes above may still call PRs unmerged. The checked integration PR governs final merge status. Keep the latest verified CI evidence and explicit recovery/rollback release gates in the dated consolidation task. Do not deploy merely because code reached main.

## Flutter/Places branch history carried into main — 2026-11-05

Historical headings below were recorded before the combined source merge. The UI remains separate and optional; Google Places billing-dependent endpoints are disabled until explicit provider approval. No Render deployment, staging migration or provider charge was authorized.

## Flutter UI Phase 1 — branch-only, 2026-11-04 UTC

- **UNMERGED / NOT DEPLOYED:** `feat/flutter-campuspool-figma-ui-2026-11-04` adds an isolated `flutter_app/` scaffold matching the Figma guest landing, desktop style, local ride/errand previews, voluntary tip totals and a collapsed price-details accordion. Existing Node/static web, APIs, databases, feature flags and Render services remain unchanged.
- Contains Dart quote/widget tests and `.github/workflows/flutter-ui.yml`. **CI VERIFIED (source commit `8ff4519`)**: Flutter 3.47.7 `flutter analyze --no-fatal-infos` and **6/6 unit/widget tests PASS** in [run #41790737256](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41790737256). Flutter/Dart SDK unavailable in authoring environment; native/device builds and visual UX QA remain **not verified**.
- **Safety:** no live sign-in, rides, errands, money movement or student data are enabled in the Flutter demo. Production NO-GO remains unchanged. [Handoff](tasks/2026-11-04-flutter-figma-ui.md).

## Flutter Phase 2 state/API boundary — stacked branch only, 2026-11-04 UTC

- **UNMERGED / NOT DEPLOYED:** `feat/flutter-phase2-platform-states-2026-11-04` is stacked on draft Phase 1 PR #17 (head `df65ad1`); it does not exist on `main`. Adds an authenticated-session-gated, read-only ride-feed adapter; restricts UI data to safe summary fields and adds Figma-aligned loading/empty/error/retry states and tests.
- Flutter CI extends to generated Android/iOS/web platform hosts, a Flutter web build and an **unsigned debug APK**, without production signing or release. Do not treat these as native distribution or deployment. **Verified:** Flutter analysis and 19/19 tests pass at `244e06c` in [CI #41793703183](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793703183); web release + Android unsigned debug APK build pass at `2ad2d51` in [CI #41793334499](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41793334499). CI-generated iOS/Android/web hosts exist only as ephemeral build output. No physical-device QA, iOS binary, or production release.
- Existing Node authorization/CSRF and production NO-GO are unchanged. [Task handoff](tasks/2026-11-04-flutter-phase2-platform-states.md).

## Flutter Phase 3 verified OTP session — draft stacked branch, 2026-11-04 UTC

- **UNMERGED, NOT DEPLOYED:** `feat/flutter-phase3-session-login-2026-11-04` (stacked on draft PR #19 → #17) adds real API-backed email OTP/session validation in Flutter, same-origin Web HttpOnly cookies, memory-only native cp_session transport, CSRF-protected logout and read-only rides after /api/auth/me verification. The old simulated login shortcut has been removed on this branch.
- No Node/Render/provider/DB/student changes. **Observed:** Flutter 3.47.7 analyzer and 28/28 tests PASS at `503b5ba` in [CI #41796997734](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41796997734); Web release PASS. Android debug succeeded on earlier Phase 3 source `f8d2ccf` in [CI #41796440947](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41796440947); latest build pending at this checkpoint. The Flutter client now rejects account-detail-bearing legacy OTP responses; the backend legacy path is still a P0 privacy risk, not repaired here. Email provider readiness, real device QA, auth privacy/CSRF review, staging backup/rollback and product release gates still block deployment. [Task](tasks/2026-11-04-flutter-session-login.md).

## Flutter ride destination autocomplete (stacked branch only, 2026-11-04 UTC)

- **NOT MERGED / NOT DEPLOYED:** `feat/flutter-places-autocomplete-2026-11-04` builds Google Places (New) prediction / Place Details integration behind private Node API-key proxy and `PLACES_AUTOCOMPLETE_ENABLED` default-off flag. Flutter displays Pune/India suggestions beneath destination input with debounce, selection, keyboard and honest unavailable states. No production data, API keys, provider billing or Render configuration changed.
- **Verified:** Flutter analyzer + 39/39 tests PASS at `6cbff8e` ([CI #41802050615](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41802050615)); Node Places adapter + server syntax 5/5 PASS at `1860647` ([CI #41801773535](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41801773535)). Latest Web/Android build pending. Google logo/terms, provider quota and physical-device QA are release blockers. [Task](tasks/2026-11-04-flutter-place-autocomplete.md).

## Mobile Places QA follow-up (stacked draft, 2026-11-04 UTC)

- **UNMERGED / NOT DEPLOYED:** `feat/flutter-places-mobile-qa-2026-11-04` builds on autocomplete PR #23; caps scrollable suggestion list above the keyboard, adds IME selection and a strict 80-character input bound. Places provider daily request cap now permits 1–1000 calls rather than silently enforcing minimum 20. **Verified:** 6/6 Node Places tests, analyzer + 41/41 Flutter tests PASS at `e0ebb45`; latest Web/Android packaging pending [run #41805066120](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41805066120).
- No Google billing/keys/Render config/student data changed; source and device QA still required. [Task](tasks/2026-11-04-flutter-places-mobile-qa.md).

## Mobility UI source reconciliation — 2026-11-05

Historical branch-only checkpoints are retained below. Private travel-intent UI remains feature-gated and is not live; migration 008 and student data rollout require protected backup/restore, consent, device acceptance and rollback evidence.

## New branch-only P1 mobility matching UI — 2026-11-03 UTC

- **Implemented but UNMERGED / NOT DEPLOYED:** `feature/mobility-intent-ui-2026-11-03` adds a responsive, labelled travel-intent form inside the existing Available Rides tab. UI stays hidden unless the user has a verified server session and `GET /api/mobility/intent` responds 200; it hides on logout/session expiry or disabled backend. Users can select points with explicit map interaction or enter coordinates manually and control a future departure window.
- The browser submits only the intended private pickup/dropoff and timing JSON over the same-origin API with CSRF and idempotency header; no raw coordinates are stored in local/session storage or URL query parameters. Matching returns only privacy-safe candidate metadata and rounded endpoint distances. Candidates are **not** reserved seats or verified road routes; booking handoff goes through the existing application checks.
- The feature adds `mobility-ui.js` to an explicit static asset allowlist with revalidation caching; pure validation/privacy tests and security CI PASSED on PR #14 code/docs commit e31d644a: security smoke #41636232397, PostgreSQL/PostGIS #41636232259, credential hygiene #41636232152 and agent-doc contract #41636232165. **No new infrastructure, SQL migration, live staging or production deployment, real student data, or payment action** has occurred. Existing mobility backend stays feature-flagged and disabled by default.
- **Driver matching integration, branch only:** optional driver geocoded pickup/dropoff/departure fields were added to the Offer a Ride form, strictly behind the same server feature gate and a separate unchecked-by-default opt-in; ordinary rides retain their original payload. The follow-up driver validation and default-off opt-in test passed on feature commit `30e4fc2`: security smoke #41637089366, PostgreSQL/PostGIS #41637089296, credential hygiene #41637089125 and docs #41637089162. The first follow-up security run failed only due to a malformed regex in the test source, which was corrected.
- **Verification pending:** authorized staging and physical-device/browser acceptance using test accounts; isolated synthetic Playwright CI has passed (see the newer evidence below). Separate staging recovery/migration 008 and historical credentials remain NO-GO. [Task](tasks/2026-11-03-mobility-intent-ui.md).

## Browser QA workstream on PR #14 — 2026-11-04 (unmerged, isolated)

- **QA implementation only, not staging release:** A dedicated Playwright workflow now runs Chromium desktop, Firefox desktop and iPhone WebKit against a disposable localhost PostgreSQL/PostGIS database populated exclusively with synthetic users and sessions. Tests cover feature gating, verified student intent lifecycle, optional driver geocoding, real candidate search, booking handoff without auto-reservation, logout/privacy, and viewport fit. Screenshots/trace artifacts are synthetic only, retained seven days. Automated E2E **PASSED** on code commit `810ad6415ecdbe78ae5576bf840ce09c3e5d63cd`: **21/21** Playwright scenarios across Chromium desktop, Firefox desktop and mobile WebKit in run #41701113565. Security #41701113571, PG/PostGIS #41701113606, credential hygiene #41701113667, agent docs #41701113609 also passed. This is synthetic CI, not manual staging or physical-device acceptance.
- **Confirmed source-level defect fixed on the feature branch:** PostgreSQL Rides IDs are `ride_<uuid>`; the earlier candidate/booking validators incorrectly accepted bare UUIDs and would reject real candidates. The revised card/bridge validators require `ride_<uuid>`, covered by an additional unit regression. The `ride_<uuid>` regression is covered by the passing security smoke and browser integration tests on `810ad64`; no corresponding release has occurred.
- **Safety:** No Render deploy, real staging or production DB access, migration 008, SMS/email delivery, or payments. Existing recovery and independent rollback gates remain NO-GO. [Browser QA task](tasks/2026-11-04-mobility-browser-qa.md).

## Final browser session/privacy hardening checkpoint — 2026-11-03 19:38 UTC

- **PR #14 remains DRAFT, OPEN and UNMERGED** (latest code tested: `76cd1a414bb942086ed7c81ba41c82835f58c19f`; check PR HEAD separately before relying on this checkpoint). The mobility frontend now versions asynchronous create, cancel and candidate-search responses against the current session epoch, preventing late responses from repopulating private UI after logout or session changes. Logout and intent cancellation also clear private date/time form fields and the departure-window text, even inside hidden DOM.
- **Real synthetic browser QA:** 30/30 Playwright scenarios PASS in GitHub run [#41704799368](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/41704799368), covering Chromium desktop, Firefox desktop, iPhone WebKit, opt-in Leaflet map click selection, deferred/no-live tile requests, keyboard Enter create/cancel, delayed search response after logout and previous 21 scenarios.
- **Other checks on the same code SHA:** security smoke #41704799389 PASS; PostgreSQL/PostGIS #41704799073 PASS; credential hygiene #41704799185 PASS; agent docs #41704799301 PASS. Leaflet assets are pinned and installed only inside the CI browser job; test tile URLs are stubbed.
- **Still NOT verified/NOT authorized:** independent human approval, real OTP email/SMS delivery, actual physical-device audit, real staging browser acceptance, safe map/road route provider verification, production safety/payment acceptance, encrypted off-site backup + independent restore and verified Render rollback. No live staging/production migration or deployment has been performed. [Hardening task](tasks/2026-11-04-mobility-ui-hardening.md).

## 2026-11-05 — Docker/Git archive hygiene hardening (source only)

- The existing unexpected local PostgreSQL archive filename `-` is still restricted but unremediated on the owner's unencrypted workstation. Add root Docker context exclusions for `-`, `**/-` and archive suffixes; reject tracked backup artifacts in the secret hygiene tests without hiding the local untracked file from `git status`.
- Work in [dated task](tasks/2026-11-05-repo-dump-hygiene.md). This does not retroactively remove historical secrets, sanitize disk blocks, or prove live recovery. No deploy, staging database migration or Azure job execution. Release NO-GO.

## 2026-11-05 — Consolidated main verified; live hosting still blocked

- Source-only merges completed: release audit #29, security/idempotency/recovery/cloud-worker #32, Flutter/Places #33, private mobility UI #34, and Git/Docker archive hygiene #35. At the audited checkpoint `main@736fe7d`, GitHub reported **zero open pull requests**; subsequent dated handoff documentation may advance the main SHA. See [consolidation task](tasks/2026-11-05-main-consolidation-render-handoff.md).
- Security integration PR #32 and private mobility PR #34 each passed **10/10** combined tests before merge. Mobility QA fixture respects required idempotency keys; no production guard bypass. Flutter/Places remains optional, provider default-off. Repository tracked-file audit found no obvious database dumps or recovery secrets; local incident on unencrypted host is unresolved and not securely erased.
- Read-only Render check: production last known live `63ae551`, later `056cd26` attempt failed on the strong `OTP_SECRET` guard; staging still live at `cceadbf`. Both services retain auto-deploy **OFF**. No Render deployment, staging migration 008, actual cloud worker launch or student-data restore was performed.
- **RELEASE NO-GO:** worker still needs image/dependency hardening and owner-approved cloud IAM/cost, a genuine encrypted staging archive and independent secure PG17/PostGIS restore, data/roles/RLS/migration/content verification, provider/login acceptance and a verified Render rollback artifact. A closed PR is not deploy approval.
- Old remote branches remain: current GitHub integration can inspect but not delete refs. Preserve the unmerged Cloudflare R2 alternative until a deliberate archive/abandon decision. See handoff for safe operator pruning of truly redundant branches.

## 2026-11-05 — Mainline integration complete, release remains blocked

- **Source-only merges:** [PR #29](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/29) Render audit (`f4ed414`), [#32](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/32) security/idempotency/Azure cloud-worker (`78fea03`, 10 green checks), [#33](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/33) Flutter/Places (`99ca122`, 7 green checks), [#34](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/34) feature-gated mobility UI (`69e8f04`, 10 green checks), [#35](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/35) archive hygiene (`736fe7d`, 3 green PR and 3 post-merge main checks). **0 open pull requests** at audit time.
- 25 remote branch refs remain. 17 non-main branches verified ancestral to main; 7 still have uniquely divergent commits. Old stacked PRs were closed only after source integration verification; alternative R2 was explicitly not merged. No refs deleted because connector lacks safe deletion; preserve for controlled cleanup.
- Tracked repository main tree: 190 files before this audit note, no filename matching `-`/archive/private-key patterns. Local WSL accidental archive remains untracked and not securely erased; history secret revocation remains unverified.
- Render production/staging auto deploy **OFF**. Actual production running `63ae551` with failed newer OTP secret startup; staging `cceadbf`. **NO new deployment or migration**. Encrypted staging backup/independent recovery/rollback/credential gates still **NO-GO**. See [consolidation task](tasks/2026-11-05-mainline-consolidation-audit.md).

## Cloud worker image supply-chain review — 2026-11-05 UTC (draft code only)

- Owner's Cloud Shell verified the Azure `campuspool-backup-env` **Succeeded** in Malaysia West with Consumption workload profile, no job and null log destination. This is externally supplied output; no connected Azure write or resource readback.
- Source branch `security/cloud-backup-worker-image-2026-11-05` pins Node/PostgreSQL base images to published SHA-256 indexes and introduces CI guards for immutable bases, non-root execution, allowlisted files and default preflight. **No image published**; future CI checks must be reviewed.
- Full dependency lockfile, secure logging, image scan/attestation and a separately approved manual job are still pending. Actual encrypted staging backup and independently verified restore/Render rollback remain **NO-GO**. [Image-hardening task](tasks/2026-11-05-cloud-worker-image-hardening.md).

## Cloud worker reproducible dependency gate — 2026-11-05 UTC

- On source-only [PR #38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38), generated `ops/cloud-backup/package-lock.json` using GitHub Actions (66 package entries), replaced Dockerfile `npm install` with `npm ci`, and added fail-closed lockfile/static-image tests and high-severity npm advisory audit. All three cloud-worker CI jobs PASS at implementation SHA `7f30dcce51d727f85c06489ea244911761e807df`; npm audit reports **0 vulnerabilities** at this check time.
- This is **npm/dependency evidence only**, not an OS container CVE scan, published/signed image, Azure job, valid encrypted backup or restore proof. No Azure resource, secret, DB or Render operation performed in this milestone. Production OTP [PR #36](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/36) remains draft/unmerged, not live. Staging/production release **NO-GO**.

## Full container vulnerability scan and Azure provision design — 2026-11-05 UTC

- Draft PR #38 complete OS+library Trivy scan initially flagged 458 advisories (4 critical/72 high); unused inherited `gosu` accounted for all 26 scanner-fixable critical/high issues and was removed. Second full image scan flagged 397 Debian 12 OS advisories (3 critical, 47 high, 173 medium, 168 low, 6 unknown), with no scanner-published high/critical fix; strict image release CI **FAILS**. [Trivy evidence](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42050852283). Alternative Debian 13 base is being assessed in source-only CI.
- `docs/ops/AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md` documents owner-cost-gated private-authenticated ACR (Basic public network limitation), Standard vault, separated least-privilege identities and a manual-only job. No ACR, Vault, managed identities, job, RBAC, logging sink or secret has been created by this work. Owner's existing empty Malaysia West Consumption environment remains intact. Real encrypted staging backup, independent recovery, OTP release **NO-GO**.

## Alternate image OS scan — 2026-11-05 UTC

- [GitHub trial](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42051538206) built PostgreSQL 17 + AGE cloud worker on Debian 13 Trixie: 336 advisories, 1 CRITICAL, 63 HIGH (worse HIGH than current Bookworm's 47). **No release image was selected or published**; the pinned Bookworm image remains guarded and scan CI intentionally FAILS (3 CRITICAL, 47 HIGH). Registry, vault, job remain only a documented owner-approval plan.
