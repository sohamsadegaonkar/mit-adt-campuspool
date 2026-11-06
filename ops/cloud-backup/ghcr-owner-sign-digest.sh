#!/usr/bin/env bash
# CampusPool: owner-run, private-registry, digest-locked Sigstore signing.
# This signs an already-published image; NEVER builds, pushes a new image,
# provisions Azure resources, or accesses the staging database.
set +x
set -euo pipefail
umask 077

IMAGE="ghcr.io/sohamsadegaonkar/campuspool-backup-worker@sha256:697feb0cf43a434dcf1afead5968b30d56fa4420edb16892b259894c710b03a2"
EXPECTED_ISSUER="https://github.com/login/oauth"
if [[ $# -ne 1 || ( "$1" != "--sign" && "$1" != "--verify" ) ]]; then
  echo "Usage: bash ops/cloud-backup/ghcr-owner-sign-digest.sh --sign|--verify" >&2
  exit 2
fi
mode="$1"

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "STOP_NOT_CAMPUSPOOL_GIT_CHECKOUT"; exit 2;
}
cd "$root"
[[ -f scripts/ghcr_private_package_check.py ]] || {
  echo "STOP_PACKAGE_PRIVACY_GATE_MISSING"; exit 2;
}
for name in docker cosign python3; do
  command -v "$name" >/dev/null 2>&1 || {
    echo "STOP_TOOL_NOT_INSTALLED_$name"; exit 2;
  }
done
[[ "$(stat -f -c %T /dev/shm)" == tmpfs ]] || {
  echo "STOP_PRIVATE_RAM_CREDENTIAL_STORE_UNAVAILABLE"; exit 2;
}
echo "PINNED_IMAGE=$IMAGE"
echo "ACTION=$mode"
echo "GHCR_PACKAGE_MUST_REMAIN_PRIVATE=YES"
echo "NO_AZURE_OR_DATABASE_ACTIONS=YES"

# Sigstore's public transparency log permanently records the signer identity.
# Require explicit opt-in before starting any registry signing operation.
if [[ "$mode" == "--sign" ]]; then
  echo "WARNING: KEYLESS_SIGNING_PUBLISHES_SIGNER_OIDC_IDENTITY_IN_PUBLIC_TRANSPARENCY_LOG"
  echo "Use your GitHub OIDC login. Do not sign if you do not consent to its public disclosure."
  IFS= read -r -p "Type 'I CONSENT TO PUBLIC SIGNER IDENTITY' to continue: " consent
  [[ "$consent" == "I CONSENT TO PUBLIC SIGNER IDENTITY" ]] || {
    echo "STOP_SIGNING_CONSENT_NOT_GIVEN"; exit 3;
  }
fi

echo "GitHub OIDC signer email is never saved or echoed by this helper."
IFS= read -r -s -p "Expected GitHub OIDC signer email (hidden): " signer
printf '\n'
[[ "$signer" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || {
  echo "STOP_SIGNER_IDENTITY_INVALID"; exit 3;
}

ramdir="$(mktemp -d /dev/shm/campuspool-cosign-XXXXXXXX)"
chmod 700 "$ramdir"
export DOCKER_CONFIG="$ramdir/docker-config"
export XDG_CACHE_HOME="$ramdir/cache"
export XDG_CONFIG_HOME="$ramdir/config"
mkdir -m 700 "$DOCKER_CONFIG" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME"
GHCR_PAT=""
cleanup() {
  unset GHCR_PAT signer || true
  docker --config "$DOCKER_CONFIG" logout ghcr.io >/dev/null 2>&1 || true
  rm -rf -- "$ramdir"
}
trap cleanup EXIT

echo "Use a temporary classic PAT with write:packages for --sign, read:packages for --verify."
echo "NEVER_PASTE_TOKEN_IN_CHAT_OR_STORE_ON_DISK"
IFS= read -r -s -p "Paste GHCR PAT (hidden): " GHCR_PAT
printf '\n'
[[ -n "$GHCR_PAT" && "$GHCR_PAT" != *[$'\r\n']* ]] || {
  echo "STOP_TOKEN_INVALID"; exit 3;
}
if ! printf '%s\n' "$GHCR_PAT" | python3 scripts/ghcr_private_package_check.py after; then
  echo "STOP_PACKAGE_NOT_VERIFIED_PRIVATE"; exit 4;
fi
if ! printf '%s' "$GHCR_PAT" | docker --config "$DOCKER_CONFIG" login ghcr.io \
    --username sohamsadegaonkar --password-stdin >/dev/null; then
  echo "STOP_GHCR_AUTH_FAILED"; exit 4;
fi
# Keep the credential solely as an in-memory shell variable until the
# authenticated post-sign privacy check. Trap destroys the RAM config on exit.

if [[ "$mode" == "--sign" ]]; then
  echo "START_KEYLESS_SIGNING_GITHUB_OIDC_ONLY"
  echo "Follow Cosign's browser/device login prompt, select GitHub."
  # Cosign's interactive browser/device URL and issuer identity may be shown.
  # Do NOT paste those raw logs into chats or tickets.
  if ! cosign sign --yes "$IMAGE"; then
    echo "STOP_REGISTRY_SIGNING_FAILED"; exit 5;
  fi
fi

# Verify the *same exact immutable digest*, and require the expected
# GitHub OIDC login (not a regex matching any person/provider).
if ! cosign verify \
    --certificate-identity "$signer" \
    --certificate-oidc-issuer "$EXPECTED_ISSUER" \
    "$IMAGE" >/dev/null 2>&1; then
  echo "STOP_SIGNED_DIGEST_IDENTITY_VERIFICATION_FAILED"; exit 6;
fi
if ! printf '%s\n' "$GHCR_PAT" | python3 scripts/ghcr_private_package_check.py after; then
  echo "STOP_POST_SIGN_PACKAGE_NOT_PRIVATE"; exit 7;
fi
unset GHCR_PAT
echo "SIGNATURE_CRYPTOGRAPHICALLY_VERIFIED=YES"
echo "VERIFIED_IMAGE=$IMAGE"
echo "EXPECTED_SIGNER_ISSUER=$EXPECTED_ISSUER"
echo "FINAL_RELEASE_WORKFLOW_ATTESTATION_AND_INDEPENDENT_SECURITY_SIGNOFF_STILL_REQUIRED=YES"
