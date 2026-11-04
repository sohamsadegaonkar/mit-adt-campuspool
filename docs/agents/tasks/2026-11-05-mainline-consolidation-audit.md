# Task: CampusPool mainline consolidation and pre-Render audit

- **Task ID / file:** `2026-11-05-mainline-consolidation-audit`
- **Status:** source integration complete; remote branch deletion and operational release blocked/separate
- **Agent / owner:** ChatGPT engineering agent, no owner of private credentials or cloud billing
- **Last updated:** 2026-11-05 UTC
- **Baseline:** main before consolidation `b83107d`; reviewed main after integration `736fe7d3aa11b366ac924fffa011cc8952552d48`
- **Scope:** GitHub repository source/CI/PR housekeeping and read-only Render checks; no cloud resource creation, database mutation, Render staging or production deployment.
- **Related:** `2026-11-05-cloud-backup-worker.md`, `2026-11-05-render-production-readiness.md`, `2026-11-05-repo-dump-hygiene.md`.

## Goal and acceptance criteria

Consolidate compatible security, idempotency, cloud-operated encrypted backup, mobile/Flutter, privacy-gated travel intent and optional Places code into `main`, without overwriting release gates, introducing billable flags or deploying unverified database migrations. Close superseded/stacked PRs and preserve traceability. Distinguish code integration from live staging/production readiness.

## Current state and verified source merges

