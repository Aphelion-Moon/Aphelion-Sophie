CREATE TABLE sophie_core.shuttle_publications (
  definition_id text NOT NULL,
  definition_version integer NOT NULL,
  publication jsonb NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (definition_id, definition_version),
  FOREIGN KEY (definition_id, definition_version) REFERENCES sophie_core.definitions (id, version),
  CHECK (publication->>'id' = definition_id AND (publication->>'version')::integer = definition_version)
);

CREATE TABLE sophie_core.shuttle_screens (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  session_id text NOT NULL REFERENCES sophie_core.shuttle_cases (session_id),
  guild_id text NOT NULL,
  user_id text NOT NULL,
  snapshot jsonb NOT NULL,
  access_epoch bigint NOT NULL CHECK (access_epoch >= 0),
  help_requested boolean NOT NULL,
  current boolean NOT NULL DEFAULT true,
  create_started boolean NOT NULL DEFAULT false,
  channel_id text,
  message_id text,
  ready boolean NOT NULL DEFAULT false,
  FOREIGN KEY (session_id, guild_id, user_id) REFERENCES sophie_core.sessions (id, guild_id, user_id),
  UNIQUE (guild_id, message_id),
  CHECK (snapshot->>'id' = session_id AND snapshot->>'guildId' = guild_id AND snapshot->>'userId' = user_id),
  CHECK (NOT ready OR message_id IS NOT NULL),
  CHECK (message_id IS NULL OR (channel_id IS NOT NULL AND create_started))
);
CREATE UNIQUE INDEX shuttle_one_current_screen ON sophie_core.shuttle_screens (guild_id, user_id) WHERE current;

CREATE TABLE sophie_core.shuttle_help_requests (
  guild_id text NOT NULL,
  interaction_id text NOT NULL,
  session_id text NOT NULL REFERENCES sophie_core.shuttle_cases (session_id),
  user_id text NOT NULL,
  session_version integer NOT NULL CHECK (session_version >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, interaction_id),
  FOREIGN KEY (session_id, guild_id, user_id) REFERENCES sophie_core.sessions (id, guild_id, user_id)
);

ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
  (kind IN ('whitelist.grant', 'whitelist.reconcile', 'member.reconcile', 'case.provision', 'shuttle.render'));
REVOKE ALL ON sophie_core.shuttle_publications, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests FROM PUBLIC;
