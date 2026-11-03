# CampusPool request idempotency contract — staging implementation

**Status:** implemented on `security/transactional-idempotency-2026-11-03` pending CI, migration and review. This document does **not** claim deployment, production protection or complete distributed exactly-once behavior.

## Verified baseline and problem

At `main@3ee1f4a12e98`, PostgreSQL uniqueness protected one active booking per rider+ride, row locking prevented seat oversell, mobility allowed only one active intent, and OTP codes/proofs had one-time controls. However:
- A network retry of `POST /api/rides` could create another ride.
- Booking replay could fail a newer unpaid-settlement check rather than return its original success.
- Repeating a successful cancel could fail 404, and callers could not know whether the first attempt committed.
- Existing protections did not bind **actor + endpoint + idempotency key + exact payload** to a durable transaction receipt.
- SQLite rides/booking cancel semantics differ from PostgreSQL; both backends need a cross-worker receipt ledger.

## Implemented, scoped HTTP contract

For authenticated, CSRF-protected domain mutations listed below, clients **must** send `Idempotency-Key: <high-entropy-unique-id>` as an ordinary request header. Use one new UUID (or 128-bit random token) per logical operation; resend the **same** key with the **same** JSON body after timeouts/network ambiguity. Do **not** generate a new key simply because a fetch timed out.

| Mutation | Durable receipt | Business effect |
|---|---|---|
| `POST /api/rides` | PG or SQLite | Ride + optional geo points created once |
| `POST /api/bookings` | PG or SQLite | Seat reserved once |
| `POST /api/bookings/cancel` | PG or SQLite | Seat restored once |
| `POST /api/rides/cancel` | PG or SQLite | Ride cancelled once |
| `POST /api/mobility/intents` | PG only, feature-gated | One active travel intent |
| `POST /api/mobility/intents/cancel` | PG only, feature-gated | Intent cancelled once |

The server checks the session and CSRF token **before** any receipt lookup; the actor is derived from the server session, never from JSON. It stores a SHA-256 actor identifier and canonicalized request-body digest; route and key are unique per actor. In PostgreSQL the receipt and business DB effect commit in one SQL transaction; in SQLite they commit under one `BEGIN IMMEDIATE` write transaction with nested savepoints. PG's unique key serialization makes concurrent same-key requests wait and replay one committed result across processes/replicas.

On a matching, completed key: return the original successful status and JSON body, with `Idempotency-Replayed: true`. On the same key with a **different** JSON payload: return `409 IDEMPOTENCY_KEY_REUSED`. Missing key: `428 IDEMPOTENCY_KEY_REQUIRED`. Malformed key: `400 INVALID_IDEMPOTENCY_KEY`. The key must match `[A-Za-z0-9_-]{16,128}`. A failed/rolled-back mutation does not reserve a key; it may retry safely. **HTTP replay caveat:** the shared IP rate limiter currently executes before idempotency receipt lookup, so under throttling even a previously completed request may receive `429 RATE_LIMIT_EXCEEDED` and `Retry-After` rather than the original saved success. Preserve the same key/body and retry after that interval; this does not mean the earlier SQL effect rolled back or ran again. Do not promise unconditional HTTP response replay under rate limiting. Receipts expire after 24 hours and can be reused after expiry, so clients must create unique keys across logical operations. Expired rows are opportunistically pruned in bounded batches during active mutation traffic; the maintenance task can purge them all.

**Important:** Idempotency receipts provide once-per-key database effects, not a universal guarantee against semantically identical requests sent with *different* keys or exactly-once delivery to external services. Avoid storing personally identifiable request data in the receipts; the stored response can include private booking information, so the table is server-only and access-restricted. Responses are never cacheable in shared HTTP/CDN caches.

The browser automatically adds keys to these six routes and temporarily reuses them for ambiguous retry and double-click protection; a full page reload does not preserve pending keys. Clients should save an operation ID in their own pending request state when robust recovery across reloads is required (but not session identities or OTP secrets).

