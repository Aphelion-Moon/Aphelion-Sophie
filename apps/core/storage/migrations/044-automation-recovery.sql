ALTER TABLE sophie_core.automation_delivery_events DROP CONSTRAINT automation_delivery_events_kind_check;
ALTER TABLE sophie_core.automation_delivery_events ADD CONSTRAINT automation_delivery_events_kind_check
  CHECK (kind IN ('send-started','receipt','unsent','withdrawal-required','confirmed','cancelled','withdrawn','operator-recheck','operator-recover'));
CREATE TABLE sophie_core.automation_recovery_actions (
  guild_id text NOT NULL,
  request_id text NOT NULL CHECK (request_id ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  delivery_id text NOT NULL REFERENCES sophie_core.automation_deliveries(id),
  event_sequence integer NOT NULL,
  expected_fence integer NOT NULL CHECK (expected_fence >= 0 AND expected_fence < 2147483646),
  action text NOT NULL CHECK (action IN ('recheck','recover')),
  message_id text,
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id,request_id),
  UNIQUE (delivery_id,event_sequence),
  FOREIGN KEY (delivery_id,event_sequence) REFERENCES sophie_core.automation_delivery_events(delivery_id,sequence),
  CHECK (operator_grant->>'guildId' IS NOT NULL AND operator_grant->>'guildId' = guild_id AND operator_grant->>'userId' IS NOT NULL),
  CHECK (action <> 'recheck' OR message_id IS NULL)
);
REVOKE ALL ON sophie_core.automation_recovery_actions FROM PUBLIC;