| PR | Result | Main integration commit | Proof |
|---|---|---|---|
| [#29](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/29) Render recovery audit | merged | `f4ed414` | Release-readiness documentation only |
| [#32](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/32) security/idempotency/backup/worker reconciliation | merged | `78fea03` | 10/10 combined CI checks passed |
| [#33](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/33) Flutter/Places optional client reconciliation | merged | `99ca122` | 7/7 combined CI checks passed, including Flutter Android/web |
| [#34](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/34) private mobility UI | merged | `69e8f04` | 10/10 combined CI checks, including real browser QA |
| [#35](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/35) archive/Docker hygiene | merged | `736fe7d` | 3/3 PR checks and 3/3 postmerge main checks passed |

- At verification time: GitHub reports **zero open pull requests**; `main` contains 190 tracked blob files, with no filename matching inspected sensitive dump/archive patterns including literal `-`. Static filename inspection is not a whole-Git-history secret scan.
- GitHub still contains **25 remote branch refs including main**. Of 24 non-main branches, 17 were verified strict ancestors of main; 7 were divergent: `chore/runtime-env-preflight-2026-11-04`, `docs/agent-working-agreement-2026-11-03`, `docs/release-merge-audit-2026-11-04`, `docs/release-recovery-checkpoint-2026-11-04`, `ops/cloudflare-r2-stream-backup-2026-11-04`, `ops/render-production-readiness-2026-11-05`, `perf/mobility-load-baseline-2026-11-04`. Their unique commits should be inspected before deletion even when equivalent contents were squash-merged. **No branch ref was deleted**; the connected GitHub tool lacks branch deletion. The R2 draft was closed as an unselected alternative, not merged.
- Closing a stacked PR whose source was already integrated by a reconciliation PR does not make that original PR independently merged; comments identify actual source lineage.
- The `stage1-otp/migrations/008_transactional_idempotency.sql` source exists, but has **not been applied** to staging. AGE, Azure/managed identity cloud-worker source has passed only synthetic tests; no real encrypted offsite staging archive or full independent recovery.
- Flutter remains a separate optional client; Places provider API proxy remains disabled until explicit billing/quotas/privacy acceptance. Mobility intent is feature-gated and private, not activated for students.

## Plan

1. Consolidate reviewed source into main in dependency order, preserving runtime config and historic agent evidence. Use actual combined SHA CI before each merge.
2. Restrict repo PR cleanup to PRs whose source is proven integrated by ancestry or superseded by a selected backend; do not delete divergent history blindly.
3. Verify that the final main tree contains no tracked archive files and that production/staging Render autoDeploy is off.
4. Preserve external operational NO-GO; start a *separate* protected recovery and Render-readiness milestone after proper evidence/approvals.

## Progress log

- 2026-11-05 UTC — Merged PR #29 to main, rendering the OTP secret deployment blocker explicit.
- 2026-11-05 UTC — Reconciled diverged security/backup tree and merged PR #32 after ten GitHub checks; source-only, no migration.
- 2026-11-05 UTC — Reconciled Flutter/Places against idempotency-aware server, renumbered decision IDs, passed seven checks, merged PR #33.
- 2026-11-05 UTC — Reconciled mobility UI and browser fixtures against full idempotency requirements; passed ten checks including browser, merged PR #34.
- 2026-11-05 UTC — Added Docker excludes for dash-named PostgreSQL dump and archives and repository tracked-file tests; merged PR #35 with three passing checks.
- 2026-11-05 UTC — Verified no open PRs, 25 remote branches, clean main tracked filename audit; retained remaining branches for branch-safe archival/deletion review. No remote branch delete attempted.

## Verification

| Check | Evidence | Verdict |
|---|---|---|
| GitHub pull requests | Open PR listing | 0 open |
| Main source | `736fe7d` | Contains merged reviewed code |
| CI | PR checks for #32/#33/#34/#35, plus main postmerge | All reported passes |
| Tracked potentially sensitive archive filenames | Git tree recursive, 190 blobs, `test_secret_hygiene.js` | No matching tracked files |
| Remote branch count / safe ancestry | GitHub branches and comparisons | 25 refs remain; 17 ancestor candidates, 7 divergent |
| Render auto deploy | Both CampusPool services in confirmed Render workspace | OFF on prod and staging |
| Live deployment/recovery | Existing Render deployment history | NO new deploy; real Azure cold restore unavailable |

## Risks and decisions

- **Release NO-GO:** Source merges do not prove retained Render rollback artifacts, valid OTP provider credentials, data durability, private student data recoverability or readiness of migration 008. Production last live release remains older than `main`; a previous attempt failed the required strong `OTP_SECRET` startup guard. Keep this guard; secret changes belong in protected Render settings.
- The accidental WSL file `-` potentially contains staging data. Unix 0600 containment was verified; Windows volumes were unencrypted. Git/Docker ignore rules do not clean local disk blocks or history. Never commit, upload or assume secure erasure.
- **Branch cleanup is incomplete, deliberately:** Non-main remote refs remain because the connected GitHub API lacks a deletion action and several have unique commits. Do not force-update refs or run `git push --delete` on unreviewed/divergent branches. The GitHub UI or authenticated `gh` can delete reviewed redundant heads separately.
- Git filename pattern checks are not comprehensive secret scanning; historical compromised credential revocation still needs owner verification.
- Avoid merging unselected Cloudflare R2 backend alongside the chosen Azure path without explicit architecture reversal.
- Do not activate real mobile geolocation, Place searches, cloud backup schedules, payment/escrow, migration 008 or Render deployment by virtue of source integration.

## Next steps

1. Verify Google/OTP/SMTP protected Render configuration **by presence, not by exposing values**; inspect release gating and production durability. Fresh 32+ character `OTP_SECRET` required; verify old credentials revoked.
2. Finalize cloud backup-worker supply-chain pinning and owner-approved Azure Container Apps/identity/Key Vault resource creation; no automatic schedules without approval.
3. Execute one approved protected cloud-side encrypted staging backup and independent off-site cold restore to distinct PG17/PostGIS; compare RLS/roles/grants/content/migrations and verify retained Render rollback image.
4. Only after signed-off evidence, review migration 008, smoke test staging, and separately approve any production Render deployment at an exact commit.
5. After deliberate branch-history review, remove only reviewed redundant remote heads through GitHub UI/CLI; retain R2 alternative and divergent design branches until disposition is explicitly recorded.

## Links and files changed

- Merged source: PRs #29, #32, #33, #34, #35.
- Readiness: `docs/agents/NEXT_STEPS.md`, `docs/agents/STATUS.md`.
- Production impact: NONE; no deployment, migration or cloud operation.
