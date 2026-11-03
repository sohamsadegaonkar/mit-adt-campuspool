# CampusPool: mandatory agent working agreement

**Applies to:** every coding, testing, security, product, deployment, and documentation agent working in this repository. This is the canonical agent policy. Tool-specific instruction files must point here, not establish conflicting rules.

## Non-negotiable documentation rule

**No implementation work is considered complete without a current Markdown handoff.** Every agent must document **what is happening, what was changed, what remains, and the exact next action based on observed repository state**. The documentation belongs in Git alongside the change, not only in chat, a private scratchpad, or a PR comment.

1. **Before work:** read `AGENTS.md`, `docs/agents/README.md`, `docs/agents/STATUS.md`, `docs/agents/NEXT_STEPS.md`, and relevant architecture/rollout notes. Check GitHub HEAD, open PRs, CI and relevant runtime state. Docs can be stale: distinguish verified state from plans.
2. **Claim a task:** use an issue/PR when available and create a uniquely named `docs/agents/tasks/YYYY-MM-DD-<slug>.md` copied from `tasks/TEMPLATE.md`. Record goal, owner/agent, baseline commit, dependencies, scope, acceptance criteria, risk and current status. Avoid simultaneously editing files owned by another active task; coordinate via PRs and task files.
3. **While implementing:** keep the task file up to date as checkpoints change. Record completed steps, work in progress, failures/blockers and verified evidence. Do not describe unmerged branches, mocks, feature flags or isolated staging tests as production features.
4. **Before PR/merge or handing off:** refresh `docs/agents/STATUS.md` (current truth) and `docs/agents/NEXT_STEPS.md` (prioritized unfinished work). Update `docs/agents/ARCHITECTURE_MAP.md` if boundaries or deployed dependencies change; update `docs/agents/DECISIONS.md` for substantive decisions or rejected alternatives. Finish the task record with concrete tests/results, modified paths, blockers, the next responsible action and whether production was touched.
5. **Handoff if unfinished:** mark the task `in progress` or `blocked`; identify the exact starting file, branch/PR, next command or test, expected result and explicit unknowns. Never silently abandon partial work. Link the task record from `NEXT_STEPS.md` if follow-up is required.
6. **On conflicts:** rebase/re-read the latest `main`, reconcile documentation with real changes, and avoid overwriting another agent's progress. Project-wide docs describe **merged or verified** state; task files describe branch-local work until integration.
7. **On every meaningful code PR:** GitHub CI requires the task record plus edits to `STATUS.md` and `NEXT_STEPS.md`. A failing docs contract means the work is not ready for merge. Repository admins should require this CI check and PR review using GitHub branch protection; direct pushes cannot be reliably blocked by a workflow alone.

## Evidence and wording

- Include a last-verified date (UTC), commit SHA/ref, test names/results and environment. Label statuses `implemented`, `tested (CI)`, `deployed (staging)`, `deployed (production)`, `proposed`, `blocked`, or `not verified` accurately.
- Do not claim a live delivery, credential revocation, backend migration, data persistence, legal clearance or production readiness without evidence.
- Never paste passwords, OTP values, database URLs, keys, tokens, personal student records, private contact details or verbose sensitive logs into Markdown, commits or issue comments.
- Create a separate short-lived branch and PR for unrelated changes. Keep changes small, tests reproducible and rollback explicit; do not silently modify unrelated features.
- **No production deploy, credential rotation, database migration, live payment enablement, mass data operation or history rewrite** without explicit authorization and a verified rollback/data-protection plan.
- Preserve secure defaults: verified server sessions, authorization/CSRF, fail-closed OTP provider configuration, atomic seat reservations, private geospatial data and payments disabled until trusted provider callbacks are verified.

## Architecture guardrails

- Current implementation is a Node.js modular-monolith-style HTTP API + static frontend; PostgreSQL/PostGIS capabilities are behind feature flags, while legacy SQLite code still exists. See `docs/agents/ARCHITECTURE_MAP.md` and detailed source rollout notes.
- Treat PostgreSQL as the authoritative persisted state for the proposed durable auth/rides/matching architecture. Do not use Redis to hold authoritative identity, booking, OTP consumption or monetary state.
- **Do not introduce Redis, H3, Kafka or microservices automatically.** First record a measurable bottleneck or requirement, benchmarking evidence, alternatives, tradeoffs, operational cost and a rollout/rollback proposal in `DECISIONS.md`. H3 is for potential aggregation/candidate indexing; PostGIS and a road-routing provider perform different jobs.
- Keep the Rides and Errands domains separate. Errands currently has a standalone demonstration prototype, **not** a production marketplace or payment implementation.
- Environments must remain isolated; do not copy production student data into staging. Refer to `PRODUCTION_RELEASE_GATE.md` and `SECURITY_CREDENTIAL_ROTATION.md` before any release.

## Agent quick-start checklist

- [ ] Read canonical docs and inspect actual code, GitHub state and environment.
- [ ] Create/update one named `docs/agents/tasks/...` file.
- [ ] Define expected behavior, tests, safety boundaries and next action.
- [ ] Make scoped changes; run appropriate tests and record factual results.
- [ ] Update `STATUS.md`, `NEXT_STEPS.md` and any affected architecture/decision documents.
- [ ] Submit PR with documentation evidence; do not claim merge/deployment until confirmed.
- [ ] Leave a handoff even when blocked, including the exact next step.

**If current documentation contradicts the implementation or runtime, investigate and correct the documentation; do not hide the discrepancy.**
