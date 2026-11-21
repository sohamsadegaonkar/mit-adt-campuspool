# CampusPool reviewer operations & appeals policy — **proposal for owner approval**

**Authored:** 2026-11-21 (IST) · **Reference:** independent reviewer API draft [#68](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/68), participant response [#67](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/67), legacy Pending review [#66](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/66)  
**Status:** **UNAPPROVED POLICY DRAFT. NO LIVE REVIEWERS, PAYMENTS OR ENFORCEMENT.** Product owner, campus operations, privacy/legal and security review required. Do not portray this as current live CampusPool rules.

## 1. Safety promise and scope

A five-minute pickup timer starts with a **driver-reported** `pickup_ready` event. At 300 seconds either passenger or driver may **report** an unresolved pickup; a safety report is available earlier. A timer expiration or user silence cannot independently prove no-show, physical presence, payment liability, bad faith or a breach. The server records an allegation; it never auto-cancels other riders, frees seats, collects a penalty, blocks an account or converts `Pending` to `Paid`.

This policy governs **non-punitive, structured, human-reviewed evidence** only. The current software contains **no lawful, provider-confirmed fee/commission, refund or debt ledger**. All such actions, together with warnings, flags, suspensions and bans, are explicitly **OUT OF SCOPE**. Do not imply that a `no_action` decision is a financial waiver or that a `follow_up_required` outcome creates an obligation. A cancelled/disputed legacy `Pending` record stays available for review, is not a payable invoice, and causes no new automatic sanction. The separate active-undisputed legacy `Pending` booking restriction is **not settled by this policy** and needs its own fairness, review and appeal decision before launch.

## 2. Case lifecycle — truthful labels

| Event | What user sees | What it actually establishes |
| --- | --- | --- |
| Driver reports pickup ready | “Driver reports arrival at pickup” | Driver self-report; **not GPS/boarding proof** |
| Five-minute report / immediate safety report | “Pickup issue reported” | Time-stamped categorical allegation; **no blame** |
| Other participant's response | “Participant statement received” | Subjective statement; original report immutable |
| Initial independent reviewer record | “Review entry recorded” | `no_action`, `insufficient_evidence`, or `follow_up_required` only; underlying case stays `open` |
| Participant appeals | “Your appeal was recorded” | One private categorized appeal per participant; no penalty/reversal |
| Independent appeal outcome | “Appeal review entry recorded” | `review_record_unchanged`, `additional_review_required`, or `insufficient_information`; **no enforcement** |

Never use “payment due”, “confirmed fraud”, “you are fined”, “case resolved”, or “review completed within N hours” unless those claims have independent evidence and a separately authorized operating policy. Current system **does not** close a case or schedule an SLA.

## 3. Neutral reviewer procedure

1. **Intake:** view only assigned role's private queue and role-scoped categorical timeline. Check whether two different booking participants contributed; a single person's claim **must not** become an initial review record. Check documented boarding PIN confirmation (where available); it is not blanket proof that all ride terms were satisfied.
2. **Safety first:** if imminent harm, advise urgent use of real campus security/emergency channels **outside this prototype**. There is no staffed campus-security dispatch, automated safety escalation, or reliable inbound notification yet. Do not delay emergencies awaiting a five-minute countdown.
3. **Independent review:** the reviewer must not be the driver, passenger, original appellant or a person with a personal interest. The backend enforces driver/passenger restrictions; staff must disclose **other** conflicts of interest separately because the system cannot know personal relationships. Use neutral codes only. `no_action` = no action recommended from the evidence; `insufficient_evidence` = conflicting/inadequate proof; `follow_up_required` = more evidence/support needed. All three are **administrative**, not disciplinary findings.
4. **Explain limitations:** no free-text personal allegations, medical details or GPS histories should be entered into public issue trackers. The app currently records only predefined reason categories and timestamps; do not promise the user evidence we have not captured.
5. **Freeze and preserve:** an initial review freezes new participant response entries even if the feature is disabled. Do not edit/delete case events, responses, reviews or appeals using the application role. Database audit records remain intact; case `open` does **not** mean an individual is at fault.
6. **Participant appeal:** either participant can challenge the initial review exactly once by category. The other side sees only that an appeal exists, not the appellant's private reasoning. Support must not equate missing appeal with consent. Future rules for supplementary evidence and multiple appeals **require owner approval**.
7. **Independent appeal:** a separate `appeal_reviewer` who is not a booking participant **or the initial reviewer** may record a bounded second-level result. It does not issue a fine, unblock an account, pay compensation, grant an automatic refund or close the case.
8. **Escalation:** any request for a fine, loss of access, legal determination, discrimination, account safety action or financial restitution **stops here** and requires a separate approved human procedure with notice, evidence, identity proof, escalation and appeal. No ad hoc manual database edits to enforce punishments.

## 4. Operations that must be established BEFORE live activation

- **Named accountable owner and trained reviewers:** minimum independent initial reviewer and separate appeal reviewer; who handles conflict, absence, access removal and out-of-hours safety. Reviewers cannot assign themselves roles in the app. No individual or role is approved by this document.
- **Review/appeal timelines:** propose triage during an explicitly staffed support window, reminder/escalation for overdue items, and a clear user-facing “no guaranteed response time” message **until staffing and SLA are approved**. Do not invent 24/48-hour commitments.
- **Privacy and retention:** define India-appropriate lawful basis, storage region, access logs, least-privilege policies, retention for disputed case data and request/appeal handling with privacy counsel. Current migration 014 uses immutable records and does not implement automated erasure; retention policy is a **release gate**, not a solved feature.
- **Evidence requirements and false reports:** absence or missing PIN alone is not proof of misconduct; driver arrival is self-reported; false allegation findings require a higher independently reviewed standard. No offense thresholds, rupee amounts or strike/ban ladder are enabled.
- **Financial fairness:** a `Pending` marker is not verified payable debt, and booking capacity is not evidence of passenger travel or driver commission. Decide how genuinely active legacy Pending restrictions can be challenged and corrected, *separately*, before any billing.
- **Monitoring:** case queue age and appeal backlog may be reviewed by authorized staff as aggregated counts, avoiding students' names, phones, PINs or raw user IDs in logs. No scheduled monitoring/notifications are created in this change.

## 5. Reviewer onboarding checklist (operator-only; no automatic permission assignment)

- Confirm a dated owner authorization and a **separate** approving security/privacy reviewer; store approval privately outside GitHub/issue comments.
- Verify the proposed `campus_users.id` belongs to a **verified, independently vetted human**, not a shared login, a ride participant in relevant cases, a service role or an account claiming admin status in the UI. The current programmatic preflight checks the verified-user marker and existing role; operations must examine undiscoverable personal conflicts.
- Prefer **different people for `case_reviewer` and `appeal_reviewer`**. Source-only preflight fails if a candidate already has a different reviewer role. Apply the smallest temporary permission and an explicit expiration (technical policy ceiling **7 days**, provisional, not a final support contract). Require renewal by a separate approved procedure; **never silently reactivate revoked/expired rows**.
- Run `node scripts/reviewer-onboarding-preflight.js --action grant --role case_reviewer --user-id <uuid> --expires-at <ISO-UTC>` with **`REVIEWER_OPERATOR_DB_URL`** set only in a private operator environment, not in command history or logs. The command makes a **READ ONLY** PostgreSQL transaction, prints sanitized booleans, never the target UUID/contact/secret, and cannot apply a grant. **It is not permission to connect to or change live staging**; target-only preflight still needs owner-approved read scope.
- Confirm the dedicated staging target, reviewer grant table RLS and app role `SELECT-only`; reject unintended grants or expired/revoked previously existing rows. **No app endpoint creates roles** and no automatic promotion of students.
- A separate owner-approved DBA change (not supplied/executed here) is required for any grant, renewal or revoke. Verify readback using preflight, check the original student session was not elevated, and test revoked/expired roles with controlled consenting accounts only. Record approval/verification privately; avoid raw evidence/secret data in repo.
- **Emergency access removal:** operator must revoke role using a separately authorized privileged process, then verify access denial and case audit preservation. The preflight supports a read-only `--action revoke` assessment; it **cannot** actually revoke credentials, sessions or reviewer grants.
- **Do not deploy** migrations, source branches, DB changes, reviewer grants or sanctions until PR review, G1 independent restore, the complete 008–014 migration/rollback plan, physical-device accessibility/safety and owner launch GO.

## 6. Engineering evidence / source of truth

- [Reviewer/appeal code and authorization tests — PR #68](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/68) and [engineering handoff](2026-11-21-reviewer-and-appeals-foundation.md).
- Onboarding guard and tests live in **this PR's repository code**, with no live DB write or reviewer promotion.
- Separate operational proposal must be reviewed by owner/security/legal **before** renaming this document to “approved policy”, posting it to students or enabling `CASE_REVIEW_ENABLED`.

**Release: NO-GO · Reviewer roles: NONE authorized here · Financial/disciplinary enforcement: NONE.**
