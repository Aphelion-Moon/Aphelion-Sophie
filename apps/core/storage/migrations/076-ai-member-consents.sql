-- Owner decision, 23 October 2026: one Yes or No for the whole server replaces per-channel opt-in. A Yes covers Sophie's
-- replies, the member's own notes and Sophie's memories, under the notice revision it records. Channel rows in
-- sophie_ai.consents are no longer read for admission; they stay exportable until the member deletes their data or leaves.
CREATE TABLE sophie_ai.member_consents (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  user_id text NOT NULL CHECK (user_id ~ '^[1-9][0-9]{0,19}$'),
  epoch bigint NOT NULL CHECK (epoch > 0),
  enabled boolean NOT NULL,
  presence_epoch bigint NOT NULL CHECK (presence_epoch >= 0),
  notice_revision integer NOT NULL CHECK (notice_revision > 0),
  receipt jsonb CHECK (receipt IS NULL OR jsonb_typeof(receipt) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, user_id)
);
REVOKE ALL ON sophie_ai.member_consents FROM PUBLIC;

-- When Sophie last showed a member without a choice the static "Set up Sophie" invitation; at most one a day.
CREATE TABLE sophie_ai.consent_invitations (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  user_id text NOT NULL CHECK (user_id ~ '^[1-9][0-9]{0,19}$'),
  invited_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, user_id)
);
REVOKE ALL ON sophie_ai.consent_invitations FROM PUBLIC;
