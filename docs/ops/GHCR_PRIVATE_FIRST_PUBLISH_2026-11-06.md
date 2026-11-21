# First private GHCR backup-worker publication — owner WSL only

**Date:** 2026-11-06 IST. **Status:** guarded code and offline tests, **NOT A LIVE IMAGE PUBLICATION, SIGNING, OR AZURE BACKUP**. Branch `ops/backup-three-gates-evidence-2026-11-06` in draft PR #44.

## Intent and boundary

Create the first **private** GHCR package from the reviewed, secret-free, digest-pinned, non-root Node 22 / PostgreSQL 17 / AGE backup-worker image. Use a temporary, RAM-only Docker authentication configuration rather than storing a classic PAT in the user's unencrypted WSL/Windows drives. **No Azure resource or service is changed**, no Supabase connection, no backup, and no automatic or production job deployment.

The package name is `ghcr.io/sohamsadegaonkar/campuspool-backup-worker`, **never** a mutable `:latest` tag. First publication is through Docker CLI rather than a GitHub Actions workflow in the public CampusPool repository, preserving independent private package permissions. GitHub explicitly documents first personal Container packages as private, and CLI-published images as initially unlinked to the repository. **Do not add an OCI `org.opencontainers.image.source` label to this first-publish image** or enable repository-inherited permissions without review.

### Owner action — prepare a new clean WSL checkout

```bash
# Run on WSL Ubuntu-D / the local Linux Docker workstation, not Azure Cloud Shell.
git clone --depth 1 --branch ops/backup-three-gates-evidence-2026-11-06 \
  https://github.com/sohamsadegaonkar/mit-adt-campuspool.git \
  "$HOME/campuspool-ghcr-release"
cd "$HOME/campuspool-ghcr-release"

# Require current exact-head CI success before a first publication.
git status --short
git rev-parse HEAD
bash ops/cloud-backup/ghcr-private-first-publish.sh --build-check
```

`--build-check` builds `linux/amd64` with `ops/cloud-backup/Dockerfile`, checks non-root UID 65532, executes read-only network-disabled smoke tests and proves that unauthenticated `--execute` **fails**. Source repository must be clean, and the isolated clone avoids the earlier accidental `-` plaintext dump file. Docker has an explicit-copy Dockerfile and `.dockerignore` denying dumps, keys and accidental archives. The build itself may download public Node/Alpine/npm dependencies; the smoke test has no network.

### Owner action — first private package publication (after local build succeeds)

1. Open <https://github.com/settings/tokens/new?scopes=write:packages> and create a short-lived **classic PAT** with **`write:packages` only**. GitHub's token UI may preselect broad `repo`; **deselect `repo`** and any unnecessary scopes before issuing the token. Do not paste it into chat, scripts, Git, terminal history or environment files.
2. In the same clean WSL checkout, run:

   ```bash
   bash ops/cloud-backup/ghcr-private-first-publish.sh --publish-private
   ```

   Paste the token **only at the hidden interactive prompt**. The helper checks existing package visibility using GitHub REST, authenticates Docker using `--password-stdin` with `DOCKER_CONFIG` under private `/dev/shm`, uploads the exact `review-<sourceSHA12>` image tag, extracts the **remote pushed manifest digest**, and authenticates a **post-push** REST query proving `visibility=private`, expected owner and expected package. It removes the token and temporary Docker configuration on exit. If a check fails, it prints a generic stop status and NEVER treats a package as private based on a guess.
3. Also open <https://github.com/sohamsadegaonkar?tab=packages> and independently check `campuspool-backup-worker` is marked **Private**. Record the `REMOTE_MANIFEST=ghcr.io/...@sha256:...` reference (digest is not sensitive). **Do not turn package visibility Public.**
4. **Do not deploy or trigger a backup yet.** This helper does **not** sign the image; first independently sign/verify the exact **published** digest with a separately trusted Cosign OIDC signing identity, preserve SBOM and exact-image Trivy scan, review package access, and produce independent human security signoff. Only after that authorize a preflight-only Container Apps Job with Vault/managed-identity/Blob permissions under the owner's spend and security constraints.
5. Revoke the temporary publishing token after signing or when no longer needed. Generate a **different read:packages-only** token for Azure private GHCR pull, held only in Key Vault, with documented expiry, rotation and revocation. Never reuse the publishing token in Azure.

**Halt conditions:** any missing CI check, unreviewed image, Docker smoke failure, nonexistent tmpfs, dirty Git checkout, inherited source label, unexpected package owner, unverified private visibility, unavailable pushed manifest digest, package access failure, or unexpected Azure resource/billing request. A successful push is **NOT** a published-digest signature or backup recovery acceptance.

### Independent sources

- [GitHub: Container registry authentication, first-publish privacy and CLI linking](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub: Personal package visibility and repository access inheritance](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [Sigstore: sign and verify image digests](https://docs.sigstore.dev/cosign/signing/signing_with_containers/)
- [Existing source-only reviewed worker and independent security gates](CLOUD_BACKUP_INDEPENDENT_SECURITY_REVIEW_2026-11-05.md)

**Do not save, quote, upload, or commit tokens, image layers with secrets, staging connection strings, database dumps or AGE recovery private keys.**
