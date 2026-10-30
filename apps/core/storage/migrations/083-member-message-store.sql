-- Owner decisions, 30 October 2026: Staff asked for deleted messages in each member's post; the owner chose "30 days".
-- Sophie keeps the text of recorded members' messages for 30 days and who wrote which message for a year, so a deletion
-- (or an edit) can be entered in the author's post with the text when it is still kept, and attributed when it is not.
-- Rows are never deleted by the runtime (it holds no DELETE): text is cleared after 30 days, author and channel after a
-- year. Nothing is kept from the protected ticket category, channels and threads under it, Sophie's case-excluded
-- channels or the record posts; member_record_channels is the channel map that decides that. No AI reads either table.
CREATE TABLE sophie_core.member_messages (
  guild_id text NOT NULL,
  message_id text NOT NULL,
  channel_id text,
  author_id text,
  sent_at_ms bigint NOT NULL CHECK (sent_at_ms > 0),
  content text CHECK (content IS NULL OR length(content) <= 4000),
  attachments jsonb CHECK (attachments IS NULL OR jsonb_typeof(attachments) = 'array'),
  edited_at_ms bigint,
  deleted_at_ms bigint,
  content_cleared boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id, message_id)
);
CREATE INDEX member_messages_expiry ON sophie_core.member_messages (sent_at_ms) WHERE author_id IS NOT NULL;

CREATE TABLE sophie_core.member_record_channels (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  parent_id text,
  deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id, channel_id)
);

ALTER TABLE sophie_core.member_record_events DROP CONSTRAINT member_record_events_kind_check;
ALTER TABLE sophie_core.member_record_events ADD CONSTRAINT member_record_events_kind_check CHECK (kind IN ('record.opened', 'joined', 'left',
  'whitelist.granted', 'whitelist.lost', 'muzzled', 'unmuzzled', 'name.changed', 'application', 'watched', 'unwatched', 'application.replaced',
  'message.deleted', 'message.edited'));

REVOKE ALL ON sophie_core.member_messages, sophie_core.member_record_channels FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.member_messages
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.member_record_channels
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
