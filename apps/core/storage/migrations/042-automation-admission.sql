ALTER TABLE sophie_core.gateway_lifecycle ADD COLUMN automation_enabled boolean NOT NULL DEFAULT false;

-- Incoming content is transient. Only routing metadata and bounded rule decisions are retained.
CREATE TABLE sophie_core.automation_events (
  guild_id text NOT NULL,
  message_id text NOT NULL,
  channel_id text NOT NULL,
  user_id text NOT NULL,
  policy_revision integer NOT NULL,
  policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at_ms bigint NOT NULL CHECK (observed_at_ms >= 0),
  continuity_epoch bigint NOT NULL CHECK (continuity_epoch >= 0),
  sequence bigint NOT NULL CHECK (sequence >= 0),
  outcome text NOT NULL CHECK (outcome IN ('evaluated','invalid-content','capacity')),
  decisions jsonb NOT NULL CHECK (jsonb_typeof(decisions) = 'array' AND jsonb_array_length(decisions) <= 25),
  PRIMARY KEY (guild_id,message_id),
  FOREIGN KEY (guild_id,policy_revision) REFERENCES sophie_core.automation_policies(guild_id,revision)
);
CREATE TABLE sophie_core.automation_cooldowns (
  guild_id text NOT NULL,
  rule_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('user','channel')),
  subject_id text NOT NULL,
  admitted_at_ms bigint NOT NULL CHECK (admitted_at_ms >= 0),
  PRIMARY KEY (guild_id,rule_id,scope,subject_id)
);
CREATE TABLE sophie_core.automation_deliveries (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  guild_id text NOT NULL,
  message_id text NOT NULL,
  channel_id text NOT NULL,
  user_id text NOT NULL,
  policy_revision integer NOT NULL,
  rule_id text NOT NULL,
  action_sha256 text NOT NULL CHECK (action_sha256 ~ '^[a-f0-9]{64}$'),
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms bigint NOT NULL CHECK (expires_at_ms = created_at_ms + 60000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','confirmed','cancelled','withdrawn')),
  UNIQUE (guild_id,message_id,rule_id),
  FOREIGN KEY (guild_id,message_id) REFERENCES sophie_core.automation_events(guild_id,message_id),
  FOREIGN KEY (guild_id,policy_revision) REFERENCES sophie_core.automation_policies(guild_id,revision)
);
CREATE INDEX automation_pending ON sophie_core.automation_deliveries(guild_id,user_id,channel_id) WHERE state = 'pending';
ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
  (kind IN ('whitelist.grant','whitelist.reconcile','member.reconcile','case.provision','shuttle.render','shuttle.alert','case.intake','case.dm','case.reply','automation.dispatch'));
REVOKE ALL ON sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.automation_deliveries FROM PUBLIC;
