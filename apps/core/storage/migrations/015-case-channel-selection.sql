ALTER TABLE sophie_core.case_provisions
  ADD COLUMN chosen_channel_id text,
  ADD COLUMN chosen_candidates text[],
  ADD CONSTRAINT case_channel_choice CHECK (
    (chosen_channel_id IS NULL AND chosen_candidates IS NULL) OR
    (chosen_channel_id IS NOT NULL AND chosen_channel_id ~ '^[1-9][0-9]{0,19}$'
      AND chosen_candidates IS NOT NULL AND cardinality(chosen_candidates) BETWEEN 2 AND 500
      AND chosen_channel_id = ANY(chosen_candidates))
  );

ALTER TABLE sophie_core.shuttle_delivery_rechecks
  DROP CONSTRAINT shuttle_delivery_rechecks_action_check,
  DROP CONSTRAINT shuttle_recovery_result,
  ADD COLUMN candidate_ids text[],
  ADD CONSTRAINT shuttle_delivery_rechecks_action_check CHECK (action IN ('recheck', 'adopt_message', 'select_channel')),
  ADD CONSTRAINT shuttle_recovery_result CHECK (
    (action = 'recheck' AND result_id IS NULL AND candidate_ids IS NULL) OR
    (action = 'adopt_message' AND result_id IS NOT NULL AND result_id ~ '^[1-9][0-9]{0,19}$' AND candidate_ids IS NULL) OR
    (action = 'select_channel' AND result_id IS NOT NULL AND result_id ~ '^[1-9][0-9]{0,19}$'
      AND candidate_ids IS NOT NULL AND cardinality(candidate_ids) BETWEEN 2 AND 500 AND result_id = ANY(candidate_ids))
  );

-- No choice is inferred from the first observed candidate. Retain every channel and
-- hold already-open ambiguous cases until the worker seals and verifies the set.
UPDATE sophie_core.case_reservations r SET state = 'pending'
WHERE r.state = 'open' AND (SELECT count(*) FROM sophie_core.case_channels c
  WHERE c.guild_id = r.guild_id AND c.case_id = r.id) > 1;

-- A late duplicate may have been retained after all earlier jobs finished. Request
-- inspection, never automatic selection or a new channel create.
INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect)
SELECT r.guild_id, 'case.selection.migration15.' || md5(r.guild_id || ':' || r.id), r.user_id, 'case.provision',
  jsonb_build_object('kind', 'case.provision', 'operationId', 'case.selection.migration15.' || md5(r.guild_id || ':' || r.id),
    'guildId', r.guild_id, 'userId', r.user_id, 'caseId', r.id, 'type', r.type)
FROM sophie_core.case_reservations r JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
WHERE p.create_started AND (SELECT count(*) FROM sophie_core.case_channels c WHERE c.guild_id = r.guild_id AND c.case_id = r.id) > 1
  AND NOT EXISTS (SELECT 1 FROM sophie_core.outbox o WHERE o.guild_id = r.guild_id AND o.kind = 'case.provision'
    AND o.effect->>'caseId' = r.id AND o.status IN ('ready', 'leased', 'parked'));
