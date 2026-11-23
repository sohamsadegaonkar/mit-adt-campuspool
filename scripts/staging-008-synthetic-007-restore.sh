#!/usr/bin/env bash
# Synthetic 007 schema -> encrypted PGDMP -> separate scratch 007 restore.
# Only CI disposable PostGIS; no staging, Azure, Render, GHCR or student records.
set -euo pipefail
set +x
umask 077
test "${GITHUB_ACTIONS:-}" = "true"
test "${CAMPUSPOOL_SYNTHETIC_008_ONLY:-}" = "YES"
test -z "${STAGING_BACKUP_DATABASE_URL:-}"
test -z "${STAGING_008_AGE_IDENTITY:-}"
test -z "${OTP_DATABASE_URL:-}"
CID="$(docker ps -q --filter ancestor=postgis/postgis:17-3.5@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6 | head -n 1)"
[[ "$CID" =~ ^[a-f0-9]{12,64}$ ]]
version="$(docker exec "$CID" psql -U postgres -d scratch_bootstrap -qAt -c 'SHOW server_version_num')"
[[ "$version" =~ ^17[0-9]{4}$ ]]
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
age-keygen -o "$TMP/age-identity" >/dev/null 2>&1
RECIPIENT="$(age-keygen -y "$TMP/age-identity")"
[[ "$RECIPIENT" =~ ^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$ ]]
docker exec "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c 'CREATE DATABASE synthetic_pre007 TEMPLATE template0'
docker exec -i "$CID" psql -U postgres -d synthetic_pre007 -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(
  version text PRIMARY KEY, name text NOT NULL
);
SQL
for migration in \
  001_otp \
  002_users_sessions \
  003_supabase_private_tables \
  004_audit_user_index \
  005_staging_backend_role \
  006_durable_rides_bookings \
  007_spatiotemporal_matching
do
  docker exec -i "$CID" psql -U postgres -d synthetic_pre007 -v ON_ERROR_STOP=1 -q \
    < "stage1-otp/migrations/${migration}.sql"
done
docker exec -i "$CID" psql -U postgres -d synthetic_pre007 -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES
('001','campuspool_001_otp'),
('002','campuspool_002_users_sessions'),
('003','campuspool_003_supabase_private_tables'),
('004','campuspool_004_audit_user_index'),
('005','campuspool_005_staging_backend_role'),
('006','campuspool_006_durable_rides_bookings'),
('007','campuspool_007_spatiotemporal_matching');
SQL
docker exec "$CID" pg_dump -U postgres -d synthetic_pre007 \
  --format=custom --no-owner --no-acl \
  --schema=public --schema=supabase_migrations |
  age --encrypt --recipient "$RECIPIENT" --output "$TMP/pre007.pgcustom.age"
test -s "$TMP/pre007.pgcustom.age"
head -c 21 "$TMP/pre007.pgcustom.age" | grep -qF 'age-encryption.org/v1'
sha256sum "$TMP/pre007.pgcustom.age" | awk '{print $1}' >"$TMP/pre007.sha256"
test "$(sha256sum "$TMP/pre007.pgcustom.age" | awk '{print $1}')" = "$(cat "$TMP/pre007.sha256")"
docker exec "$CID" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c 'CREATE DATABASE synthetic_restored_007 TEMPLATE template0'
docker exec -i "$CID" psql -U postgres -d synthetic_restored_007 -v ON_ERROR_STOP=1 -q <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SQL
age --decrypt --identity "$TMP/age-identity" "$TMP/pre007.pgcustom.age" |
  docker exec -i "$CID" pg_restore -U postgres -d synthetic_restored_007 \
    --exit-on-error --no-owner --no-acl
docker exec -i "$CID" psql -U postgres -d synthetic_restored_007 -v ON_ERROR_STOP=1 -q \
  < stage1-otp/migrations/005_staging_backend_role.sql
docker exec -i "$CID" psql -U postgres -d synthetic_restored_007 -v ON_ERROR_STOP=1 -q \
  < scripts/staging-008-scratch-grants.sql
docker exec -i "$CID" psql -U postgres -d synthetic_restored_007 -v ON_ERROR_STOP=1 -qAt \
  < scripts/staging-008-scratch-assertions.sql >"$TMP/assertions"
test "$(grep -c '^t$' "$TMP/assertions")" -eq 8
test "$(wc -l <"$TMP/assertions")" -eq 8
echo "SYNTHETIC_ACTUAL_007_SCOPED_AGE_COLD_RESTORE_WITH_RLS_GRANTS=PASS"
echo "REAL_STAGING_BACKUP_CREATED=NO"
echo "OFFSITE_INDEPENDENT_RESTORE_VERIFIED=NO"
echo "STAGING_008_MIGRATION_AUTHORIZED=NO"
