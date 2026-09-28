ALTER TABLE sophie_ai.request_receipts DROP CONSTRAINT request_receipts_state_check;
ALTER TABLE sophie_ai.request_receipts ADD CONSTRAINT request_receipts_state_check
  CHECK (state IN ('gathering','gathered','admitted','sending','delivered','reacted','silent','expired','cancelled','unavailable','uncertain'));
ALTER TABLE sophie_ai.request_receipts
  ADD COLUMN gather_root text,
  ADD COLUMN gather_owner uuid,
  ADD COLUMN gather_scope text CHECK (gather_scope ~ '^[a-f0-9]{64}$'),
  ADD COLUMN gather_until timestamptz,
  ADD COLUMN gather_quiet_until timestamptz,
  ADD COLUMN gather_bytes integer CHECK (gather_bytes BETWEEN 0 AND 4096),
  ADD COLUMN gather_chars integer CHECK (gather_chars BETWEEN 0 AND 4000);
CREATE INDEX ai_gather_member ON sophie_ai.request_receipts(guild_id,user_id) WHERE state='gathering';
