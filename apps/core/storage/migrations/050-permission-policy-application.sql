ALTER TABLE sophie_control.maintenance_operations
  DROP CONSTRAINT maintenance_operations_phase_check,
  ADD CONSTRAINT maintenance_operations_phase_check CHECK (phase IN ('held','sealing','sealed','policy-applied','cancelled'));

CREATE TABLE sophie_control.maintenance_policy_applications (
  operation_id text PRIMARY KEY REFERENCES sophie_control.maintenance_operations,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  configuration_sha256 text NOT NULL CHECK (configuration_sha256 ~ '^[a-f0-9]{64}$'),
  base_configuration jsonb NOT NULL CHECK (jsonb_typeof(base_configuration)='object'),
  inventory_revision integer NOT NULL,
  inventory_sha256 text NOT NULL CHECK (inventory_sha256 ~ '^[a-f0-9]{64}$'),
  observed_inventory_sha256 text NOT NULL CHECK (observed_inventory_sha256 ~ '^[a-f0-9]{64}$'),
  seal_plan_sha256 text CHECK (seal_plan_sha256 ~ '^[a-f0-9]{64}$'),
  control_before_sha256 text NOT NULL CHECK (control_before_sha256 ~ '^[a-f0-9]{64}$'),
  control_after_sha256 text NOT NULL CHECK (control_after_sha256 ~ '^[a-f0-9]{64}$'),
  reconciliation_jobs jsonb NOT NULL CHECK (jsonb_typeof(reconciliation_jobs)='array'),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary)='object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  database_actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (operation_id,inventory_revision) REFERENCES sophie_control.maintenance_inventories
);
REVOKE ALL ON sophie_control.maintenance_policy_applications FROM PUBLIC;
