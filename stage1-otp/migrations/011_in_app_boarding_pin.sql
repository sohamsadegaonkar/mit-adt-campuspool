-- 011: opt-in per-booking in-app PIN proof, never GPS or payment proof.
-- Additive, no user data copied; only requires existing private campus_bookings.
BEGIN;
ALTER TABLE public.campus_bookings
 ADD COLUMN IF NOT EXISTS boarded_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS boarding_pin_nonce TEXT,
 ADD COLUMN IF NOT EXISTS boarding_pin_expires_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS boarding_pin_attempts SMALLINT NOT NULL DEFAULT 0;
DO $boarding$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid='public.campus_bookings'::regclass AND conname='campus_booking_boarding_pin_check'
 ) THEN
   ALTER TABLE public.campus_bookings ADD CONSTRAINT campus_booking_boarding_pin_check CHECK (
     boarding_pin_attempts BETWEEN 0 AND 5
     AND (
       (boarding_pin_nonce IS NULL AND boarding_pin_expires_at IS NULL)
       OR (boarding_pin_nonce ~ '^[0-9a-f]{48}$' AND boarding_pin_expires_at IS NOT NULL)
     )
     AND (boarded_at IS NULL OR boarding_pin_nonce IS NULL)
   );
 END IF;
END
$boarding$;
COMMIT;
