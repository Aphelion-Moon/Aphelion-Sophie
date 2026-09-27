CREATE TABLE sophie_core.case_delivery_issues (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  guild_id text NOT NULL,
  operation_id text NOT NULL,
  user_id text NOT NULL,
  case_id text NOT NULL REFERENCES sophie_core.case_reservations (id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 2147483646),
  parked_fence integer NOT NULL CHECK (parked_fence >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (guild_id, operation_id),
  FOREIGN KEY (guild_id, operation_id) REFERENCES sophie_core.outbox,
  FOREIGN KEY (guild_id, user_id) REFERENCES sophie_core.members
);
CREATE INDEX case_delivery_issue_queue ON sophie_core.case_delivery_issues (guild_id, created_at, id);
CREATE TABLE sophie_core.case_delivery_actions (
  guild_id text NOT NULL,
  interaction_id text NOT NULL,
  issue_id text NOT NULL REFERENCES sophie_core.case_delivery_issues (id),
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 2147483646),
  operator_grant jsonb NOT NULL,
  parked_fence integer NOT NULL CHECK (parked_fence >= 1),
  attempts integer NOT NULL CHECK (attempts >= 1),
  dispatch_started boolean NOT NULL,
  error_code text NOT NULL CHECK (error_code ~ '^[A-Z_0-9]{1,64}$'),
  action text NOT NULL CHECK (action IN ('recheck', 'adopt_message', 'select_channel')),
  result_id text CHECK (result_id ~ '^[1-9][0-9]{0,19}$'),
  record_id text CHECK (record_id ~ '^[a-f0-9]{32}$'),
  candidate_ids text[],
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, interaction_id),
  UNIQUE (issue_id, revision),
  CHECK (operator_grant->>'guildId' = guild_id),
  CHECK ((action = 'recheck') = (result_id IS NULL)),
  CHECK ((action = 'adopt_message') = (record_id IS NOT NULL)),
  CHECK ((action = 'select_channel') = (candidate_ids IS NOT NULL)),
  CHECK (candidate_ids IS NULL OR (cardinality(candidate_ids) BETWEEN 2 AND 500 AND result_id = ANY(candidate_ids)))
);
REVOKE ALL ON sophie_core.case_delivery_issues, sophie_core.case_delivery_actions FROM PUBLIC;

-- Retain existing ordinary parked work without changing its attempts, fence or effect.
INSERT INTO sophie_core.case_delivery_issues (id, guild_id, operation_id, user_id, case_id, parked_fence, created_at)
SELECT md5('sophie-case-issue:' || o.guild_id || ':' || o.operation_id), o.guild_id, o.operation_id, o.user_id, r.id, o.fence, o.created_at
FROM sophie_core.outbox o
JOIN sophie_core.case_reservations r ON r.id = o.effect->>'caseId' AND r.guild_id = o.guild_id AND r.user_id = o.user_id
JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
WHERE o.status = 'parked' AND r.type <> 'shuttle'
  AND o.effect->>'kind' = o.kind AND o.effect->>'guildId' = o.guild_id AND o.effect->>'userId' = o.user_id
  AND o.effect->>'operationId' = o.operation_id
  AND ((o.kind = 'case.provision' AND o.effect->>'type' = r.type) OR (o.kind = 'case.intake' AND EXISTS (
    SELECT 1 FROM sophie_core.case_intakes intake WHERE intake.case_id = r.id AND intake.guild_id = r.guild_id
      AND intake.user_id = r.user_id AND intake.case_type = r.type)));
