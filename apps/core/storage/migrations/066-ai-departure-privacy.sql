-- Departure metadata stays with core authority; AI identities receive no core access.
ALTER TABLE sophie_core.actor_authority
  ADD COLUMN ai_departure_epoch bigint NOT NULL DEFAULT 0 CHECK(ai_departure_epoch>=0),
  ADD COLUMN ai_cleanup_epoch bigint NOT NULL DEFAULT 0 CHECK(ai_cleanup_epoch>=0),
  ADD CONSTRAINT ai_departure_cleanup_order CHECK(ai_cleanup_epoch<=ai_departure_epoch);
CREATE INDEX ai_departure_pending ON sophie_core.actor_authority(guild_id,user_id)
  WHERE ai_departure_epoch>ai_cleanup_epoch;
ALTER TABLE sophie_ai.response_preferences
  ADD COLUMN retain_on_leave boolean NOT NULL DEFAULT false,
  ADD COLUMN departure_epoch bigint NOT NULL DEFAULT 0 CHECK(departure_epoch>=0);
-- Minimal replay fence after personal activity records have been erased.
CREATE TABLE sophie_ai.request_tombstones (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  message_hash text NOT NULL CHECK(message_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(guild_id,message_hash)
);
REVOKE ALL ON sophie_ai.request_tombstones FROM PUBLIC;
-- Keep cleanup ownership after personal dependency metadata has been erased.
CREATE TABLE sophie_ai.effect_erasure (
  guild_id text NOT NULL,
  member_hash text NOT NULL CHECK(member_hash ~ '^[a-f0-9]{64}$'),
  message_id text NOT NULL,
  PRIMARY KEY(guild_id,member_hash,message_id),
  FOREIGN KEY(guild_id,message_id) REFERENCES sophie_ai.request_receipts
);
REVOKE ALL ON sophie_ai.effect_erasure FROM PUBLIC;
