-- A Shuttle run keeps one status card (its shuttle_screens anchor, edited in place) and posts each step as plain
-- messages followed by a navigation card. Each posted message is a retained part row. When the step changes, the
-- anchor's part_generation advances: older parts are deleted from Discord, never from this table.
ALTER TABLE sophie_core.shuttle_screens ADD COLUMN part_generation integer NOT NULL DEFAULT 0 CHECK (part_generation >= 0);
-- Digest of the payload last confirmed on the anchor, so an unchanged card needs no read or write. NULL: unknown.
ALTER TABLE sophie_core.shuttle_screens ADD COLUMN rendered_sha256 text CHECK (rendered_sha256 ~ '^[a-f0-9]{64}$');
-- Digest of an edit that was sent but not confirmed (or of a body to re-check on entry). The next attempt reads
-- the message instead of editing it again: an uncertain edit is inspected before another write.
ALTER TABLE sophie_core.shuttle_screens ADD COLUMN pending_sha256 text CHECK (pending_sha256 ~ '^[a-f0-9]{64}$');
-- Someone deleted the status card. A deleted card cannot return to the top of the channel, so the run is replaced.
ALTER TABLE sophie_core.shuttle_screens ADD COLUMN message_gone boolean NOT NULL DEFAULT false;

CREATE TABLE sophie_core.shuttle_screen_parts (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  screen_id text NOT NULL REFERENCES sophie_core.shuttle_screens (id),
  guild_id text NOT NULL,
  user_id text NOT NULL,
  generation integer NOT NULL CHECK (generation >= 0),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  kind text NOT NULL CHECK (kind IN ('content', 'nav')),
  create_started boolean NOT NULL DEFAULT false,
  -- A create whose response was lost may be repeated once with the same Discord nonce while Discord still
  -- suppresses duplicates; afterwards it parks for review like any other uncertain create.
  create_started_at timestamptz,
  create_retried boolean NOT NULL DEFAULT false,
  channel_id text,
  message_id text,
  rendered_sha256 text CHECK (rendered_sha256 ~ '^[a-f0-9]{64}$'),
  pending_sha256 text CHECK (pending_sha256 ~ '^[a-f0-9]{64}$'),
  delete_started boolean NOT NULL DEFAULT false,
  gone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (screen_id, generation, position),
  UNIQUE (guild_id, message_id),
  CHECK (message_id IS NULL OR (channel_id IS NOT NULL AND create_started)),
  CHECK (create_started = (create_started_at IS NOT NULL)),
  CHECK (NOT create_retried OR create_started),
  CHECK (NOT delete_started OR message_id IS NOT NULL)
);
CREATE INDEX shuttle_screen_parts_open ON sophie_core.shuttle_screen_parts (screen_id, generation, position) WHERE NOT gone;
REVOKE ALL ON sophie_core.shuttle_screen_parts FROM PUBLIC;
CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON sophie_core.shuttle_screen_parts
  FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write();
