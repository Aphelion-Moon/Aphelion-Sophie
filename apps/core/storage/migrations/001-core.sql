CREATE SCHEMA sophie_core;
REVOKE ALL ON SCHEMA sophie_core FROM PUBLIC;

CREATE TABLE sophie_core.members (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  PRIMARY KEY (guild_id, user_id),
  CHECK (state->>'guildId' = guild_id AND state->>'userId' = user_id)
);

CREATE TABLE sophie_core.definitions (
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  PRIMARY KEY (id, version),
  CHECK (definition->>'id' = id AND (definition->>'version')::integer = version)
);

CREATE TABLE sophie_core.sessions (
  id text PRIMARY KEY,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  definition_id text NOT NULL,
  definition_version integer NOT NULL,
  current boolean NOT NULL,
  state jsonb NOT NULL,
  FOREIGN KEY (guild_id, user_id) REFERENCES sophie_core.members,
  FOREIGN KEY (definition_id, definition_version) REFERENCES sophie_core.definitions,
  CHECK (state->>'id' = id AND state->>'guildId' = guild_id AND state->>'userId' = user_id),
  CHECK (state->>'definitionId' = definition_id AND (state->>'definitionVersion')::integer = definition_version),
  CHECK (NOT current OR state->>'status' IN ('active', 'role_pending'))
);
CREATE UNIQUE INDEX sessions_one_current ON sophie_core.sessions (guild_id, user_id) WHERE current;

-- Receipts hold routing metadata and outcome references, never case text or role authority.
CREATE TABLE sophie_core.receipts (
  guild_id text NOT NULL,
  interaction_id text NOT NULL,
  user_id text NOT NULL,
  request jsonb NOT NULL,
  result jsonb,
  PRIMARY KEY (guild_id, interaction_id)
);

CREATE TABLE sophie_core.outbox (
  guild_id text NOT NULL,
  operation_id text NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('whitelist.grant', 'whitelist.reconcile', 'member.reconcile', 'case.provision')),
  effect jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'leased', 'done', 'cancelled', 'parked')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_until timestamptz,
  fence integer NOT NULL DEFAULT 0 CHECK (fence >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  dispatch_started boolean NOT NULL DEFAULT false,
  last_error_code text,
  PRIMARY KEY (guild_id, operation_id),
  CHECK (effect->>'guildId' = guild_id AND effect->>'userId' = user_id AND effect->>'operationId' = operation_id AND effect->>'kind' = kind),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX outbox_due ON sophie_core.outbox (available_at, created_at) WHERE status IN ('ready', 'leased');

-- Lock the guild before a reservation count; it serialises the bounded admission budget.
CREATE TABLE sophie_core.case_budgets (guild_id text PRIMARY KEY);
CREATE TABLE sophie_core.case_reservations (
  id text PRIMARY KEY,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  type text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'open', 'closed', 'failed')),
  created_at_ms bigint NOT NULL,
  channel_id text,
  UNIQUE (guild_id, channel_id)
);
CREATE INDEX case_capacity ON sophie_core.case_reservations (guild_id, user_id, state);

-- Tombstones are permanent even after a case closes or its Discord channel moves/deletes.
CREATE TABLE sophie_core.case_exclusions (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  parent_id text,
  PRIMARY KEY (guild_id, channel_id)
);

REVOKE ALL ON ALL TABLES IN SCHEMA sophie_core FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA sophie_core REVOKE ALL ON TABLES FROM PUBLIC;
