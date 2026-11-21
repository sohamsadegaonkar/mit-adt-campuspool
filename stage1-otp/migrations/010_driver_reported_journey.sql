-- 010: driver-reported journey; additive, no automatic travel inference.
BEGIN;
ALTER TABLE public.campus_rides
 ADD COLUMN IF NOT EXISTS journey_stage TEXT NOT NULL DEFAULT 'scheduled',
 ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS pickup_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
DO $milestone$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.campus_rides'::regclass AND conname='campus_ride_journey_stage_check') THEN
   ALTER TABLE public.campus_rides ADD CONSTRAINT campus_ride_journey_stage_check CHECK (
    (journey_stage='scheduled' AND departed_at IS NULL AND pickup_at IS NULL AND arrived_at IS NULL) OR
    (journey_stage='departed' AND departed_at IS NOT NULL AND pickup_at IS NULL AND arrived_at IS NULL) OR
    (journey_stage='pickup_ready' AND departed_at IS NOT NULL AND pickup_at IS NOT NULL AND pickup_at>=departed_at AND arrived_at IS NULL) OR
    (journey_stage='arrived' AND departed_at IS NOT NULL AND pickup_at IS NOT NULL AND arrived_at IS NOT NULL AND departed_at<=pickup_at AND pickup_at<=arrived_at)
   );
 END IF;
END
$milestone$;
COMMIT;
