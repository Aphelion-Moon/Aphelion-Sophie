-- Retained authored configuration only; no submitted answers or case content.
CREATE TABLE sophie_core.case_form_drafts (
  guild_id text NOT NULL,
  case_type text NOT NULL CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact')),
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document->>'caseType' IS NOT NULL AND document->>'caseType' = case_type),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, case_type, revision),
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' IS NOT NULL)
);
CREATE TABLE sophie_core.case_form_editor_actions (
  guild_id text NOT NULL,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  case_type text NOT NULL CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (action IN ('save', 'publish', 'withdraw')),
  before_revision integer NOT NULL CHECK (before_revision >= 0),
  after_revision integer NOT NULL CHECK (after_revision >= before_revision),
  publication_version integer CHECK (publication_version > 0),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, request_id),
  CHECK ((action = 'save') = (publication_version IS NULL)),
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' IS NOT NULL)
);
REVOKE ALL ON sophie_core.case_form_drafts, sophie_core.case_form_editor_actions FROM PUBLIC;
