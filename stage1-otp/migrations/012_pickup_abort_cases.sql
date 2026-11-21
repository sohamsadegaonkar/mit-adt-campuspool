-- 012: booking-specific pickup interruption claims, with no monetary effects.
-- All claims remain allegations; no automated no-show judgment or sanctions.
BEGIN;
CREATE TABLE IF NOT EXISTS public.campus_booking_cases (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id TEXT NOT NULL UNIQUE REFERENCES public.campus_bookings(booking_id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open')),
 opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.campus_booking_case_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id UUID NOT NULL REFERENCES public.campus_booking_cases(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
 actor_role TEXT NOT NULL CHECK (actor_role IN ('driver','passenger')),
 reason TEXT NOT NULL CHECK (reason IN
   ('no_response','could_not_locate','changed_plans','safety_emergency','other')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (case_id,actor_user_id,reason)
);
CREATE INDEX IF NOT EXISTS campus_booking_case_events_case_idx
 ON public.campus_booking_case_events(case_id,created_at);
CREATE INDEX IF NOT EXISTS campus_booking_cases_opened_idx
 ON public.campus_booking_cases(opened_at DESC);
ALTER TABLE public.campus_booking_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_booking_case_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campus_booking_cases,public.campus_booking_case_events FROM PUBLIC;
DO $scope$
DECLARE r TEXT;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.campus_booking_cases,public.campus_booking_case_events FROM %I',r);
  END IF;
 END LOOP;
END
$scope$;
GRANT SELECT,INSERT ON public.campus_booking_cases,public.campus_booking_case_events
 TO campuspool_staging_app;
-- Keep case updates out of the app role until reviewer RBAC and appeal policy are implemented.
DO $policies$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['campus_booking_cases','campus_booking_case_events'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename=t AND policyname='campuspool_backend_case_read') THEN
   EXECUTE format('CREATE POLICY campuspool_backend_case_read ON public.%I FOR SELECT TO campuspool_staging_app USING (true)',t);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename=t AND policyname='campuspool_backend_case_write') THEN
   EXECUTE format('CREATE POLICY campuspool_backend_case_write ON public.%I FOR INSERT TO campuspool_staging_app WITH CHECK (true)',t);
  END IF;
 END LOOP;
END
$policies$;
COMMIT;
