CREATE TABLE sophie_core.gateway_lifecycle (
  guild_id text PRIMARY KEY,
  mapping_hash text NOT NULL CHECK (mapping_hash ~ '^[a-f0-9]{64}$'),
  lease_owner text NOT NULL,
  fence integer NOT NULL CHECK (fence > 0),
  lease_until timestamptz NOT NULL,
  continuity_epoch bigint NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0),
  status text NOT NULL CHECK (status IN ('offline', 'identifying', 'synchronizing', 'resuming', 'current')),
  session_id text,
  resume_url text,
  sequence bigint,
  guild_available boolean NOT NULL DEFAULT false,
  last_error_code text,
  CHECK ((session_id IS NULL) = (resume_url IS NULL)),
  CHECK ((session_id IS NULL) = (sequence IS NULL)),
  CHECK (sequence IS NULL OR sequence >= 0),
  CHECK (status <> 'current' OR (guild_available AND session_id IS NOT NULL))
);
CREATE TABLE sophie_core.gateway_members (
  guild_id text NOT NULL REFERENCES sophie_core.gateway_lifecycle,
  user_id text NOT NULL,
  continuity_epoch bigint NOT NULL CHECK (continuity_epoch >= 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  PRIMARY KEY (guild_id, user_id)
);
REVOKE ALL ON sophie_core.gateway_lifecycle, sophie_core.gateway_members FROM PUBLIC;
