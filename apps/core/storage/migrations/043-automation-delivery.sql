ALTER TABLE sophie_core.automation_deliveries
  ADD COLUMN create_started boolean NOT NULL DEFAULT false,
  ADD COLUMN receipt_available boolean NOT NULL DEFAULT false,
  ADD COLUMN sent_message_id text,
  ADD COLUMN withdrawal_reason text CHECK (withdrawal_reason IN ('disabled','expired','policy','channel','eligibility','effect-missing','rejected','existing-reaction')),
  ADD COLUMN settled_at timestamptz,
  ADD CONSTRAINT automation_receipt_started CHECK (NOT receipt_available OR create_started),
  ADD CONSTRAINT automation_message_receipt CHECK (sent_message_id IS NULL OR receipt_available);
CREATE TABLE sophie_core.automation_delivery_events (
  delivery_id text NOT NULL REFERENCES sophie_core.automation_deliveries(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN ('send-started','receipt','unsent','withdrawal-required','confirmed','cancelled','withdrawn')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (delivery_id,sequence)
);
CREATE INDEX automation_cooldown_subject ON sophie_core.automation_cooldowns(guild_id,scope,subject_id);
REVOKE ALL ON sophie_core.automation_delivery_events FROM PUBLIC;
