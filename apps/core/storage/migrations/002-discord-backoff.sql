-- One Discord identity per core. Shared across workers and retained across restart.
CREATE TABLE sophie_core.discord_backoff (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  until_at timestamptz NOT NULL DEFAULT '-infinity',
  paused boolean NOT NULL DEFAULT false
);
INSERT INTO sophie_core.discord_backoff (singleton) VALUES (true);
REVOKE ALL ON sophie_core.discord_backoff FROM PUBLIC;

-- Reconciliation reads routing metadata even after histories grow indefinitely.
CREATE INDEX sessions_member_epoch ON sophie_core.sessions
  (guild_id, user_id, ((state->>'eligibilityEpoch')::bigint));
CREATE INDEX outbox_uncertain_member ON sophie_core.outbox (guild_id, user_id, created_at DESC, operation_id DESC)
  WHERE kind = 'whitelist.grant' AND dispatch_started AND status IN ('cancelled', 'parked');
