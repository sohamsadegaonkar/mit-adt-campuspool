-- Stage 1 identity extension. Applies after 001_otp.sql.
-- Run only on a NEW, isolated staging database.
BEGIN;
CREATE TABLE IF NOT EXISTS campus_users (
 id UUID PRIMARY KEY,
 name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
 email TEXT NOT NULL,
 phone TEXT NOT NULL,
 dept TEXT NOT NULL,
 is_verified BOOLEAN NOT NULL DEFAULT TRUE,
 verified_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT campus_users_email_unique UNIQUE (email),
 CONSTRAINT campus_users_phone_unique UNIQUE (phone),
 CONSTRAINT campus_users_normalized_email CHECK (email = lower(trim(email))),
 CONSTRAINT campus_users_phone_format CHECK (phone ~ '^[6-9][0-9]{9}$')
);
CREATE INDEX IF NOT EXISTS campus_users_created_idx ON campus_users(created_at DESC);
CREATE TABLE IF NOT EXISTS campus_sessions (
 session_hash CHAR(64) PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES campus_users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS campus_sessions_user_idx ON campus_sessions(user_id);
CREATE INDEX IF NOT EXISTS campus_sessions_expiry_idx ON campus_sessions(expires_at);
CREATE TABLE IF NOT EXISTS campus_identity_audit (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id UUID REFERENCES campus_users(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL CHECK (event_type IN ('registered','login','logout')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campus_identity_audit_created_idx ON campus_identity_audit(created_at DESC);
COMMIT;
