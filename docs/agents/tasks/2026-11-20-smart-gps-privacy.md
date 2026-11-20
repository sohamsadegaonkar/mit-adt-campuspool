# Task: Smart GPS Privacy

- **Status:** candidate / CI pending
- **Owner:** application engineering; independent review pending
- **Date:** 2026-11-20 IST
- **Baseline:** parent #56 913a93057d79565b99a6ca2c01c60364fd2893a8, main unchanged.
- **Scope:** existing live location routes and SQLite table; existing browser tracker. No production operations, schema change or new infrastructure.

## Goal and acceptance criteria

Explicit start creates a random session-bound lease with no coordinates. Update requires active owner/participant and lease, valid captured timestamp, finite coordinates and metadata; reject duplicate/older, stale or future fixes. Latest fix visible to active participants for at most 60s after effective capture; old unconsented rows never served. Stop deletes matching lease, old requests cannot resurrect stopped/replaced lease. Existing cancellation checks deny subsequent requests. No worker-local cache or history. Periodic 30s logical cleanup. Browser starts only on click, stops on close/hidden/session change, no fake location/demo writes, no fabricated ETA. No live changes.

## Current state (verified vs assumed)

#56 all five CI checks passed, 29 projection checks, four actors. Source audit found unbounded worker maps, SQLite stale reads and unconditional overwrite; existing UI simulator sends fake location to actual backend and initial coordinates/ETA are fabricated. Keep existing GPS rate tier and participant checks, no extra PG queries. No live environment tested.

## Plan

1. Reuse existing SQLite live_locations row with versioned type and JSON lease hash; immediate transaction for update/stop. Indexed logical expiry, periodic cleanup. Session-bound hash not raw session/token. Legacy rows ignored and cleaned.
2. Same two endpoints use explicit POST start/update/stop, GET read; keep CSRF/auth and per-IP budget. Old clients fail closed on missing action; no backward permissive write path.
3. Browser explicit toggle, current view/session generation and bounded in-flight callbacks, no simulated writes. Poll only while dialog open; clear markers on null/failure and stop on close/visibility loss. Map provider remains external.
4. Real disposable HTTP and independent SQLite handle deterministic clock tests; update previous privacy suite to explicit consent; prior regression CI.

## Minimum complexity review

- **Level:** significant
- **Existing / smallest:** one row per resource in existing SQLite, no separate lease table or service; explicit action over same routes; one current authorization query per operation.
- **Conventional alternative:** Redis TTL/live WebSocket service; extra infrastructure, no need for current pilot; would still require authorization and consent.
- **First-principles alternative:** avoid storing trajectory entirely; store last fix with session-bound capability, strictly ordered capture time and short expiry; no cache, no background history or fake GPS.
- **Tradeoffs:** 60-second TTL and 30-second cleanup are provisional, actual logical deletion nominally by 90s absent process pauses/outage; no forensic erasure of WAL/backups. Clock skew tolerance 5s future and 30s stale; client timestamps are not proof of genuine sensor data. New start replaces previous lease; another session cannot reuse its token. Existing PG authorization and SQLite storage are not atomic across DBs; request already authorized before cancellation can finish, subsequent requests denied. Logout/tab crash/network failure may leave fix until expiry. Clients must update contract. External map tiles can disclose viewport; review provider separately.
- **Decision:** explicit fail-closed lease and no simulation, reject stale/out-of-order fixes, no new infra or schema. Browser continuously watches only after consent and while visible; passenger changes from one-shot to explicit stoppable sharing; no background tracking. No claimed fully secure erasure.
- **Evidence:** source audit, #56 exact CI output; pending new suite.
- **Validation:** real HTTP and two independent handles, lease replacement/stop/session isolation, TTL boundary and logical prune, invalid sample rejection, post-cancel denial, prior privacy/Rush/Wi-Fi/smoke/browser CI. Physical device tests separate.

## Progress log

- 2026-11-20 IST — verified #56, audited GPS and created scoped candidate with regression.

## Verification

| Test | Evidence | Result |
|---|---|---|
| Smart GPS HTTP | RIDES_HTTP_GPS_DISPOSABLE_DB=YES npm run test:rides-http | pending |
| Previous privacy contract | updated explicit sharing steps | pending |
| Browser and regression | CI | pending |
| Live / physical device | none | not performed |

## Risks and decisions

Point-in-time authorization, no cross-store atomic revocation or physical erasure; stale/cancelled rows age out, access denied after committed cancellation. No absolute guarantee against malicious client fake GPS. Inaccessible old format on rollout; logical cleanup intentionally deletes old GPS state, deployment not authorized. No real payment change. Device/mobile and native compatibility and external map-provider privacy require review.

## Next steps — exact handoff

1. Read exact-head CI CAMPUS_GPS_RESULT and failures; correct defects, record evidence. Then owner-approved rides-only settlement policy and integrated release review. 
2. Application engineering / independent reviewer; production release G1 remains NO-GO.
3. No live resources, deployment, data migration, backup change.
4. Verify same-key booking/receipt invariants, GPS lifecycle and prior CI.

## Links and files changed

- Branch security/smart-gps-privacy-2026-11-20
- database.js, server.js, index.html, bench/campus-privacy-shield.js, bench/campus-gps-privacy.js, test_pg_rides_http.js, .github/workflows/stage1-otp.yml, docs/agents status/next/decisions/architecture and task.
