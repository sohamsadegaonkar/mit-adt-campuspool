-- SCRATCH-ONLY verification for the isolated restored pre-008 application schemas.
-- Exactly eight boolean results, each must be 't'; not a live-staging query.
SELECT count(*)=7 FROM supabase_migrations.schema_migrations;
SELECT ARRAY(
  SELECT name FROM supabase_migrations.schema_migrations ORDER BY version
)=ARRAY[
  'campuspool_001_otp','campuspool_002_users_sessions',
  'campuspool_003_supabase_private_tables','campuspool_004_audit_user_index',
  'campuspool_005_staging_backend_role','campuspool_006_durable_rides_bookings',
  'campuspool_007_spatiotemporal_matching'
];
SELECT to_regclass('public.campus_idempotency_keys') IS NULL;
SELECT (
  (SELECT count(*) FROM public.otp_challenges) +
  (SELECT count(*) FROM public.otp_rate_buckets) +
  (SELECT count(*) FROM public.campus_users) +
  (SELECT count(*) FROM public.campus_sessions) +
  (SELECT count(*) FROM public.campus_identity_audit) +
  (SELECT count(*) FROM public.campus_rides) +
  (SELECT count(*) FROM public.campus_bookings) +
  (SELECT count(*) FROM public.campus_ride_geo) +
  (SELECT count(*) FROM public.campus_trip_intents)
)=0;
SELECT count(*)=9 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
    ('otp_challenges','otp_rate_buckets','campus_users','campus_sessions',
     'campus_identity_audit','campus_rides','campus_bookings',
     'campus_ride_geo','campus_trip_intents') AND c.relrowsecurity;
SELECT count(*)=9 FROM pg_policies
  WHERE schemaname='public' AND policyname='campuspool_backend_access'
    AND cmd='ALL' AND qual='true' AND with_check='true'
    AND roles @> ARRAY['campuspool_staging_app']::name[];
SELECT count(*)=9 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
    ('otp_challenges','otp_rate_buckets','campus_users','campus_sessions',
     'campus_identity_audit','campus_rides','campus_bookings',
     'campus_ride_geo','campus_trip_intents')
    AND has_table_privilege('campuspool_staging_app',c.oid,'SELECT')
    AND has_table_privilege('campuspool_staging_app',c.oid,'INSERT')
    AND has_table_privilege('campuspool_staging_app',c.oid,'UPDATE')
    AND has_table_privilege('campuspool_staging_app',c.oid,'DELETE');
SELECT count(*)=9 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
    ('otp_challenges','otp_rate_buckets','campus_users','campus_sessions',
     'campus_identity_audit','campus_rides','campus_bookings',
     'campus_ride_geo','campus_trip_intents')
    AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE');
