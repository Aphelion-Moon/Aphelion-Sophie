CREATE TABLE sophie_core.case_answer_reviews (
  token text PRIMARY KEY CHECK (token ~ '^[a-f0-9]{48}$'),
  guild_id text NOT NULL,
  user_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations(id),
  channel_id text NOT NULL,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_version integer NOT NULL CHECK (reviewed_version >= 0),
  plan_key text NOT NULL,
  answer_name text NOT NULL,
  answer_revision integer NOT NULL,
  answer_sha256 text NOT NULL CHECK (answer_sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms bigint NOT NULL CHECK (expires_at_ms = created_at_ms + 600000),
  state text NOT NULL DEFAULT 'awaiting' CHECK (state IN ('awaiting','submitted','cancelled')),
  reply_id text REFERENCES sophie_core.case_replies(id),
  settled_at timestamptz,
  UNIQUE (guild_id, request_id),
  FOREIGN KEY (guild_id, answer_name, answer_revision) REFERENCES sophie_core.curated_answers(guild_id, name, revision),
  CHECK (operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' = user_id),
  CHECK ((state = 'submitted') = (reply_id IS NOT NULL)),
  CHECK ((state = 'awaiting') = (settled_at IS NULL))
);
CREATE INDEX case_answer_reviews_pending ON sophie_core.case_answer_reviews(guild_id, user_id, expires_at_ms) WHERE state = 'awaiting';
REVOKE ALL ON sophie_core.case_answer_reviews FROM PUBLIC;
