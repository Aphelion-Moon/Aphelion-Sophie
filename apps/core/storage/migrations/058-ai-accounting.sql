-- Content-free AI accounting. No grants to knowledge/inference or changes to core administration.
ALTER TABLE sophie_ai.publications DROP CONSTRAINT publications_kind_check,
  ADD CONSTRAINT publications_kind_check CHECK (kind IN ('configuration','personality','budget'));
CREATE TABLE sophie_ai.budget_policies (
  guild_id text PRIMARY KEY REFERENCES sophie_ai.state,
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  held boolean NOT NULL DEFAULT false,
  actor_id text NOT NULL CHECK (actor_id ~ '^[1-9][0-9]{0,19}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sophie_ai.budget_periods (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
  reserved_nanos bigint NOT NULL DEFAULT 0 CHECK (reserved_nanos >= 0),
  settled_nanos bigint NOT NULL DEFAULT 0 CHECK (settled_nanos >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (guild_id,period)
);
CREATE TABLE sophie_ai.provider_attempts (
  guild_id text NOT NULL,
  message_id text NOT NULL,
  fence uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved','dispatch_started','settled','uncertain','released')),
  policy_revision integer NOT NULL CHECK (policy_revision > 0),
  price jsonb NOT NULL CHECK (jsonb_typeof(price) = 'object'),
  month_period text NOT NULL,
  day_period text NOT NULL,
  control_epoch bigint NOT NULL CHECK (control_epoch >= 0),
  input_revision text NOT NULL CHECK (input_revision ~ '^[a-f0-9]{64}$'),
  reserved_nanos bigint NOT NULL CHECK (reserved_nanos > 0),
  prompt_bytes integer NOT NULL CHECK (prompt_bytes BETWEEN 1 AND 32768),
  output_tokens integer NOT NULL CHECK (output_tokens BETWEEN 1 AND 512),
  estimate_quality text NOT NULL DEFAULT 'conservative-byte-estimate' CHECK (estimate_quality='conservative-byte-estimate'),
  settled_nanos bigint CHECK (settled_nanos >= 0),
  usage jsonb,
  settlement_basis text CHECK (settlement_basis IN ('reported-usage-peak','conservative-reservation')),
  resolution_actor text CHECK (resolution_actor ~ '^[1-9][0-9]{0,19}$'),
  resolution_id text CHECK (resolution_id ~ '^[a-f0-9]{64}$'),
  model text,
  fingerprint text,
  deadline timestamptz NOT NULL,
  dispatch_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,message_id),
  FOREIGN KEY (guild_id,message_id) REFERENCES sophie_ai.request_receipts,
  FOREIGN KEY (guild_id,month_period) REFERENCES sophie_ai.budget_periods(guild_id,period),
  FOREIGN KEY (guild_id,day_period) REFERENCES sophie_ai.budget_periods(guild_id,period)
);
CREATE INDEX ai_provider_outstanding ON sophie_ai.provider_attempts(guild_id,state,deadline)
  WHERE state IN ('reserved','dispatch_started','uncertain');
CREATE TABLE sophie_ai.budget_hold_receipts (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[1-9][0-9]{0,19}$'),
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  policy_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,request_id)
);
REVOKE ALL ON sophie_ai.budget_policies,sophie_ai.budget_periods,sophie_ai.provider_attempts,sophie_ai.budget_hold_receipts FROM PUBLIC;
