-- Candidate migration 015: pending registration (issue #80).
-- Not wired to the migration runner or authorized for live application.
BEGIN;
CREATE TABLE IF NOT EXISTS public.campus_pending_registrations (
  id uuid PRIMARY KEY,
  resume_hash text NOT NULL UNIQUE CHECK (resume_hash ~ '^[0-9a-f]{64}$'),
  email text NOT NULL,
  phone text NOT NULL,
  email_challenge_id uuid,
  phone_challenge_id uuid,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (email_verified_at IS NULL OR email_challenge_id IS NOT NULL),
  CHECK (phone_verified_at IS NULL OR phone_challenge_id IS NOT NULL),
  CHECK (consumed_at IS NULL OR (email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS campus_pending_registration_expiry_idx
  ON public.campus_pending_registrations(expires_at);
ALTER TABLE public.campus_pending_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campus_pending_registrations FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.campus_pending_registrations FROM %I',r);
    END IF;
  END LOOP;
END $roles$;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.campus_pending_registrations TO campuspool_staging_app;
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='campus_pending_registrations' AND policyname='campuspool_backend_access') THEN
    CREATE POLICY campuspool_backend_access ON public.campus_pending_registrations
      FOR ALL TO campuspool_staging_app USING (true) WITH CHECK (true);
  END IF;
END $policy$;
COMMIT;
