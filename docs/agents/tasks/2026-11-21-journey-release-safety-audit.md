# CampusPool PR #60 — independent journey release-safety audit

- **Task ID:** 2026-11-21-journey-release-safety-audit
- **Owner:** independent engineering QA / product and security sign-off unassigned
- **Baseline:** PR #60 \`bfaf7751573bb74e5db722fc345a0e4c433a3bf3\`; test branch stacked above #60, not main
- **Scope:** CI latest-head, adversarial journey behavior, migration 010 dry-run and rollback review, Android accessibility and dependency reconciliation
- **Environment:** public source + disposable \`campuspool_stage1_ci\` PostGIS CI only; NO staging/production writes or feature enablement
- **Status:** adversarial disposable PostgreSQL CI PASS at `3f66b29c21c369b07568217d6726f6dc6cb1ec30`; physical device + policy review blocked; release NO-GO

## Evidence and precise current limitations

1. **Parent head CI:** GitHub workflow runs on \`bfaf7751573bb74e5db722fc345a0e4c433a3bf3\` completed **5/5 success** (Stage 1 PostgreSQL OTP, mobility real-browser, smoke, PostGIS load, Places). Previous application SHA \`e1ea317\` also passed its five checks and 7/7 journey VM, 30 E2E, 3,880/3,880 Rush Hour. These are CI facts, not live or device checks.
2. **Driver misreporting:** \`POST /api/rides/journey\` accepts consecutive valid self-attested transitions from driver without GPS/independent passenger confirmation. API correctly describes self-report, but false pickup/arrival remains possible. Real HTTP/PG regression records this observation; not a verified physical journey.
3. **No-show:** after reported departure the passenger's normal \`POST /api/bookings/cancel\` returns 409 \`JOURNEY_ALREADY_STARTED\`. No documented self-service no-show/dispute resolution path; support, adjudication, debt policy and evidence retention require explicit product decisions.
4. **Emergency cancellation:** driver \`POST /api/rides/cancel\` is permitted before arrival and sets every active booking \`status='cancelled'\`, resets \`seats_left=seats_total\`. Read endpoint selects active bookings only, so the canceled booking disappears from normal passenger history. Existing \`payment_status='Pending'\` remains on the physical row, but settlement guard only considers **active** Pending bookings and driver commission derived from seats sold; it can drop enforcement of a contested obligation. This is a **P1 release blocker / no approved financial policy**, not a test success.
5. **Arrival:** a reported arrival does not automatically set \`Paid\`; existing active \`Pending\` remains. Post-arrival contact and location authorization restrictions have dedicated existing CI checks.
6. **Migration 010:** additive columns/default plus stage CHECK constraint; auto migration runner applies 008 -> 009 -> 010. Flag-off **does not** remove \`PgRidesStore.ready()\`'s requirement for validated 009/010. Concurrent releases or old binaries after first non-scheduled stage can re-expose booking/cancellation paths. The CI added here reruns 010 on populated **disposable** rows, verifying no stage/timestamp/PaymentStatus mutation. **No real staging or production execution.**

## Automated reproduction (on this audit branch)

\`RIDES_HTTP_JOURNEY_DISPOSABLE_DB=YES npm run test:rides-http\`, which invokes \`bench/campus-journey-lifecycle.js\`.

New assertion suite:
- Creates an extra synthetic emergency trip and checks passenger Pending before driver departure;
- Verifies passenger no-show cancellation 409 and non-driver ride-cancel 403;
- Executes driver emergency cancel, checks retained SQL Pending + changed row status, missing active-history row, unlocked settlement guard;
- Confirms another booking is currently accepted under that now-cleared guard;
- On a separate synthetic trip, executes all three consecutive driver-only self-reports without location or passenger check-in; confirms arrival remains Pending;
- Re-runs 010 with populated synthetic rows and asserts immutable persisted timestamps, one validated constraint and unchanged Pending.

**Interpretation:** The automated test intentionally checks the current *unsafe observations* and outputs \`CAMPUS_ADVERSARIAL_RESULT\` and \`releaseVerdict: NO_GO_DISPUTE_AND_OBLIGATION_POLICY_UNRESOLVED\`. A CI green outcome would prove reproducibility, not approval of the behaviors.

## Physical Android / accessibility test matrix (NOT EXECUTED)

A real Android device connected to a controlled, disposable/staging build and authorized synthetic test accounts is required. No device/ADB is attached to this agent session; a desktop Chromium viewport or CI browser is **not** a physical-device pass.

- TalkBack screen reading in the journey card: readable stage + attribution, landmark and button names, confirmation dialog voice, announcement of asynchronous update; no reading SVG as GPS.
- Android text scaling (default, 150%, 200%) and font/display scaling: at 320/360/380 CSS px, milestones, timestamps, buttons and error banners do not clip, overlap, truncate meaning or require horizontal scrolling.
- Bluetooth/physical keyboard or Android keyboard navigation: logical tab/focus order, visible focus ring, after modal cancel and after stage save, no focus loss when cards re-render.
- Remove animations / reduced motion enabled: car/line stationary at final authorized state, textual milestone present; no fake progress on reload or stale retry.
- Poor connectivity, repeated taps, stale session and slow device: no false success, no doubled milestone, verified readback and retry guidance.
- Driver distraction: milestone controls cannot reasonably require interaction while driving; parked-only copy/confirmation does not itself enforce safe use. Product review required.
- Capture device model, Android/Chrome version, viewport, test account scope, annotated screenshots/video (no student data), exact deployed SHA, pass/fail per case.

## Safe proposed migration / deployment sequence (PLAN ONLY)

0. Stop: production roadmap G1 remains NO-GO; confirm credential rotation, independently restored encrypted backup, real OTP receipt, production durable DB and provider/campus permissions before any staging/prod migration. Secure approvals independently; never infer from CI.
1. Review SQL 008/009/010, validated 009 and 010 constraints, lock budget, old/new binary behavior, operations owner, maintenance window and rollback artifact. Verify snapshot/restore on an isolated PostgreSQL clone (not real campus data).
2. With explicit staging approval and known isolated backup, pause booking writes, apply 008 then 009 then 010 in order, with bounded lock/statement timeouts and fail-closed verification; record before/after counts, schema/check validity, active seat invariants, Pending and no-payment modes, authorization/RLS and migration markers.
3. Only after migrations, deploy reviewed exact combined application SHA with \`RIDES_JOURNEY_ENABLED=false\`. \`RIDES_BACKEND=postgres\` requires coordinated release and schema. Smoke-read only, then approved synthetic flows.
4. Keep flag off until product resolves no-show, false-report disputes, emergency financial policy, historical bookings and physical Android accessibility/driver distraction; re-run independent security and load suites on the exact build.
5. Safe application rollback: turn OFF future milestone reporting without destroying already recorded stages; preserve reads, post-departure restrictions and privacy. **Never roll back to a binary that can book into a departed ride or erase historical stage semantics.** Use an approved compatible hotfix or place writes in maintenance mode. Database schema rollback is not a routine rollback.
6. Production requires independent separately authorized migration+release, independent recovery proof, monitoring and owner GO. No automatic merge, secrets, real GPS or monetary operations.

## PR dependency graph (21 Nov 2026)

Main <- #47 <- #48 <- #49 <- #51 <- #52 <- #53 <- #54 <- #55 <- #56 <- #57 <- #58 <- #59 <- #60 <- audit.
#50 is a **separate main-based policy PR**; #36 is a separate main-based OTP release fix, neither is inherited through this stack. #58 introduces 009, #60 introduces 010; 008 belongs to older idempotency work in stack. All #47–#60 listed above currently OPEN DRAFT; exact GitHub PR base refs must be rechecked before any integration. GitHub 'mergeable=true' does not prove readiness.

## Required follow-up / handoff

- Review CI on **audit branch head**, rerun failures if any, quote exact SHA and job URLs.
- **P1** decide no-show/false-claim escalation, passenger record retention and post-cancellation finance treatment; add failing acceptance tests before implementing policy.
- **P1** independent security, privacy and product review, then owner explicitly approves or declines changes.
- Physical Android device tests above remain **BLOCKED**, no claim of execution without device evidence.
- Review the complete stacked PR chain; integrate in dependency order only with owner approval, required checks, migration+backup controls and a compatible rollback plan.
- No staging, production, Azure or student data changed during this audit.


## Verified independent CI — 2026-11-21 05:40 UTC

- **Audit commit:** \`3f66b29c21c369b07568217d6726f6dc6cb1ec30\`, with the adversarial test code at commit \`288bc86481967087fc9b9d7eb21bd7699a457f1c\`.
- **Actual ephemeral PostgreSQL/PostGIS GitHub workflow:** [Stage 1 tests run #44871822116](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/44871822116) **completed SUCCESS**; job \`postgres-otp\`, syntax and isolated DB tests PASSED.
- **Observed output:** \`CAMPUS_ADVERSARIAL_RESULT\` confirms \`driverSelfReportsWithoutGpsOrPassengerConfirmation=true\`, \`noShowPassengerCancellationBlocked=true\`, \`emergencyDriverCancelAllowed=true\`, \`cancelledBookingMissingFromNormalHistory=true\`, \`cancelledPendingObligationStillStored=true\`, \`cancelledPendingIgnoredBySettlementGuard=true\`, \`followOnBookingAfterEmergencyAllowed=true\`, \`selfReportedArrivalDoesNotSettlePending=true\`, \`migration010ReplayWithData=true\`.
- **Existing journey result:** \`CAMPUS_JOURNEY_RESULT\` confirms five synthetic actors, driver-only authorization/CSRF, concurrent idempotent key, invalid order, passenger readback, GPS revocation, financial preservation on normal arrived ride and delayed transaction timestamp.
- **Verdict:** Automated reproduction completed, but <b>P1 release hold remains</b>. The successful tests intentionally document unsafe behavior; financial/dispute decisions, physical Android/device accessibility, driver safety, recovery approval, staged rollout and all predecessor PR reviews remain open. No live data or environment changed.
