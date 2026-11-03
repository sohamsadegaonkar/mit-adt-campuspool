# CampusPool GitHub Copilot instructions

Read root [AGENTS.md](../AGENTS.md) first; it is the binding multi-agent policy. Continue with [agent docs](../docs/agents/README.md), [current state](../docs/agents/STATUS.md), [next steps](../docs/agents/NEXT_STEPS.md) and [architecture map](../docs/agents/ARCHITECTURE_MAP.md).

For every coding task, maintain a unique file copied from [the task template](../docs/agents/tasks/TEMPLATE.md) documenting baseline, plan, progress, tests, blockers and exact next action. Implementation PRs must also update STATUS.md and NEXT_STEPS.md or CI fails.

Do not invent production readiness, store secrets in code/docs, enable unverified payments or introduce Redis/H3/Kafka/microservices without an evidence-backed decision.
