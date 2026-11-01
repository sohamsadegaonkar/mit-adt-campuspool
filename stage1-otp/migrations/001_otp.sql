-- CampusPool Stage 1 OTP storage.
-- Contains no plaintext OTPs, email addresses, phone numbers or raw session tokens.
-- Run using: npm run migrate:otp (OTP_DATABASE_URL required).
BEGIN;

CREATE TABLE IF NOT EXISTS otp_challenges (
    id UUID PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('login', 'signup_email', 'signup_phone')),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
    target_hash CHAR(64) NOT NULL,
    code_hmac CHAR(64) NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'verified', 'locked', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    expires_at TIMESTAMPTZ NOT NULL,
    resend_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    proof_hash CHAR(64),
    proof_expires_at TIMESTAMPTZ,
    proof_consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (purpose, channel, target_hash)
);

CREATE INDEX IF NOT EXISTS otp_challenges_expiry_idx ON otp_challenges(expires_at);
CREATE INDEX IF NOT EXISTS otp_challenges_proof_idx
    ON otp_challenges(purpose, channel, target_hash, proof_hash)
    WHERE state = 'verified';

CREATE TABLE IF NOT EXISTS otp_rate_buckets (
    bucket_key CHAR(64) PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_rate_buckets_expiry_idx ON otp_rate_buckets(expires_at);

COMMIT;
