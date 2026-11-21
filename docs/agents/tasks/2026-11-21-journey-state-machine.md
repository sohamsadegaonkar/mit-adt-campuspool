# CampusPool real driver-reported journey lifecycle
- **Task ID:** 2026-11-21-journey-state-machine
- **Status:** implementation in progress / CI pending / unmerged, undeployed
- **Owner:** application engineering, independent security and product review unassigned
- **Last updated:** 2026-11-21 UTC
- **Baseline:** main 1020e2e; parent #59 b252b6e, #50 minimum complexity rule
- **Dependencies:** stacked #47–59 PRs, migration 010 review, owner launch approval, G1 NO-GO.

## Goal and acceptance

PostgreSQL-backed, driver-attested scheduled -> departed -> pickup_ready -> arrived with database timestamps; no automatic stage inferred from timers/GPS. Owner-only, CSRF-protected, transactionally idempotent POST. Active passenger sees real persisted timestamps in private bookings; owner sees ride milestones. Bookings close on departure, GPS access ends at arrival, no silent financial settlement. Maintain passenger history and existing Pending state. Animate only *after* verified read of persisted state.

## Current verified state

#59 parent passed PostgreSQL/browser/smoke, 7/7 motion VM and 30 browser E2E, Rush 3880/3880. Schema 006 had only active/cancelled; stage not implemented. 009 payment mode remains unapproved for live. Main unchanged.

## Minimum complexity review (significant)

- Existing/smallest: add journey stage and three nullable timestamps to existing ride row, existing transaction locks and private HTTP/session/idempotency. Reuse booking and owner reads, no event bus, Redis or workers.
- Conventional alternative: audit event stream/WebSockets; future option if warranted but adds retention and deployment complexity.
- First principles: only a real user action recorded on server can drive a status; this is **driver self-report**, not independent arrival proof. Never present live car motion/ETA based on clock.
- Tradeoffs: driver can misreport; passenger confirmation not built; no-show and dispute resolution absent. Stop new reservations after departure, disallow booking cancellation after departure to preserve seat/fare invariants; allow emergency ride cancellation before arrival, disallow after arrival. Existing dues never settled automatically. The stage can persist if feature turned off; no rollback that rewrites historic stages. Read-only historical snapshots stay protected.
- Rollout: new migration 010 runs in disposable CI only; schema requires separate operator approval and coordinated deployment before enabling. Flag RIDES_JOURNEY_ENABLED defaults OFF and needs PG Rides. No live writes authorized.

## Implementation plan and progress

- 2026-11-21 UTC — verified #59 and schema; drafted backend milestone state machine, 010 and safety rules. Add UI and CI tests next.

## Verification

| Test | Scope | Status |
|---|---|---|
| Journey HTTP real PG | owner/outsider/order/idempotency/cancel/GPS | pending |
| Browser timeline VM | persisted snapshots and reduced motion | pending |
| Existing PostgreSQL/Rush/privacy/GPS/pilot/browser | CI | pending |
| Real device/accessibility | manual | not run |

## Risks / exact handoff

- Driver-reported not independently verified. Driver should be stationary when updating, visual warning and low-distraction buttons. GPS access is denied after arrival by new PG queries; last fix in SQLite can persist to TTL and is not forensically erased. No automatic financial changes, rollback only by disable flag (not deleting persisted events). Mixing old/new binaries is unsafe before coordinated migration. No production or staging migration/deploy.
- Next: complete UI, run exact-head CI, reconcile failures, document tested SHA, product/safety/accessibility review, then owner approval before any rollout.

- 2026-11-21 UTC — added real 5-actor PG HTTP journey verification, duplicate-key race, privacy/seat/financial assertions; CI script staged, browser timeline still pending.

- 2026-11-21 UTC — UI driver report button with parked-only confirmation, server re-read of milestone; yellow-black timeline for driver and active passengers from persisted timestamps, replay/real-state distinction; browser VM pending.

- 2026-11-21 UTC — new VM test verifies initial timeline is static, real server snapshot changes only, false-progress guards, reduced-motion and script syntax. Owner/booking refresh both required before status animation.

- 2026-11-21 UTC — reviewed access side channels: unauthorized cancellation must yield 403 before revealing journey stage. Added outsider regression before stage check. Exact-head CI pending rerun.

- 2026-11-21 UTC — post-arrival private booking DTO revokes driver-phone disclosure on subsequent reads (cannot reclaim previously seen numbers); journey endpoint rejects non-object bodies with 400. Real PG regression added. Exact CI pending.
