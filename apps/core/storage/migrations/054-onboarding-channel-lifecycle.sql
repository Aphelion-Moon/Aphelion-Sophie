-- Channel retirement does not expire retained case or Onboarding records.
ALTER TABLE sophie_core.case_reservations
  ADD COLUMN onboarding_activity_ms bigint CHECK (onboarding_activity_ms >= 0),
  ADD COLUMN onboarding_retirement text CHECK (onboarding_retirement IN ('requested', 'removed')),
  ADD COLUMN onboarding_retirement_reason text CHECK (onboarding_retirement_reason IN ('manual', 'completed', 'inactive', 'missing')),
  ADD COLUMN onboarding_retirement_actor jsonb,
  ADD COLUMN onboarding_retired_ms bigint CHECK (onboarding_retired_ms >= 0),
  ADD CONSTRAINT onboarding_retirement_type CHECK (onboarding_retirement IS NULL OR
    (type = 'shuttle' AND onboarding_retirement_reason IS NOT NULL AND onboarding_retired_ms IS NOT NULL));

-- Give pre-upgrade channels the full grace period; never infer old inactivity.
UPDATE sophie_core.case_reservations SET onboarding_activity_ms = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  WHERE type = 'shuttle';
CREATE INDEX onboarding_cleanup_candidates ON sophie_core.case_reservations (guild_id, onboarding_activity_ms)
  WHERE type = 'shuttle' AND onboarding_retirement IS NULL;

ALTER TABLE sophie_core.shuttle_cases ADD COLUMN previous_case_ids text[] NOT NULL DEFAULT '{}';
