# CampusPool 2026-11-05 — Main consolidation and Render preflight handoff

- **Task ID:** `2026-11-05-main-consolidation-render-handoff`
- **Status:** source consolidation complete; branch pruning requires explicit GitHub ref deletion capability; Render release remains **NO-GO**
- **Owner:** CampusPool engineering agent; cloud/database account owner handles live credentials, backups and deployments
- **Date:** 2026-11-05 IST
- **Scope:** GitHub repository status, CI and branch hygiene, read-only Render checks. No student data access, provider test, Azure resource creation, migration or deployment.

## Goal and acceptance criteria

Consolidate reviewed CampusPool source changes into `main`, keep relevant audit history, close obsolete pull requests, prevent accidental backup archives entering Git/Docker, and leave one clear pre-Render release handoff. **Code merged is not equivalent to student-data recovery or permission to deploy.**

## Current state

- Production and staging Render CampusPool services both track `main` but **automatic deployment is off**. Production deployment history records older `63ae551` as live and later `056cd26` as failed due to the strong `OTP_SECRET` startup guard. Staging still reports `cceadbf` live.
- GitHub PRs [#29](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/29) (Render audit), [#32](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/32) (security/idempotency/Azure cloud worker), [#33](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/33) (Flutter/Places), [#34](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/34) (mobility), and [#35](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/35) (dump hygiene) are merged into `main`.
- `main` source after #35: `736fe7d3aa11b366ac924fffa011cc8952552d48` (before this handoff commit). At that checkpoint **zero open PRs**. The newest source-only PR #35 has green unit/hygiene CI.
- Review of the GitHub tracked tree identified **no obvious tracked dump/AGE identity, SQLite runtime DB, archive, APK or VHDX file** in the checked tree. PR #35 adds `.dockerignore` exclusions for unexpected `-` and archive names and strengthens tracked-file tests. This does not remediate old local incident copies or historical credentials.
- Remaining many remote branches are old development and reconciliation refs. Some are true ancestors of `main`; several older squash-merged branch refs are technically divergent, so do **not** indiscriminately delete them. An optional Cloudflare R2 alternative has separate unmerged commits and is deliberately **not** in main because Azure was selected; its PR #25 is closed/superseded.
- New backend functionality/migration 008 and opt-in mobility remain **not launched**. Google Places is default-off and not approved for billing. Cloud backup worker source is merged but no Azure Container Apps Job, Key Vault or actual backup/recovery target has been provisioned by this work.

## Plan

1. Keep final code on `main`; do not force-update or rewrite its history. Confirm post-merge CI and read-only Render deployment history.
2. Only delete remote branches after a provenance and ahead/behind review. For true ancestors, the operator can safely inspect dry-run output of `git for-each-ref refs/remotes/origin` and remove each with `git push origin --delete`; retain Cloudflare R2 or any branch with unique commits unless separately approved for abandonment. The currently connected GitHub integration lacks a direct branch-ref deletion operation; **no remote branch deletion is claimed**.
3. Preserve no-GO for migrations and hosting until encrypted cloud-generated staging backup, independent restore and rollback are verified.

## Progress log

- **2026-11-05:** Merged release audit PR #29.
- **2026-11-05:** Combined security/recovery/cloud-worker PR #32 after ten passing checks; retained mainline runtime and benchmark code, with legacy task documentation normalized.
- **2026-11-05:** Merged Flutter/Places PR #33, preserving security and flag-off provider endpoints.
- **2026-11-05:** Merged mobility UI PR #34 after browser fixture was fixed to supply a required idempotency key, preserving 428 key-required protections. Ten checks passed, including desktop/mobile real-browser tests against disposable PostGIS.
- **2026-11-05:** Merged archive hygiene PR #35; Docker context now excludes local backups and tracked-file CI rejects archive/identity filenames.
- **2026-11-05:** Read-only Render check confirmed production and staging auto-deploy remain off and still run older builds. No production or staging deployment initiated.

## Verification

| Verification | Evidence | Status |
|---|---|---|
| Security/recovery integration | PR #32 | PASS 10/10 pre-merge checks |
| Flutter/Places integration | PR #33 | Source merged; Flutter, Places, Node tests reviewed |
| Mobility/browser integration | PR #34 | PASS 10/10 pre-merge checks after idempotent fixture correction |
| Git/Docker archive hygiene | PR #35 | Merged, checked 3 green CI tests |
| Open GitHub PRs | GitHub listing after PR #35 | 0 |
| All historic branches deleted | Direct ref-deletion tooling absent | NOT DONE |
| Production/staging auto deploy | Connected Render services list | OFF |
| Real cloud backup with separate encrypted PG17/PostGIS cold restore | Azure recovery incident | NOT DONE |
| Render rollback artifact and strong OTP secret/proprietary provider acceptance | Production release checklist | NOT VERIFIED |
| Production migration/deployment | Render | NOT PERFORMED |

## Next steps

1. Recheck `main` post-merge CI, `git status` and tracked-file exclusions; ensure no untracked incident dump is staged from Ubuntu-D.
2. Prune only confirmed redundant GitHub remote branches with appropriate admin/CLI permissions; do not delete the unmerged R2 alternative, valuable rollback refs, or branches with unique work by default. Verify `main` remains default.
3. Review production `OTP_SECRET` strength privately in Render. Never paste or log its value. Do not weaken the startup guard.
4. Finish secure cloud worker supply-chain hardening: lock dependencies, pin image digests, review Key Vault/managed identity, manual-only region/cost authorization and network scope.
5. Produce one approved cloud-side encrypted staging archive, independently retrieve and cold restore it in encrypted PG17/PostGIS with roles, RLS, migration and content parity. Confirm retained Render rollback artifact and data durability.
6. Only then prepare a separate controlled staging deployment and real OTP/device/privacy QA; production release needs separate GO. Do not enable feature flags or apply migration 008 prematurely.

## Links

- [GitHub main](https://github.com/sohamsadegaonkar/mit-adt-campuspool/tree/main)
- [Azure cloud worker runbook](../../ops/CLOUD_AZURE_BACKUP_WORKER.md)
- [Render production readiness task](2026-11-05-render-production-readiness.md)
- [Azure stdout incident](2026-11-04-azure-pgdump-stdout-incident.md)
- **Production impact:** None from this handoff document.
