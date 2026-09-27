ALTER TABLE sophie_control.maintenance_operations
  DROP CONSTRAINT maintenance_operations_phase_check,
  ADD CONSTRAINT maintenance_operations_phase_check CHECK (phase IN ('held','sealing','sealed','cancelled'));

CREATE TABLE sophie_control.maintenance_seal_plans (
  operation_id text PRIMARY KEY REFERENCES sophie_control.maintenance_operations,
  inventory_revision integer NOT NULL,
  inventory_sha256 text NOT NULL CHECK (inventory_sha256 ~ '^[a-f0-9]{64}$'),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[a-f0-9]{64}$'),
  sealed_inventory_sha256 text CHECK (sealed_inventory_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (operation_id,inventory_revision) REFERENCES sophie_control.maintenance_inventories
);
CREATE TABLE sophie_control.maintenance_seal_effects (
  operation_id text NOT NULL REFERENCES sophie_control.maintenance_seal_plans,
  channel_id text NOT NULL CHECK (channel_id ~ '^[1-9][0-9]{0,19}$'),
  case_id text NOT NULL,
  target jsonb NOT NULL CHECK (jsonb_typeof(target)='object' AND target->>'channelId'=channel_id),
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','started','sent','uncertain','verified')),
  had_uncertainty boolean NOT NULL DEFAULT false,
  response_observed boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  PRIMARY KEY (operation_id,channel_id),
  CHECK ((state='verified') = (verified_at IS NOT NULL))
);
REVOKE ALL ON sophie_control.maintenance_seal_plans, sophie_control.maintenance_seal_effects FROM PUBLIC;
