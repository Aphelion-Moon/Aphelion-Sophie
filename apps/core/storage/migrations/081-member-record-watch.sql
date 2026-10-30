-- Owner direction, 30 October 2026: "All staff can use the member watch command." Turning Watch on or off is an entry in
-- the member's record, with who did it.
ALTER TABLE sophie_core.member_record_events DROP CONSTRAINT member_record_events_kind_check;
ALTER TABLE sophie_core.member_record_events ADD CONSTRAINT member_record_events_kind_check CHECK (kind IN ('record.opened', 'joined', 'left',
  'whitelist.granted', 'whitelist.lost', 'muzzled', 'unmuzzled', 'name.changed', 'application', 'watched', 'unwatched'));
