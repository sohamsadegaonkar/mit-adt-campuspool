-- Supabase staging protection. All app tables are server-only; no public REST grants.
-- Backend connects using a private PostgreSQL connection string, never an anon key.
BEGIN;

ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_identity_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.otp_challenges, public.otp_rate_buckets,
  public.campus_users, public.campus_sessions, public.campus_identity_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.campus_identity_audit_id_seq FROM PUBLIC;

-- Supabase defines anon and authenticated; vanilla PostgreSQL CI doesn't.
DO $supabase_restrict$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.otp_challenges, public.otp_rate_buckets, public.campus_users, public.campus_sessions, public.campus_identity_audit FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON SEQUENCE public.campus_identity_audit_id_seq FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$supabase_restrict$;

COMMIT;
