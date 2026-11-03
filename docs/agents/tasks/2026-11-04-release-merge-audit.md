# Task: CampusPool pre-deployment merge and release audit

- **Task ID / file:** `2026-11-04-release-merge-audit`
- **Status:** verified read-only checks; release blocked by owner-operated data recovery and security gates
- **Agent / owner:** ChatGPT engineering agent for audit and safe source integration; account owner for private backup, rollback eligibility, credential revocation and final release signoff; independent reviewer unassigned
- **Last verified:** 2026-11-03 UTC (2026-11-04 Asia/Kolkata)
- **Baseline:** `main@3ee1f4a12e984cb6aecbf8ea09150d1e79556c87` before this audit; `main@a76eaca895dc0a4df97d9a2d11e26f97441b9fec` after safe PR #15 squash merge
- **Scope:** inspect repo/PRs/CI, connected Render service/deploy metadata, Supabase staging project/migration metadata, safe-source merge decision and blockers. No staging/prod redeploy, service env change, SQL migration, student data export, live writes, payments or secret operations
- **Related:** PRs #11–#15, `AGENTS.md`, `PRODUCTION_RELEASE_GATE.md`, `STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md`, `SECURITY_CREDENTIAL_ROTATION.md`

## Goal and acceptance criteria

Honor the owner's request to evaluate and merge *healthy, independent, low-risk* changes before a Render rollout, without assuming CI is equivalent to an independent privacy review or a recoverable live deployment. Produce an exact audit of merged and withheld PRs, branch/deploy SHA, passing checks, dependencies, migration status, backup/rollback/credential gates and who must act next. Never trigger a deployment without a proven data-protection/rollback plan.

## Current state

- Source-of-truth main before the audit was `3ee1f4a`; five open PRs #11–#15.
- **PR #15:** solely a deterministic synthetic PostGIS burst benchmark workflow, aggregate-only test/QA code, extra npm test scripts and Markdown status/decision docs. Does **not** modify `server.js`, `index.html`, database migration, service config, live payment or authentication logic. All five PR checks passed on `438498c5`. User explicitly requested safe branch merges. PR #15 was marked ready for review, then **squash-merged**, yielding `main@a76eaca895dc0a4df97d9a2d11e26f97441b9fec`.
- **Post-merge main checks:** Stage 1 PostgreSQL/PostGIS #41712374613 PASS, secret hygiene #41712374669 PASS and agent documentation #41712374540 PASS. Benchmark workflow was already independently green on #15 branch (128/128 synthetic students), and did not run again on the `main` push.
- **PR #11:** draft, unmerged, mixes transactional idempotency and migration `008_transactional_idempotency.sql` with security/backup tooling; no independent approving review, and staging restore/rollback prerequisites remain missing. **Do not merge/release yet.**
- **PR #12:** draft and stacked on PR #11, read-only restored-data comparator. **Do not merge out of order.**
- **PR #13:** open ready-for-review, stacked on #12, content-digest restore hardening. A `COMMENTED` review is not an approval; no independent restored dataset. **Do not merge out of order.**
- **PR #14:** draft, unmerged, behind authenticated server feature flag, with 30/30 synthetic browser cases PASS on run #41705501135 and all four other CI workflows green. A `COMMENTED` review is not an independent approval; real staging/phone E2E and privacy assessment remain open. **Do not merge/release without independent review.**
- Render `mit-adt-campuspool` production service: branch `main`, auto-deploy `off`, current `live` deploy `dep-dbj5auss728c738sa94g` commit `63ae5510bbe23107288441fe4f2c07ac39b82b1a`, 2026-10-31. Render `mit-adt-campuspool-staging` staging service: branch `main`, auto-deploy `off`, current `live` deploy `dep-dbke9uo8v5cc738cpnd0` commit `cceadbf6251f70634320e50b8288530ba77513c3`, 2026-11-02. These are metadata checks, not user-flow E2E; neither was redeployed.
- Connected private staging Supabase project reports **ACTIVE_HEALTHY**, PG 17.11. Migration list includes 001–007, **no 008**. Supabase security advisor returned no lints on this check, which is **not proof of full security, restore or readiness**.
- The operator/recovery runbooks explicitly say the actual staging encrypted off-site backup, independent archive re-download/digest verification, independent PG17/PostGIS recovery of real staging roles/schema/data, and Render retained previous-build rollback eligibility are **not evidenced**. Previously green synthetic backup/restore tests cannot substitute.
- Historical Gmail SMTP App Password and OTP signing-secret rotation/revocation remain unverified by the account owner; real approved Resend/MSG91 email/SMS receipt and physical-device flow remain unverified. Production uses legacy SQLite Rides and needs reconciliation/data migration planning before a feature release.

## Plan

1. Verify repo PR list, commit SHAs, dependencies, reviews, current CI and actual Render metadata.
2. Verify connected staging project health, migration list and security advisor **without reading student rows or modifying SQL**.
3. Integrate only independently scoped, tested, non-runtime PR #15; verify new main's CI; hold chained idempotency and user-facing mobility PRs behind their explicitly documented gates.
4. Document a staged release preflight with distinct **GO / NO-GO** conditions, exact owners/evidence and rollback baseline. No live deploy until the missing evidence exists.

