CREATE SCHEMA sophie_control;
REVOKE ALL ON SCHEMA sophie_control FROM PUBLIC;

-- Local transaction history, not an independent watermark. Sequence allocation is
-- not commit order: a replica must preserve transactions, never poll id > max(id).
CREATE TABLE sophie_control.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('members', 'actor_authority', 'case_reservations',
    'case_provisions', 'case_participants', 'case_exclusions', 'definitions', 'case_forms',
    'capability_policies', 'case_policies', 'dashboard_auth_policies')),
  operation text NOT NULL CHECK (operation IN ('baseline', 'insert', 'update', 'delete')),
  control_key jsonb NOT NULL CHECK (jsonb_typeof(control_key) = 'array' AND octet_length(control_key::text) <= 1024),
  before_state jsonb CHECK (jsonb_typeof(before_state) = 'object' AND octet_length(before_state::text) <= 4096),
  after_state jsonb CHECK (jsonb_typeof(after_state) = 'object' AND octet_length(after_state::text) <= 4096),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((operation IN ('baseline', 'insert') AND before_state IS NULL AND after_state IS NOT NULL) OR
    (operation = 'update' AND before_state IS NOT NULL AND after_state IS NOT NULL) OR
    (operation = 'delete' AND before_state IS NOT NULL AND after_state IS NULL))
);
REVOKE ALL ON sophie_control.events FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sophie_control FROM PUBLIC;

-- Explicit projections only. No observations, role snapshots, text, forms, notes,
-- progress, credentials, attachments or transcript bodies cross this boundary.
CREATE FUNCTION sophie_control.project(source text, row_data jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE key_data jsonb; facts jsonb;
BEGIN
  CASE source
    WHEN 'members' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'user_id');
      facts := jsonb_build_object('eligibilityEpoch', row_data#>'{state,eligibilityEpoch}',
        'accessEpoch', row_data#>'{state,accessEpoch}', 'presenceEpoch', row_data#>'{state,presenceEpoch}',
        'muteRequested', row_data#>'{state,muteRequested}');
    WHEN 'actor_authority' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'user_id');
      facts := jsonb_build_object('capabilityEpoch', row_data->'capability_epoch',
        'presenceEpoch', row_data->'presence_epoch', 'policyVersion', row_data->'policy_version');
    WHEN 'case_reservations' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'id');
      facts := jsonb_build_object('version', row_data->'version', 'state', row_data->'state',
        'desiredAccess', row_data->'desired_access', 'channelId', row_data->'channel_id');
    WHEN 'case_provisions' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'case_id');
      facts := jsonb_build_object('policyVersion', row_data->'policy_version', 'presenceEpoch', row_data->'presence_epoch',
        'audienceVersion', row_data->'audience_version', 'phase', row_data->'phase', 'channelId', row_data->'channel_id');
    WHEN 'case_participants' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'case_id', row_data->'version');
      facts := jsonb_build_object('userId', row_data->'user_id', 'presenceEpoch', row_data->'presence_epoch', 'status', row_data->'status');
    WHEN 'case_exclusions' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'channel_id');
      facts := jsonb_build_object('parentId', row_data->'parent_id');
    WHEN 'definitions' THEN
      key_data := jsonb_build_array(row_data->'id', row_data->'version');
      facts := jsonb_build_object('status', row_data#>'{definition,status}',
        'definitionSha256', encode(sha256(convert_to((row_data->'definition')::text, 'UTF8')), 'hex'));
    WHEN 'case_forms' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'case_type', row_data->'version');
      facts := jsonb_build_object('status', row_data->'status', 'sha256', row_data->'sha256');
    WHEN 'capability_policies', 'case_policies', 'dashboard_auth_policies' THEN
      key_data := jsonb_build_array(row_data->'guild_id', row_data->'version');
      facts := jsonb_build_object('policySha256', encode(sha256(convert_to((row_data->'policy')::text, 'UTF8')), 'hex'));
    ELSE RAISE EXCEPTION USING MESSAGE = 'RECOVERY_CONTROL_SOURCE_INVALID';
  END CASE;
  RETURN jsonb_build_object('key', key_data, 'facts', facts);
END $$;

CREATE FUNCTION sophie_control.capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE previous jsonb; current_state jsonb;
BEGIN
  IF TG_TABLE_SCHEMA <> 'sophie_core' THEN RAISE EXCEPTION USING MESSAGE = 'RECOVERY_CONTROL_SOURCE_INVALID'; END IF;
  IF TG_OP <> 'INSERT' THEN previous := sophie_control.project(TG_TABLE_NAME, to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN current_state := sophie_control.project(TG_TABLE_NAME, to_jsonb(NEW)); END IF;
  IF TG_OP = 'UPDATE' AND previous = current_state THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND previous->'key' <> current_state->'key' THEN
    RAISE EXCEPTION USING MESSAGE = 'RECOVERY_CONTROL_KEY_IMMUTABLE';
  END IF;
  INSERT INTO sophie_control.events (source, operation, control_key, before_state, after_state)
    VALUES (TG_TABLE_NAME, lower(TG_OP), COALESCE(current_state->'key', previous->'key'), previous->'facts', current_state->'facts');
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION sophie_control.project(text, jsonb), sophie_control.capture() FROM PUBLIC;

DO $$
DECLARE source_name text;
BEGIN
  FOREACH source_name IN ARRAY ARRAY['members', 'actor_authority', 'case_reservations', 'case_provisions',
    'case_participants', 'case_exclusions', 'definitions', 'case_forms', 'capability_policies', 'case_policies', 'dashboard_auth_policies'] LOOP
    -- Installation holds the source lock through the baseline and trigger creation.
    EXECUTE format('LOCK TABLE sophie_core.%I IN SHARE ROW EXCLUSIVE MODE', source_name);
    EXECUTE format('INSERT INTO sophie_control.events (source, operation, control_key, after_state)
      SELECT %L, ''baseline'', p->''key'', p->''facts'' FROM
        (SELECT sophie_control.project(%L, to_jsonb(t)) AS p FROM sophie_core.%I t) projected', source_name, source_name, source_name);
    EXECUTE format('CREATE TRIGGER recovery_control_change AFTER INSERT OR UPDATE OR DELETE ON sophie_core.%I
      FOR EACH ROW EXECUTE FUNCTION sophie_control.capture()', source_name);
  END LOOP;
END $$;
