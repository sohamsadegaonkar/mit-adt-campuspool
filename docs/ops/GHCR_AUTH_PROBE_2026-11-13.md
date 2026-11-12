# 13 November 2026 — Azure GHCR authentication probe (one-time owner-approved)

Purpose: test whether the exact **existing** Key Vault GHCR credential can authenticate to the published, private image manifest, without touching real backup data or changing the existing failed proof job.

## References and prior evidence

Operator: scripts/azure-ghcr-auth-probe-operator.py
Offline tests: test_azure_ghcr_auth_probe_operator.py
Offline CI: .github/workflows/azure-ghcr-auth-probe-offline-ci.yml
Original failed job: campuspool-ghcr-pull-proof (MANIFEST_UNKNOWN at the exact pinned digest)
Published private image: ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2
Source tag: review-6c571396fff0
Azure secret ARM metadata: Enabled=true; no expiry or not-before attributes. This does not prove GitHub PAT validity.
Windows Docker's 403 and Cloud Shell interactive Key Vault data-plane ForbiddenByRbac involved different identities and must not be conflated with the attached job UAI.

## Risk-bound probe design

The operator creates a *separate*, manual-only job named campuspool-ghcr-auth-probe in existing campuspool-backup-standard-env (Malaysia West, WorkloadProfiles Consumption). No schedule; parallelism one, retries zero, 120-second timeout, 0.25 CPU / 0.5 GiB memory. It uses the project's already-reviewed public official Node base pinned by SHA-256 in ops/cloud-backup/Dockerfile, not the private worker image (which was previously denied).

The job has exactly one GHCR Key Vault reference and the existing campuspool-ghcr-vault-reader UAI; it receives the GHCR PAT via one secretRef environment variable into process memory. **This exposes the credential to code running inside the probe container**; limit jobs/start/override authority, avoid untrusted workloads, and delete the probe job after evidence review. No database/Blob credentials, network mounts, volumes, backup script or arbitrary user-supplied image.

Fixed inline Node code requests a scoped bearer from https://ghcr.io/token, then HEADs the one expected digest under https://ghcr.io/v2/. Only those pinned GHCR URLs, TLS, no redirects, 10-second timeouts. It emits fixed PASS / categorical FAIL markers, never token values, Authorization headers or HTTP bodies. A PASS means the credential can read the image in an isolated container, not that original Azure passwordSecretRef injection is correct.

## Exact owner steps, Cloud Shell

Step A, read-only checkout + offline tests + preflight:

~~~bash
cd ~/campuspool-ghcr-preflight
git pull --ff-only
python3 -m unittest -v test_azure_ghcr_auth_probe_operator.py
python3 scripts/azure-ghcr-auth-probe-operator.py --plan
~~~

Expected GHCR_AUTH_PROBE_PLAN_COMPLETE=YES and NO_AZURE_WRITE_OR_JOB_START=YES. If failures or STOP markers, do not continue.

Step B, creation only:

~~~bash
python3 scripts/azure-ghcr-auth-probe-operator.py --create
~~~

Type CREATE_ONLY_MANUAL_GHCR_AUTH_PROBE_NO_START when prompted. Creation does not start a job, but may incur Azure charges.

Step C, read-only exact-resource verification:

~~~bash
python3 scripts/azure-ghcr-auth-probe-operator.py --verify
~~~

Must return GHCR_AUTH_PROBE_EXACT_CONFIG_VERIFIED=YES and GHCR_AUTH_PROBE_EXECUTIONS=0. Stop otherwise.

Step D, single owner-authorized billable execution:

~~~bash
python3 scripts/azure-ghcr-auth-probe-operator.py --start
~~~

Type START_ONE_GHCR_AUTH_PROBE_NO_DB_BLOB. Never retry on unknown outcome; inspect status instead.

Step E, read-only status and fixed-marker log inspection:

~~~bash
python3 scripts/azure-ghcr-auth-probe-operator.py --status
~~~

When execution is terminal, query only the new job's console marker; sanitize logs before sharing. If there are no replicas, inspect Azure system logs, not another job run.

Step F, explicit cleanup after terminal execution and evidence review:

~~~bash
python3 scripts/azure-ghcr-auth-probe-operator.py --delete
~~~

Type DELETE_ONLY_CAMPUSPOOL_GHCR_AUTH_PROBE. This deletes only the new probe job, leaving original failed proof job, vault, secret, roles, database and Blob unchanged.

## Interpret result

- PASS with execution Succeeded: the KV-supplied PAT can read the immutable private manifest from an isolated probe. Review the original job's registry passwordSecretRef wiring/caching before any retest.
- TOKEN_ENDPOINT_HTTP_401/403 or MANIFEST_HEAD_HTTP_401/403: the private registry credential lacks effective access; validate exact PAT owner, token state, package ACL, and importing/version selection without widening Azure IAM.
- MANIFEST_HEAD_HTTP_404: registry could mask private access as missing; don't call the published image nonexistent based on that.
- No pod / public image pull error: probe didn't test GHCR; investigate bootstrap image/ACA platform first.
- Do not change the image digest, run backup exports, change production OTP, or initiate independent PG17 restore until all safety gates are satisfied.
