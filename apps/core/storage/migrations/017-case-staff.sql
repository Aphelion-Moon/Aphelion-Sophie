ALTER TABLE sophie_core.case_reservations
  ADD COLUMN assignee_grant jsonb,
  ADD CONSTRAINT case_assignee_guild CHECK (assignee_grant IS NULL OR assignee_grant->>'guildId' = guild_id);

-- Fixed-length routing tokens permit bounded controls for every supported case ID.
-- Existing collisions must be reviewed, never silently reassigned by migration.
ALTER TABLE sophie_core.case_provisions ADD CONSTRAINT case_provisions_guild_token_key UNIQUE (guild_id, operation_token);

CREATE TABLE sophie_core.case_staff_actions (
  guild_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483646),
  interaction_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('claim', 'unclaim', 'assign')),
  reason text NOT NULL,
  operator_grant jsonb NOT NULL,
  previous_assignee_grant jsonb,
  assignee_grant jsonb,
  requested_at_ms bigint NOT NULL,
  PRIMARY KEY (guild_id, case_id, version),
  UNIQUE (guild_id, interaction_id),
  CHECK ((action = 'claim' AND reason = 'self-claim') OR (action = 'unclaim' AND reason = 'self-release') OR
    (action = 'assign' AND reason IN ('handoff', 'coverage'))),
  CHECK (operator_grant->>'guildId' = guild_id),
  CHECK (assignee_grant IS NULL OR assignee_grant->>'guildId' = guild_id),
  CHECK ((action = 'unclaim') = (assignee_grant IS NULL))
);
REVOKE ALL ON sophie_core.case_staff_actions FROM PUBLIC;
