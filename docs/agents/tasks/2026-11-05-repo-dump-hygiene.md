# Task: Prevent accidental dumps entering Git and Docker builds

- **Task ID:** `2026-11-05-repo-dump-hygiene`
- **Status:** code/test review in progress; local incident remains unresolved
- **Agent:** ChatGPT engineering agent
- **Last updated:** 2026-11-05 UTC
- **Baseline:** latest integrated `main` and the previously verified archive incident
- **Scope:** source-only `.dockerignore` and `test_secret_hygiene.js`; no archive reads, deletion, cloud writes, staging data, deployment or migration
- **Related:** `2026-11-04-azure-pgdump-stdout-incident.md`

## Goal and acceptance criteria

Ensure a filename literally `-` (previous `pg_dump --file=-` mistake), PostgreSQL dump/archive files and encrypted recovery artifacts cannot be accidentally committed or included in the **root Docker build context**. The secret hygiene CI must pass without hiding the owner-side untracked incident file from `git status`.

## Current state

A potentially sensitive 48,600-byte archive named `-` was previously created on an unencrypted Windows-backed WSL worktree. The operator confirmed owner-only 0600 file mode, but that does not erase raw disk remnants. This patch never reads or changes that file, and cannot retroactively sanitize history.

## Plan

1. Add `-`, `**/-` and common backup/archive suffixes to `.dockerignore`, which the root Render Docker build respects.
2. Extend Git tracked-file hygiene tests to reject unexpectedly committed archive and plaintext key material, including literal `-`.
3. Keep `-` **out** of `.gitignore`: the local incident must remain visible as untracked for owner inspection/remediation; do not silently conceal it.
4. Verify green CI, merge only tested source, keep actual staging and Render release NO-GO.

## Progress log

- 2026-11-05 UTC — Added Docker build-context exclusions and tracked archive filename checks in draft hygiene PR. No local file deletion or copy.
- 2026-11-05 UTC — Agent documentation check initially blocked because implementation PR needs a dated handoff; this task and STATUS/NEXT_STEPS added to resolve contract.

## Verification

| Check | Evidence | Result |
|---|---|---|
| Existing secret hygiene | GitHub PR initial CI | PASS before handoff updates |
| Agent doc contract | GitHub CI initial run | FAIL until this dated task and STATUS/NEXT_STEPS recorded |
| Docker build context and archive ignore checks | `test_secret_hygiene.js` | Requires fresh CI |
| Local plaintext cleanup / encrypted volume | Operator security incident | NOT DONE |
| Production deployment | Render | NOT PERFORMED |

## Risks and decisions

- Blacklisting filenames is defense in depth, not a substitute for secret scanning, secure credentials, employee/operator data handling or encrypted storage.
- Excluded `*.age` may also exclude encrypted test artifacts, which are not required in application image.
- The root `.dockerignore` does not rewrite any historical Git blob. Historical secret revocation and any local disk remnants must be handled separately.

## Next steps

1. Confirm all CI checks pass on final PR head.
2. Merge source only if safe and ensure root Docker build excludes archives.
3. Keep the local incident open until safe owner-selected handling and separate recovery verification.
4. Do not deploy, migrate staging or copy the artifact to cloud.

## Links

- Related incident: `2026-11-04-azure-pgdump-stdout-incident.md`
- Production impact: none
