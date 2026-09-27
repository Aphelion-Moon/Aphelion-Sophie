-- Owner-only metadata observations. No messages, names, arbitrary topics or files.
CREATE TABLE sophie_control.maintenance_inventories (
  operation_id text NOT NULL REFERENCES sophie_control.maintenance_operations,
  revision integer NOT NULL CHECK (revision > 0),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  candidate_sha256 text NOT NULL CHECK (candidate_sha256 ~ '^[a-f0-9]{64}$'),
  control_sha256 text NOT NULL CHECK (control_sha256 ~ '^[a-f0-9]{64}$'),
  inventory jsonb NOT NULL CHECK (jsonb_typeof(inventory)='object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (operation_id,revision),
  UNIQUE (operation_id,request_id)
);
REVOKE ALL ON sophie_control.maintenance_inventories FROM PUBLIC;
