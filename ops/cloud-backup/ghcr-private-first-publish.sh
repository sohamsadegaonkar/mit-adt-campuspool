#!/usr/bin/env bash
# Owner WSL workstation ONLY. Never pass secrets in argv, env files, or Git.
# Modes: --build-check (default) and --publish-private (explicit interactive).
# This helper DOES NOT sign images or authorize Azure deployment / DB access.
set -euo pipefail
umask 077

usage() {
  echo "Usage: bash ops/cloud-backup/ghcr-private-first-publish.sh --build-check|--publish-private" >&2
  exit 2
}
[[ $# -eq 1 ]] || usage
mode="$1"
[[ "$mode" == "--build-check" || "$mode" == "--publish-private" ]] || usage

owner="sohamsadegaonkar"
image="ghcr.io/${owner}/campuspool-backup-worker"
root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "STOP_NOT_GIT_REPOSITORY"; exit 2; }
cd "$root"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || {
  echo "STOP_DIRTY_REPOSITORY: use a fresh clean clone; do not copy local dumps"; exit 2;
}
[[ -f ops/cloud-backup/Dockerfile && -f scripts/azure-blob-backup.js ]] || {
  echo "STOP_WRONG_REPOSITORY"; exit 2;
}
remote="$(git remote get-url origin 2>/dev/null)" || { echo "STOP_NO_ORIGIN"; exit 2; }
case "$remote" in
  https://github.com/sohamsadegaonkar/mit-adt-campuspool|\
  https://github.com/sohamsadegaonkar/mit-adt-campuspool.git|\
  git@github.com:sohamsadegaonkar/mit-adt-campuspool.git) ;;
  *) echo "STOP_UNEXPECTED_ORIGIN"; exit 2;;
esac
sha="$(git rev-parse HEAD)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "STOP_INVALID_SOURCE_SHA"; exit 2; }
tag="review-${sha:0:12}"
ref="${image}:${tag}"

if [[ "$mode" == "--build-check" ]]; then
  echo "SOURCE_COMMIT=$sha"
  echo "LOCAL_REVIEW_IMAGE=$ref"
  echo "BUILD_NETWORK=DEPENDENCY_DOWNLOAD_ONLY; NO_AZURE_OR_STAGING_ACCESS"
  docker build --platform linux/amd64 --file ops/cloud-backup/Dockerfile --tag "$ref" .
  # No source-repository OCI label: first personal GHCR CLI publication must remain unlinked.
  labels="$(docker image inspect --format '{{json .Config.Labels}}' "$ref")"
  [[ "$labels" != *"org.opencontainers.image.source"* ]] || {
    echo "STOP_AUTOMATIC_REPOSITORY_ACCESS_INHERITANCE"; exit 3;
  }
  uid="$(docker image inspect --format '{{.Config.User}}' "$ref")"
  [[ "$uid" == "65532:65532" ]] || { echo "STOP_IMAGE_NOT_NONROOT"; exit 3; }
  docker run --rm --network none --read-only --entrypoint sh "$ref" -c \
    'test "$(id -u)" -eq 65532 && node --version && pg_dump --version && age --version'
  # The image must reject an unauthenticated run even when --execute is supplied.
  if docker run --rm --network none --read-only "$ref" --execute; then
    echo "STOP_UNAUTHENTICATED_BACKUP_UNEXPECTEDLY_SUCCEEDED"; exit 3;
  fi
  echo "LOCAL_IMAGE_BUILD_AND_NO_SECRET_EXECUTION_GUARD_PASS"
  echo "LOCAL_IMAGE_IS_NOT_SIGNED_OR_PUBLISHED"
  exit 0
fi

