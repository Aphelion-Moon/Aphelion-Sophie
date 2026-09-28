-- AI-only lifecycle intent and acknowledgement. No credentials, prompts, shell commands or service paths.
CREATE TABLE sophie_ai.worker_state (
  guild_id text PRIMARY KEY REFERENCES sophie_ai.state,
  desired_revision integer NOT NULL DEFAULT 0 CHECK(desired_revision>=0),
  active_revision integer CHECK(active_revision>0),
  active_identity jsonb CHECK(active_identity IS NULL OR jsonb_typeof(active_identity)='object'),
  phase text NOT NULL DEFAULT 'stopped' CHECK(phase IN ('stopped','pending','draining','starting','ready','failed')),
  owner uuid,
  fence uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((owner IS NULL)=(fence IS NULL)),
  CHECK((active_revision IS NULL)=(active_identity IS NULL))
);
CREATE TABLE sophie_ai.worker_requests (
  guild_id text NOT NULL REFERENCES sophie_ai.worker_state,
  revision integer NOT NULL CHECK(revision>0),
  request_id text NOT NULL CHECK(request_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK(actor_id ~ '^[1-9][0-9]{0,19}$'),
  review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK(action IN ('apply','stop')),
  release jsonb,
  control_epoch bigint NOT NULL CHECK(control_epoch>=0),
  configuration_revision integer NOT NULL CHECK(configuration_revision>=0),
  personality_revision integer NOT NULL CHECK(personality_revision>=0),
  budget_revision integer NOT NULL CHECK(budget_revision>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(guild_id,revision), UNIQUE(guild_id,request_id),
  CHECK((action='stop' AND release IS NULL) OR (action='apply' AND jsonb_typeof(release)='object'))
);
REVOKE ALL ON sophie_ai.worker_state,sophie_ai.worker_requests FROM PUBLIC;
