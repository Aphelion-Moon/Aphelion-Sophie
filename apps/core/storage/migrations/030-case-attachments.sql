-- Durable intent is committed with the observed attachment reference and Gateway cursor.
CREATE TABLE sophie_core.case_attachment_jobs (
  token text PRIMARY KEY CHECK (token ~ '^[a-f0-9]{48}$'),
  guild_id text NOT NULL,
  continuity_epoch bigint NOT NULL,
  sequence bigint NOT NULL,
  message_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 99),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'leased', 'retained', 'unavailable')),
  fence integer NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_owner text,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_code text,
  retained_slot text,
  retained_sha256 text CHECK (retained_sha256 ~ '^[a-f0-9]{64}$'),
  retained_bytes bigint CHECK (retained_bytes BETWEEN 1 AND 33554432),
  retained_at timestamptz,
  UNIQUE (guild_id, continuity_epoch, sequence, message_id, ordinal),
  FOREIGN KEY (guild_id, continuity_epoch, sequence, message_id) REFERENCES sophie_core.case_message_observations,
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((status = 'retained') = (retained_slot IS NOT NULL AND retained_sha256 IS NOT NULL AND retained_bytes IS NOT NULL AND retained_at IS NOT NULL))
);
CREATE INDEX case_attachment_jobs_pending ON sophie_core.case_attachment_jobs (available_at, token) WHERE status IN ('pending', 'leased');

CREATE TABLE sophie_core.case_attachment_capacity (
  vault_id text PRIMARY KEY CHECK (vault_id ~ '^[a-f0-9]{64}$'),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  until_at timestamptz NOT NULL DEFAULT '-infinity',
  paused boolean NOT NULL DEFAULT false
);
CREATE TABLE sophie_core.case_attachment_attempts (
  slot text PRIMARY KEY CHECK (slot ~ '^[a-f0-9]{48}$'),
  job_token text NOT NULL REFERENCES sophie_core.case_attachment_jobs,
  vault_id text NOT NULL REFERENCES sophie_core.case_attachment_capacity,
  fence integer NOT NULL CHECK (fence > 0),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 33554432),
  media_type text NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'text/plain')),
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object' AND octet_length(policy::text) <= 2048),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_token, fence)
);
ALTER TABLE sophie_core.case_attachment_jobs ADD FOREIGN KEY (retained_slot) REFERENCES sophie_core.case_attachment_attempts;
CREATE INDEX case_attachment_attempts_job ON sophie_core.case_attachment_attempts (job_token, fence);

-- Previous references remain references until the explicit acquisition composition runs.
INSERT INTO sophie_core.case_attachment_jobs (token, guild_id, continuity_epoch, sequence, message_id, ordinal)
  SELECT substring(md5(o.guild_id || ':' || o.continuity_epoch || ':' || o.sequence || ':' || o.message_id || ':' || a.ordinality) ||
    md5(o.message_id || ':' || a.ordinality || ':attachment'), 1, 48),
    o.guild_id, o.continuity_epoch, o.sequence, o.message_id, (a.ordinality - 1)::integer
  FROM sophie_core.case_message_observations o,
    jsonb_array_elements(CASE WHEN jsonb_typeof(o.patch->'attachments') = 'array' THEN o.patch->'attachments' ELSE '[]'::jsonb END) WITH ORDINALITY a;
REVOKE ALL ON sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity FROM PUBLIC;
