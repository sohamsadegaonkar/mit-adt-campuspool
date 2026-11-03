# Task: Establish durable multi-agent engineering handoffs

- **Task ID / file:** `2026-11-03-agent-workflow`
- **Status:** in review
- **Agent / owner:** ChatGPT engineering agent
- **Last updated:** 2026-11-03 UTC
- **Baseline:** `main@0345b6aeff86`
- **Scope:** repository agent instructions, agent docs, PR template, documentation-check CI; **no application business logic, database records, secret values, Render settings or payment flow**
- **Dependencies:** existing GitHub repo and 2026-11-03 status review; no previous agent handoff contract existed in main.

## Goal and acceptance criteria

Make every incoming development agent discover project context, keep accurate working Markdown notes, record actual progress and next steps, and leave a reusable handoff in Git. Validate the contract automatically for implementation PRs.

Acceptance: an incoming agent can determine current vs planned features, review blockers, choose a task, write a per-task record and pass CI only when implementation PRs update required shared docs.

## Current state (verified vs assumed)

Checked `main` at `0345b6aeff86`; PostGIS mobility matching and PostgreSQL identity/Rides code exist, Errands only a standalone demo, and two Render deployments are older than `main`. Automatic production deployment is currently off. CI has green PostgreSQL and hygiene results. Historical credential incident remains unverified as closed. This task does **not** inspect secrets or deploy.

## Plan

1. Define canonical root `AGENTS.md`, plus tool-specific pointers for multi-agent discovery.
2. Create docs for live status, prioritized next steps, architecture/dependency map and important deferred decisions.
3. Create a reusable task log template with explicit current/plan/progress/tests/next action.
4. Add PR template, CI validator and GitHub workflow; execute validation.
5. Link agent instructions from README and submit changes for review without touching production.

## Progress log

- 2026-11-03 UTC — Inspected repository HEAD, open PRs, CI, existing rollout runbooks and recent Render deploy metadata.
- 2026-11-03 UTC — Created this task and agent documentation on short-lived branch `docs/agent-working-agreement-2026-11-03`.
- 2026-11-03 UTC — Verification and PR review pending until the new workflow runs; do not report CI success or merge as complete before GitHub confirms.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Current GitHub state | GitHub `main@0345b6aeff86` and recent workflow metadata | Verified on 2026-11-03 |
| Docs contract | `node scripts/check-agent-docs.js` | Pending |
| PR diff enforcement | GitHub Actions `Agent documentation contract` | Pending |
| Production data/service | Not accessed or modified by this task | No production impact |

## Risks and decisions

Shared status/next-step docs may conflict when multiple PRs run concurrently; agents must rebase and reconcile rather than overwrite each other. Dedicated task logs reduce context loss and preserve branch-local ownership. The CI validator confirms files/required sections/diff presence, **not factual truth**. See `../DECISIONS.md` for the Redis/H3/microservices deferral and architecture context.

## Next steps — exact handoff

1. **Next action:** complete doc/CI file creation, open PR, run its Actions checks; fix any failing job.
2. **Who may do it:** assigned agent or repo reviewer; final merge is subject to PR checks and review.
3. **Prerequisites:** verify latest `main` has not moved and no conflicting PR exists.
4. **Expected evidence:** GitHub Actions success for documentation contract and known existing checks; after merge, new agents can read `AGENTS.md` on `main`.
5. **Production impact:** none. Do not trigger production Render deploy for a documentation policy update.

## Links and files changed

- Branch: `docs/agent-working-agreement-2026-11-03`.
- Root `AGENTS.md`; `docs/agents/`; `.github/` agent workflow/PR template; `scripts/check-agent-docs.js`; README index.
- Baseline production SHA observed `63ae5510bbe2`, staging SHA `cceadbf6251f`; neither changed by this task.
