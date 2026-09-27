CREATE TABLE sophie_core.permission_drafts (
  guild_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, revision)
);
CREATE TABLE sophie_core.permission_candidates (
  guild_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  revision integer NOT NULL,
  status text NOT NULL CHECK (status IN ('published', 'withdrawn')),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  candidate jsonb NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, version),
  FOREIGN KEY (guild_id, revision) REFERENCES sophie_core.permission_drafts(guild_id, revision)
);
CREATE TABLE sophie_core.permission_editor_actions (
  guild_id text NOT NULL,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, request_id)
);
REVOKE ALL ON sophie_core.permission_drafts, sophie_core.permission_candidates, sophie_core.permission_editor_actions FROM PUBLIC;