# PUBLISH: only previously built, reviewed image. Pushes private registry data.
docker image inspect "$ref" >/dev/null || {
  echo "STOP_IMAGE_NOT_BUILT: run --build-check first"; exit 4;
}
[[ "$(docker image inspect --format '{{.Config.User}}' "$ref")" == "65532:65532" ]] || {
  echo "STOP_IMAGE_NOT_NONROOT"; exit 4;
}
[[ "$(docker image inspect --format '{{json .Config.Labels}}' "$ref")" != *"org.opencontainers.image.source"* ]] || {
  echo "STOP_AUTOMATIC_REPOSITORY_ACCESS_INHERITANCE"; exit 4;
}
[[ "$(stat -f -c %T /dev/shm)" == "tmpfs" ]] || {
  echo "STOP_NO_RAM_BACKED_CREDENTIAL_STORE"; exit 4;
}
command -v python3 >/dev/null && command -v docker >/dev/null || {
  echo "STOP_REQUIRED_UTILITIES_MISSING"; exit 4;
}
[[ -f scripts/ghcr_private_package_check.py ]] || { echo "STOP_PRIVACY_CHECK_MISSING"; exit 4; }
tmpdir="$(mktemp -d /dev/shm/campuspool-private-ghcr-XXXXXXXX)"
chmod 700 "$tmpdir"
export DOCKER_CONFIG="$tmpdir/docker-config"
mkdir -m 700 "$DOCKER_CONFIG"
GHCR_PAT=""
cleanup() {
  unset GHCR_PAT || true
  docker --config "$DOCKER_CONFIG" logout ghcr.io >/dev/null 2>&1 || true
  rm -rf -- "$tmpdir"
  unset DOCKER_CONFIG || true
}
trap cleanup EXIT

echo "GHCR_PACKAGE=campuspool-backup-worker"
echo "TOKEN_REQUIRED=classic_Personal_Access_Token_write:packages_ONLY_SHORT_EXPIRY"
echo "NEVER_PASTE_TOKEN_IN_CHAT_OR_COMMAND_HISTORY"
IFS= read -r -s -p "Paste short-lived GHCR upload token (input hidden): " GHCR_PAT
printf '\n'
[[ -n "$GHCR_PAT" && "$GHCR_PAT" != *[$'\r\n']* ]] || {
  echo "STOP_TOKEN_EMPTY_OR_INVALID"; exit 4;
}
# Token is sent to Python via stdin, not environment, argv or persistent disk.
if ! printf '%s\n' "$GHCR_PAT" | python3 scripts/ghcr_private_package_check.py before; then
  echo "STOP_GHCR_VISIBILITY_PREFLIGHT_FAILED"; exit 4;
fi
if ! printf '%s' "$GHCR_PAT" | docker --config "$DOCKER_CONFIG" login ghcr.io \
  --username "$owner" --password-stdin >/dev/null; then
  echo "STOP_PRIVATE_GHCR_AUTH_FAILED"; exit 4;
fi

echo "PUSHING_REVIEW_IMAGE=$ref"
echo "NOT_DEPLOYABLE: awaiting pushed digest signing and independent security approval"
docker --config "$DOCKER_CONFIG" push "$ref" >"$tmpdir/push-output.log" 2>&1 || {
  echo "STOP_PRIVATE_GHCR_PUSH_FAILED"; exit 5;
}
digest="$(grep -Eo 'digest: sha256:[0-9a-f]{64}' "$tmpdir/push-output.log" | tail -n 1 | cut -d' ' -f2 || true)"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "STOP_REGISTRY_MANIFEST_DIGEST_UNAVAILABLE"; exit 5;
}
# Verify package metadata with same token; fail on absent/unknown visibility.
if ! printf '%s\n' "$GHCR_PAT" | python3 scripts/ghcr_private_package_check.py after; then
  echo "STOP_POST_PUSH_PACKAGE_PRIVACY_NOT_VERIFIED: do not share/deploy"; exit 5;
fi
echo "REMOTE_GHCR_PRIVATE_VERIFIED=YES"
echo "REMOTE_MANIFEST=${image}@${digest}"
echo "REGISTRY_MANIFEST_NOT_YET_SIGNED_OR_APPROVED_FOR_AZURE=YES"
