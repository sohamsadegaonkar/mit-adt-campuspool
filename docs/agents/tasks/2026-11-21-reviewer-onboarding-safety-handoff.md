# Reviewer onboarding preflight and operational policy — engineering handoff

**Task date:** 2026-11-21 (IST)  
**Branch:** `ops/reviewer-onboarding-policy-2026-11-21` · **PR:** [Draft #69](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/69) (parent reviewer foundation #68 → participant response #67 → finance review #66 → pickup #64 → earlier stack)  
**Status:** source-only policy **PROPOSAL**; review/onboarding feature OFF, no reviewer grants, no Supabase/Render/Azure or production writes.

## Outcome

The owner asked to prepare the next step after technical reviewer/appeal support: safe reviewer operations and onboarding without enabling financial charges or sanctions. The key principle is that code proving role checks is **not permission to appoint reviewers** or make a student-facing support promise.

1. [Unapproved operations policy](2026-11-21-reviewer-operations-policy-proposal.md) maps arrival/no-show claims, independent initial review, separate appeals, procedural fairness, safety, incident disclosure, privacy, staff conflict and student communications. It deliberately commits to **no response-time SLA**, verified liability, fines, bans, account flags or refunds until owner/staff/legal signoff; active legacy `Pending` restriction remains separate.
2. `scripts/reviewer-onboarding-preflight.js` is a **read-only planning command**, NOT a credential manager. It takes one explicit `--action grant|revoke`, role, verified user UUID, private approval reference (`CP-...`), and an explicit UTC expiration for proposed grants (1 hour–7 days provisional maximum). It rejects unknown args including `--apply`.
3. Target whitelist: only **loopback disposable** PostgreSQL database `campuspool_stage1_ci` or the exact dedicated Supabase staging ref `tnitksrlntrdxbvznxzf`; no arbitrary cloud, production, nonlocal host, TLS-disabled staging or wrong DB path. **No DB was connected during source creation**. Any staging read requires owner-approved scope plus the explicit `REVIEWER_STAGING_READ_APPROVED=YES` opt-in before connecting. The `CP-...` reference and env flag are only format/safety checks, **not independently verified permission**.
4. DB planning is `BEGIN TRANSACTION READ ONLY` → SELECT verified candidate and single table privilege snapshot → SELECT grant history → `ROLLBACK`. A session using the app role or schema missing RLS/least privilege is rejected. App-role grant INSERT/UPDATE/DELETE must all be false; operator must hold the intended DML privilege, but **the script cannot exercise it**.
5. Reject unknown/unverified users, already granted/expired/revoked matching role (no silent reactivation), other reviewer role assigned (independence preference), missing/expired revoke target, insufficient operator permission. The plan prints only coarse flags; it never prints raw UUID, email, phone, approval reference, DB connection string or password.
6. A live grant/revoke/renewal **requires a separate approved DBA process and manual verified readback**, never a self-service HTTP route or this preflight. No live accounts/grants were altered. A real staff console and support operational SOP remain future work.
7. `test_reviewer_onboarding_preflight.js` is **offline**, using fake read-only SQL clients with precise assertions on allowed targets, CLI grammar, timezone/TTL, rollback even on failure, RLS and role privileges, expired/revoked/dual grants, verified identity, privacy of output and anti-enforcement policy. Added to existing Stage 1 PostgreSQL workflow. No fake fixtures ever touch production.

## Operator guidance — planning ONLY (approval separately required)

For a *previously authorized* operator, on a private workstation with an approved dedicated DB URL stored in a private environment variable, a sample **read-only** preflight looks like:

```bash
# Illustrative command only. Do NOT run without owner-approved DB READ scope.
# Never paste a real URL, password, personal ID or approval evidence in chat or Git.
node scripts/reviewer-onboarding-preflight.js \
  --action grant \
  --role case_reviewer \
  --user-id "$APPROVED_VERIFIED_USER_UUID" \
  --expires-at "$APPROVED_UTC_EXPIRY" \
  --approval "$APPROVAL_REFERENCE"
```

Set `REVIEWER_OPERATOR_DB_URL` privately before invoking. For a separately authorized staging read also set `REVIEWER_STAGING_READ_APPROVED=YES`; never use that environment flag as a substitute for a real approval. **No grant is performed**. For a revoked or expired existing grant, preflight purposely refuses a reactivation; a separately approved renewal design and audit need to exist first. Revocation planning uses `--action revoke` with no `--expires-at` and likewise makes **no DB change**. Even a successful plan does **not authorize a SQL change or production rollout**.

## Expected acceptance / release gates

- Check exact application/policy SHA in GitHub; Stage 1/CI must pass the offline policy + onboarding guard tests without weakening JWT/cookie/CSRF, HTTP mutation rate limits or existing reviewer privilege model. Browser, security, Places, mobility regression checks remain linked.
- Verify source tree has **no update/insert/delete** to reviewer grants in app routes, migration 014 still provides SELECT-only app grants, `CASE_REVIEW_ENABLED=false`, and no proposed scheduled enforcement workflow.
- Owner to approve named reviewer and independent second reviewer, staff/privacy/legal role criteria, consent, retention and escalation; produce dated and private change request, and only then allow separately reviewed DBA provisioning and exact readback. No public ticket containing personal IDs.
- Independently restored backup G1, staged migration 008–014 forward/rollback, all stacked PR security review, physical Android TalkBack/200% text and parked-driver safe-mode evaluation, and owner GO before staging/production changes.
- **Do not merge, deploy, run against staging, grant or revoke reviewers, collect funds, issue fines, mark debts paid or ban anybody** as a result of this task.

**Code review status:** candidate in [PR #69](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/69). Exact-head CI pending at initial handoff; replace with verified run SHA/IDs only after checking workflows.

## Verified CI result — 2026-11-21

- **Exactly tested code SHA:** `a85f113ccabf2555d80621f35f36f85f855863cf`. The only new workflow triggered by the changed onboarding script and Stage 1 config was [Stage 1 PostgreSQL #44888752526](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44888752526), **completed SUCCESS**.
- Actual job log confirms syntax and **all 7 new `test_reviewer_onboarding_preflight.js` assertions PASS**: exact local/dedicated staging target whitelist, strict approval/UTC TTL inputs and `--apply` rejection, entirely read-only SQL + ROLLBACK, matching active-grant revoke planning, no silent revoked/expired renewal or dual-role assignment, unverified-user denial, least privilege/RLS/DB-identity fail-closed, and policy bans self-service promotion, financial sanctions and imaginary SLAs.
- The remainder of the Stage 1 PostgreSQL/OTP/rides/HTTP suite finished SUCCESS, so earlier pickup, booking, reviewer/appeal and security regressions remain protected. This branch changes **no application ride/finance code or database schema** and does **not** trigger a separate browser/security/Places/load workflow; those were independently verified on the parent PR #68 exact code SHA `be358d6518c9fe69a42e2ded36f59e5f80b1d237`.
- All commits after the tested code SHA added **documentation only**, no runtime logic. **No actual database connection to Supabase**, reviewer grant/revoke, student account, permission, payment, fine, deployment or other remote operational write occurred. The CLI's approved operator use is future work and requires a separate owner decision.
- **NO-GO** unchanged: private approved staffing/security/legal policy, verified independent reviewer grants, physical Android/TalkBack/parked driver checks, backup G1 independently restored, staging migration 008–014 and rollback approval, full stacked PR integration and production owner GO.
