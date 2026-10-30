-- Member records (owner decisions, 30 October 2026): one post per member in a Staff forum, kept indefinitely, with a
-- changelog post listing every automatic entry. The record holds what Sophie wants the post to show (profile, application,
-- events); the delivered columns hold what she has posted. Core converges one record at a time, so a crash, a timeout or a
-- duplicate event leaves work to finish, never a second post. No AI reads any of these tables.
CREATE TABLE sophie_core.member_records (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  thread_id text,
  -- Sophie's own messages in the post, by slot: header, ledger, application, application2..., games, spare.
  messages jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(messages) = 'object'),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  -- The approved access application as read from Discord: NULL until looked up, then found, none or unavailable.
  application jsonb CHECK (application IS NULL OR application->>'status' IN ('found', 'none', 'unavailable')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  delivered_revision integer NOT NULL DEFAULT 0 CHECK (delivered_revision >= 0),
  -- Hashes of the header, ledger, application, title and tags last delivered.
  delivered jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(delivered) = 'object'),
  create_started boolean NOT NULL DEFAULT false,
  -- Records opened by the backfill wait behind live work.
  background boolean NOT NULL DEFAULT false,
  opened_at_ms bigint NOT NULL CHECK (opened_at_ms > 0),
  updated_at_ms bigint NOT NULL CHECK (updated_at_ms > 0),
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner text,
  lease_until timestamptz,
  last_error_code text,
  PRIMARY KEY (guild_id, user_id),
  UNIQUE (guild_id, thread_id),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);
CREATE INDEX member_records_due ON sophie_core.member_records (background, due_at) WHERE delivered_revision < revision;

-- Append-only: what happened to the member, and where Sophie posted it (the entry, and its changelog line).
CREATE TABLE sophie_core.member_record_events (
  guild_id text NOT NULL,
  event_id text NOT NULL CHECK (event_id ~ '^[A-Za-z0-9._-]{1,160}$'),
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('record.opened', 'joined', 'left', 'whitelist.granted', 'whitelist.lost', 'muzzled', 'unmuzzled',
    'name.changed', 'application')),
  at_ms bigint NOT NULL CHECK (at_ms > 0),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  message_id text,
  changelog_message_id text,
  PRIMARY KEY (guild_id, event_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES sophie_core.member_records (guild_id, user_id)
);
CREATE INDEX member_record_events_member ON sophie_core.member_record_events (guild_id, user_id, at_ms);

-- The copy of Staff discussion in the posts (owner: "She can copy into her DB."): each create, edit and delete as Sophie
-- observed it, like case message observations. Never read by an AI, never exported.
CREATE TABLE sophie_core.member_record_messages (
  guild_id text NOT NULL,
  thread_id text NOT NULL,
  message_id text NOT NULL,
  continuity_epoch bigint NOT NULL,
  sequence bigint NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('create', 'update', 'delete')),
  author_id text,
  author_name text,
  content text,
  attachments jsonb CHECK (attachments IS NULL OR jsonb_typeof(attachments) = 'array'),
  message_at_ms bigint,
  observed_at_ms bigint NOT NULL CHECK (observed_at_ms > 0),
  PRIMARY KEY (guild_id, message_id, continuity_epoch, sequence),
  FOREIGN KEY (guild_id, user_id) REFERENCES sophie_core.member_records (guild_id, user_id)
);
CREATE INDEX member_record_messages_thread ON sophie_core.member_record_messages (guild_id, thread_id, observed_at_ms);

REVOKE ALL ON sophie_core.member_records, sophie_core.member_record_events, sophie_core.member_record_messages FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.member_records
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.member_record_events
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.member_record_messages
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
