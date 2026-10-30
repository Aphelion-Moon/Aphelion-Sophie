-- Owner direction, 30 October 2026: "Leavers should have their date and time of leaving documented, and have links to
-- their 5 most recent messages. New applications should replace the old one in the post, and sophie should document the
-- old application and new application change as a post in that users thread."
-- recent_messages keeps, per member, the IDs and times of their latest messages (never content), newest first, so a leave
-- can link to them. A replaced application is an entry of its own.
ALTER TABLE sophie_core.member_records ADD COLUMN recent_messages jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(recent_messages) = 'array' AND jsonb_array_length(recent_messages) <= 10);
ALTER TABLE sophie_core.member_record_events DROP CONSTRAINT member_record_events_kind_check;
ALTER TABLE sophie_core.member_record_events ADD CONSTRAINT member_record_events_kind_check CHECK (kind IN ('record.opened', 'joined', 'left',
  'whitelist.granted', 'whitelist.lost', 'muzzled', 'unmuzzled', 'name.changed', 'application', 'watched', 'unwatched', 'application.replaced'));
