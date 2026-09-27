-- Append-only moderation decisions. The latest revision is selected under the member lock.
CREATE TABLE sophie_core.member_actions (
  guild_id text NOT NULL,
  user_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  operation_id text NOT NULL,
  muted boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'applied')),
  operator_grant jsonb NOT NULL CHECK (jsonb_typeof(operator_grant) = 'object'),
  eligibility_epoch bigint NOT NULL CHECK (eligibility_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (guild_id, user_id, revision),
  UNIQUE (guild_id, operation_id),
  FOREIGN KEY (guild_id, user_id) REFERENCES sophie_core.members
);
CREATE INDEX member_reconciliation ON sophie_core.outbox (guild_id, user_id)
  WHERE kind = 'member.reconcile' AND status IN ('ready', 'leased', 'parked');
REVOKE ALL ON sophie_core.member_actions FROM PUBLIC;
