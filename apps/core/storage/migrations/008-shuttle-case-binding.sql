-- Retained metadata connects each deterministic run to its private case.
-- A currently eligible repeat may reuse a still-open case; old runs remain separate.
ALTER TABLE sophie_core.sessions ADD CONSTRAINT sessions_owner_binding UNIQUE (id, guild_id, user_id);
ALTER TABLE sophie_core.case_reservations ADD CONSTRAINT cases_owner_binding UNIQUE (id, guild_id, user_id);
CREATE TABLE sophie_core.shuttle_cases (
  session_id text PRIMARY KEY,
  case_id text NOT NULL,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  FOREIGN KEY (session_id, guild_id, user_id) REFERENCES sophie_core.sessions (id, guild_id, user_id),
  FOREIGN KEY (case_id, guild_id, user_id) REFERENCES sophie_core.case_reservations (id, guild_id, user_id)
);
CREATE INDEX shuttle_case_history ON sophie_core.shuttle_cases (case_id);
REVOKE ALL ON sophie_core.shuttle_cases FROM PUBLIC;
