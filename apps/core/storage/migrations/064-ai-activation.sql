-- Operator-owned activation receipts. Normal AI control credentials may not qualify a release.
CREATE TABLE sophie_ai.activation_receipts (
  guild_id text NOT NULL REFERENCES sophie_ai.state,
  request_id text NOT NULL CHECK(request_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK(actor_id ~ '^[1-9][0-9]{0,19}$'),
  channel_id text NOT NULL CHECK(channel_id ~ '^[1-9][0-9]{0,19}$'),
  review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
  boundary_epoch bigint NOT NULL CHECK(boundary_epoch>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(guild_id,request_id)
);
REVOKE ALL ON sophie_ai.activation_receipts FROM PUBLIC;
