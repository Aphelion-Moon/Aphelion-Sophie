UPDATE sophie_core.members SET state = jsonb_set(state, '{presenceEpoch}', '0') WHERE NOT state ? 'presenceEpoch';

CREATE TABLE sophie_core.case_policies (
  guild_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  PRIMARY KEY (guild_id, version),
  CHECK (policy->>'guildId' = guild_id AND (policy->>'version')::integer = version)
);
CREATE TABLE sophie_core.case_provisions (
  case_id text PRIMARY KEY REFERENCES sophie_core.case_reservations,
  guild_id text NOT NULL,
  policy_version integer NOT NULL,
  operation_token text NOT NULL UNIQUE CHECK (operation_token ~ '^[a-f0-9]{48}$'),
  presence_epoch bigint NOT NULL CHECK (presence_epoch >= 0),
  create_started boolean NOT NULL DEFAULT false,
  channel_id text,
  phase text NOT NULL DEFAULT 'reserved' CHECK (phase IN ('reserved', 'creating', 'sealed', 'opening', 'confirmed', 'quarantining', 'quarantined')),
  FOREIGN KEY (guild_id, policy_version) REFERENCES sophie_core.case_policies
);
CREATE TABLE sophie_core.case_channels (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations,
  first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, channel_id)
);
CREATE INDEX case_channels_case ON sophie_core.case_channels (case_id);
REVOKE ALL ON sophie_core.case_policies, sophie_core.case_provisions, sophie_core.case_channels FROM PUBLIC;
