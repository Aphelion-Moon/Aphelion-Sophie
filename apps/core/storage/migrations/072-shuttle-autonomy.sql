-- Owner direction, 20 October 2026: Staff take no part in the Shuttle. Parked Shuttle work is rechecked on its own
-- (parked_at, auto_rechecks); uncertain creates carry on once they are old enough (create_started_at).
ALTER TABLE sophie_core.outbox ADD COLUMN parked_at timestamptz;
ALTER TABLE sophie_core.outbox ADD COLUMN auto_rechecks integer NOT NULL DEFAULT 0 CHECK (auto_rechecks >= 0);
UPDATE sophie_core.outbox SET parked_at = clock_timestamp() WHERE status = 'parked';
ALTER TABLE sophie_core.shuttle_screens ADD COLUMN create_started_at timestamptz;
ALTER TABLE sophie_core.case_provisions ADD COLUMN create_started_at timestamptz;

-- Release: help pauses end and open help requests close as resolved by this migration (their rows are kept, without a
-- Staff resolution record). Unsent Staff notices are withdrawn. Current runs that were paused or showed a help notice are drawn again.
UPDATE sophie_core.shuttle_help_requests SET status = 'resolved', revision = 1 WHERE status = 'open';
UPDATE sophie_core.shuttle_alerts SET state = 'obsolete' WHERE state = 'pending' AND NOT create_started;
UPDATE sophie_core.sessions SET state = state || '{"helpPaused": false}'::jsonb WHERE state->>'helpPaused' = 'true';
INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect)
  SELECT guild_id, 'screen.autonomy.' || id, user_id, 'shuttle.render', jsonb_build_object('kind', 'shuttle.render',
    'operationId', 'screen.autonomy.' || id, 'guildId', guild_id, 'userId', user_id, 'screenId', id)
  FROM sophie_core.shuttle_screens WHERE current AND (snapshot->>'helpPaused' = 'true' OR help_requested)
  ON CONFLICT (guild_id, operation_id) DO NOTHING;
UPDATE sophie_core.shuttle_screens SET snapshot = snapshot || '{"helpPaused": false}'::jsonb, help_requested = false
  WHERE snapshot->>'helpPaused' = 'true' OR help_requested;
