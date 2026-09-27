CREATE TABLE sophie_core.case_forms (
  guild_id text NOT NULL,
  case_type text NOT NULL CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact')),
  version integer NOT NULL CHECK (version > 0),
  form jsonb NOT NULL CHECK (jsonb_typeof(form) = 'object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('published', 'withdrawn')),
  PRIMARY KEY (guild_id, case_type, version)
);
CREATE TABLE sophie_core.case_form_actions (
  guild_id text NOT NULL,
  case_type text NOT NULL,
  version integer NOT NULL,
  action text NOT NULL CHECK (action IN ('publish', 'withdraw')),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, case_type, version, action),
  FOREIGN KEY (guild_id, case_type, version) REFERENCES sophie_core.case_forms,
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'guildId' = guild_id)
);
-- Temporary, bounded modal handles contain no submitted answers. Reuse only after expiry.
CREATE TABLE sophie_core.case_form_slots (
  guild_id text NOT NULL,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 128),
  token text NOT NULL CHECK (token ~ '^[a-f0-9]{48}$'),
  user_id text NOT NULL,
  interaction_id text NOT NULL,
  case_type text NOT NULL,
  form_version integer NOT NULL,
  case_policy_version integer NOT NULL CHECK (case_policy_version > 0),
  presence_epoch bigint NOT NULL CHECK (presence_epoch >= 0),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_case_id text REFERENCES sophie_core.case_reservations(id),
  PRIMARY KEY (guild_id, slot),
  UNIQUE (guild_id, token),
  UNIQUE (guild_id, interaction_id),
  FOREIGN KEY (guild_id, case_type, form_version) REFERENCES sophie_core.case_forms,
  CHECK (expires_at > issued_at)
);
CREATE INDEX case_form_slots_user ON sophie_core.case_form_slots (guild_id, user_id, expires_at);
-- Retained case content. No expiry or DELETE privilege, including failed/closed cases.
CREATE TABLE sophie_core.case_intakes (
  case_id text PRIMARY KEY REFERENCES sophie_core.case_reservations(id),
  guild_id text NOT NULL,
  user_id text NOT NULL,
  case_type text NOT NULL,
  form_version integer,
  form_token text,
  answers jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'array'),
  answers_sha256 text NOT NULL CHECK (answers_sha256 ~ '^[a-f0-9]{64}$'),
  interaction_id text NOT NULL,
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (guild_id, form_token),
  UNIQUE (guild_id, interaction_id),
  FOREIGN KEY (guild_id, case_type, form_version) REFERENCES sophie_core.case_forms,
  CHECK ((case_type = 'quick-help' AND form_version IS NULL AND form_token IS NULL AND answers = '[]'::jsonb) OR
    (case_type <> 'quick-help' AND form_version IS NOT NULL AND form_token IS NOT NULL AND form_token ~ '^[a-f0-9]{48}$')),
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'userId' IS NOT NULL AND
    operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' = user_id)
);
REVOKE ALL ON sophie_core.case_forms, sophie_core.case_form_actions, sophie_core.case_form_slots, sophie_core.case_intakes FROM PUBLIC;
