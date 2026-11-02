-- Owner direction, 2 November 2026 (docs/decisions/0001-owner-policy.md, "Game moderation in the member records"): the game
-- servers' bans, notes and admin help tickets, read from the central identity database's member_moderation view, are entries
-- in the member's post. game.ban, game.note and game.ticket enter a record once; game.changed enters a later lift, edit,
-- deletion or reopened ticket. member_record_sources remembers which revision of each source record a member's post holds,
-- so a feed run that finds nothing new enters nothing. Production grants it to the core runtime like member_record_channels.
ALTER TABLE sophie_core.member_record_events DROP CONSTRAINT member_record_events_kind_check;
ALTER TABLE sophie_core.member_record_events ADD CONSTRAINT member_record_events_kind_check CHECK (kind IN ('record.opened', 'joined', 'left',
  'whitelist.granted', 'whitelist.lost', 'muzzled', 'unmuzzled', 'name.changed', 'application', 'watched', 'unwatched', 'application.replaced',
  'message.deleted', 'message.edited', 'roles.changed', 'game.ban', 'game.note', 'game.ticket', 'game.changed'));

CREATE TABLE sophie_core.member_record_sources (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  -- <server id>.<source key> as the central database names it, for example meridian-main.ban.12.
  source_key text NOT NULL CHECK (source_key ~ '^[a-z0-9-]{1,40}\.[a-z]{1,10}\.[0-9]{1,20}(\.[0-9]{1,10})?$'),
  revision text NOT NULL CHECK (revision ~ '^[0-9a-f]{32}$'),
  present boolean NOT NULL,
  -- What the post was last given, for the next change entry's before-and-after.
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  entered_at_ms bigint NOT NULL,
  PRIMARY KEY (guild_id, user_id, source_key)
);

REVOKE ALL ON sophie_core.member_record_sources FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.member_record_sources
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
