ALTER TABLE sophie_core.case_provisions
  ADD COLUMN next_inspection_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN inspection_revision integer NOT NULL DEFAULT 0 CHECK (inspection_revision BETWEEN 0 AND 2147483646),
  ADD COLUMN last_inspection_operation_id text,
  ADD FOREIGN KEY (guild_id, last_inspection_operation_id) REFERENCES sophie_core.outbox (guild_id, operation_id);

CREATE INDEX case_inspections_due ON sophie_core.case_provisions (guild_id, next_inspection_at, case_id COLLATE "C") WHERE create_started;
CREATE INDEX case_outstanding_inspections ON sophie_core.outbox (guild_id, (effect->>'caseId'))
  WHERE kind = 'case.provision' AND status IN ('ready', 'leased', 'parked');

-- A short database transaction serializes each bounded batch; no timer holds a lease.
CREATE TABLE sophie_core.case_inspection_sweeps (
  guild_id text PRIMARY KEY,
  not_before timestamptz NOT NULL DEFAULT '-infinity',
  last_batch_at timestamptz,
  considered integer NOT NULL DEFAULT 0 CHECK (considered BETWEEN 0 AND 25),
  queued integer NOT NULL DEFAULT 0 CHECK (queued BETWEEN 0 AND considered),
  pending integer NOT NULL DEFAULT 0 CHECK (pending BETWEEN 0 AND considered),
  review integer NOT NULL DEFAULT 0 CHECK (review BETWEEN 0 AND considered),
  CHECK (queued + pending + review = considered)
);
REVOKE ALL ON sophie_core.case_inspection_sweeps FROM PUBLIC;
