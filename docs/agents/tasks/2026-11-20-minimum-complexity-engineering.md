# Task: Minimum Complexity Engineering Protocol and CI review gate

- **Task ID / file:** 2026-11-20-minimum-complexity-engineering
- **Status:** in review / CI pending
- **Agent / owner:** application engineering; independent reviewer unassigned
- **Last updated:** 2026-11-20 IST
- **Baseline:** main@1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb
- **Scope:** repository policy, existing documentation CI checker, task and PR template, regression tests; no application behavior, cloud settings, deployment, database or branch protection changes.
- **Dependencies / related tasks:** owner approved minimum-complexity policy. Existing pending application #36/#45–49 and ops #37–44 retain scopes; reconcile after integration, no historical rewrite.

## Goal and acceptance criteria

Enforce a concise existing-task optimization review for implementation PRs. Require significant-level alternatives and evidence on known high-risk paths; include deletions and stacked PRs. Existing handoff guard remains. Clear reviewer limitations; no new dependencies or services. Positive and negative isolated Git test fixtures pass.

## Current state (verified vs assumed)

Main at 1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb; existing checker validates headings and task presence, but no complexity review; excludes deletions and only runs PRs targeting main. Prior decision register already discourages speculative infrastructure; reuse existing mechanism. Notion roadmap confirms G1 NO-GO and current parallel workstream. No branch protection edits.

## Plan

1. Add canonical rule and short reference guide. Put review record inside existing task template and PR checklist.
2. Extend existing Node validator; no extra dependencies. Include deletion path detection, merge-base comparison, significant path classification and exact review fields.
3. Run isolated temporary Git fixtures in existing workflow; enable stacked PR check. Record actual CI and independently review before merge. Notify active application/ops work through PR links without editing their branches.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Reuse existing AGENTS.md, task records, reviewer and docs checker; no separate optimization engine. Prior policy already rejects speculative Redis/H3; add universal record requirement.
- **Conventional alternative:** Manual-only PR checklist, no testable enforcement; low effort but easy to omit and no fail-closed signal.
- **First-principles alternative:** Require only evidence that a simpler alternative was considered and safety constraints preserved at the existing handoff boundary; use exact fields rather than semantic AI scoring or extra service.
- **Tradeoffs:** A few additional fields for significant work, four for small. One existing check extended, zero new dependencies, no runtime or infra cost. Path rules conservative, reviewer responsible for semantics and missing high-risk paths. Existing branches need reconciliation; reverting this source-only PR does not alter business runtime.
- **Decision:** Extend existing checker and templates, not a new CI service or scoring system. No mandatory novel technique, no numerical complexity score, no repeated benchmarking for no-op comparisons.
- **Evidence:** Existing checker read at main exact SHA: name-only diff omitted D, PR filter main, heading presence only. Prior PostgreSQL stress PR #49 531 operations p95 37.31ms is illustrative of measured simplicity, not evidence for validator performance.
- **Validation:** Run nine isolated Git-fixture tests with existing Node runtime; positive/negative cases, divergent base and deletions, required baseline. Verify exact-head GitHub CI, record current status.

## Progress log

- 2026-11-20 IST — checked main, open PRs, canonical operating documents, existing checker/templates and Notion roadmap.
- 2026-11-20 IST — prepared canonical policy, tiered review record, extended checker and regression fixtures in one scoped branch.

## Verification

| Test/check | Environment and command/evidence | Result / limitations |
|---|---|---|
| Existing source review | exact main at 1020e2e4a6d446b6b8b7b3bcedd188d02ef142fb | verified gaps |
| Agent docs regression fixtures | node --test test_agent_docs.js | exact-head CI pending |
| Actual PR check | existing agent-docs job | pending |
| Runtime / infrastructure | unchanged | no live access |

## Risks and decisions

CI checks structure, not reasoning quality, global optimum, novelty, security, or truthful evidence; independent review required. Path trigger is conservative and incomplete. Policy does not change protections/settings; required status check configuration not verified. Existing PRs must add record before integration after policy merge. Git diff compares merge base to head and checkout exact head. Prior history remains intact. No existing release gate is weakened.

## Next steps — exact handoff

1. **Next action:** verify exact-head CI and regressions; review and integrate policy PR first when authorized, then reconcile open PR task records.
2. **Who may do it:** application engineering / independent reviewer; repo owner for branch protection.
3. **Prerequisites and blockers:** no bypass of CI or G1; existing branches review independently. No production release implicated.
4. **Expected evidence:** nine fixture tests green, actual PR docs check green; policy applied to future PRs on main.
5. **Production impact:** none.

## Links and files changed

- Branch: docs/minimum-complexity-engineering-2026-11-20
- AGENTS.md; docs/agents/MINIMUM_COMPLEXITY.md; README.md; tasks/TEMPLATE.md; DECISIONS.md; STATUS.md; NEXT_STEPS.md; this task
- scripts/check-agent-docs.js; test_agent_docs.js; .github/workflows/agent-docs.yml; .github/pull_request_template.md
