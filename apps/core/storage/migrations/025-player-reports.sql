-- Extend authored forms without changing existing versions or their hashes.
ALTER TABLE sophie_core.case_forms DROP CONSTRAINT case_forms_case_type_check;
ALTER TABLE sophie_core.case_forms ADD CONSTRAINT case_forms_case_type_check
  CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report'));
ALTER TABLE sophie_core.case_form_drafts DROP CONSTRAINT case_form_drafts_case_type_check;
ALTER TABLE sophie_core.case_form_drafts ADD CONSTRAINT case_form_drafts_case_type_check
  CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report'));
ALTER TABLE sophie_core.case_form_editor_actions DROP CONSTRAINT case_form_editor_actions_case_type_check;
ALTER TABLE sophie_core.case_form_editor_actions ADD CONSTRAINT case_form_editor_actions_case_type_check
  CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report'));

-- A subject is retained report context. No audience or role state references it.
ALTER TABLE sophie_core.case_form_slots ADD COLUMN subject_id text;
ALTER TABLE sophie_core.case_form_slots ADD CONSTRAINT case_form_slot_subject
  CHECK (subject_id IS NULL OR (case_type = 'player-report' AND subject_id ~ '^[1-9][0-9]{0,19}$'));
ALTER TABLE sophie_core.case_intakes ADD COLUMN subject_id text;
ALTER TABLE sophie_core.case_intakes ADD CONSTRAINT case_intake_subject
  CHECK (subject_id IS NULL OR (case_type = 'player-report' AND subject_id ~ '^[1-9][0-9]{0,19}$'));
