# CampusPool — prioritized next steps and ownership

**Last prioritized:** 2026-11-03 UTC. **Baseline:** `main@3ee1f4a12e98`. Items are an actionable backlog, **not authorizations** to alter Render production, student data, SMS/email accounts or payment systems.

| Priority | Work item | Current state | Next concrete action | Acceptance / evidence | Owner |
|---|---|---|---|---|---|
| P0 | Verify transactional request idempotency | Browser retry reload and PG role checks passed isolated CI at `282df2c`; PR #11 still unmerged/not staged | Independently review read-only replay under load, PG role/RLS permissions and browser key lifecycle; only after approval plan staging migration 008 | Green CI runs 41588934566/34664/34558/34552; independent review, controlled staging E2E and rollback still required | ChatGPT engineering agent (branch only) |
| P0 | Close historical credential incident | Unverified account-side revocation | Account owner confirms revoked Gmail App Password, regenerated OTP secret and private Render replacement; review access logs | Dated verification, no raw secrets in Git/logs, controlled provider test | Account owner |
| P0 | Genuine provider OTP verification in staging | Adapter and CI mock tests exist | Configure verified Resend sender/domain and approved MSG91/DLT Flow in isolated staging, then test controlled end-to-end signup/login | Actual inbox/handset receipt, expiry/replay/resend and provider failure checks | Unassigned |
| P0 | Durable production Rides plan | PostgreSQL Rides implementation exists behind flag; production on SQLite | Inventory existing data; design consistent backup/export, UUID reconciliation, staging import and cold restore | Recorded counts/hashes, ownership continuity, proven forward+rollback | Unassigned |
| P0 | Security and release QA | Automated backend tests green | Execute browser/phone E2E on a reviewed staging deploy with test users and adverse concurrency cases | Test report with exact deployed SHA and resolved high-severity defects | Unassigned |
| P1 | Hyperlocal travel-intent frontend | Private PostGIS matching API exists; no integrated UI | Add authenticated travel-intent form, privacy-safe candidate cards and booking handoff behind flag | UI/mobile/E2E tests, no raw student coordinates or contacts leaked | Unassigned |
| P1 | Realistic route-aware matching | Geometric straight-line proximity only | Evaluate road-routing provider, cost caps, route detour bounds and fallbacks | Costed design + test comparing sample ground-truth routes | Unassigned |
| P1 | Mobility load and fraud benchmark | CI indexes + basic shared PostgreSQL limits | Create isolated 100+ concurrent-user benchmark, record p95, CPU, locks, query plans and rate-limit behavior | Reproducible report; decide whether optimizations beat Redis/H3 | Unassigned |
| P2 | Errands backend | Standalone sample UI only | Specify request/runner/assignment state machine, roles, PIN handover, notifications and abuse model | Reviewed domain design + server-side integration tests with mock payments | Unassigned |
| P2 | Payment partner readiness | Unverified payment settlement disabled | Review eligible regulated payout provider and settlement/refund flows, not a homegrown escrow | Provider eligibility, signed webhook tests, ledger/reconciliation and approval | Unassigned |
| Conditional | Redis, H3, background queue or microservices | **Deferred**; no performance justification recorded yet | Revisit on evidence: slow spatial query, hot shared limits, reliable notification demand, or independent scaling | ADR with benchmarks, cost, added operational risks, rollback | Unassigned |

## Sequencing rules

- **Security and durable data first;** do not treat GitHub merge as production approval.
- Build the Hyperlocal matching UI and road-route verification on isolated staging before exposing it to students.
- Add a PostgreSQL transactional outbox/background worker before a high-volume external queue if reliability requirements demand asynchronous work.
- **Do not add Redis, H3, Kafka or microservices merely because they are well-known system-design tools.** First measure the real bottleneck and capture an accepted decision in `DECISIONS.md`.

## For the next agent

1. Inspect GitHub HEAD, new PRs, CI and exact staging deployment commit; do not trust this timestamp as real-time.
2. Choose a specific unassigned item, create `docs/agents/tasks/YYYY-MM-DD-<slug>.md`, record an explicit scope and owner, and coordinate changes with active PRs.
3. Update progress in the task file and keep these priorities aligned with verified reality on each implementation PR.
4. If no credentials, authority, safe environment or rollback evidence exist, mark the task blocked instead of improvising a production action.

