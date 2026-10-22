-- Shuttle Activity layout (owner decision of 22 October 2026): the scene each stop uses, moment overrides per section and
-- the curated arrival list, kept as numbered versions with who published them. Bounded JSON, validated by
-- modules/onboarding/activity-layout.js. It changes what the Activity draws and links; never a run or a permission.
CREATE TABLE sophie_core.activity_layouts (
  guild_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, version),
  UNIQUE (guild_id, request_id),
  CHECK (operator_grant->>'guildId' = guild_id)
);
REVOKE ALL ON sophie_core.activity_layouts FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.activity_layouts
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
