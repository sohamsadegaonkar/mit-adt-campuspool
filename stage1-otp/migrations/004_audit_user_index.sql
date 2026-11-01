-- Add index for audit user-id foreign key lookups.
CREATE INDEX IF NOT EXISTS campus_identity_audit_user_idx ON public.campus_identity_audit(user_id);