## Active agent handoff

- [Transactional request idempotency](tasks/2026-11-03-transactional-idempotency.md): draft PR #11 has green GitHub CI at `a2e231b`; bounded throttled replay passed CI at `3c050be`; next independently review permissions/browser retry lifecycle and migration/rollout, then complete separately authorized staging QA before treating as deployed. No live migration authorized.

## Latest completed documentation task

See [2026-11-03-agent-workflow.md](tasks/2026-11-03-agent-workflow.md) for the multi-agent continuity-policy bootstrap and its verification/handoff.

## Current blocking handoff — staging release gate (2026-11-03 UTC)

- **P0 / blocked:** [Staging permissions, browser retry and rollback task](tasks/2026-11-03-staging-permissions-browser-retry.md). Browser fix and restricted-role tests are CI-green at `282df2c`; live staging retains migrations 001–007 only, no idempotency 008.
- **Exact next action:** account owner verifies encrypted off-site staging dump and restores it to an independent disposable PostgreSQL/PostGIS target; confirms intended Render workspace/service, current staging branch, known-good deploy SHA and executable rollback path. Do not request secrets in Git or chat.
- **Next engineering action after gates pass:** re-audit grants, apply 008 in **staging only**, verify roles/RLS and deploy exact CI-tested branch SHA with both browser and backend. Run synthetic-account E2E and rehearse returning to prior SHA. **No live migration or deploy authorized by this note.**
- Read [staging idempotency release runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md). Production remains NO-GO.

## Next engineering handoff — staging migration preflight (2026-11-03)

