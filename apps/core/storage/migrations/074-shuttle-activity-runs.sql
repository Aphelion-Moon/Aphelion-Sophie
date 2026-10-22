-- Shuttle Activity (owner decisions of 21-22 October 2026): a run started in the Activity has no Onboarding channel.
-- It is an ordinary Shuttle session; this marks which sessions the Activity shows and drives.
CREATE TABLE sophie_core.shuttle_activity_runs (
  session_id text PRIMARY KEY,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  started_at_ms bigint NOT NULL CHECK (started_at_ms > 0),
  FOREIGN KEY (session_id, guild_id, user_id) REFERENCES sophie_core.sessions (id, guild_id, user_id)
);
CREATE INDEX shuttle_activity_runs_member ON sophie_core.shuttle_activity_runs (guild_id, user_id, started_at_ms DESC);
REVOKE ALL ON sophie_core.shuttle_activity_runs FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.shuttle_activity_runs
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
