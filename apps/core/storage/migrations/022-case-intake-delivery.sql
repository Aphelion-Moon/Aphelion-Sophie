ALTER TABLE sophie_core.case_intakes ADD COLUMN delivery_format integer NOT NULL DEFAULT 1 CHECK (delivery_format = 1);
CREATE TABLE sophie_core.case_intake_messages (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  case_id text NOT NULL REFERENCES sophie_core.case_intakes (case_id),
  guild_id text NOT NULL,
  user_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 16),
  kind text NOT NULL CHECK (kind IN ('answer', 'notice')),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'confirmed')),
  create_started boolean NOT NULL DEFAULT false,
  channel_id text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  UNIQUE (case_id, ordinal),
  UNIQUE (guild_id, message_id),
  CHECK (message_id IS NULL OR (channel_id IS NOT NULL AND create_started)),
  CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL)),
  CHECK (state <> 'confirmed' OR message_id IS NOT NULL)
);
ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
  (kind IN ('whitelist.grant', 'whitelist.reconcile', 'member.reconcile', 'case.provision', 'shuttle.render', 'shuttle.alert', 'case.intake'));
-- Existing retained intake gets the same format and durable intent. Pages are planned under current case policy by core.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM sophie_core.case_intakes AS intake
    JOIN sophie_core.outbox AS job ON job.guild_id = intake.guild_id AND job.operation_id = 'intake.' || intake.case_id
    WHERE job.user_id IS DISTINCT FROM intake.user_id OR job.kind <> 'case.intake'
      OR job.effect IS DISTINCT FROM jsonb_build_object('kind', 'case.intake', 'operationId', 'intake.' || intake.case_id,
        'guildId', intake.guild_id, 'userId', intake.user_id, 'caseId', intake.case_id)
  ) THEN RAISE EXCEPTION 'CASE_INTAKE_MIGRATION_COLLISION' USING ERRCODE = '23514'; END IF;
END $$;
INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect)
SELECT guild_id, 'intake.' || case_id, user_id, 'case.intake', jsonb_build_object('kind', 'case.intake',
  'operationId', 'intake.' || case_id, 'guildId', guild_id, 'userId', user_id, 'caseId', case_id)
FROM sophie_core.case_intakes ON CONFLICT (guild_id, operation_id) DO NOTHING;
REVOKE ALL ON sophie_core.case_intake_messages FROM PUBLIC;
