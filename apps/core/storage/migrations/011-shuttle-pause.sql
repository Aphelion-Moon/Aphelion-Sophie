-- Earlier versions could publish only helpPauses=false. Preserve their behavior explicitly.
UPDATE sophie_core.sessions SET state = state || '{"helpPaused": false}'::jsonb;
UPDATE sophie_core.shuttle_screens SET snapshot = snapshot || '{"helpPaused": false}'::jsonb;
ALTER TABLE sophie_core.sessions ADD CONSTRAINT shuttle_pause_state CHECK
  (state ? 'helpPaused' AND jsonb_typeof(state->'helpPaused') = 'boolean' AND
    (state->>'helpPaused' = 'false' OR state->>'status' = 'active'));
ALTER TABLE sophie_core.shuttle_screens ADD CONSTRAINT shuttle_pause_snapshot CHECK
  (snapshot ? 'helpPaused' AND jsonb_typeof(snapshot->'helpPaused') = 'boolean' AND
    (snapshot->>'helpPaused' = 'false' OR snapshot->>'status' = 'active'));
ALTER TABLE sophie_core.shuttle_help_resolutions ADD COLUMN resumed_version integer
  CHECK (resumed_version IS NULL OR resumed_version > 0);
