-- 009: explicit free pilot. Existing rows remain legacy; no obligation is waived.
BEGIN;
ALTER TABLE public.campus_rides ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE public.campus_bookings ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'legacy';
CREATE UNIQUE INDEX IF NOT EXISTS campus_rides_payment_mode_uidx ON public.campus_rides(id,payment_mode);
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.campus_rides'::regclass AND conname='campus_ride_payment_mode_check') THEN
    ALTER TABLE public.campus_rides ADD CONSTRAINT campus_ride_payment_mode_check CHECK (
      payment_mode='legacy' OR (payment_mode='free_pilot' AND student_fare=0 AND driver_payout=0 AND uber_benchmark=0 AND upi_id='')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.campus_bookings'::regclass AND conname='campus_booking_payment_mode_check') THEN
    ALTER TABLE public.campus_bookings ADD CONSTRAINT campus_booking_payment_mode_check CHECK (
      (payment_mode='legacy' AND payment_status='Pending') OR
      (payment_mode='free_pilot' AND payment_status='NoPaymentRequired' AND student_fare=0 AND upi_id='')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.campus_bookings'::regclass AND conname='campus_booking_ride_payment_mode_fk') THEN
    ALTER TABLE public.campus_bookings ADD CONSTRAINT campus_booking_ride_payment_mode_fk
      FOREIGN KEY (ride_id,payment_mode) REFERENCES public.campus_rides(id,payment_mode) ON DELETE RESTRICT;
  END IF;
END
$migration$;
ALTER TABLE public.campus_bookings DROP CONSTRAINT IF EXISTS campus_bookings_payment_status_check;
COMMIT;
