-- One configured guild/application. Debit before sending, including uncertain attempts.
-- Conservative local ceiling supplements Discord's application-wide reported limit.
ALTER TABLE sophie_core.gateway_lifecycle
  ADD COLUMN identify_window_started_at timestamptz,
  ADD COLUMN identify_attempts integer NOT NULL DEFAULT 0 CHECK (identify_attempts BETWEEN 0 AND 20),
  ADD COLUMN identify_not_before timestamptz NOT NULL DEFAULT '-infinity',
  ADD CONSTRAINT gateway_identify_window CHECK ((identify_window_started_at IS NULL) = (identify_attempts = 0));
