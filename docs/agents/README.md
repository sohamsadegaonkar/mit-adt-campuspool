# Agent documentation: start here

This directory is the **shared continuity system** for multiple development agents on CampusPool. `AGENTS.md` at repo root is the governing policy. These files are intended to prevent context loss and accidental duplicate work when agents change.

| Document | Purpose | Update policy |
|---|---|---|
| [STATUS.md](STATUS.md) | Verified current code, CI, deployment, blockers | Every implementation PR; after each release |
| [NEXT_STEPS.md](NEXT_STEPS.md) | Ordered work queue, owner, dependencies, acceptance criteria | Every implementation PR; when priorities change |
| [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md) | Current technology, modules, flags, trust boundaries and relevant docs | Whenever architecture/runtime behavior changes |
| [DECISIONS.md](DECISIONS.md) | Decisions and deliberately deferred technologies with evidence | Every substantive architecture or release decision |
| [tasks/TEMPLATE.md](tasks/TEMPLATE.md) | Required per-task plan, progress log, verification and handoff fields | Copy for each independent task |
| [tasks/](tasks/) | Individual agent/PR logs; unfinished work can be resumed without chat | Start, checkpoints, and completion |

## Order for a new agent

1. Read `/AGENTS.md` and this page.
2. Read `STATUS.md`, `NEXT_STEPS.md` and `ARCHITECTURE_MAP.md`.
3. Check `main`, PRs, Actions and relevant Render/Supabase runtime data independently.
4. Read the relevant detailed project document from `ARCHITECTURE_MAP.md` (e.g., mobility or Rides rollout).
5. Claim a distinct task filename in `tasks/`, record the baseline ref and work only within the approved scope.
6. Keep its progress/handoff current. Before merge, reconcile and update `STATUS.md` and `NEXT_STEPS.md`.

## Truth hierarchy

1. Verified running deployment/database and recent executed tests.
2. Current repository code, migrations and tracked config at an exact commit.
3. Active work documented in a task file and PR, explicitly marked unmerged.
4. Project-wide Markdown and older instructions — **may be stale**; confirm before trusting.

An empty task ownership field is not authorization to deploy. If ownership or deployment authorization is unclear, treat the action as unapproved.

## Concurrency and review rules

- Use a unique task file rather than editing someone else's task record. Communicate dependencies in PR links.
- Branch-specific progress lives in the task record. Project-wide docs should truthfully describe `main` and verified deployments; write pending implementation as pending until merged.
- All implementation PRs update shared status/next-step docs; resolve conflicts against latest `main` as part of review. Keep changes minimal to reduce churn.
- A PR description or model response is **not** the long-term handoff. A Markdown record in Git is.
- Automation checks document presence, required sections and PR diffs, not factual accuracy. Human/agent review must verify claims.
