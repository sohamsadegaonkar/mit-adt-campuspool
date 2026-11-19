# Minimum Complexity Engineering Protocol

**Owner-approved direction:** 20 November 2026. **Activation:** repository PR review; CI enforcement starts on branches containing this change and after integration into main. No live release authorization is implied.

## Objective

Use the simplest sufficient, measurable solution; favor eliminating unnecessary operations before optimizing each operation. Aim for a Pareto improvement where possible: same or better correctness and safeguards with less overhead, cost, latency, state or maintenance. There is no universal scalar efficiency score. No claim of globally optimal algorithms or originality without evidence.

## Before implementation: bounded optimization loop

1. Specify real user outcome, existing behavior, non-negotiable invariants, scale and acceptance criteria. Inspect current source and its tests; ask whether an existing primitive or no code change suffices.
2. Remove needless work: duplicate requests, state copies, round trips and abstractions; use built-in/platform semantics where they fit. For significant work compare at least three plausible options (existing/smallest, conventional, first-principles). A hybrid or experimental design is optional if its potential advantage is concrete. Explain when an option cannot meet a hard constraint. Do not spend time manufacturing fake alternatives for trivial changes.
3. Evaluate correctness first, then relevant complexity measures: time/space growth when meaningful, p50/p95/p99 with sample size/workload, DB queries/lock/queue cost, CPU/RAM/IO, network hops, infrastructure cost, dependency count and maintainability. Avoid optimizing irrelevant metrics; document what was measured vs estimated.
4. Choose the smallest sufficient option; justify extra parts and rejected alternatives. Prototype/benchmark only the uncertain tradeoffs that could change the decision. Set comparable conditions, representative inputs, warm/cold distinction if relevant, and record commands/results. A new technique is worthwhile only if it satisfies the same invariants and justifies its added risks.
5. Implement a scoped change. Test happy, failure, retry, authorization and race cases when relevant. Compare measured behavior to the baseline and acceptance thresholds; if a simpler approach works, discard needless complexity. Record rollback, compatibility and untested limits.
6. Require independent review of material changes. Stop when constraints are met and remaining optimization has no material justified benefit; do not endlessly search for perfection.

## Review levels

- **small**: bounded bug/test/refactor with unchanged external contract, security/transaction guarantees, architecture and dependencies. A short four-field record is enough.
- **significant**: behavior/architecture/API/schema/security/privacy/transaction/scaling/algorithm/dependency/operational changes or nontrivial performance claim. Complete the additional fields. A significant change can be small in lines. CI flags dependency manifests, migration paths, deployment/config/workflow and the validator itself; reviewers must escalate any material change missed by path rules.
- Pure Markdown documentation updates do not require a new review record under the automated contract. Document important policy/architecture decisions anyway.
- Test-only changes qualify as small only when bounded without material workload, fixture, security or release-gate changes. Deletions qualify for review just as additions do.

## Record format (in the existing dated task)

### Small example

```md
## Minimum complexity review

- **Level:** small
- **Existing / smallest:** Existing validator accepts a malformed field; a single guard at the existing boundary suffices.
- **Decision:** Add the guard; no new helper, dependency or state.
- **Validation:** Regression rejects malformed values and accepts the previous valid cases; command and outcome in Verification.
```

### Significant example

```md
## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** Retain the existing PostgreSQL transaction and unique booking constraint; check observed remaining capacity under the existing lock.
- **Conventional alternative:** Redis distributed locking; extra consistency and outage modes without replacing authoritative SQL constraints.
- **First-principles alternative:** Derive capacity from active booking rows with a single transactional write boundary; extra aggregation/constraint tradeoffs require measurement.
- **Tradeoffs:** Preserve atomic seat and receipt invariants; compare lock waits, query count, latency, storage, cost, failure modes and rollback. No live data.
- **Decision:** Retain SQL transaction until representative mixed HTTP workload proves a constraint; avoid extra state.
- **Evidence:** Isolated PR #49 code df02678: 531 mixed-wave attempts, 173 invariant snapshots, p95 37.31ms, zero unexpected errors; synthetic store-level only, not production SLA. No controlled comparison of alternatives yet.
- **Validation:** Measure baseline mixed HTTP and pool pressure; no duplicate bookings or invariant violations permitted. No infrastructure adoption without review.
```

For pending work, evidence may identify an observed source/measurement baseline and clearly specify missing evidence; validation must give the actual test/measurement plan and later result in Verification. Do not claim unmeasured alternatives are faster. Use prose, not scores falsely implying precision.

## Enforcement and limits

`scripts/check-agent-docs.js` checks the existing handoff plus the exact review heading and non-placeholder required fields in changed dated task records for implementation PRs. It counts deleted implementation paths, does not require separate files or dependencies, and uses merge-base comparison for divergent/stacked PRs. It enforces significant for a deliberately conservative path list. Reviewers must look past field presence and reject boilerplate, unsafe shortcuts, unverifiable claims or misclassified work. CI is not a proof of optimality or a substitute for branch protection/required review. The rule becomes a merge control only when the existing job is required by repository settings. No repository settings, sharing, hosting or release changes are authorized by this document.

Existing open PRs should reconcile after the policy is integrated; add the record to the existing task without rewriting unrelated history. The task owner coordinates status/next-step conflicts. This rule must not override recovery gate G1 or the separate DevOps workstream.
