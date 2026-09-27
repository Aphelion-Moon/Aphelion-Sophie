CREATE TABLE sophie_core.case_direct_notices (
  case_id text PRIMARY KEY REFERENCES sophie_core.case_intakes (case_id),
  guild_id text NOT NULL,
  user_id text NOT NULL,
  nonce text NOT NULL UNIQUE CHECK (nonce ~ '^[a-f0-9]{24}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'blocked', 'obsolete')),
  create_started boolean NOT NULL DEFAULT false,
  dm_channel_id text,
  ticket_channel_id text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT create_started OR (dm_channel_id IS NOT NULL AND ticket_channel_id IS NOT NULL)),
  CHECK (message_id IS NULL OR create_started),
  CHECK (state <> 'sent' OR message_id IS NOT NULL)
);
ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
  (kind IN ('whitelist.grant', 'whitelist.reconcile', 'member.reconcile', 'case.provision', 'shuttle.render', 'shuttle.alert', 'case.intake', 'case.dm'));
REVOKE ALL ON sophie_core.case_direct_notices FROM PUBLIC;
