ALTER TABLE sophie_core.case_reservations
  DROP CONSTRAINT case_reservations_state_check,
  ADD CONSTRAINT case_reservations_state_check CHECK (state IN ('pending', 'open', 'closing', 'closed', 'failed')),
  ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 2147483646),
  ADD COLUMN desired_access text NOT NULL DEFAULT 'open' CHECK (desired_access IN ('open', 'closed', 'sealed'));

-- Existing closed/failed cases keep their earlier bot-only policy. Migration does
-- not invent a human action, reopen a case or grant historical channel access.
UPDATE sophie_core.case_reservations SET desired_access = 'sealed' WHERE state IN ('closed', 'failed');

CREATE TABLE sophie_core.case_lifecycle_actions (
  guild_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483646),
  interaction_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('close', 'reopen')),
  reason text NOT NULL,
  operator_grant jsonb NOT NULL,
  previous_access text NOT NULL CHECK (previous_access IN ('open', 'closed', 'sealed')),
  requested_at_ms bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'revoked', 'ineligible', 'superseded')),
  settled_at timestamptz,
  PRIMARY KEY (guild_id, case_id, version),
  UNIQUE (guild_id, interaction_id),
  CHECK ((action = 'close' AND reason IN ('resolved', 'duplicate', 'withdrawn')) OR
    (action = 'reopen' AND reason IN ('follow-up', 'closed-in-error'))),
  CHECK (operator_grant->>'guildId' = guild_id),
  CHECK ((status = 'pending') = (settled_at IS NULL))
);
REVOKE ALL ON sophie_core.case_lifecycle_actions FROM PUBLIC;
