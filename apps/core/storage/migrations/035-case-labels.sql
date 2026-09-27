ALTER TABLE sophie_core.case_reservations
  ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 8 AND array_position(tags, NULL) IS NULL AND octet_length(array_to_string(tags, ',')) <= 1024);

-- Authored labels stay in the restricted case store, never in recovery-control projections.
CREATE TABLE sophie_core.case_label_changes (
  guild_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations(id),
  version integer NOT NULL CHECK (version > 0),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  author_id text NOT NULL,
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  previous_priority text NOT NULL,
  previous_tags text[] NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  tags text[] NOT NULL,
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (guild_id, case_id, version),
  UNIQUE (guild_id, request_id),
  CHECK (operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' = author_id)
);
REVOKE ALL ON sophie_core.case_label_changes FROM PUBLIC;
