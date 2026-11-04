-- Additive migration: atomic idempotency receipts for authenticated domain writes.
-- No live database change: apply to isolated disposable CI/staging first.
BEGIN;
CREATE TABLE IF NOT EXISTS public.campus_idempotency_keys (
  actor_hash CHAR(64) NOT NULL,
  route TEXT NOT NULL CHECK(length(route) BETWEEN 12 AND 120),
  request_key VARCHAR(128) NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT,
  response_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (actor_hash,route,request_key),
  CONSTRAINT campus_idempotency_response_pair CHECK (
    (response_status IS NULL AND response_json IS NULL) OR
    (response_status BETWEEN 200 AND 299 AND response_json IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS campus_idempotency_expiry_idx
  ON public.campus_idempotency_keys(expires_at);
ALTER TABLE public.campus_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campus_idempotency_keys FROM PUBLIC;
DO $revoke$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.campus_idempotency_keys FROM %I',r);
    END IF;
  END LOOP;
END $revoke$;
-- The restricted server-side pool is the only intended application reader.
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.campus_idempotency_keys TO campuspool_staging_app;
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='campus_idempotency_keys'
      AND policyname='campuspool_backend_access'
  ) THEN
    CREATE POLICY campuspool_backend_access ON public.campus_idempotency_keys
      FOR ALL TO campuspool_staging_app USING (true) WITH CHECK (true);
  END IF;
END $policy$;
COMMIT;
