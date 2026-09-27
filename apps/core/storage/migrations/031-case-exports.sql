-- Append-only generation-attempt metadata; no copied conversation bodies or bearer download tokens.
CREATE TABLE sophie_core.case_export_policies (
  guild_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (guild_id, version)
);
CREATE TABLE sophie_core.case_export_attempts (
  guild_id text NOT NULL,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  case_id text NOT NULL,
  channel_id text NOT NULL,
  review_hash text NOT NULL CHECK (review_hash ~ '^[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 2097152),
  observation_count integer NOT NULL CHECK (observation_count BETWEEN 0 AND 100),
  gap_count integer NOT NULL CHECK (gap_count BETWEEN 0 AND 200),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, request_id)
);
CREATE INDEX case_export_attempts_case ON sophie_core.case_export_attempts (guild_id, case_id, recorded_at);
REVOKE ALL ON sophie_core.case_export_policies, sophie_core.case_export_attempts FROM PUBLIC;
