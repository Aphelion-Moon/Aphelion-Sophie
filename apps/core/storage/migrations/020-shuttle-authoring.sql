CREATE TABLE sophie_core.shuttle_draft_revisions (
  guild_id text NOT NULL,
  definition_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, definition_id, revision),
  CHECK (operator_grant->>'guildId' = guild_id)
);
CREATE TABLE sophie_core.shuttle_editor_actions (
  guild_id text NOT NULL,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  definition_id text NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (action IN ('save', 'publish', 'withdraw')),
  before_revision integer NOT NULL CHECK (before_revision >= 0),
  after_revision integer NOT NULL CHECK (after_revision >= before_revision),
  publication_version integer CHECK (publication_version > 0),
  operator_grant jsonb NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, request_id),
  CHECK (operator_grant->>'guildId' = guild_id)
);
CREATE INDEX shuttle_editor_history ON sophie_core.shuttle_editor_actions (guild_id, definition_id, created_at DESC);
CREATE INDEX shuttle_publication_impact ON sophie_core.sessions (guild_id, definition_id, definition_version)
  WHERE current OR state->>'status' = 'complete';
REVOKE ALL ON sophie_core.shuttle_draft_revisions, sophie_core.shuttle_editor_actions FROM PUBLIC;
