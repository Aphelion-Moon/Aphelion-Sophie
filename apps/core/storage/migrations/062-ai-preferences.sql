CREATE TABLE sophie_ai.response_preferences (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  user_id text NOT NULL CHECK(user_id ~ '^[1-9][0-9]{0,19}$'),
  epoch bigint NOT NULL CHECK(epoch>0),
  presence_epoch bigint NOT NULL CHECK(presence_epoch>=0),
  settings jsonb CHECK(jsonb_typeof(settings)='object' AND octet_length(settings::text)<=128),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(guild_id,user_id),
  CHECK(settings IS NULL OR expires_at IS NOT NULL)
);
CREATE INDEX ai_preferences_expiry ON sophie_ai.response_preferences(expires_at) WHERE settings IS NOT NULL;
REVOKE ALL ON sophie_ai.response_preferences FROM PUBLIC;
