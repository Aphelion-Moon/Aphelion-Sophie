CREATE TABLE sophie_core.system_wording (
  guild_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  wording jsonb NOT NULL CHECK (jsonb_typeof(wording)='object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,revision), UNIQUE (guild_id,request_id),
  CHECK (operator_grant->>'guildId'=guild_id)
);
REVOKE ALL ON sophie_core.system_wording FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.system_wording
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();

-- Existing immutable deliveries keep their original wording. New deliveries pin
-- a revision before creating a message, including uncertain-send recovery.
ALTER TABLE sophie_core.shuttle_alerts ADD COLUMN wording_revision integer DEFAULT 0 CHECK (wording_revision >= 0);
ALTER TABLE sophie_core.shuttle_alerts ALTER COLUMN wording_revision DROP DEFAULT;
ALTER TABLE sophie_core.case_intakes ADD COLUMN wording_revision integer DEFAULT 0 CHECK (wording_revision >= 0);
ALTER TABLE sophie_core.case_intakes ALTER COLUMN wording_revision DROP DEFAULT;

ALTER TABLE sophie_core.shuttle_screens ADD COLUMN wording_revision integer DEFAULT 0 CHECK (wording_revision >= 0);
ALTER TABLE sophie_core.shuttle_screens ALTER COLUMN wording_revision DROP DEFAULT;
