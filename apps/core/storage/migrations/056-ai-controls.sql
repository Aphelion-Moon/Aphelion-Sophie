-- AI-only control state. No case data, credentials, model prompts or conversation payloads.
CREATE SCHEMA sophie_ai;
REVOKE ALL ON SCHEMA sophie_ai FROM PUBLIC;

CREATE TABLE sophie_ai.state (
  guild_id text PRIMARY KEY CHECK (guild_id ~ '^[1-9][0-9]{0,19}$'),
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  disabled boolean NOT NULL DEFAULT true,
  configuration_revision integer NOT NULL DEFAULT 0 CHECK (configuration_revision >= 0),
  personality_revision integer NOT NULL DEFAULT 0 CHECK (personality_revision >= 0)
);
CREATE TABLE sophie_ai.publications (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  kind text NOT NULL CHECK (kind IN ('configuration','personality')),
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[1-9][0-9]{0,19}$'),
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,kind,revision), UNIQUE(guild_id,request_id)
);
CREATE TABLE sophie_ai.consents (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  channel_id text NOT NULL CHECK (channel_id ~ '^[1-9][0-9]{0,19}$'),
  user_id text NOT NULL CHECK (user_id ~ '^[1-9][0-9]{0,19}$'),
  epoch bigint NOT NULL CHECK (epoch > 0),
  enabled boolean NOT NULL,
  presence_epoch bigint NOT NULL CHECK (presence_epoch >= 0),
  notice_revision integer NOT NULL CHECK (notice_revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,channel_id,user_id)
);
-- Only the installation owner may write actual worker/release qualification.
-- Desired settings alone never qualify a model, audience, image or restore.
CREATE TABLE sophie_ai.qualifications (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  channel_id text NOT NULL CHECK (channel_id ~ '^[1-9][0-9]{0,19}$'),
  boundary_epoch bigint NOT NULL CHECK (boundary_epoch > 0),
  audience_sha256 text NOT NULL CHECK (audience_sha256 ~ '^[a-f0-9]{64}$'),
  worker_domain text NOT NULL CHECK (worker_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$'),
  release_sha256 text NOT NULL CHECK (release_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  configuration_sha256 text NOT NULL CHECK (configuration_sha256 ~ '^[a-f0-9]{64}$'),
  personality_sha256 text NOT NULL CHECK (personality_sha256 ~ '^[a-f0-9]{64}$'),
  restricted boolean NOT NULL,
  active boolean NOT NULL DEFAULT false,
  restore_ready boolean NOT NULL DEFAULT false,
  PRIMARY KEY (guild_id,channel_id)
);
CREATE TABLE sophie_ai.request_receipts (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  message_id text NOT NULL CHECK (message_id ~ '^[1-9][0-9]{0,19}$'),
  channel_id text NOT NULL CHECK (channel_id ~ '^[1-9][0-9]{0,19}$'),
  user_id text NOT NULL CHECK (user_id ~ '^[1-9][0-9]{0,19}$'),
  input_revision text NOT NULL CHECK (input_revision ~ '^[a-f0-9]{64}$'),
  proactive boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL CHECK (state IN ('admitted','sending','delivered','reacted','silent','expired','cancelled','unavailable','uncertain')),
  deadline timestamptz NOT NULL,
  effect_id text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,message_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA sophie_ai FROM PUBLIC;

ALTER TABLE sophie_core.dashboard_login_flows
  DROP CONSTRAINT dashboard_login_flows_return_path_check,
  ADD CONSTRAINT dashboard_login_flows_return_path_check CHECK (
    return_path IN ('/', '/localizations', '/ticket-forms', '/automation', '/permissions', '/contacts', '/contact-entry',
      '/answers', '/cases', '/manage-cases', '/case-replies', '/staff-notes', '/case-labels', '/ai', '/ai-preferences')
  );
