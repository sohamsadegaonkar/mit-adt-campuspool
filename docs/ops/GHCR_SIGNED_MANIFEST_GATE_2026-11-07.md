# GHCR first private publication — verified owner output and next exact-digest signing

**Date:** November 7, 2026 (IST). **Scope:** private CampusPool staging encrypted-backup worker. **No Azure job or staging export authorized by these results.**

## Owner-confirmed first publication

The owner ran the guarded WSL Docker `--publish-private` helper following the clean-checkout build. It returned these **non-secret evidence fields**:

```text
GHCR_PACKAGE_NOT_FOUND_FIRST_PUSH_WILL_DEFAULT_PRIVATE
GHCR_PERSONAL_CONTAINER_PACKAGE_PRIVATE_VERIFIED
REMOTE_GHCR_PRIVATE_VERIFIED=YES
REMOTE_MANIFEST=ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2
REGISTRY_MANIFEST_NOT_YET_SIGNED_OR_APPROVED_FOR_AZURE=YES
```

- Initial package was absent and the first publish was through Docker CLI, not the public repository's GitHub Actions workflow. The helper authenticated to GitHub's owner Container package endpoint and received `visibility=private` **after** the push. Therefore **private first publication and authenticated package-visibility verification: PASS (owner-provided execution evidence)**.
- Image is `linux/amd64`, source review tag `review-6c571396fff0`, immutable pushed registry **manifest** digest `sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2`. **Do not substitute a local Docker image ID or earlier signed OCI archive SHA for this manifest digest.**
- Docker printed its normal warning that authentication configuration was stored unencrypted in `/dev/shm/campuspool-private-ghcr-.../docker-config/config.json`. `/dev/shm` is RAM-backed tmpfs on the user's Linux Docker host, and the helper's EXIT trap logs out and removes that temporary directory. The warning did **not** mean credentials were intentionally saved in the user's persistent `~/.docker/config.json`. The owner should still revoke the temporary write-scoped PAT when no longer needed and should never share it in chat or Git.
- No assertion that signing, signature verification, independent human approval, Key Vault access, secure CA and `/dev/shm` in Azure, encrypted Blob backup or independent PG17/PostGIS cold restore has occurred.

## Next controlled image-signing step (owner WSL only)

A reviewed **owner-interactive keyless signing script** is at `ops/cloud-backup/ghcr-owner-sign-digest.sh`, pinned to the above exact private manifest. It performs only GHCR package metadata GET, Docker private-registry login, `cosign sign --yes` of the digest, `cosign verify` with **exact user-entered GitHub OIDC signer identity** and `https://github.com/login/oauth` issuer, then rechecks that package remains Private. Token and Docker auth are held in owner-only RAM-backed `/dev/shm` and cleaned on EXIT. No Azure or database access, no Docker image rebuild and no mutable tag.

**Important confidentiality choice:** Sigstore Fulcio/Rekor identity-based signing can permanently record the **signer's email address in a public transparency log**, even though the GHCR image itself remains Private. The script explicitly asks consent. If that privacy tradeoff is unacceptable, do **not** run `--sign`: arrange a separately approved GitHub Actions release signer from a security-reviewed private signing environment, with tightly scoped package access instead. Granting a public repository GHCR Actions access can expose private packages to forks, per GitHub documentation. Never silently grant that access or make this package public.

```bash
# Run only in the existing WSL checkout used for private GHCR publication.
cd "$HOME/campuspool-ghcr-release"
git pull --ff-only
cosign version
bash ops/cloud-backup/ghcr-owner-sign-digest.sh --sign
```

- Prerequisite: recent **verified authentic Cosign** installed. If `cosign version` fails, obtain the release using official verified binaries/install instructions at https://docs.sigstore.dev/cosign/system_config/installation/ ; do **not** run an unverified curl-pipe shell snippet.
- Use a **temporary classic PAT with `write:packages` for `--sign`**, supplied only to the hidden prompt; choose **GitHub** for Cosign OIDC login and enter the matching expected identity at the script's hidden prompt. Do not paste token, OIDC login URL, signer email, raw Cosign output or private key into Git, chat, Notion or logs.
- A successful run prints `SIGNATURE_CRYPTOGRAPHICALLY_VERIFIED=YES` and the **unchanged exact digest**. Optionally repeat `bash ops/cloud-backup/ghcr-owner-sign-digest.sh --verify` with a new `read:packages` classic PAT and the same expected issuer/identity, using a separate controlled device for more independent verification.
- **This owner's interactive signing does not automatically satisfy the existing independent trusted-release-workflow identity/human security acceptance gate.** Reviewer must decide if an owner GitHub OIDC personal signing identity is acceptable for this one-time bootstrap or require a protected CI release-workflow identity. Never deploy an unsigned or independently unreviewed worker.

## Remaining mandatory external gates

Key Vault and `Microsoft.ManagedIdentity` providers are **Registered**, but no Key Vault, user-assigned registry/CA reader, system-assigned job/data role, no-delete container-scoped Blob permissions, manually approved zero-retry Container Apps job or tested root CA mount has yet been verified. The ₹500 aggregate spending review was deferred rather than passed. First genuine AGE-encrypted staging `pg_dump` to private Blob and **independent** PG17/PostGIS cold restore remain **OPEN/NO-GO**.

Sources: [existing GHCR first publish plan](GHCR_PRIVATE_FIRST_PUBLISH_2026-11-06.md), [Sigstore image signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/), [Cosign verifying signer identity](https://docs.sigstore.dev/cosign/verifying/verify/), [GitHub granular package access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).
