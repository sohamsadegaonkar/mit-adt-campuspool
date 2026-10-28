-- =========================================================================
-- MIT ADT CampusPool Production Database Schema (PostgreSQL + Supabase RLS)
-- Enforces Strict Uniqueness on Student Name, Email, and Mobile Number
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE CHECK (email ~* '^[A-Za-z0-9._%+-]+@((students\.)?mituniversity\.edu\.in|mituniversity\.ac\.in|mitpune\.edu\.in|mitaoe\.ac\.in)$'),
    department TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE CHECK (phone ~* '^(\+91\s?)?[6-9][0-9]{9}$'),
    is_driver BOOLEAN DEFAULT FALSE,
    upi_vpa TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_student_full_name UNIQUE (full_name)
);

-- Unique index to prevent duplicate student names regardless of casing/spacing
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_name_lower_trim ON public.profiles(LOWER(TRIM(full_name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_lower_trim ON public.profiles(LOWER(TRIM(email)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_clean ON public.profiles(phone);

CREATE TABLE IF NOT EXISTS public.rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_name TEXT NOT NULL,
    driver_email TEXT NOT NULL REFERENCES public.profiles(email) ON UPDATE CASCADE,
    driver_phone TEXT NOT NULL,
    vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('Bike', 'Car')),
    vehicle_model TEXT NOT NULL,
    pickup_gate TEXT NOT NULL,
    destination TEXT NOT NULL,
    departure_time TEXT NOT NULL,
    seats_total INTEGER NOT NULL CHECK (seats_total BETWEEN 1 AND 4),
    seats_left INTEGER NOT NULL CHECK (seats_left >= 0 AND seats_left <= seats_total),
    uber_benchmark NUMERIC(6,2) NOT NULL CHECK (uber_benchmark >= 50),
    student_fare NUMERIC(6,2) NOT NULL,
    driver_payout NUMERIC(6,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT bike_seats_constraint CHECK (vehicle_type != 'Bike' OR seats_total = 1)
);

CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
    passenger_name TEXT NOT NULL,
    passenger_email TEXT NOT NULL REFERENCES public.profiles(email) ON UPDATE CASCADE,
    passenger_phone TEXT NOT NULL,
    driver_email TEXT NOT NULL,
    fare_paid NUMERIC(6,2) NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT no_duplicate_active_booking UNIQUE (ride_id, passenger_email)
);

CREATE TABLE IF NOT EXISTS public.otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('EMAIL', 'PHONE')),
    hashed_otp TEXT NOT NULL,
    attempts_left INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    verification_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row-Level Security (RLS) Configuration
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated students can view profiles"
ON public.profiles FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Users can create and edit own profile"
ON public.profiles FOR ALL
USING (auth.uid() = id);

CREATE POLICY "Allow authenticated students to view rides"
ON public.rides FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow verified drivers to create rides"
ON public.rides FOR INSERT
WITH CHECK (auth.role() = 'authenticated' AND auth.email() = driver_email);

CREATE POLICY "Allow drivers to update their own rides"
ON public.rides FOR UPDATE
USING (auth.email() = driver_email);

CREATE POLICY "Allow passenger and driver to view their bookings"
ON public.bookings FOR SELECT
USING (auth.email() = passenger_email OR auth.email() = driver_email);

CREATE POLICY "Allow passengers to create own bookings"
ON public.bookings FOR INSERT
WITH CHECK (auth.email() = passenger_email);
