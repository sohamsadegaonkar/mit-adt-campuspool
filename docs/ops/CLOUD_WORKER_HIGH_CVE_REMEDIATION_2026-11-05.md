# CampusPool cloud-backup worker — 37 HIGH Debian findings disposition

**Date:** 2026-11-05 UTC. **Source:** raw Trivy JSON/SBOM artifact from [image scan run 42062150091](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42062150091). **Scope:** worker container image only, not the broader CampusPool application or encrypted-backup recovery.

## Exact inventory and root cause

The prior pinned Debian 12 worker image reported 37 HIGH *package-finding rows* grouped into **10 distinct CVEs across eight source-package families**. Package duplicates are legitimate scanner rows (e.g. one util-linux CVE across eight subpackages) but do not represent eight independent bugs.

| CVE | Source family | Rows | Debian vendor assessment and affected code path | Remediation / release disposition |
| --- | --- | ---: | --- | --- |
| [CVE-2026-53613](https://security-tracker.debian.org/tracker/CVE-2026-53613) | util-linux | 8 | Debian Bookworm 2.38.1-5+deb12u3 vulnerable; TOCTOU in privileged `mount`. Debian Trixie fixed in 2.41.5-0+deb13u1. | Remove entire Debian util-linux runtime by changing **worker's OS** to an Alpine 3.23 base; no SUID mount is required for backup. No waiver. |
| [CVE-2026-53615](https://security-tracker.debian.org/tracker/CVE-2026-53615) | util-linux | 8 | Debian Bookworm vulnerable; libblkid DOS partition parser integer overflow. Debian Trixie fixed. | Same distribution replacement; no disk partition parsing needed in worker. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/source-package/util-linux) | util-linux | 8 | Debian tracker flags Bookworm vulnerable; [Red Hat's researcher summary](https://access.redhat.com/security/cve/cve-2026-78410) says the affected X-mount owner/group/mode functionality began in 2.39, after Bookworm's 2.38.1. **Conflicting vendor assessments:** do not classify not-affected automatically. | Remove Debian util-linux package tree entirely, avoid relying on disputed source-level label. |
| [CVE-2026-41992](https://security-tracker.debian.org/tracker/CVE-2026-41992) | GNU gzip | 1 | Bookworm vulnerable/postponed; LZH decompressor state overflow. Trixie fixed. | Remove GNU gzip by using Alpine worker runtime; do not decompress untrusted LZH data. |
| [CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369) | acl / libacl | 1 | Bookworm vulnerable/postponed due to ABI-changing `acl_*_at` upstream fix. | Remove Debian libacl package and ACL-mutating tooling from worker. |
| [CVE-2023-2953](https://security-tracker.debian.org/tracker/CVE-2023-2953) | OpenLDAP | 1 | Bookworm OpenLDAP affected; null dereference in `ber_memalloc_x`. Trixie fixed. | Use Alpine PG17 client dependency graph that did **not** pull Debian libldap-2.5-0. |
| [CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538) | Perl/Archive::Tar | 4 | Bookworm vulnerable/postponed; crafted tar headers can force very large allocation. | Do not include Perl or Archive::Tar in the minimal runtime. |
| [CVE-2026-16742](https://security-tracker.debian.org/tracker/source-package/systemd) | systemd | 2 | `systemd-homed` local privilege escalation; Debian Bookworm source vulnerable/postponed. | No systemd service or libsystemd/udev packages in Alpine job runtime. |
| [CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720) | ncurses | 3 | Bookworm vulnerable/no-DSA; `infocmp` stack overflow. | Alpine worker may include **different** ncurses binary packages (e.g. readline dependency), but old Debian `ncurses-bin` and source-package issue are not carried over. Scan *Alpine* packages separately. |
| [CVE-2026-76844](https://www.debian.org/Bugs/) | zlib | 1 | A real `gz_write` state bug in older zlib, distinct from [CVE-2026-85091](https://security.alpinelinux.org/vuln/CVE-2026-85091). [Debian bug #1153063](https://bugs.debian.org/1153063) says both issues are addressed by upstream commit `df84af2` but Bookworm has no patch. | Alpine 3.23 packages `zlib=1.3.2-r1`, a vendor security build for CVE-2026-85091, and the **actual image scan reports zero known CVEs**. Do **not** infer CVE-2026-76844 is fully verified from scanner silence alone; verify Alpine's source patch provenance/reachability before first export. |

**Totals:** util-linux 24 + gzip 1 + acl 1 + OpenLDAP 1 + Perl 4 + systemd 2 + ncurses 3 + zlib 1 = **37 HIGH package rows**.

## Tested remediation (source only)

- Build a minimal **Alpine Linux 3.23** image instead of the Debian 12 worker, still including exactly PostgreSQL 17 client tools, AGE encryption, Node 22, trusted CA roots, allowlisted scripts and locked runtime Node packages; no PostgreSQL server, no npm toolchain, nonroot UID/GID 65532, and `--preflight` as default.
- [Isolated Alpine candidate run 42064936340](https://github.com/sohamsadegaonkar/mit-adt-campuspool/actions/runs/42064936340) **PASS**: `node v22.23.4`, `pg_dump 17.11`, AGE, absent `postgres`/`npm`/`npx`, and missing protected secrets blocked `--execute`.
- Full Trivy OS+application scan **0 reported vulnerabilities**, with verified scanner inventory: Alpine **3.23.7**, **29 OS packages**, **78 Node package records** and **108 CycloneDX SBOM components**. Raw scan and SBOM are downloadable GitHub Actions artifacts. This is a **time-limited scanner assessment**; zero published matches does not mean zero weaknesses or automatically prove that every old CVE is patched in a source dependency.
- Official [Alpine 3.23 `postgresql17-client` package](https://pkgs.alpinelinux.org/package/v3.23/main/x86_64/postgresql17-client) is 17.11-r0; [Alpine `age` package](https://pkgs.alpinelinux.org/packages?branch=v3.23&name=age) is 1.2.1-r15; [Alpine `zlib` package](https://pkgs.alpinelinux.org/package/v3.23/main/x86_64/zlib) is 1.3.2-r1.
- The canonical worker Dockerfile in [draft PR #38](https://github.com/sohamsadegaonkar/mit-adt-campuspool/pull/38) was updated to the **tested parent image index digest** `sha256:6abbcf5dd6b231da109bcde1181db1d92bf78015ae1a9514d9807c1f857869db` for both build/runtime stages and specific APK package versions. The release scan now **fails closed if the scanner cannot find the expected Alpine OS package graph or Node lockfile packages**, and separately blocks all HIGH/CRITICAL findings.

## Residual security and recovery gates

1. Confirm the exact-final-commit CI scan, smoke, npm audit, scanner coverage and SBOM; **do not** reintroduce Debian-only MiniZip exception as a generic cross-OS suppression. Prior Debian evidence remains historically valid but Alpine needs its *own* package-specific assessments.
2. Review Alpine zlib 1.3.2-r1 source patch pedigree for the additional `CVE-2026-76844` report despite Trivy's clean scan. No blanket risk waiver.
3. Sign and retain the **built image digest**, inspect latest advisories before publishing, and perform a full TLS/PG17 SSL `verify-full` smoke with protected staging credentials in an approved environment. The base digest and APK exact version declarations are not a replacement for final release provenance.
4. **No new Azure registry, Key Vault, identity, permission grant, job, logging sink, actual export or migration** is authorized. The user has not approved a specific Azure for Students budget for these. Real encrypted backup, independent PG17/PostGIS restore and Render rollback still block staging/OTP/production deployment.

No student records or secrets were accessed or stored in this task.
