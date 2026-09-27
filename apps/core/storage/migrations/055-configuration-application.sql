CREATE TABLE sophie_core.permission_applications (
  guild_id text NOT NULL,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  candidate_version integer NOT NULL,
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','applying','blocked','applied','cancelled')),
  summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,request_id),
  FOREIGN KEY (guild_id,candidate_version) REFERENCES sophie_core.permission_candidates(guild_id,version)
);
CREATE UNIQUE INDEX permission_application_active ON sophie_core.permission_applications(guild_id)
  WHERE state IN ('queued','applying','blocked');
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.permission_applications
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
REVOKE ALL ON sophie_core.permission_applications FROM PUBLIC;

ALTER TABLE sophie_control.maintenance_operations
  DROP CONSTRAINT maintenance_operations_phase_check,
  ADD CONSTRAINT maintenance_operations_phase_check CHECK (phase IN ('held','sealing','sealed','policy-applied','completed','cancelled'));

CREATE TABLE sophie_control.configuration_applications (
  operation_id text PRIMARY KEY CHECK (operation_id ~ '^[a-f0-9]{64}$'),
  guild_id text NOT NULL,
  request_id text NOT NULL,
  base_configuration jsonb NOT NULL,
  candidate_configuration jsonb NOT NULL,
  phase text NOT NULL DEFAULT 'preparing' CHECK (phase IN ('preparing','held','sealing','policies','members','reconciling','completed')),
  generation bigint,
  inventory_revision integer,
  inventory_sha256 text,
  seal_sha256 text,
  member_cursor text,
  member_scan_complete boolean NOT NULL DEFAULT false,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz
);
CREATE TABLE sophie_control.configuration_members (
  operation_id text NOT NULL REFERENCES sophie_control.configuration_applications,
  user_id text NOT NULL,
  requires_mute boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  pending_effect jsonb,
  PRIMARY KEY (operation_id,user_id)
);
CREATE TABLE sophie_control.runtime_configuration (
  guild_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES sophie_control.configuration_applications,
  configuration jsonb NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON sophie_control.configuration_applications, sophie_control.configuration_members,
  sophie_control.runtime_configuration FROM PUBLIC;
