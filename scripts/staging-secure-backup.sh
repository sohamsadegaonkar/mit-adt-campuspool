#!/usr/bin/env bash
# OPERATOR-ONLY. Never invoke from GitHub Actions or Render. No live DB changes.
set -euo pipefail
set +x
umask 077
mode="${1:-}"
if [[ "$#" != 1 || ( "$mode" != '--preflight' && "$mode" != '--execute' ) ]]; then
  echo 'Usage: bash scripts/staging-secure-backup.sh --preflight|--execute' >&2
  exit 2
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node scripts/staging-backup-guard.js  # fail before invoking any external database tool
for bin in node supabase docker psql age tar sha256sum mktemp; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[STAGING BACKUP] Missing required command: $bin" >&2; exit 2; }
done
# A PostgreSQL 17 client is required for the staging PG17 recovery drill.
if ! psql --version 2>/dev/null | grep -Eq 'PostgreSQL\) 17\.'; then
  echo '[STAGING BACKUP] PostgreSQL 17 psql is required.' >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1 || ! supabase db dump --help >/dev/null 2>&1; then
  echo '[STAGING BACKUP] Supabase CLI/Docker unavailable or CLI flags unverified.' >&2
  exit 2
fi
if [[ "$mode" == '--preflight' ]]; then
  echo '[STAGING BACKUP] Local tools and target guards passed. NO backup created, remote proof absent.'
  exit 0
fi
work="$(mktemp -d "$STAGING_ENCRYPTED_WORKDIR/campuspool-stage.XXXXXXXX")"
chmod 700 "$work"
partial=''
cleanup(){
  [[ -z "${partial:-}" ]] || rm -f -- "$partial"
  [[ -z "${work:-}" ]] || rm -rf -- "$work"
}
trap cleanup EXIT
if ! supabase db dump --db-url "$STAGING_DB_URL" --role-only -f "$work/roles.sql" >/dev/null 2>&1; then
  echo '[STAGING BACKUP] Roles export failed (details suppressed).' >&2; exit 3
fi
if ! supabase db dump --db-url "$STAGING_DB_URL" -f "$work/schema.sql" >/dev/null 2>&1; then
  echo '[STAGING BACKUP] Schema export failed (details suppressed).' >&2; exit 3
fi
if ! supabase db dump --db-url "$STAGING_DB_URL" --use-copy --data-only -f "$work/data.sql" >/dev/null 2>&1; then
  echo '[STAGING BACKUP] Data export failed (details suppressed).' >&2; exit 3
fi
for part in roles schema data; do
  [[ -s "$work/$part.sql" ]] || { echo '[STAGING BACKUP] Incomplete SQL export.' >&2; exit 3; }
done
# Store only age-encrypted bytes on the explicitly operator-approved remote mount.
name="campuspool-stage-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM.tar.age"
dest="$OFFSITE_DIR/$name"
partial="$dest.part"
if [[ -e "$dest" || -e "$partial" || -e "$dest.sha256" ]]; then
  echo '[STAGING BACKUP] Archive name already exists; refusing overwrite.' >&2; exit 3
fi
if ! tar -C "$work" -cf - roles.sql schema.sql data.sql | age --encrypt --recipient "$AGE_RECIPIENT" --output "$partial"; then
  echo '[STAGING BACKUP] Encryption/upload failed.' >&2; exit 3
fi
[[ -s "$partial" ]] || { echo '[STAGING BACKUP] Encrypted archive empty.' >&2; exit 3; }
mv -- "$partial" "$dest"
partial=''
digest="$(sha256sum "$dest" | cut -d' ' -f1)"
printf '%s  %s\n' "$digest" "$name" > "$dest.sha256"
( cd "$OFFSITE_DIR" && sha256sum --check --status "$name.sha256" ) || {
  echo '[STAGING BACKUP] Ciphertext checksum failed.' >&2; exit 3;
}
echo '[STAGING BACKUP] Encrypted archive written and mounted copy checksum verified.'
echo '[STAGING BACKUP] BLOCKED pending separately downloaded remote copy verification, independent restore and comparison.'
echo '[STAGING BACKUP] No deployment or migration was attempted.'
