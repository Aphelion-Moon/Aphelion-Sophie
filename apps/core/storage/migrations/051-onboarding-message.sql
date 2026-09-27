-- A screen is the persistent message anchor; controls carry its changing revision.
ALTER TABLE sophie_core.shuttle_screens ADD COLUMN control_version integer NOT NULL DEFAULT 0 CHECK (control_version >= 0);
