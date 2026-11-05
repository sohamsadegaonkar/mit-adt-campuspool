# CampusPool backup worker — full-container CVE review and lean image candidate

**Review date:** 2026-11-05 UTC. **Scope:** GitHub CI only; no Azure image publication, job, secret, staging export, production deployment or permission grants.

## Objective and evidence

Move from a full PostgreSQL server Docker image to a non-root Node.js 22 + PostgreSQL 17 **client-only** + AGE worker. Preserve the existing safety invariants: explicit allowlisted files, no private AGE identity, no privileged runtime, `--preflight` by default, fixed Node base image digest and exact npm dependency lockfile. Review actual container OS + language ecosystem advisories with Trivy rather than treating `npm audit` as an image audit.

| Image | Trivy total | Critical | High | Sources |
| --- | ---: | ---: | ---: | --- |
| Original PostgreSQL 17 bookworm image + `gosu` | 458 | 4 | 72 | [Original scan](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42050254779) |
| PostgreSQL bookworm image after removing unused `gosu` | 397 | 3 | 47 | [Cleanup scan](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42050852283) |
| PostgreSQL 17 Trixie full server experiment | 336 | 1 | 63 | [Trixie experiment](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42051538206) |
| Node bookworm + PGDG `postgresql-client-17` + AGE, retaining Node npm tools | 297 | 2 | 52 | [First client experiment](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42058495458) |
| Same client-only runtime with bundled npm/corepack removed | **268** | **1** | **40** | [Lean experiment](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42058866977) |

The last scanner output: **268 Debian 12 OS findings:** 1 CRITICAL, 40 HIGH, 113 MEDIUM, 111 LOW, 3 UNKNOWN; **0 Node library findings**. The image built on GitHub Actions; `node`, `pg_dump --version` (PostgreSQL 17), and `age --version` passed. Runtime `postgres`, `npm`, `npx` commands were absent. Attempted `--execute` without protected config failed closed. The lean version is promoted to the review branch's canonical `ops/cloud-backup/Dockerfile`, but is **not a deployable release** until full scan of that exact final Dockerfile, vulnerability triage, image signature and separate owner approval.

## Critical finding with vendor assessment

**CVE-2023-45853** surfaced as `zlib1g` in the Debian 12 scan. The issue is in **MiniZip** `zipOpenNewFileInZip4_64`, not the ordinary zlib inflate/deflate API. The official [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853) specifically marks Debian Bookworm's zlib source advisory **ignored** because the affected contrib/minizip implementation was not built into the relevant zlib binary packages; Debian's separate `minizip` Bookworm package shows a fixed version. This supports a **potential not-applicable triage**, not permission for an automatic global ignore. Before any CVE-specific VEX decision, confirm exact runtime contents have no affected MiniZip binary/library and obtain independent security reviewer acceptance of the Debian tracker rationale.

The remaining **40 HIGH** scanner findings are not automatically accepted or waived. Keep the current strict Trivy HIGH/CRITICAL gate **blocking** and triage each reachable/system-level issue by Debian package status, deployed runtime's actual exposed code paths, and approved mitigations. Vendor `affected`, `fix_deferred`, `will_not_fix` do not mean harmless. Re-scan after every image or OS package update.

## Supply chain caveats and release conditions

1. Runtime base is **digest pinned** to Node 22.23.2 Bookworm Slim; `npm ci` resolves the committed lockfile in an isolated builder stage, then npm/corepack is removed from the final runtime. Two pinned identical Node base stages prevent the full PostgreSQL **server** environment from being inherited.
2. The PostgreSQL **client** comes from the official signed PostgreSQL APT repository, `bookworm-pgdg`, as documented by [PostgreSQL](https://www.postgresql.org/download/linux/debian/). The exact signed `postgresql-client-17`, AGE and Debian package versions are still resolved by APT at build time; **APT layers are not bit-reproducible** merely because the base image/npm lockfile are pinned. Review/update PGDG signing-key provenance and the dependency SBOM, then sign the **final built image digest**.
3. CI must verify the actual reviewed main Dockerfile, offline nonroot/--preflight smoke, full Trivy OS+library scan and CycloneDX SBOM. The strict scanner fail indicates **NO-GO** until specific security sign-off, not the mere presence of a JSON report.
4. **No deployment resource is approved beyond the empty Azure Container Apps environment.** [Azure registry, Key Vault, identities and manual-only job plan](AZURE_BACKUP_REGISTRY_VAULT_JOB_PREPARATION.md) remains a proposal, awaiting a concrete spending cap and permission approval. Do not touch the production OTP deployment/migration until real encrypted staging backup, separate protected PG17/PostGIS restore, and Render rollback gates are independently passed.

## Next operational handoff

- Verify final PR #38 scan result and image SBOM at the current GitHub head; collect exact critical/high advisory details and vendor classification; request security review of MiniZip zlib false-positive candidate and other remaining CVEs.
- Avoid registry push, Key Vault provisioning, privileged job creation, job execution, or staging DB credentials until a concrete approved budget and safe runtime design exist. Existing private Azure Blob container and invalid old 200-byte object remain untouched.

## Promoted client-only Dockerfile and Debian patch-upgrade follow-up — 2026-11-05 UTC

- Promoted the client-only base to the canonical `ops/cloud-backup/Dockerfile`, requiring **both** stages from the same pinned Node 22 slim digest and copying only locked production npm modules and allowlisted scripts. The runtime installs signed PGDG `postgresql-client-17` and AGE (not the PostgreSQL server), removes bundled npm/corepack and operates as nonroot with `--preflight`. Existing CI unit guards, image build and no-secrets smoke passed on this exact design. Retired redundant experimental CI jobs and Dockerfiles.
- [First promoted-image exact scan](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42059534772): **268** vulnerabilities, 1 CRITICAL, 40 HIGH, 113 MEDIUM, 111 LOW, 3 UNKNOWN; **3** HIGH with available fixed packages in Debian (`apt` and `libapt-pkg6.0` / `CVE-2026-109518`, `libpcre2-8-0` / `CVE-2026-103111`). No release approval.
- Added `apt-get upgrade -y --no-install-recommends` to the same Dockerfile layer immediately after PGDG signed APT metadata refresh, then installed only PG17 client. [Latest full CI scan](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42060036992): **262** Debian OS advisories, **1 CRITICAL, 37 HIGH, 113 MEDIUM, 111 LOW and 0 UNKNOWN**; **0 HIGH/CRITICAL with a scanner-published package fix** at scan date. The strict all-HIGH/CRITICAL release gate **still FAILED intentionally**. The npm audit, worker image build, nonroot/--preflight and Azure auth tests passed. The critical zlib MiniZip-related finding needs individual Debian tracker/VEX review; no automatic waiver granted.
- **Important repeatability caveat:** `apt-get upgrade` and `postgresql-client-17` resolve current signed Debian/PGDG package versions at build time. The build must be pinned/attested by final image digest plus SBOM before Azure release; base SHA/npm lockfile alone do not yield byte-for-byte reproducibility. Every future image rebuild requires fresh OS + app scans.
