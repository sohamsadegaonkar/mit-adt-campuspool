# Task: Read-only comparison of a recovered staging backup

- **Task ID / file:** 2026-11-03-staging-restore-compare
- **Status:** in review — branch implementation; real staging restore blocked
- **Agent / owner:** ChatGPT engineering agent (code and isolated tests); authorized account operator (private recovery execution)
- **Last updated:** 2026-11-03 UTC
- **Baseline:** main@3ee1f4a12e98; idempotency PR #11 head a1a06b767508912e5380668dc22f1f5a39226cf8
- **Scope:** scripts/staging-restore-compare.js, test_staging_restore_compare.js, package.json, CI, operator runbook and mandatory docs. No new live DB, credentials, migration, staging deployment, production action or data changes.
- **Dependencies / related tasks:** PR #11; staging actual backup gate (2026-11-03-staging-backup-restore-gates.md); operator export tool (2026-11-03-secure-backup-operator-tool.md)

## Goal and acceptance criteria

After an independently restored real staging backup is available, compare the known Supabase staging PostgreSQL source with a **different, explicitly approved** scratch Supabase target. Refuse same-project, wrong environment, weak/missing TLS or unsanctioned restore project. Use only read-only transactions and print no URLs, passwords, SQL diagnostics or patient/student records. Compare campus table definitions, columns, indexes, constraints, RLS policies, role privileges, relevant extensions, migration-history versions and aggregate row counts. Fail on differences. Never set a release-ready status.

## Current state (verified vs assumed)

- Baseline PR #11 implements transactional idempotency and guarded local encrypted staging export, but actual staging backup, off-site ciphertext download verification, independently restored actual staging data and Render rollback artifact eligibility are **not verified**.
- The stage source is the dedicated Supabase project ref tnitksrlntrdxbvznxzf. Migration 008 is not reported as live; PR #11 remains unmerged.
- This tool is a *read-only verifier only*. It neither creates a backup nor restores bytes, verifies off-site provenance, certifies individual row content or tests private role passwords.

## Plan

1. Implement explicit --preflight and --compare modes; require trusted operator-provided private stage and different scratch target with verified project reference and TLS.
2. Check exact catalog metadata and row counts within repeatable-read read-only transactions; print only category names on failure and never release approval.
3. Add unit tests including mismatched RLS/counts, same-project refusal, SQL read-only contract, rollback and no credential leakage. Wire into security workflow.
4. Keep release gate NO-GO pending *real* off-site/restore/rollback evidence and independent operator approval.

## Progress log

- 2026-11-03 UTC — Reviewed AGENTS.md, current PR #11 and release handoffs. Created independent branch security/staging-restore-compare-2026-11-03 from a1a06b7.
- 2026-11-03 UTC — Implemented read-only schema/grant/count comparison, strict staging vs. separate scratch project guard, sanitized CLI results and isolated mock tests.
- 2026-11-03 UTC — Initial local Node 22.16.0 four synthetic tests passed with a local copy of the backup-guard contract; real repo/CI integration still to be confirmed. No live DB accesses made.
- 2026-11-03 UTC — Wired to package script and security CI. Exact branch CI status pending review.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Unit guard and SQL fake-client tests | Local Node 22.16.0, node --test test_staging_restore_compare.js with local guard-contract copy | 4/4 pass; mock/synthetic only |
| Syntax | node --check scripts/staging-restore-compare.js | PASS locally |
| Full repo security smoke | GitHub Actions on proposed PR | Pending |
| Real source vs independently restored scratch | Private owner-provided stage/scratch PostgreSQL 17+ | NOT RUN / BLOCKED |
| Render baseline artifact eligibility | Render staging dashboard | NOT VERIFIED |

## Risks and decisions

- **Counts are not row-content checksums**; a matching comparison is necessary verification but *insufficient* recovery evidence. Operator must independently confirm encrypted off-site archive provenance, decryption, full SQL restore success, migration history and sampled/test-controlled data validity.
- Supabase default-managed schemas may be provider-version-specific; this checks campus application objects, selected security roles/extensions, and migration version entries, not every provider-managed object. A restored app-role password may need separate secure provisioning; this tool cannot validate role credentials.
- Catalog comparison can produce conservative false mismatches if source writes during the check; schedule a maintenance/frozen-write window. Read-only queries have timeouts.
- Explicit two-project credentials are private environment values on the approved machine; tool errors are sanitized; no credentials belong in Git, CI, chat or task files.
- The source is read-only. The script **cannot** restore, migrate, deploy, authorize production or replace a human/DBA recovery signoff.
- No Redis, H3, microservice, payment or transactional business-logic changes.

## Next steps — exact handoff

1. **Next action:** Review PR CI and SQL semantics. Owner must independently create and download-check an encrypted off-site *real stage* backup and restore it to a distinct approved compatible Supabase scratch project, then run the read-only comparer with private URLs.
2. **Who may do it:** engineering reviewer for code/CI; authorized account owner for export, scratch restoration, and Render rollback artifact inspection.
3. **Prerequisites and blockers:** stage-only owner credentials kept off Git; scratch project reference/credentials; ciphertext remote provenance, decryption and successful SQL restore; release approval separate.
4. **Expected evidence:** CI green; comparison reports matches=true with releaseReady=false, independent restore/decryption/count/RLS report, migration history and Render retained rollback target cceadbf6251f verified.
5. **Production impact:** none; staging source unchanged; actual recovery not done.

## Links and files changed

- Branch/PR: security/staging-restore-compare-2026-11-03, targets unmerged idempotency PR #11 (not main)
- Relevant file paths: scripts/staging-restore-compare.js, test_staging_restore_compare.js, package.json, .github/workflows/security-smoke.yml, STAGING_IDEMPOTENCY_RELEASE_RUNBOOK.md, docs/agents/{STATUS,NEXT_STEPS}.md
- Last known staging deploy SHA (historical verified): cceadbf6251f; actual current live state not rechecked in this task