## Progress log

- 2026-11-03 UTC — Audited open PRs #11–#15: all CI tested, but review approvals absent. #11–#13 are nested, and #11 contains additive DB migration 008. #14 feature matches behind a flag but still needs independent privacy/security/physical-mobile acceptance.
- 2026-11-03 UTC — Verified Render staging and production are still on older live commits with auto-deploy OFF and no confirmed retained-artifact rollback eligibility. Confirmed staging Supabase PG17.11 ACTIVE_HEALTHY, migration ledger 001–007 only, security-advisor lints empty.
- 2026-11-03 UTC — Squash-merged safe PR #15 into main, SHA `a76eaca`. Checked post-merge CI: PostGIS, credential-hygiene and agent docs all PASS. PR #15 status is merged/closed.
- 2026-11-03 UTC — Explicit **NO-GO** on Render staging/production deployment because owner-operated encrypted backup, independent restore and rollback-artifact eligibility remain unverified; no service/database mutation performed.

## Verification

| Check | Evidence | Result / limitations |
|---|---|---|
| PR #15 five checks | GitHub PR SHA `438498c5`; benchmark #41711049426 + security, PostGIS, docs, secrets | PASS; safe source integration |
| Main after PR #15 merge | SHA `a76eaca`: PG #41712374613, secret hygiene #41712374669, agent docs #41712374540 | ALL PASS |
| PR #14 synthetic browser QA | #41705501135, 30/30 Chromium/Firefox/WebKit | PASS in isolated CI, not staging or independent review |
| PR #11–13 dependency chain | GitHub PR base branches and state | All open; no approving reviews; live recovery gate still pending |
| Render production/staging deploys | Connected Render service + deploy lists | Baseline SHAs verified; auto-deploy OFF; prior rollback artifact eligibility NOT proven |
| Staging Supabase migrations | list_migrations; project healthy | 001–007 present, 008 absent; no SQL changes |
| Supabase security advisor | staging security lints = [] | No current lints; not a full security or backup attestation |
| Actual staging encrypted off-site backup and independent restored data | Operator-run recovery evidence | NOT VERIFIED — NO-GO |
| Historical exposed secrets revoked and real OTP provider delivery | Account owner/provider evidence | NOT VERIFIED — production NO-GO |
| New Render deployment | Connected service history | NOT PERFORMED — blocked |

## Risks and decisions

- No current user claim, automated test, historical `live` deploy entry or accessible repo document establishes that a retained Render rollback image remains actually usable.
- An unverified PostgreSQL recovery target makes migrations/deploys unsafe even if current staging appears empty or healthy. Do not migrate 008, assume downtime is harmless or copy actual student records into CI.
- The important user-facing PR #14 is a **release candidate**, not a reviewed/approved feature. Retain branch and tests while obtaining independent security/privacy/mobile review. No bypass of provider OTP safeguards.
- PR #11–13 must be reviewed and landed in explicit dependency order after real backup/rollback evidence; never directly merge child PR #13 to `main` and accidentally sweep its parent dependency chain.
- No paid provider provisioning, live payment enabling, Redis, H3, additional microservice or production environment mutation was requested or performed by this audit.

## Next steps

1. **Account owner (private operator action):** verify historic Gmail App Password revocation and rotate exposed signing secrets; record private dated evidence without logging values.
2. **Account owner + staging DBA:** on a trusted encrypted machine export the ACTUAL staging PG17/PostGIS roles/schema/data, encrypt off-site, re-download checksum-verified bytes independently, decrypt and cold-restore into a *different approved isolated* PG17/PostGIS scratch project. Then execute the PR #13 read-only compare after code review; record only metadata/verdict, not student data or hashes.
3. **Render staging operator:** in the Render dashboard independently confirm the **retained rollback artifact/button** for prior successful stage deploy `dep-dbke9uo8v5cc738cpnd0` at `cceadbf`, and document tested recovery procedure. A deploy row marked `deactivated` is not sufficient.
4. **Independent reviewer:** approve or request changes to PRs #11–#14, including the nested 11→12→13 recovery/migration chain, session/CSRF/idempotency and privacy/physical-mobile UX of #14. No person has been assigned as reviewer in this audit.
5. **After all staging prerequisites and explicit owner release GO:** build/deploy **exact reviewed** commit to staging only, migrate staged schema only in a planned transaction with rollback strategy, test real provider OTP under controlled accounts and complete browser/physical-mobile E2E; capture deployed SHA, data checks and logs.
6. **Production GO separately:** require revocation proof, true provider delivery, validated durable Rides migration, verified off-site backup and restoration, reversible release plan, legal/privacy review, monitoring and an explicit final GO. No automatic promotion or unconditional main deploy.
7. **Next engineering action not requiring live access:** independently review #14 and #11–13; maintain draft branches and create a staging runbook checklist where needed. Audit state again before future merge or deploy.

## Links and files changed

- Merged safe PR: https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/15
- Held pending independent review/recovery: PRs #11–#14.
- Runtime metadata baselines: staging `cceadbf6251f`, production `63ae5510bbe2`.
- Files: this task, `docs/agents/STATUS.md`, `docs/agents/NEXT_STEPS.md`.
