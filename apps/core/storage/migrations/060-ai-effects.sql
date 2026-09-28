-- Minimal own-effect receipts; never prompts, generated text or case content.
CREATE TABLE sophie_ai.effects (
  guild_id text NOT NULL,
  message_id text NOT NULL,
  owner uuid NOT NULL,
  channel_id text NOT NULL CHECK (channel_id ~ '^[1-9][0-9]{0,19}$'),
  kind text NOT NULL CHECK (kind IN ('reply','react')),
  emoji jsonb,
  dependencies jsonb NOT NULL CHECK (jsonb_typeof(dependencies)='array' AND jsonb_array_length(dependencies)<=13 AND octet_length(dependencies::text)<=32768),
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources)='array' AND jsonb_array_length(sources)<=24 AND octet_length(sources::text)<=8192),
  state text NOT NULL CHECK (state IN ('prepared','attempted','confirmed','cleanup','removed')),
  receipt_id text CHECK (receipt_id ~ '^[a-zA-Z0-9._-]{1,96}$'),
  deadline timestamptz NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(guild_id,message_id),
  FOREIGN KEY(guild_id,message_id) REFERENCES sophie_ai.request_receipts,
  CHECK ((kind='reply' AND emoji IS NULL) OR (kind='react' AND jsonb_typeof(emoji)='object' AND octet_length(emoji::text)<=512))
);
CREATE INDEX ai_effect_reconcile ON sophie_ai.effects(guild_id,checked_at) WHERE state<>'removed';
REVOKE ALL ON sophie_ai.effects FROM PUBLIC;
