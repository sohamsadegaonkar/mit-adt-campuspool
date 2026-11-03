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
