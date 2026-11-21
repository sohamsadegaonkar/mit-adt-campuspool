-- 013: optional, structured participant responses to an existing pickup case.
-- Neither participant may resolve a case, change money or penalize the other.
-- A response is a non-adjudicated self-report; avoid personal free-text.
BEGIN;
CREATE TABLE IF NOT EXISTS public.campus_booking_case_responses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id UUID NOT NULL REFERENCES public.campus_booking_cases(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
 actor_role TEXT NOT NULL CHECK (actor_role IN ('driver','passenger')),
 response_code TEXT NOT NULL CHECK (response_code IN
   ('present_at_pickup','could_not_find_partner','attempted_contact',
    'other_party_not_present','safety_concern','other')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (case_id,actor_user_id)
);
CREATE INDEX IF NOT EXISTS campus_case_responses_created_idx
  ON public.campus_booking_case_responses(case_id,created_at,id);
ALTER TABLE public.campus_booking_case_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campus_booking_case_responses FROM PUBLIC;
DO $scope$
DECLARE r TEXT;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.campus_booking_case_responses FROM %I',r);
  END IF;
 END LOOP;
END
$scope$;
-- The application role does not get direct UPDATE/DELETE. The backend alone
-- enforces ride/booking participant ownership, counterparty claim and CSRF.
GRANT SELECT,INSERT ON public.campus_booking_case_responses TO campuspool_staging_app;
DO $policies$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_policies
   WHERE schemaname='public' AND tablename='campus_booking_case_responses'
     AND policyname='campuspool_backend_response_read'
 ) THEN
   CREATE POLICY campuspool_backend_response_read
     ON public.campus_booking_case_responses
     FOR SELECT TO campuspool_staging_app USING (true);
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_policies
   WHERE schemaname='public' AND tablename='campus_booking_case_responses'
     AND policyname='campuspool_backend_response_write'
 ) THEN
   CREATE POLICY campuspool_backend_response_write
     ON public.campus_booking_case_responses
     FOR INSERT TO campuspool_staging_app WITH CHECK (true);
 END IF;
END
$policies$;
COMMIT;
