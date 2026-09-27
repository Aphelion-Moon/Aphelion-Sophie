ALTER TABLE sophie_core.case_provisions ADD COLUMN audience_version integer NOT NULL DEFAULT 0 CHECK (audience_version >= 0);
-- Every invitation is retained, including removed or revoked invitations. Rejoining
-- never updates an old binding; a new explicit action creates a new record.
CREATE TABLE sophie_core.case_participants (
  guild_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations(id),
  version integer NOT NULL CHECK (version > 0),
  user_id text NOT NULL,
  presence_epoch bigint NOT NULL CHECK (presence_epoch > 0),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed', 'revoked')),
  settled_reason text CHECK (settled_reason IN ('membership-revoked', 'authority-revoked', 'staff-removed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  settled_at timestamptz,
  PRIMARY KEY (guild_id, case_id, version),
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'guildId' = guild_id)
);
CREATE UNIQUE INDEX case_participant_current ON sophie_core.case_participants (guild_id, case_id, user_id) WHERE status IN ('pending', 'active');
CREATE INDEX case_participant_member ON sophie_core.case_participants (guild_id, user_id) WHERE status IN ('pending', 'active');
CREATE TABLE sophie_core.case_participant_actions (
  guild_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations(id),
  version integer NOT NULL CHECK (version > 0),
  interaction_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('add', 'remove')),
  user_id text NOT NULL,
  invitation_version integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('requested-help', 'case-context', 'no-longer-needed', 'added-in-error')),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  PRIMARY KEY (guild_id, case_id, version),
  UNIQUE (guild_id, interaction_id),
  FOREIGN KEY (guild_id, case_id, invitation_version) REFERENCES sophie_core.case_participants,
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'guildId' = guild_id)
);
REVOKE ALL ON sophie_core.case_participants, sophie_core.case_participant_actions FROM PUBLIC;
