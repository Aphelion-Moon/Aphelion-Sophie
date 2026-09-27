ALTER TABLE sophie_core.shuttle_help_requests
  ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  ADD COLUMN revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT shuttle_help_revision CHECK ((status = 'open' AND revision = 0) OR (status = 'resolved' AND revision = 1)),
  ADD CONSTRAINT shuttle_help_request_id CHECK (interaction_id ~ '^[1-9][0-9]{0,19}$');

-- Existing duplicate requests need an explicit migration decision, never silent deletion.
CREATE UNIQUE INDEX shuttle_help_one_open ON sophie_core.shuttle_help_requests (session_id) WHERE status = 'open';
CREATE INDEX shuttle_help_queue ON sophie_core.shuttle_help_requests (guild_id, (interaction_id::numeric)) WHERE status = 'open';

CREATE TABLE sophie_core.shuttle_help_resolutions (
  guild_id text NOT NULL,
  interaction_id text NOT NULL,
  request_id text NOT NULL,
  revision integer NOT NULL CHECK (revision = 1),
  operator_grant jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, interaction_id),
  UNIQUE (guild_id, request_id),
  FOREIGN KEY (guild_id, request_id) REFERENCES sophie_core.shuttle_help_requests (guild_id, interaction_id),
  CHECK (operator_grant->>'guildId' = guild_id)
);
REVOKE ALL ON sophie_core.shuttle_help_resolutions FROM PUBLIC;
