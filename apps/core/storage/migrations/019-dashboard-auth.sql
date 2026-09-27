CREATE TABLE sophie_core.dashboard_auth_policies (
  guild_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  PRIMARY KEY (guild_id, version),
  CHECK (policy->>'guildId' = guild_id AND (policy->>'version')::integer = version)
);
CREATE TABLE sophie_core.dashboard_auth_limits (
  guild_id text PRIMARY KEY,
  not_before timestamptz NOT NULL DEFAULT '-infinity'
);

-- Bounded, recyclable authentication slots. These are not case records or audit history.
CREATE TABLE sophie_core.dashboard_login_flows (
  guild_id text NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 64),
  policy_version integer NOT NULL,
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  binding_hash text NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  phase text NOT NULL CHECK (phase IN ('pending', 'consumed', 'complete')),
  PRIMARY KEY (guild_id, slot),
  UNIQUE (guild_id, state_hash),
  FOREIGN KEY (guild_id, policy_version) REFERENCES sophie_core.dashboard_auth_policies
);
CREATE TABLE sophie_core.dashboard_sessions (
  guild_id text NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 256),
  policy_version integer NOT NULL,
  user_id text NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id, slot),
  UNIQUE (guild_id, token_hash),
  FOREIGN KEY (guild_id, policy_version) REFERENCES sophie_core.dashboard_auth_policies
);
REVOKE ALL ON sophie_core.dashboard_auth_policies, sophie_core.dashboard_auth_limits,
  sophie_core.dashboard_login_flows, sophie_core.dashboard_sessions FROM PUBLIC;
