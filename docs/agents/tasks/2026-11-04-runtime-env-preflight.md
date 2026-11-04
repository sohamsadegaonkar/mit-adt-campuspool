# Task: Private, deployment-independent runtime environment preflight

- **Task ID / file:** `2026-11-04-runtime-env-preflight`
- **Status:** tested (CI) — 10/10 synthetic configuration tests passed, all six CI workflows green; independent review and real Render verification pending
- **Agent / owner:** ChatGPT engineering agent; independent reviewer and Render operator unassigned
- **Last verified:** 2026-11-04 07:29 UTC — GitHub Actions PR #18 code SHA `33df5499`
- **Baseline:** `main@056cd26b9e66324c7953065418de1ec765c6ebef`
- **Branch:** `chore/runtime-env-preflight-2026-11-04`
- **Scope:** standalone read-only configuration checker + unit tests + CI + agent docs; no change to `server.js`, Docker startup, payment, production environment, Render service, Supabase, SMS/email providers or live databases
- **Dependencies:** `PRODUCTION_RELEASE_GATE.md`, `SECURITY_CREDENTIAL_ROTATION.md`, incident with production deployment `dep-dbl4c9p5efls73f7b1q0` failing at new `OTP_SECRET` validation; live previously published SHA `63ae5510bbe2`

## Goal and acceptance criteria

Prevent an avoidable repeat of production's missing/weak `OTP_SECRET` startup error by offering a local, read-only preflight of the application runtime environment for two distinct configurations: current production legacy SQLite and isolated staging PostgreSQL/PostGIS. Never print or export secret values, complete connection URLs, provider keys, exact lengths or filesystem contents. Provide safe key-specific diagnostic codes, machine-readable option, fail-closed exit code and synthetic CI tests. **A passing result means only that known runtime configuration checks passed, not that a release, credentials, persisted rides, real OTP delivery, backup or rollback is approved.**

## Current state (verified vs assumed)

- Main's Dockerfile sets `NODE_ENV=production` and launches `server.js`. New code refuses missing/short/known-exposed `OTP_SECRET` at startup. Render's last manual production deployment of `056cd26` failed before binding a port; a previous deploy remains marked live at `63ae551` (not independent HTTP uptime proof).
- User showed seven masked environment variables (OTP_SECRET + six SMTP entries) and reported **Save only**; value quality, current runtime application and actual historical SMTP key revocation cannot be verified from this.
- `scripts/check-release-gates.js --production` is an existing **production launch** gate requiring PostgreSQL, real providers and independent manual approval. It is not a preflight for the current legacy SQLite production process. Preserve it unchanged.
- Staging declares dedicated PostgreSQL identity/Rides and matching feature flags in `render-staging.yaml` and requires a secret file trust anchor. Production is intentionally different. Render staging/production service secrets cannot be inferred from Blueprints.
- Main has other open independent PRs (#11–14 and #17); this task must avoid conflicting runtime changes.

## Plan

1. Add CLI with explicit `--target=production` or `--target=staging`, optional `--json`, no environment mutations and no access to external services. Check invariants from actual app startup and provider source; separate must-pass config and remaining manual release blockers.
2. Add synthetic unit tests for missing, short, compromised and strong OTP secret, unverified SMTP rotation, staging database/TLS/HMAC/Basic Auth/provider combinations, safe JSON output and unavailable secret-file path.
3. Add independent CI job to run helper tests with synthetic values only. Do not inject, fetch, cache or print any real Render credentials.
4. Record green CI run/commit and observed limitations in `STATUS.md`, `NEXT_STEPS.md` and this task file; keep PR draft/unmerged until review.

## Progress log

- 2026-11-04 — Verified main, existing release gates, Render Blueprints, actual Node startup checks, repo task documentation and open PRs. Created a separate branch for read-only preflight.
- 2026-11-04 07:29 UTC — Added explicit two-profile CLI, safe check codes, JSON output, zero network actions, ten synthetic unit tests and CI workflow. GitHub Actions on implementation SHA `33df5499`: **runtime #41792580706 PASS, 10/10**; security smoke #41792580514 PASS, credential hygiene #41792580531 PASS, PG integration #41792580639 PASS, benchmark #41792580561 PASS, agent docs #41792580707 PASS. No real secret values were used in CI. No app startup path, Render environment, DB, service or provider was touched.

## Verification

| Check | Environment/evidence | Result |
|---|---|---|
| Syntax and pure tests | Node 22.23.2, #41792580706 | PASS — 10 tests, zero failures |
| Synthetic legacy production preflight | #41792580706, fake values | PASS |
| Synthetic isolated staging preflight | #41792580706, fake URL/CA/provider data | PASS |
| Leaked secret / diagnostics non-disclosure | #41792580706, CLI JSON and stderr checks | PASS |
| GitHub CI full PR validation | Code SHA `33df549954cd3564d9738c9e84169c5ed85feecf` | PASS — #41792580706 plus #41792580561, #41792580531, #41792580514, #41792580707, #41792580639 |
| Connected real Render value verification | Hidden values; not accessed | NOT VERIFIED; no production action |

## Risks and decisions

- `OTP_SECRET` validity cannot establish actual secret randomness or that previous tokens/sessions were revoked; fingerprint rejection only covers the known compromised signing key.
- SMTP provider values may be present but expired, misconfigured or compromised; no network call will be performed.
- Production's legacy SQLite persistence is unsafe for a release migration. Keep the existing production release gate as a **separate required control**.
- If staging TLS CA file exists locally, that proves only file presence; PostgreSQL certificate validation and actual reachability remain outside a read-only configuration preflight.
- Do not add credentials to GitHub Actions, logs, task files, command-line arguments or Notion.

## Next steps — exact handoff

1. **Next action:** independently review PR #18, compare supported startup settings against the actual Render service using dashboard-private values, and validate certificate trust/provider delivery separately; do not copy any secrets into CI.
2. **Who may do it:** engineering agent may modify branch-only files and tests; Render operator must separately apply environment changes and own rollout decision.
3. **Prerequisites / blockers:** production rollout still needs legacy data protection, independent restore/rollback, provider and credential rotation evidence; stage release remains independently blocked.
4. **Expected evidence:** synthetic test matrix green and secret-safe CLI showing only named check codes.
5. **Production impact:** none — no deployment, service update, environment modification, live DB query or provider API call.

## Links and files changed

- Branch: `chore/runtime-env-preflight-2026-11-04`
- Files: `scripts/check-runtime-config.js`, `test_runtime_config.js`, `package.json`, `.github/workflows/runtime-env-preflight.yml`, `docs/agents/STATUS.md`, `docs/agents/NEXT_STEPS.md`, this file.
