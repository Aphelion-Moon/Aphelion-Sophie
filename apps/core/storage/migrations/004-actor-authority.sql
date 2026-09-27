CREATE TABLE sophie_core.capability_policies (
  guild_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  PRIMARY KEY (guild_id, version),
  CHECK (policy->>'guildId' = guild_id AND (policy->>'version')::integer = version)
);
CREATE TABLE sophie_core.actor_authority (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  capability_epoch bigint NOT NULL CHECK (capability_epoch > 0),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  PRIMARY KEY (guild_id, user_id),
  FOREIGN KEY (guild_id, policy_version) REFERENCES sophie_core.capability_policies,
  CHECK (observation->>'guildId' = guild_id AND observation->>'userId' = user_id)
);
REVOKE ALL ON sophie_core.actor_authority, sophie_core.capability_policies FROM PUBLIC;
