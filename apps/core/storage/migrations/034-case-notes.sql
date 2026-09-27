-- Notes stay in the core case store, outside conversation capture and exports.
CREATE TABLE sophie_core.case_notes (
  guild_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations(id),
  number integer NOT NULL CHECK (number BETWEEN 1 AND 2147483647),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  author_id text NOT NULL,
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000 AND octet_length(body) <= 16000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (guild_id, case_id, number),
  UNIQUE (guild_id, request_id),
  CHECK (operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' = author_id)
);
REVOKE ALL ON sophie_core.case_notes FROM PUBLIC;
