-- Owner direction, 31 October 2026: each record post's reserved games message shows the member's linked game accounts and
-- character names, read from the central identity database (docs/decisions/0006-central-identity.md). The column is the
-- wanted state, written by the games feed (apps/core/discord/member-record-games.js); NULL until the feed first reads the
-- member, so a post keeps its reserved text until then. Table grants cover the new column.
ALTER TABLE sophie_core.member_records ADD COLUMN games jsonb
  CHECK (games IS NULL OR (jsonb_typeof(games) = 'object' AND games->>'status' IN ('none', 'linked')));
