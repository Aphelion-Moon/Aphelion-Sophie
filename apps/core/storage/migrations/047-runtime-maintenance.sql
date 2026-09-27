-- Owner-only durable barrier. Runtime identities can observe one boolean, never
-- modify the barrier or read its candidate/audit records.
CREATE TABLE sophie_control.maintenance_operations (
  operation_id text PRIMARY KEY CHECK (operation_id ~ '^[a-f0-9]{64}$'),
  guild_id text NOT NULL,
  candidate_version integer NOT NULL CHECK (candidate_version > 0),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL UNIQUE CHECK (generation > 0),
  phase text NOT NULL CHECK (phase IN ('held','cancelled')),
  database_actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_at timestamptz,
  CHECK ((phase='cancelled') = (cancelled_at IS NOT NULL))
);
CREATE TABLE sophie_control.runtime_gate (
  singleton boolean PRIMARY KEY CHECK (singleton),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  operation_id text REFERENCES sophie_control.maintenance_operations
);
INSERT INTO sophie_control.runtime_gate (singleton) VALUES (true);
REVOKE ALL ON sophie_control.maintenance_operations, sophie_control.runtime_gate FROM PUBLIC;

CREATE FUNCTION sophie_core.runtime_available() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT operation_id IS NULL FROM sophie_control.runtime_gate WHERE singleton
$$;
-- Only the boolean is public; schema USAGE remains restricted to the core role.

CREATE FUNCTION sophie_control.guard_runtime_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE held text;
BEGIN
  -- SECURITY DEFINER changes current_user: the caller must be checked using
  -- session_user. Only the owner identity may perform maintenance writes.
  IF pg_has_role(session_user, (SELECT relowner FROM pg_class WHERE oid=TG_RELID), 'USAGE') THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock_shared(182745, 47);
  -- The permanent singleton and row lock also fence old repeatable-read snapshots:
  -- a concurrently changed gate produces serialization failure, not stale permission.
  SELECT operation_id INTO held FROM sophie_control.runtime_gate WHERE singleton FOR SHARE;
  IF NOT FOUND OR held IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='RUNTIME_MAINTENANCE_ACTIVE';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION sophie_control.guard_runtime_write() FROM PUBLIC;

DO $$
DECLARE source_name text;
BEGIN
  FOR source_name IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='sophie_core' AND c.relkind='r' ORDER BY c.relname LOOP
    EXECUTE format('CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.%I
      FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write()', source_name);
  END LOOP;
END $$;
