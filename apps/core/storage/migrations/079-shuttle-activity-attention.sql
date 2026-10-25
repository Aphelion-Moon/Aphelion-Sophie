-- Owner request, 25 October 2026: time to completion and the average time per page in the Whitelist notice, counting only
-- time the member was focused on the Shuttle Activity, and a Staff check of a member's progress. Each Continue or Back
-- reports the focused time on the stop it leaves; core credits at most the time that really passed since the last one.
ALTER TABLE sophie_core.shuttle_activity_runs
  ADD COLUMN attention_at_ms bigint CHECK (attention_at_ms > 0),
  ADD COLUMN completed_at_ms bigint CHECK (completed_at_ms > 0);
CREATE TABLE sophie_core.shuttle_activity_attention (
  session_id text NOT NULL REFERENCES sophie_core.shuttle_activity_runs (session_id),
  stop smallint NOT NULL CHECK (stop BETWEEN 0 AND 63),
  active_ms bigint NOT NULL CHECK (active_ms >= 0),
  pages smallint NOT NULL CHECK (pages BETWEEN 0 AND 64),
  PRIMARY KEY (session_id, stop)
);
REVOKE ALL ON sophie_core.shuttle_activity_attention FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.shuttle_activity_attention
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
