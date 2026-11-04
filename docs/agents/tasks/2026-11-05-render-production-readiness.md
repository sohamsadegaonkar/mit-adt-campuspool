# Task: Restore safe Render production release path (no deployment yet)

- **Task ID / file:** `2026-11-05-render-production-readiness`
- **Status:** blocked — secure OTP secret configuration and staging recovery evidence required
- **Agent / owner:** ChatGPT engineering audit; owner must configure protected secrets and approve release
- **Last updated:** 2026-11-05 UTC
- **Baseline:** `main@b83107d`, read-only Render workspace/service/deploy/log inspection
- **Scope:** release investigation and agent handoff; no actual Render setting change, migration, staging modification, production deployment or secrets retrieval
- **Dependencies:** Azure cloud worker draft PR #28 stacked on streaming fix PR #27; independent encrypted staging backup and PG17/PostGIS restore; retained Render rollback

## Verified current status (not planned)

- Render production service `mit-adt-campuspool`, attached to GitHub `main`, Docker runtime in Singapore; automatic deploy **off**.
- Render's most recent attempted production deployment `dep-dbl4c9p5efls73f7b1q0` of commit `056cd26b9e66324c7953065418de1ec765c6ebef` on 2026-11-03 UTC had status **`update_failed`**.
- Render logs at `2026-11-03T20:38:32Z` identify an application startup block: `OTP_SECRET must be configured as a strong private environment variable`, originating from `server.js:72`.
- The source checks `NODE_ENV=production` and refuses a missing `OTP_SECRET`, a value **shorter than 32 characters**, or a known historically exposed secret fingerprint. This is an intended protective fail-closed behavior, not evidence that bypassing the check is safe.
- The previous production deployment `dep-dbj5auss728c738sa94g` with commit `63ae5510bbe23107288441fe4f2c07ac39b82b1a` remains **live** according to Render deployment history.
- Render's separate staging service `mit-adt-campuspool-staging` runs `cceadbf6251f70634320e50b8288530ba77513c3` and has auto-deploy **off**.
- Current GitHub main has advanced to `b83107d`. These deploys are not a proof that latest main has passed production smoke tests.
- Log output from the previous production process still mentions SQLite and JSON-to-SQLite migration; review persistent data and migration strategy, do not assume all data is durably stored in staging PostgreSQL.
- No runtime environment secret **values** were requested/read or displayed during this audit.

## Production NO-GO until release gates pass

1. **Secrets:** Owner configures a fresh independent high-entropy `OTP_SECRET` in Render's protected production environment (at least 32 characters; never reuse exposed keys or commit/paste secret). Confirm all other mandatory production configuration via a sanitized presence-only checklist and source validation; stage-only basic auth credentials must remain isolated.
2. **Backup and recovery:** First complete one verified encrypted offsite staging archive generated **inside approved cloud compute** and an independent cold restore in a protected PG17/PostGIS environment; validate roles, grants, RLS, migration ledger and content digests. Cloud worker is **draft PR #28**, not deployed. A 200-byte previous Azure object failed archive verification.
3. **Rollback:** Confirm retained known-good Render image/deployment artifact, reproducibility, and explicit rollback steps before any attempted production deploy. Do not remove old release.
4. **Data durability:** Audit SQLite/JSON fallback/legacy startup behavior and production data persistence; do not route real users to a nonpersistent database. Verify migration plan, idempotency, rate limits, monitoring, health checks and login/signup flows.
5. **Staging promotion:** Deploy approved changes first to protected staging **only after the recovery prerequisite**, run migrations under explicit sign-off and test OTP/login, transactions and negative paths; verify health/observability and release gates. Keep auto-deploy disabled until owner authorizes change.
6. **Production change:** Separate explicit approval after the above; use exact commit SHA, record deployment ID, smoke results, rollback SHA and success/failure status. No unreviewed deploy.

## Immediate engineering actions — no secrets or live mutations

- Preserve `server.js` fail-closed OTP validation; never relax the length, fingerprint or production check to make a deployment succeed.
- Review existing `Dockerfile` startup and `NODE_ENV` behavior with a **synthetic** production-config guard test in CI.
- Add sanitized environment-presence checks without logging values.
- Continue backup/cloud worker PR review and independent recovery work.
- Owner may configure a new `OTP_SECRET` via Render's protected Environment UI after safe credential process review, but **do not deploy** solely because the secret exists.

## Evidence and links

- Production [Render service dashboard](https://dashboard.render.com/web/srv-dbh51h0473hc739ae7cg)
- Staging [Render service dashboard](https://dashboard.render.com/web/srv-dbjof8fb9u1s73eks0bg)
- Failed production deploy: `dep-dbl4c9p5efls73f7b1q0` (status update_failed, 2026-11-03)
- Last live production deploy: `dep-dbj5auss728c738sa94g` (63ae551)
- GitHub [PR #27 stdout fix](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/27), [PR #28 cloud-worker](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/28)
- Source: `server.js` production guard near line 72
- Production impact: NONE (read-only inspection)
