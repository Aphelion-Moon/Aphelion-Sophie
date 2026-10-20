-- Owner decision, 20 October 2026: Sophie writes her own memories while she talks. A memory is about one member
-- ("member") or about a channel ("channel"), names members only as subjects, and is valid only while every subject's
-- preference epoch still matches the one it was written under (deletion, departure and restore fences).
CREATE TABLE sophie_ai.memories (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel_id text NOT NULL CHECK(channel_id ~ '^[1-9][0-9]{0,19}$'),
  scope text NOT NULL CHECK(scope IN ('member','channel')),
  subject_ids text[] NOT NULL,
  subject_epochs bigint[] NOT NULL,
  text text NOT NULL CHECK(char_length(text) BETWEEN 3 AND 240),
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(guild_id,id),
  CHECK(cardinality(subject_ids)=cardinality(subject_epochs) AND cardinality(subject_ids)<=4),
  CHECK(scope='channel' OR cardinality(subject_ids)=1)
);
CREATE INDEX ai_memories_subjects ON sophie_ai.memories USING gin(subject_ids);
CREATE INDEX ai_memories_channel ON sophie_ai.memories(guild_id,channel_id,used_at DESC) WHERE scope='channel';
CREATE INDEX ai_memories_expiry ON sophie_ai.memories(expires_at);
REVOKE ALL ON sophie_ai.memories FROM PUBLIC;

-- A member who turned memory off. Kept until they turn it back on or leave.
CREATE TABLE sophie_ai.memory_optouts (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  user_id text NOT NULL CHECK(user_id ~ '^[1-9][0-9]{0,19}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(guild_id,user_id)
);
REVOKE ALL ON sophie_ai.memory_optouts FROM PUBLIC;
