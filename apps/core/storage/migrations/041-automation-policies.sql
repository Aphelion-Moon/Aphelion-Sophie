-- Retained authored configuration and withdrawal receipts; no incoming message content.
CREATE TABLE sophie_core.automation_policies (
  guild_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('publish','withdraw')),
  document jsonb,
  document_sha256 text CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  approved_public boolean NOT NULL CHECK (approved_public),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,revision),
  UNIQUE (guild_id,request_id),
  CHECK ((action = 'publish' AND document IS NOT NULL AND jsonb_typeof(document) = 'object' AND document_sha256 IS NOT NULL)
    OR (action = 'withdraw' AND document IS NULL AND document_sha256 IS NULL)),
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' IS NOT NULL)
);
REVOKE ALL ON sophie_core.automation_policies FROM PUBLIC;
