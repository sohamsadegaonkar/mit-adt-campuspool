-- Phase 2: durable campus rides and bookings, server-only in Supabase.
-- This is additive. No student/ride data is copied, removed or switched yet.
-- Run after 001-005. On PostgreSQL CI the custom backend role is created by 005.
BEGIN;

CREATE TABLE IF NOT EXISTS public.campus_rides (
  id TEXT PRIMARY KEY CHECK (id ~ '^ride_[0-9a-f-]{36}$'),
  driver_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
  driver_name TEXT NOT NULL,
  driver_email TEXT NOT NULL,
  driver_phone TEXT NOT NULL,
  dept TEXT,
  vehicle TEXT NOT NULL CHECK (vehicle IN ('Car','Bike')),
  vehicle_model TEXT NOT NULL CHECK (length(vehicle_model) BETWEEN 1 AND 80),
  pickup TEXT NOT NULL CHECK (length(pickup) BETWEEN 1 AND 120),
  destination TEXT NOT NULL CHECK (length(destination) BETWEEN 1 AND 120),
  departure_time TEXT NOT NULL CHECK (length(departure_time) BETWEEN 1 AND 120),
  seats_total SMALLINT NOT NULL CHECK (seats_total BETWEEN 1 AND 4),
  seats_left SMALLINT NOT NULL CHECK (seats_left >= 0 AND seats_left <= seats_total),
  uber_benchmark NUMERIC(10,2) NOT NULL CHECK (uber_benchmark >= 0 AND uber_benchmark <= 10000),
  student_fare NUMERIC(10,2) NOT NULL CHECK (student_fare >= 0 AND student_fare <= 10000),
  driver_payout NUMERIC(10,2) NOT NULL CHECK (driver_payout >= 0 AND driver_payout <= 10000),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  upi_id TEXT NOT NULL DEFAULT '' CHECK (length(upi_id) <= 128),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campus_bike_one_seat CHECK (vehicle <> 'Bike' OR seats_total = 1)
);
CREATE INDEX IF NOT EXISTS campus_rides_active_created_idx
  ON public.campus_rides(created_at DESC) WHERE status='active';
CREATE INDEX IF NOT EXISTS campus_rides_driver_idx
  ON public.campus_rides(driver_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.campus_bookings (
  booking_id TEXT PRIMARY KEY CHECK (booking_id ~ '^BKG-[0-9a-f-]{36}$'),
  ride_id TEXT NOT NULL REFERENCES public.campus_rides(id) ON DELETE RESTRICT,
  passenger_user_id UUID NOT NULL REFERENCES public.campus_users(id) ON DELETE RESTRICT,
  passenger_name TEXT NOT NULL,
  passenger_email TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  driver_email TEXT NOT NULL,
  driver_phone TEXT NOT NULL,
  dept TEXT,
  vehicle_model TEXT NOT NULL,
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  student_fare NUMERIC(10,2) NOT NULL CHECK (student_fare >= 0),
  payment_status TEXT NOT NULL DEFAULT 'Pending' CHECK (payment_status = 'Pending'),
  upi_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT campus_booking_cancellation_consistency CHECK
    ((status='active' AND cancelled_at IS NULL) OR (status='cancelled' AND cancelled_at IS NOT NULL))
);
-- The partial unique index prevents duplicate active bookings, even under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS campus_bookings_one_active_seat_per_student_idx
  ON public.campus_bookings(ride_id,passenger_user_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS campus_bookings_passenger_idx
  ON public.campus_bookings(passenger_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campus_bookings_ride_idx
  ON public.campus_bookings(ride_id, created_at DESC);

-- Supabase public schema is exposed by default; protect the tables both ways.
ALTER TABLE public.campus_rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.campus_rides, public.campus_bookings FROM PUBLIC;
DO $restrict_clients$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.campus_rides, public.campus_bookings FROM %I',r);
    END IF;
  END LOOP;
END
$restrict_clients$;

-- Backend is a non-bypassrls role; all authorization still happens in the server.
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.campus_rides,public.campus_bookings
  TO campuspool_staging_app;
DO $backend_policies$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['campus_rides','campus_bookings'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=t AND policyname='campuspool_backend_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY campuspool_backend_access ON public.%I FOR ALL TO campuspool_staging_app USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END
$backend_policies$;

COMMIT;
