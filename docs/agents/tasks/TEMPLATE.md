# Task: <short human-readable name>

- **Task ID / file:** `YYYY-MM-DD-topic-slug`
- **Status:** proposed | in progress | blocked | in review | completed
- **Agent / owner:** <agent identifier; do not invent an owner>
- **Last updated:** YYYY-MM-DD UTC
- **Baseline:** `main@<sha>` (plus feature branch, PR, deployment if applicable)
- **Scope:** <explicit paths/components; say what is out of scope>
- **Dependencies / related tasks:** <file paths, issues, PRs>

## Goal and acceptance criteria

What problem are we solving? Describe measurable user outcome and tests that determine completion.

## Current state (verified vs assumed)

Summarize what the repo/CI/staging/production currently does and **how it was verified**. Distinguish proposed or branch-local functionality from merged/deployed code.

## Plan

1. Concrete step with expected output.
2. Tests and data-protection controls.
3. Release/rollback and documentation requirements.

## Progress log

- YYYY-MM-DD UTC — <what actually changed; paths/commit/PR, or blocker>. Keep this updated as the work evolves, not just when it ends.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| <name> | <command, CI run, URL or query without secrets> | pass / fail / not run |

## Risks and decisions

List architectural choices, security/privacy issues, backwards compatibility and any unverified assumptions. Link `../DECISIONS.md` if a system-level decision was made.

## Next steps — exact handoff

1. **Next action:** <specific change, code path or test>
2. **Who may do it:** <owner or unassigned; avoid inventing approvals>
3. **Prerequisites and blockers:** <credentials, test environment, review>
4. **Expected evidence:** <objective completion signal>
5. **Production impact:** none | proposed | performed and verified (include approval and SHA)

## Links and files changed

- Branch/PR:
- Relevant file paths / related runbook:
- Last known deployment SHA (if relevant):

**Do not delete blocked tasks or mark work complete because tests were merely planned.**
