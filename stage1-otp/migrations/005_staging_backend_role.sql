-- Dedicated server-only staging login role. Password is never stored in migrations.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='campuspool_staging_app') THEN
    CREATE ROLE campuspool_staging_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO campuspool_staging_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.otp_challenges, public.otp_rate_buckets,
  public.campus_users, public.campus_sessions, public.campus_identity_audit
  TO campuspool_staging_app;
GRANT USAGE, SELECT ON SEQUENCE public.campus_identity_audit_id_seq TO campuspool_staging_app;
DO $$
DECLARE tab_name TEXT;
BEGIN
  FOREACH tab_name IN ARRAY ARRAY[
    'otp_challenges','otp_rate_buckets','campus_users','campus_sessions','campus_identity_audit'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=tab_name AND policyname='campuspool_backend_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY campuspool_backend_access ON public.%I FOR ALL TO campuspool_staging_app USING (true) WITH CHECK (true)',
        tab_name
      );
    END IF;
  END LOOP;
END $$;
COMMIT;
