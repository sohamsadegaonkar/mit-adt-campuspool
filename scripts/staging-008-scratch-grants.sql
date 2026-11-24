-- ISOLATED SCRATCH DATABASE ONLY. NEVER APPLY TO STAGING OR PRODUCTION.
-- pg_dump --no-acl / pg_restore --no-acl intentionally omit original grants.
-- Migration 005 restores five initial app-table grants; the four tables from
-- migrations 006/007 need exact backend CRUD and extension usage reconstructed.
-- This file assumes migration 005 has already run on the isolated restore DB.
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.campus_rides, public.campus_bookings,
  public.campus_ride_geo, public.campus_trip_intents
  TO campuspool_staging_app;
GRANT USAGE ON SCHEMA extensions TO campuspool_staging_app;
COMMIT;
