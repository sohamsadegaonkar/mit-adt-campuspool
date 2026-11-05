# CampusPool cloud worker: Alpine zlib source, PostgreSQL TLS, secrets and image signing review

**Date:** 2026-11-05 UTC. **Scope:** GitHub review branch and synthetic checks only. No Azure registry push, Key Vault creation, IAM grants, staging backup or production deployment.

## Verified Alpine zlib 1.3.2-r1 patch provenance

- Official Alpine 3.23 stable recipe: https://github.com/alpinelinux/aports/blob/3.23-stable/main/zlib/APKBUILD . The package version and release are 1.3.2-r1; the recipe includes CVE-2026-85091.patch and declares its SHA-512 checksum.
- Actual Alpine patch: https://github.com/alpinelinux/aports/blob/3.23-stable/main/zlib/CVE-2026-85091.patch . Its From line identifies upstream commit df84af25dc1942490e1d1c899a07619152a46148; it clears the stale input buffer length and pointer after a failed gzwrite.
- Upstream fix: https://github.com/madler/zlib/commit/df84af25dc1942490e1d1c899a07619152a46148 . Debian CVE-2026-85091 tracker also links to this commit: https://security-tracker.debian.org/tracker/CVE-2026-85091 .
- Debian bug 1153063, dated 2026-11-04, records a reproducer and explicitly says that the distinct CVE-2026-76844 is addressed by the same commit: https://bugs.debian.org/1153063 . That is reporter and source-level evidence, not a completed runtime exploit reproduction by this agent.
- The new scripts/verify-alpine-zlib-patch.js retrieves the official Alpine stable recipe and patch and fails if the package version, SHA-512 patch bytes, upstream identifier or crucial fix lines change. Its CI source-provenance job PASSed on 2026-11-05.
- Exact runtime Trivy coverage independently checks Alpine 3.23.7 with zlib 1.3.2-r1. The source check plus inventory supports an installed patched vendor package, but does not prove byte-level equivalence of every compiled shared-library instruction. No CVE waiver or scanner exception was introduced.

## PostgreSQL TLS and secret controls

**Previous design flaw:** managed-identity mode accepted a plaintext PGPASSWORD job environment variable and forwarded that variable to pg_dump; the TLS root check merely verified that an arbitrary file existed.

**Source improvements:**
- scripts/cloud-backup-runtime-security.js validates the PGSSLROOTCERT as a parseable, currently valid X.509 CA PEM file. Missing, invalid, expired, non-CA, symlinked or group/world-writable files are blocked.
- Cloud mode still requires PGSSLMODE=verify-full. The actual certificate chain and pooler hostname are checked by PostgreSQL libpq during a real TLS connection, not by this static guard. No real Supabase connection took place.
- Managed-identity mode rejects the inline PGPASSWORD variable and requires PGPASSFILE. The password file must be absolute, owner-only, not a symlink, on /dev/shm Linux tmpfs, owned by the current worker UID, with a single entry matching the allowlisted PG host, port, database and user.
- The pg_dump child receives only PGPASSFILE path; the AGE encryption child receives neither the password nor that path. All child environments use explicit allowlists. Only local CLI operator mode retains the former inline-password behavior pending separate local-operation review.
- A cloud preflight now blocks unless the protected passfile and real CA are present, in addition to existing explicit export approval for --execute.
- Synthetic tests use a public CA certificate and test-only credentials. They cover bad CA files, symlinks, permissive passfiles, incorrect host/user and child environment isolation. GitHub CI passed on 2026-11-05.

**Unresolved operational blocker:** Azure Container Apps secret-volume and Key Vault settings have not been provisioned. A trusted bootstrap must place a correctly escaped libpq password-file entry on UID 65532-accessible /dev/shm with mode 0600 or 0400 without exposing any credential on a shell command line, container image, persistent filesystem or CI logs. Validate this bootstrapping mechanism and the CA trust fingerprint independently in Azure before a real staging-only TLS handshake or export. Do not relax the file safeguards to make deployment appear ready.

## Sigstore keyless image review artifact

- The cloud-backup-worker CI pipeline only runs its signed-oci-candidate job after all image/CVE, zlib provenance, credential and synthetic backup guards PASS. The job runs on a same-repository pull request, has scoped GitHub OIDC id-token permission and no Azure credentials.
- Sigstore Cosign installer is pinned to commit 6f9f17788090df1f26f669e9d70d6ae9567deba6 (v4.1.2). It builds a Linux/amd64 OCI archive, signs those exact archive bytes using keyless Sigstore, and verifies the expected GitHub workflow certificate identity and SHA-256.
- PASS evidence: https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42069719355 . Signed OCI archive SHA-256: 85da830fcc1250213df626a922409ba032f5e053cfadac8cde7f58f1dce4355f . The Sigstore bundle contains a certificate and a transparency-log entry. GitHub retains the review artifact for one day.
- Important limitation: this is an ephemeral, signed PR review OCI **archive**, NOT a signature on an Azure Container Registry image manifest digest. Rebuilding/publishing changes the digest; production signing and verification must be repeated on the exact approved pushed registry image with a trusted release-workflow identity, after separate owner cost/RBAC approval.

## Remaining controls before real deployment

1. Review the source-package-to-runtime zlib claim and signed OCI bundle; independently inspect the Alpine zlib patch and trust-chain provenance if needed.
2. Design and test the safe password-file materialization path and CA fingerprint. Prove actual libpq TLS verify-full against staging using controlled credentials, without exporting user records during connection smoke.
3. Approve registry/Key Vault/secure logs/least-privilege identities/job costs before creating any resources. No Azure job exists; the empty Consumption environment remains untouched.
4. Sign the final published ACR image digest separately with an authorized trusted identity and compare the digest with the signed reviewed source image.
5. Only after explicit operator consent, perform real age-encrypted staging export, private Blob readback and a protected independent PostgreSQL 17/PostGIS cold restore, including roles, grants, RLS, content digests and Render rollback evidence. OTP remains not live.

**No real database, Azure data-plane or production actions were performed in this review.**
