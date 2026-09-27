-- Extend authored configuration; existing form versions and hashes stay unchanged.
ALTER TABLE sophie_core.case_forms DROP CONSTRAINT case_forms_case_type_check;
ALTER TABLE sophie_core.case_forms ADD CONSTRAINT case_forms_case_type_check
  CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report', 'staff-contact'));
ALTER TABLE sophie_core.case_form_drafts DROP CONSTRAINT case_form_drafts_case_type_check;
ALTER TABLE sophie_core.case_form_drafts ADD CONSTRAINT case_form_drafts_case_type_check
  CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report', 'staff-contact'));
ALTER TABLE sophie_core.case_form_editor_actions DROP CONSTRAINT case_form_editor_actions_case_type_check;
ALTER TABLE sophie_core.case_form_editor_actions ADD CONSTRAINT case_form_editor_actions_case_type_check
  CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report', 'staff-contact'));

-- Selected membership bindings are bounded temporary metadata, never form answers.
ALTER TABLE sophie_core.case_form_slots
  ADD COLUMN contact_grants jsonb,
  ADD COLUMN contact_operator_grant jsonb,
  ADD COLUMN contact_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN contact_cancelled boolean NOT NULL DEFAULT false;
ALTER TABLE sophie_core.case_form_slots ADD CONSTRAINT case_form_contact_selection CHECK (
  (case_type <> 'staff-contact' AND contact_grants IS NULL AND contact_operator_grant IS NULL AND NOT contact_confirmed AND NOT contact_cancelled) OR
  (case_type = 'staff-contact' AND contact_grants IS NOT NULL AND jsonb_typeof(contact_grants) = 'array'
    AND jsonb_array_length(contact_grants) BETWEEN 1 AND 20 AND contact_operator_grant IS NOT NULL
    AND jsonb_typeof(contact_operator_grant) = 'object'
    AND contact_operator_grant->>'guildId' IS NOT NULL AND contact_operator_grant->>'guildId' = guild_id
    AND contact_operator_grant->>'userId' IS NOT NULL AND contact_operator_grant->>'userId' = user_id));

-- Retain the initial Staff authority outcome separately from later lifecycle actions.
ALTER TABLE sophie_core.case_intakes ADD COLUMN contact_status text;
ALTER TABLE sophie_core.case_intakes ADD CONSTRAINT case_intake_contact_status CHECK (
  (case_type <> 'staff-contact' AND contact_status IS NULL) OR
  (case_type = 'staff-contact' AND contact_status IS NOT NULL AND contact_status IN ('pending', 'confirmed', 'revoked', 'superseded')));

-- One explicitly confirmed initial selection can invite multiple distinct people.
ALTER TABLE sophie_core.case_participant_actions DROP CONSTRAINT case_participant_actions_guild_id_interaction_id_key;
ALTER TABLE sophie_core.case_participant_actions ADD CONSTRAINT case_participant_action_recipient UNIQUE (guild_id, interaction_id, user_id);