## Intentionally excluded: different safety semantics

- **OTP send/verify/register:** Challenges, rate limits, one-time proofs and session creation use separate security controls. Do not blindly replay OTP proofs, session cookies or provider sends. Future true retry-safe delivery needs a durable outbox and provider-message idempotency semantics; ambiguous provider acceptance cannot be inferred.
- **Live GPS updates:** These overwrite current location (latest-write state), not cumulative financial or seat effects. Reordering and freshness/sequence numbers need an explicit design. They are not covered by the response receipt table.
- **Payment / payout:** Client-reported settlement endpoints remain hard-disabled with HTTP 501. A future provider integration requires **provider event IDs**, verified signatures, an immutable ledger and idempotent webhook handling in the same transaction—not reuse of client keys alone.
- **Other authentication/admin mutations:** Existing flow-specific uniqueness and replay constraints apply; they have **not** been proven exactly-once for every possible crash/retry interleaving.

## Migration, permissions and rollout

- PostgreSQL additive migration: `stage1-otp/migrations/008_transactional_idempotency.sql`.
- Private PostgreSQL table: `public.campus_idempotency_keys` with RLS on, no anon/authenticated privileges, restricted backend-only access, TTL index. The migration is **not automatically applied** to existing staging or production.
- SQLite adds `idempotency_keys` during its schema initialization, on service restart. **SQLite on Render Free is still ephemeral** and cannot supply durable effects across disk loss.
- For PostgreSQL Rides mode, server startup **fails closed** if the new PG table is missing, rather than silently allowing unsafe unkeyed writes.
- Apply and test migration **only on isolated disposable CI/local DB** during this task. To deploy to staging, explicitly approve a staging-only migration with verified restricted role, backup, current branch SHA, and a controlled manual service deployment.
- Retain 24-hour receipts. During active traffic, the PG store deletes up to 200 expired receipts per worker per hour using \`SKIP LOCKED\`, and SQLite opportunistically deletes expired receipts. For complete cleanup, schedule \`npm run prune:otp\` against the privately migrated PG database; it also prunes expired idempotency rows. No production cron has been created.
- Stage a browser/mobile test for double-clicks, concurrent same-key and different-key booking operations, timeout then retry, malformed/reused keys, CSRF, cross-account isolation and restart behavior. Test under PostgreSQL and SQLite with isolated databases.

## Limits and operational hazards

- Existing `main` and production build don't implement this contract until the reviewed PR is merged and the relevant deployment is approved.
- Any older client not sending keys will receive 428 for the listed routes after a new build is deployed. Update and serve the frontend together; do not deploy the backend alone.
- PostgreSQL and SQLite receipts are independent: never switch backends mid-operation without data migration and reconciliation.
- A 24h retry window is not forever. On key expiry, the client must reconcile resource status before retrying potentially destructive work.
- DB errors trigger rollback and are not cached as successes; a request cancelled *after* commit may have succeeded even when the caller never received its response.
- The cache/broker is not the source of truth; no Redis, H3 or microservices were introduced.

## Tests and follow-up

- `npm run test:idempotency` — isolated SQLite atomicity, replay, conflicts, rollback and key expiry.
- `npm run test:security` — legacy HTTP requires keys and replays ride creation.
- `npm run test:rides-http` — PostgreSQL ride/booking create+cancel replays, collision, original success after changed settlement state.
- `npm run test:mobility-http` — PostGIS intent create/cancel replays and privacy/authorization.

**Next:** verify PR #11 full CI on the latest head; then review and approve staging migration and controlled E2E QA. Initial CI detected an unawaited rejected HTTP promise on active-intent duplicate; \`server.js\` has been fixed to await every idempotent mutation, preventing a 409 conflict from terminating the server. Subsequent CI must confirm the fix. Do not claim all external provider actions are exactly once.
