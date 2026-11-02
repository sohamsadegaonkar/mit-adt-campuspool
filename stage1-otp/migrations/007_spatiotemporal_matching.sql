-- Phase 3: opt-in demand-first spatial matching.
-- No changes to existing bookings or student identities. Server-only tables.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- Existing rides without verified coordinates stay valid; they simply do not
-- appear in geometric candidate matching until a driver adds a route point.
CREATE TABLE IF NOT EXISTS public.campus_ride_geo (
  ride_id TEXT PRIMARY KEY REFERENCES public.campus_rides(id) ON DELETE CASCADE,
  pickup_geo extensions.geography(Point,4326) NOT NULL,
  dropoff_geo extensions.geography(Point,4326) NOT NULL,
  departure_at TIMESTAMPTZ NOT NULL,
  pickup_cell TEXT NOT NULL CHECK (length(pickup_cell) BETWEEN 3 AND 24),
  dropoff_cell TEXT NOT NULL CHECK (length(dropoff_cell) BETWEEN 3 AND 24),
  departure_bucket BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_ride_geo_pickup_gist_idx
  ON public.campus_ride_geo USING GIST (pickup_geo);
CREATE INDEX IF NOT EXISTS campus_ride_geo_dropoff_gist_idx
  ON public.campus_ride_geo USING GIST (dropoff_geo);
CREATE INDEX IF NOT EXISTS campus_ride_geo_departure_idx
  ON public.campus_ride_geo (departure_at);
CREATE INDEX IF NOT EXISTS campus_ride_geo_grid_time_idx
  ON public.campus_ride_geo (pickup_cell,departure_bucket);

-- A single active intent per verified student limits spam and ambiguity in
-- this first iteration. Expired intents can be replaced transactionally.
CREATE TABLE IF NOT EXISTS public.campus_trip_intents (
  id UUID PRIMARY KEY,
  student_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE CASCADE,
  pickup_geo extensions.geography(Point,4326) NOT NULL,
  dropoff_geo extensions.geography(Point,4326) NOT NULL,
  pickup_cell TEXT NOT NULL CHECK (length(pickup_cell) BETWEEN 3 AND 24),
  dropoff_cell TEXT NOT NULL CHECK (length(dropoff_cell) BETWEEN 3 AND 24),
  first_bucket BIGINT NOT NULL,
  earliest_departure TIMESTAMPTZ NOT NULL,
  latest_departure TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campus_intent_window CHECK (
    latest_departure > earliest_departure
    AND latest_departure <= earliest_departure + INTERVAL '3 hours'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS campus_trip_intents_one_active_idx
  ON public.campus_trip_intents(student_user_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS campus_trip_intents_student_idx
  ON public.campus_trip_intents(student_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS campus_trip_intents_pickup_gist_idx
  ON public.campus_trip_intents USING GIST(pickup_geo);
CREATE INDEX IF NOT EXISTS campus_trip_intents_dropoff_gist_idx
  ON public.campus_trip_intents USING GIST(dropoff_geo);
CREATE INDEX IF NOT EXISTS campus_trip_intents_grid_time_idx
  ON public.campus_trip_intents(pickup_cell,first_bucket) WHERE status='active';
CREATE INDEX IF NOT EXISTS campus_trip_intents_time_idx
  ON public.campus_trip_intents(earliest_departure,latest_departure)
  WHERE status='active';

-- Separate coarse cell indices accelerate grouped analytics later. Exact
-- coordinates are never exposed to other users by the matching API.
ALTER TABLE public.campus_ride_geo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_trip_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campus_ride_geo,public.campus_trip_intents FROM PUBLIC;
DO $restrict$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.campus_ride_geo, public.campus_trip_intents FROM %I',r);
    END IF;
  END LOOP;
END $restrict$;

GRANT USAGE ON SCHEMA extensions TO campuspool_staging_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE
  public.campus_ride_geo,public.campus_trip_intents TO campuspool_staging_app;
DO $policies$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['campus_ride_geo','campus_trip_intents'] LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename=t AND policyname='campuspool_backend_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY campuspool_backend_access ON public.%I FOR ALL TO campuspool_staging_app USING (true) WITH CHECK (true)',t
      );
    END IF;
  END LOOP;
END $policies$;
COMMIT;
