-- Owner direction, 30 October 2026: "Add role changes to the automatic entries." A member's role changes (other than
-- Whitelist and Muzzled, which have their own entries) are an entry, with who changed them from the audit log.
ALTER TABLE sophie_core.member_record_events DROP CONSTRAINT member_record_events_kind_check;
ALTER TABLE sophie_core.member_record_events ADD CONSTRAINT member_record_events_kind_check CHECK (kind IN ('record.opened', 'joined', 'left',
  'whitelist.granted', 'whitelist.lost', 'muzzled', 'unmuzzled', 'name.changed', 'application', 'watched', 'unwatched', 'application.replaced',
  'message.deleted', 'message.edited', 'roles.changed'));
