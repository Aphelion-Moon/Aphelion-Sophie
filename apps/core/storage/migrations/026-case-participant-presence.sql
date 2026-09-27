-- Membership revocation is separate from Staff capability changes. Existing operator
-- grants stay byte-compatible; this column does not create any case invitation.
ALTER TABLE sophie_core.actor_authority ADD COLUMN presence_epoch bigint NOT NULL DEFAULT 1 CHECK (presence_epoch > 0);
