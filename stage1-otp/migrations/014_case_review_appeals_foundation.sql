-- 014: reviewer + appeal evidence only. Absolutely no monetary or account effects.
-- Reviewer grants are provisioned externally by a privileged operator; the
-- application role has SELECT ONLY and no self-service grant API.
BEGIN;
CREATE TABLE IF NOT EXISTS public.campus_case_reviewer_grants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
 reviewer_role TEXT NOT NULL CHECK(reviewer_role IN ('case_reviewer','appeal_reviewer')),
 granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 UNIQUE(user_id,reviewer_role),
 CHECK(expires_at>granted_at),
 CHECK(revoked_at IS NULL OR revoked_at>=granted_at)
);
CREATE INDEX IF NOT EXISTS campus_case_reviewer_grants_active_idx
 ON public.campus_case_reviewer_grants(user_id,reviewer_role,expires_at)
 WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.campus_case_review_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id UUID NOT NULL UNIQUE REFERENCES public.campus_booking_cases(id) ON DELETE RESTRICT,
 reviewer_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
 decision_code TEXT NOT NULL CHECK(decision_code IN
 ('no_action','insufficient_evidence','follow_up_required')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.campus_case_appeals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id UUID NOT NULL REFERENCES public.campus_booking_cases(id) ON DELETE RESTRICT,
 actor_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
 reason_code TEXT NOT NULL CHECK(reason_code IN
 ('missing_evidence','mistaken_identity','technical_issue','safety_context','other')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(case_id,actor_user_id)
);
CREATE INDEX IF NOT EXISTS campus_case_appeals_case_idx
 ON public.campus_case_appeals(case_id,created_at,id);
CREATE TABLE IF NOT EXISTS public.campus_case_appeal_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 appeal_id UUID NOT NULL UNIQUE REFERENCES public.campus_case_appeals(id) ON DELETE RESTRICT,
 reviewer_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
 result_code TEXT NOT NULL CHECK(result_code IN
 ('review_record_unchanged','additional_review_required','insufficient_information')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.campus_case_reviewer_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_case_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_case_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_case_appeal_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.campus_case_reviewer_grants,
 public.campus_case_review_decisions,public.campus_case_appeals,
 public.campus_case_appeal_reviews FROM PUBLIC;
DO $roles$
DECLARE role_name TEXT;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON public.campus_case_reviewer_grants,public.campus_case_review_decisions,public.campus_case_appeals,public.campus_case_appeal_reviews FROM %I',role_name);
  END IF;
 END LOOP;
END
$roles$;
-- No HTTP endpoint or app database privilege can create or alter reviewer grants.
GRANT SELECT ON public.campus_case_reviewer_grants TO campuspool_staging_app;
GRANT SELECT,INSERT ON public.campus_case_review_decisions,
 public.campus_case_appeals,public.campus_case_appeal_reviews TO campuspool_staging_app;
DO $policies$
DECLARE table_name TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'campus_case_reviewer_grants','campus_case_review_decisions',
  'campus_case_appeals','campus_case_appeal_reviews'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename=table_name
       AND policyname='campuspool_backend_review_select') THEN
   EXECUTE format('CREATE POLICY campuspool_backend_review_select ON public.%I FOR SELECT TO campuspool_staging_app USING (true)',table_name);
  END IF;
  IF table_name<>'campus_case_reviewer_grants' AND NOT EXISTS(
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name
      AND policyname='campuspool_backend_review_insert') THEN
   EXECUTE format('CREATE POLICY campuspool_backend_review_insert ON public.%I FOR INSERT TO campuspool_staging_app WITH CHECK (true)',table_name);
  END IF;
 END LOOP;
END
$policies$;
COMMIT;