- [Read-only migration 008 preflight](tasks/2026-11-03-staging-migration-preflight.md): isolated GitHub CI passed at `4d66aa0` (PostGIS #41595567003, security #41595567015). Review the exact-project guard and run `APP_ENV=staging OTP_DB_SSL=true npm run check:staging-migration -- --mode=before` **only** with a private stage-only `OTP_DATABASE_URL` on the authorized operator machine.
- Before any live SQL: obtain encrypted off-site backup, independent restore proof, verified Render workspace and re-deployable known-good SHA. The preflight itself deliberately reports `releaseReady:false`; passing schema inspection never waives release gates.

## Release-gate blocker — 2026-11-03

- [Actual staging backup and rollback evidence](tasks/2026-11-03-staging-backup-restore-gates.md): Render candidate `My Workspace` awaits owner confirmation; last deployed stage SHA not verified. Supabase stage remains 001–007 with no 008.
- Verify a **real encrypted off-site staging database dump + scratch restore**, not just the synthetic CI backup/restore rehearsal; ensure schema/roles/data and migration history are restored correctly. After this and Render rollback artifact validation, consider stage-only migration 008 with reviewed tool and manual deployment to exact vetted SHA. NO-GO otherwise.

## Latest verified synthetic restore CI — 2026-11-03

- Draft PR #11 `f59eb8b` passed PostGIS #41597004644, security #41597004543, docs #41597004472 and credential #41597004588. The disposable PG16 synthetic backup + encrypted checksum + logical restore drill passed. It **does not substitute for a real encrypted off-site staging backup and scratch restore of the actual staging dataset**.
- Next: owner confirms Render workspace `My Workspace`, then verify actual staging service/last-good deploy SHA. Owner securely exports and encrypts staging roles/schema/data, restores to an independent scratch target and records verification evidence. Only then can the authorized migration 008 and rollback rehearsal proceed.

## Render target verified — next unblock (2026-11-03 UTC)

- **Completed:** User confirmed `My Workspace`; staging service `srv-dbjof8fb9u1s73eks0bg` branch `main`/auto-deploy off. Current live rollback baseline `cceadbf6251f`, Render deploy `dep-dbke9uo8v5cc738cpnd0`; historical successful `fe93c6be16b4`, deploy `dep-dbkdr5qjnfac738p2heg`. Build-retention/rollback dashboard button still needs a read-only eligibility check.
- **Unblocked action owner must perform next:** encrypted off-site export of real `campuspool-staging-db` PostgreSQL 17 roles/schema/data + migration history, verification of ciphertext digest, independent compatible scratch restore and RLS/grant/count comparisons. Keep all credentials and archive content out of Git/CI/chat. Until complete, **DO NOT** migrate 008, deploy PR #11, or rehearse live rollback.
- On proof of successful restore and approved stage release, use Render Dashboard *Deploy a specific commit* for the reviewed PR SHA (not default `trigger_deploy` on `main`); preserve the original `cceadbf6251f` build as rollback target. Confirm that Rollback is eligible in Dashboard. See [task](tasks/2026-11-03-staging-backup-restore-gates.md).

## Operator execution handoff — 2026-11-03 UTC

The actual PG17 backup/restore steps remain impossible to execute through the available read-only project metadata connections. The owner must use a trusted local encrypted machine with private stage-only DB owner credentials, age recipient, approved off-site storage and distinct PG17/PostGIS scratch restore target; see the detailed command sequence and queries in [runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md). Current `cceadbf6251f` Render deploy is confirmed `live` but artifact rollback eligibility cannot be verified by Render MCP; check the staging Events dashboard before release. **Staging migration/deploy and rollback remain NO-GO.**

## Next concrete action — local-operator staging backup (2026-11-03)

- The unmerged PR #11 adds `npm run check:staging-backup` (safe local preflight) and `npm run backup:staging-operator` (explicit private-stage export). [Task and conditions](tasks/2026-11-03-secure-backup-operator-tool.md). Isolated CI passed at `3f723d1`; account owner next runs these on an encrypted trusted workstation with a separately confirmed encrypted off-site mount and stage-only private connection string. **Never** run with live credentials from GitHub Actions/Render/chat.
- After encrypted archive creation, independently download its off-site copy and check SHA-256; restore to a different approved Supabase-compatible PostgreSQL 17/PostGIS project and compare data/roles/indexes/RLS/policies/permissions. Until that evidence and Render build-artifact eligibility exist, live migration 008 and staged deployment remain blocked.

## Next unmerged engineering handoff — independent staging restore comparison (2026-11-03 UTC)

- [Operator-only read-only restore comparison](tasks/2026-11-03-staging-restore-compare.md) developed on child branch security/staging-restore-compare-2026-11-03, based on idempotency PR #11. Security smoke #41626504817 and disposable PostgreSQL/PostGIS integration #41626505003 passed at code head a0962f2; no real staging restore was executed.
- **Next operator action after verified private backup:** restore independently to a different approved Supabase-compatible PG17/PostGIS scratch project, verify the ciphertext via separate remote download, and privately set APP_ENV=staging, RESTORE_TARGET_CONFIRMED=YES, RESTORE_PROJECT_REF and both DB URLs. Run the comparison preflight followed by read-only comparison per the runbook. Never supply the credentials to chat, GitHub or CI.
- **Required additional evidence:** full restore operation success, migration history, role credentials, provider-managed objects, independent data checks and Render retained artifact eligibility. A matching metadata/row-count comparison is necessary but **insufficient** for release. Do not apply 008 or deploy until authorized.

## Engineering handoff — row-content integrity in independently restored staging (2026-11-03 UTC)

- [Bounded SHA-256 restored-row verification](tasks/2026-11-03-staging-content-integrity.md) developed on child branch security/staging-restore-content-digests-2026-11-03 targeting draft PR #12 (which targets PR #11), not main. The staged recovery verifier now checks that **record contents** match, not just counts, while keeping all derived digests private.
- **Immediate engineering action:** CI passed on eb9200f8 (security #41627772559, PostGIS #41627772557 including equal-count row mutation). Next independently review fingerprint serialization/collation, the 25,000-row cap and documentation contract, then fold reviewed changes into PR #12. The operator's real encrypted off-site backup/restore and Render rollback proof remain separately blocked; **NO** application migration 008 or live deploy is authorized.

## Next exact review gate — fail-closed recovery evidence (2026-11-03 UTC)

- Current draft PR #13 contains a fail-closed fix for both sides omitting required evidence or migration history. Fresh CI for hardened code commit `6384a55` PASSED (security smoke #41629693100; disposable PostgreSQL/PostGIS #41629693149). **Next engineering action:** PR #13 was marked Ready for review after an engineering COMMENT review (review ID 5751792917); obtain a separate human reviewer approval of query behavior, time bounds, strict ledger requirement and security claims before integrating PR #13 into PR #12. No merge has occurred.
- Real-staging operator gates remain unchanged: off-site encrypted archive verified by independent download, a compatible separate scratch restore, role/security/data evidence and retained Render rollback artifact availability. Do not run a live migration 008, deploy staging or production, or merge the release branch merely because the tests pass.

## Actual independent staging backup/restore start — 2026-11-04 UTC

- **Source metadata check complete** at 08:15 UTC: exact PG17 staging, 9/9 RLS, restricted backend role, 001–007 installed, 008 absent. No source data rows read. A separate recovery database and protected off-site archive have **not** been created.
- **Next local operator action:** [current recovery execution task](tasks/2026-11-04-independent-staging-recovery-start.md) and [runbook](../../STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md) define Ubuntu-D preflight with private `STAGING_DB_URL`, encrypted scratch/off-site directory, AGE public recipient and strict project allowlist. Use updated **five-part** backup after CI and independently verified write-quiescence. No raw SQL/URL/keys in ChatGPT/GitHub.
- **After live export:** re-download encrypted bytes independently, verify SHA256, decrypt inside a trusted encrypted volume, provision approved separate PG17/PostGIS target, restore ALL five components including `supabase_migrations` and compare source/target catalog, permissions, counts and bounded content digests. Operator must independently verify Render rollback artifact and record only PASS/BLOCKED proof. **Do not deploy/migrate 008** without all hard gates.

## Azure private Blob backup next gate — 2026-11-04 UTC

- Owner reported Azure for Students storage account `011campuspoolbackup` created in Malaysia West. Owner has now confirmed `campuspool-staging-backups` container created. **Next action:** verify container **Private** access and assign the operator **Storage Blob Data Contributor at container scope** via Azure IAM (without sharing access keys); then use Ubuntu-D Azure CLI Entra authentication cached under encrypted-in-RAM `/dev/shm`, `az storage container show --auth-mode login` read-only, and only then test encrypted synthetic upload. Confirm RBAC, encryption, network scope and any cost warning; don't paste access keys, tokens or student data into GitHub/chat.
- [Azure Blob operator runbook](../ops/AZURE_BLOB_BACKUP.md) and [dated task](tasks/2026-11-04-azure-private-blob-backup.md) document new Azure SDK/Entra streaming backup branch, synthetic tests and protected /dev/shm Azure CLI session credentials. Cloudflare R2 PR #25 remains untouched (not merged). Do not execute actual staging export until private container confirmed and harmless encrypted sample roundtrip tested.
- Continue separate **cold restore** with verified PG17/PostGIS, global roles / managed objects and RLS, migration ledger, content parity and retained Render rollback; migration 008 and all staging/production deployments still NO-GO.

## Azure container RBAC assigned — owner reported, Nov 4 2026

- Owner reports `Storage Blob Data Contributor` assignment for their Microsoft Entra user at the `campuspool-staging-backups` container scope. Next safe step: Ubuntu-D `az login --use-device-code` with `AZURE_CONFIG_DIR` rooted in `/dev/shm` (tmpfs 0700) and **read-only** `az storage container show --auth-mode login` on the exact storage account and container. Verify private access, proper subscription and successful RBAC. Report only PASS/BLOCKED, not access codes/tokens or IDs.
- PR #26 remains draft, unmerged. No student data export or cloud test upload occurred; after successful read-only access, test encrypted synthetic upload and independent ciphertext readback. A full cold restore and source/target parity remain mandatory before migration 008 or any protected staging deployment.

## Following successful Azure AGE smoke test — Nov 4 2026

- Owner ran private Entra-authenticated test: AGE-encrypted synthetic payload upload/download/decrypt and test blob deletion — **both PASS**, no database access. Next local step: install the Azure JS SDK in a dedicated non-repository directory, fetch PR #26 in a **new worktree** and run its synthetic tests before preparing restricted preflight. Keep Azure CLI auth cache under verified private `/dev/shm`.
- Before **any real staging PostgreSQL dump** uploaded to Malaysia West: ensure durable separate AGE private-key custody and recoverability, appropriate student-data cross-border review, credit/billing check, selected-schema backup scope review, local PG17/SDK preflight and an approved independent PG17/PostGIS cold-restore target. Release gating remains **NO-GO**; migration 008, Render and production unchanged.

## Azure backup operator local preflight — 2026-11-04 UTC

- Azure owner confirms local 6/6 synthetic tests passed. Run **credential-free** `node scripts/azure-blob-backup.js --preflight` from `~/campuspool-azure-recovery` using **synthetic PGHOST/PGPASSWORD/AGE_RECIPIENT sentinel values** that satisfy config shape and exact destination allowlists; `NODE_PATH` points to separately installed Azure SDK and `AZURE_CONFIG_DIR` is private 0700 tmpfs. This only validates tool versions, packages and config; it performs no DB or cloud query.
- **Do not** proceed to `--execute` with sentinel values. The live cross-border staging export still requires separately recoverable **durable AGE private identity**, approved student-data transfer/privacy and subscription cost review, and independent recovery target planning. Release gates remain NO-GO.

## Azure preflight passed — next durable AGE recovery key gate (2026-11-04)

- Owner reports `AZURE_PREFLIGHT_PASS; no database or blob contacted` from guarded fake-only CLI preflight. No source/cloud contact. Azure private-container and synthetic AGE upload checks already passed.
- Execute **only** the persistent AGE encryption-identity key generation procedure in [Azure task](tasks/2026-11-04-azure-private-blob-backup.md), keeping plaintext identity in `/dev/shm` and writing only a strongly passphrase-encrypted identity to local persistent storage. Verify synthetic ciphertext decrypts through this protected identity and independently back up encrypted key/passphrase in approved separate secure storage. Treat WSL swap and key-loss risk as unresolved until reviewed.
- Do not run `--execute` or any real student-data export to Malaysia until transfer privacy/data-retention and Azure credits are reviewed, durable decryption recovery proved, and separate PG17/PostGIS restore + rollback plan approved. Migration 008, staging/production deploy remain NO-GO.

## Durable AGE backup-key recovery — next operator gate (Nov 4, 2026)

- Owner reports the new permanent AGE identity was **passphrase-encrypted** and successfully decrypted a synthetic AGE file (two PASS checks). The identity is currently known only as a locally created encrypted file; independent key backup and off-device restore test are **not done**.
- Next: copy `~/.local/share/campuspool-recovery/staging-age-identity.passphrase.age` to a **separate secure vault/location** and safeguard its passphrase separately. Retrieve that copy independently, verify it matches the local encrypted copy, and use it to decrypt a fresh sample with the stored public recipient; do not expose keys/passphrases or write plaintext identity to unencrypted C:/D:. Do not delete the only working copy.
- Continue to block all actual staging uploads until permitted personal-data cross-border transfer, Azure credit/cost/retention, selected-schema vs full recovery scope, an independent PostgreSQL 17/PostGIS restore target and Render rollback have been reviewed. No staging migration 008, production or Render deployment.

## Owner-reported Azure recovery completed; audit evidence before release — 2026-11-04 UTC

- Owner says final three tasks are complete: independent encrypted AGE key copy, transfer/cost review, actual PostgreSQL backup and independent restore. **Do not ask owner to redo the work.** Agent has no local WSL filesystem or Azure storage integration to independently inspect archived bytes or local Postgres restore. Request **only sanitized status evidence** (no secrets/records): independently re-downloaded ciphertext digest match, AGE key recovery/decrypt result, PG17/PostGIS restore target type and successful operation, schema+ledger+role/RLS/grants+row fingerprints/count parity, cost/data-transfer signoff.
- Optional owner-side authenticated **read-only** check for actual Azure archive metadata:
  `az storage blob list --account-name 011campuspoolbackup --container-name campuspool-staging-backups --auth-mode login --prefix staging/ --query "[].{bytes:properties.contentLength,modified:properties.lastModified}" --output table`.
  Report only item count/nonzero bytes/most recent timestamp; object names and data not needed.
- Connected Supabase still reports seven migration versions; Render stage old `cceadbf6251f` is live. No newly created restore Supabase project in connected account; a local PG17/PostGIS restore would be expected in that case. Restore compare script in Azure branch expects a **different Supabase project ref** and is not directly usable for local restores.
- Validate actual restore and held backup covers intended recovery scope. Azure code archives `public` and `supabase_migrations` only (global roles and provider-managed schemas/media excluded): do not claim complete Supabase project recovery from a matching selected-schema restore.
- Confirm existing Render artifact can actually be re-deployed/rolled back, then obtain review of stacked recovery PRs #11/#12/#13/#22/#26 and explicit approval before staging migration 008. No production work.

## CORRECTED recovery handoff — independent restore remaining (Nov 4, 2026 UTC)

- Owner explicitly clarified the independent PostgreSQL restore is **not done**, correcting the prior owner completion claim. Do not mark restore done or release approved.
- Next safe action: list encrypted `staging/` Azure blob objects with **read-only** Azure CLI `az storage blob list --auth-mode login`; confirm nonzero encrypted backup archive bytes/modified time. No credentials or student records in chat.
- Establish a **separate, isolated, approved PG17/PostGIS target with encrypted storage**. Both Windows C:/D: lack BitLocker; do not restore personal-data rows into ordinary WSL or Docker host volumes that persist there. Review trusted encrypted cloud/volume or secure RAM-only container + WSL swap risk. Never restore onto the original staging source or production.
- Once isolated restore target is ready: independently retrieve AGE ciphertext and checksum, decrypt privately in encrypted workspace, inspect custom archive listing with `pg_restore --list`, restore with fail-closed error behavior, and compare table schema, migration ledger, RLS, privileges, rows/content fingerprints. Global roles/Supabase-managed objects not in Azure two-schema archive must be handled separately. Retained Render rollback proof remains pending; no staging migration/deploy.

## Immediate operator action: create the missing Azure backup (owner listing: 0 / []) — 2026-11-04

- Exact `campuspool-staging-backups` container is confirmed **empty** (`staging/` count 0; full listing []), correcting the earlier mistaken report of completed database export. Do **not** proceed to restoring an object that does not exist.
- From isolated Ubuntu-D Azure worktree, preserve protected `AZURE_CONFIG_DIR` under `/dev/shm` and private SDK under `NODE_PATH`. Use actual copied Supabase stage *session pooler* host, exact stage user/ref, 5432, `PGSSLMODE=verify-full`, stage password read silently and saved AGE **public** recipient. Operator first runs `node scripts/azure-blob-backup.js --preflight` with real values (no DB or cloud connection). After explicit manual confirmation, operator can run `AZURE_EXPORT_APPROVED=YES node scripts/azure-blob-backup.js --execute` to create a uniquely named AGE-encrypted `staging/*.pgdump.age` Azure blob, with automatic ciphertext readback and digest verification. Avoid printing/sharing secret environments.
- Verify `CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED` and a nonzero `staging/` object in a read-only Azure listing. Log safe object metadata and checksum locally, then secure approval for a distinct PG17/PostGIS cold restore environment. Source schema scope excludes global roles and Supabase-managed schemas/storage. No migration 008 or application deployment.

## Handle first real staging Azure export failure — 2026-11-04 UTC

- Owner's first `node scripts/azure-blob-backup.js --execute` returned only `AZURE_BACKUP_BLOCKED; no verified restoration` after `AZURE_PREFLIGHT_PASS`. This is **NOT** a successful remote backup. Original script hid specific stage. No blind rerun.
- **Immediate diagnostic:** run a **read-only `psql -X -w -qAt -c 'SELECT 1'`** using real staging *session pooler* host, exact staging user, port 5432, database postgres, `PGSSLMODE=verify-full` and private password read without echo. Keep stderr temporary under private `/dev/shm`, print only static TLS/AUTH/NETWORK/OTHER outcome, erase temporary diagnostics; no plaintext rows read. Review `PGSSLROOTCERT`/CA trust on TLS failure without changing `verify-full`.
- **Confirm no misleading residual blob:** list `staging/` objects read-only via Entra ID Azure CLI; do not delete a partial remote object without reviewed cleanup. Then `git fetch`/update clean detached Azure worktree to current PR #26 head and rerun 9/9 synthetic unit tests; the script now reports stable failure-stage categories and never raw SDK or SQL messages.
- If source probe PASS, run a separately approved guarded backup execution only once with current safe diagnostics; checksum readback plus independently verified remote presence required. Independent PG17/PostGIS cold restore and rollback still gated; no migration 008 or staging/prod deploy.

## Correct live-source TLS before Azure export — November 4, 2026

- Operator's read-only `psql SELECT 1` probe returned `DB_TLS_BLOCKED`. **Stop real backup retries** until strict verification passes. The old PG probe classified multiple SSL errors under the same code; missing local CA is plausible, not proven.
- Download the verified **project-specific Supabase CA certificate** via staging Dashboard → Database Settings → SSL Configuration → Download certificate; parse with `openssl x509`, install outside repository, set `PGSSLROOTCERT` for libpq/PG17; keep `PGSSLMODE=verify-full` and exact Session Pooler hostname. Re-run read-only `SELECT 1` with private staging password; report only category. If TLS still fails, inspect **local private stderr without pasting secrets**, check hostname and certificate provenance; never use `sslmode=require`, disable TLS, or skip certificate validation.
- Once `DB_CONNECT_PASS`, recheck Azure container metadata and guarded current code/CI before separate approved encrypted export; final independent PG17/PostGIS restore and release gates remain outstanding.

## Source strict TLS gate passed — retry real encrypted backup once (2026-11-04)

- Owner successfully downloaded authentic Supabase staging `prod-ca-2021.crt`, installed a private local copy in `~/.config/campuspool/supabase-staging-ca.crt`, and ran read-only `psql SELECT 1` with `PGSSLROOTCERT` and `PGSSLMODE=verify-full`; outcome **`DB_CONNECT_PASS`**.
- The earlier credential-containing shell block was subshell-scoped. In a new protected Ubuntu-D shell explicitly restore `PGSSLROOTCERT`, `PGSSLMODE=verify-full`, exact stage project/user, actual dashboard pooler host and secret PG password read silently; preserve only the durable AGE **public** recipient in env. Azure SDK `NODE_PATH` and `AZURE_CONFIG_DIR` must be set to private paths. Check Azure data-plane access read-only, run latest guarded `--preflight`, then only after explicit `BACKUP` confirmation retry the new, diagnostic `--execute` once. Do not use any unverified CA and do not disable certificate checks.
- Confirm `AZURE_CIPHERTEXT_READBACK_MATCH_RESTORE_NOT_TESTED` and a nonzero immutable `staging/` Azure blob, then independently retrieve/decrypt and plan distinct PG17/PostGIS restore. Do not claim full Supabase project recovery: Azure dump includes `public` and `supabase_migrations` only; managed auth/storage/global roles require separate procedures.

## Next operator command after clean Azure worktree — November 4, 2026

- Use the tested clean `~/campuspool-azure-retry` checkout (owner local 10/10 pass, commit `e6850ab`) rather than disturbing the previous worktree with untracked `-`. The stage `psql SELECT 1` previously returned DB_CONNECT_PASS with project-supplied TLS CA.
- Before uploading, read-only check existing Azure `staging/` blobs, and stop on any current objects. In a protected subshell re-export `PGSSLROOTCERT=$HOME/.config/campuspool/supabase-staging-ca.crt` and `PGSSLMODE=verify-full`, source stage user/host, Azure private container and RAM-backed CLI tokens, permanent AGE public recipient. Enter PG password only silently; read-only test `SELECT 1`, real-config `--preflight`, then user-confirm `BACKUP` to permit one stream upload. Share only categorized status and object size, never credentials or private identity.
- Do not deploy/migrate or claim recovery until Azure ciphertext confirmed, separately downloaded/decrypted and restored into distinct secure PG17/PostGIS, with migration/security/data comparisons and Render rollback verification.
