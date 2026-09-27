-- Case content remains in the core schema, separate from the metadata Gateway journal.
ALTER TABLE sophie_core.gateway_lifecycle
  ADD COLUMN capture_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN capture_observed_at_ms bigint CHECK (capture_observed_at_ms >= 0);

CREATE TABLE sophie_core.case_capture_channels (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations,
  root_channel_id text NOT NULL,
  parent_id text,
  registered_at_ms bigint NOT NULL CHECK (registered_at_ms >= 0),
  deleted_at_ms bigint CHECK (deleted_at_ms >= 0),
  PRIMARY KEY (guild_id, channel_id)
);
CREATE INDEX case_capture_channels_case ON sophie_core.case_capture_channels (case_id, channel_id);

CREATE TABLE sophie_core.case_message_observations (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  continuity_epoch bigint NOT NULL CHECK (continuity_epoch >= 0),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  kind text NOT NULL CHECK (kind IN ('create', 'update', 'delete')),
  observed_at_ms bigint NOT NULL CHECK (observed_at_ms >= 0),
  patch jsonb NOT NULL CHECK (jsonb_typeof(patch) = 'object'),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array'),
  PRIMARY KEY (guild_id, continuity_epoch, sequence, message_id),
  FOREIGN KEY (guild_id, channel_id) REFERENCES sophie_core.case_capture_channels,
  CHECK (octet_length(patch::text) <= 262144 AND jsonb_array_length(issues) <= 32),
  CHECK (kind <> 'delete' OR patch = '{}'::jsonb)
);
CREATE INDEX case_message_observations_channel ON sophie_core.case_message_observations
  (guild_id, channel_id, continuity_epoch, sequence, message_id);

CREATE TABLE sophie_core.case_capture_gaps (
  guild_id text NOT NULL,
  token text NOT NULL CHECK (token ~ '^[a-f0-9]{48}$'),
  channel_id text,
  scope_key text NOT NULL,
  started_at_ms bigint CHECK (started_at_ms >= 0),
  closed_at_ms bigint CHECK (closed_at_ms >= 0),
  reasons text[] NOT NULL CHECK (cardinality(reasons) BETWEEN 1 AND 16),
  recovered_by text CHECK (recovered_by IN ('registered', 'resumed', 'identified', 'observed', 'permissions-verified')),
  PRIMARY KEY (guild_id, token),
  FOREIGN KEY (guild_id, channel_id) REFERENCES sophie_core.case_capture_channels,
  CHECK (scope_key = CASE WHEN channel_id IS NULL THEN 'guild' ELSE channel_id END),
  CHECK (closed_at_ms IS NULL OR started_at_ms IS NULL OR closed_at_ms >= started_at_ms),
  CHECK ((closed_at_ms IS NULL) = (recovered_by IS NULL))
);
CREATE UNIQUE INDEX case_capture_gap_open ON sophie_core.case_capture_gaps (guild_id, scope_key) WHERE closed_at_ms IS NULL;
CREATE INDEX case_capture_gaps_channel ON sophie_core.case_capture_gaps (guild_id, channel_id, started_at_ms);

-- Historical channels have no invented message history or complete-coverage claim.
INSERT INTO sophie_core.case_capture_channels (guild_id, channel_id, case_id, root_channel_id, registered_at_ms)
  SELECT guild_id, channel_id, case_id, channel_id, floor(extract(epoch FROM first_observed_at) * 1000)::bigint
  FROM sophie_core.case_channels;
INSERT INTO sophie_core.case_capture_gaps (guild_id, token, channel_id, scope_key, reasons)
  SELECT guild_id, substring(md5(guild_id || ':' || channel_id) || md5(channel_id || ':capture'), 1, 48),
    channel_id, channel_id, ARRAY['before-capture', 'capture-not-verified'] FROM sophie_core.case_capture_channels;
REVOKE ALL ON sophie_core.case_capture_channels, sophie_core.case_message_observations, sophie_core.case_capture_gaps FROM PUBLIC;
