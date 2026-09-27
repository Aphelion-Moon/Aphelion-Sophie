CREATE TABLE sophie_core.shuttle_alerts (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  guild_id text NOT NULL,
  user_id text NOT NULL,
  session_id text NOT NULL REFERENCES sophie_core.shuttle_cases (session_id),
  kind text NOT NULL CHECK (kind IN ('help', 'delivery')),
  source_id text NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'confirmed', 'obsolete')),
  create_started boolean NOT NULL DEFAULT false,
  channel_id text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  FOREIGN KEY (session_id, guild_id, user_id) REFERENCES sophie_core.sessions (id, guild_id, user_id),
  UNIQUE (guild_id, kind, source_id),
  UNIQUE (guild_id, message_id),
  CHECK (kind <> 'delivery' OR source_id = session_id),
  CHECK (message_id IS NULL OR (channel_id IS NOT NULL AND create_started)),
  CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL)),
  CHECK (state <> 'confirmed' OR message_id IS NOT NULL)
);
ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
  (kind IN ('whitelist.grant', 'whitelist.reconcile', 'member.reconcile', 'case.provision', 'shuttle.render', 'shuttle.alert'));
REVOKE ALL ON sophie_core.shuttle_alerts FROM PUBLIC;
