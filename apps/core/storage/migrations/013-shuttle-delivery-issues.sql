CREATE TABLE sophie_core.shuttle_delivery_issues (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  guild_id text NOT NULL,
  operation_id text NOT NULL,
  user_id text NOT NULL,
  session_id text NOT NULL REFERENCES sophie_core.shuttle_cases (session_id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 2147483646),
  parked_fence integer NOT NULL CHECK (parked_fence >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (guild_id, operation_id),
  FOREIGN KEY (guild_id, operation_id) REFERENCES sophie_core.outbox,
  FOREIGN KEY (guild_id, user_id) REFERENCES sophie_core.members
);
CREATE INDEX shuttle_delivery_issue_queue ON sophie_core.shuttle_delivery_issues (guild_id, created_at, id);

CREATE TABLE sophie_core.shuttle_delivery_rechecks (
  guild_id text NOT NULL,
  interaction_id text NOT NULL,
  issue_id text NOT NULL REFERENCES sophie_core.shuttle_delivery_issues (id),
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483646),
  operator_grant jsonb NOT NULL,
  parked_fence integer NOT NULL CHECK (parked_fence >= 1),
  attempts integer NOT NULL CHECK (attempts >= 1),
  dispatch_started boolean NOT NULL,
  error_code text NOT NULL CHECK (error_code ~ '^[A-Z_0-9]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, interaction_id),
  UNIQUE (issue_id, revision),
  CHECK (operator_grant->>'guildId' = guild_id)
);
REVOKE ALL ON sophie_core.shuttle_delivery_issues, sophie_core.shuttle_delivery_rechecks FROM PUBLIC;

-- Retain existing parked work without replaying it. These opaque handles are routing
-- identifiers, not credentials; a collision aborts migration rather than aliasing a job.
INSERT INTO sophie_core.shuttle_delivery_issues (id, guild_id, operation_id, user_id, session_id, parked_fence, created_at)
SELECT md5('sophie-shuttle-issue:' || o.guild_id || ':' || o.operation_id), o.guild_id, o.operation_id, o.user_id, s.id, o.fence, o.created_at
FROM sophie_core.outbox o
JOIN sophie_core.outbox g ON g.guild_id = o.guild_id AND g.user_id = o.user_id AND g.kind = 'whitelist.grant'
  AND g.operation_id = CASE WHEN o.kind = 'whitelist.grant' THEN o.operation_id ELSE o.effect->>'sourceOperation' END
JOIN sophie_core.sessions s ON s.id = g.effect->>'sessionId' AND s.guild_id = g.guild_id AND s.user_id = g.user_id
JOIN sophie_core.shuttle_cases b ON b.session_id = s.id AND b.guild_id = s.guild_id AND b.user_id = s.user_id
JOIN sophie_core.case_reservations r ON r.id = b.case_id AND r.guild_id = b.guild_id AND r.user_id = b.user_id
WHERE o.kind IN ('whitelist.grant', 'whitelist.reconcile') AND o.status = 'parked' AND r.type = 'shuttle';
