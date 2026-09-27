CREATE TABLE sophie_core.case_replies (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  guild_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations(id),
  user_id text NOT NULL,
  channel_id text NOT NULL,
  author_id text NOT NULL,
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_version integer NOT NULL CHECK (reviewed_version >= 0),
  plan_key text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','cancelled','withdrawn')),
  create_started boolean NOT NULL DEFAULT false,
  message_id text,
  withdrawal_reason text CHECK (withdrawal_reason IN ('authority-revoked','membership-revoked','case-changed','audience-changed','channel-access-changed','message-changed')),
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  settled_at timestamptz,
  UNIQUE (guild_id, request_id),
  CHECK (operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' = author_id),
  CHECK (message_id IS NULL OR create_started),
  CHECK (state <> 'confirmed' OR (message_id IS NOT NULL AND withdrawal_reason IS NULL)),
  CHECK (state <> 'cancelled' OR (NOT create_started AND message_id IS NULL AND withdrawal_reason IS NOT NULL)),
  CHECK (state <> 'withdrawn' OR (message_id IS NOT NULL AND withdrawal_reason IS NOT NULL)),
  CHECK ((state = 'pending') = (settled_at IS NULL))
);
CREATE INDEX case_replies_pending ON sophie_core.case_replies (guild_id, author_id, case_id) WHERE state = 'pending';
CREATE INDEX case_replies_history ON sophie_core.case_replies (guild_id, case_id, created_at_ms DESC, id DESC);
CREATE INDEX case_replies_author_cadence ON sophie_core.case_replies (guild_id, author_id, created_at_ms DESC);
CREATE TABLE sophie_core.case_reply_events (
  reply_id text NOT NULL REFERENCES sophie_core.case_replies(id),
  number integer NOT NULL CHECK (number > 0),
  event text NOT NULL CHECK (event IN ('requested','send-started','receipt','send-released','withdrawal-required','confirmed','cancelled','withdrawn')),
  message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (reply_id, number)
);
ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
  (kind IN ('whitelist.grant','whitelist.reconcile','member.reconcile','case.provision','shuttle.render','shuttle.alert','case.intake','case.dm','case.reply'));
REVOKE ALL ON sophie_core.case_replies, sophie_core.case_reply_events FROM PUBLIC;
