/**
 * Clears the listed synthetic tables between scenarios on the cluster's administrative pool.
 *
 * TRUNCATE gives every table and index new files, so per-scenario resets left over 100,000 files for the next
 * checkpoint and made each reset slow on Windows (docs/storage.md). DELETE in one transaction keeps the files. Replica
 * mode, as with TRUNCATE, fires no row triggers (including the runtime write guards) and needs no foreign-key order; the
 * lists are the same foreign-key-closed sets the TRUNCATE statements used. Sequences are not reset by either.
 *
 * @param {import('pg').Pool} pool  administrative (superuser) pool of the isolated test cluster
 * @param {string} list  comma-separated schema-qualified table names
 */
export async function resetTables(pool, list) {
  const tables = list.split(',').map(name => name.trim()).filter(Boolean);
  if (!tables.length || tables.some(name => !/^sophie_[a-z_]+\.[a-z_]+$/u.test(name))) throw new Error('RESET_TABLE_INVALID');
  const client = await pool.connect();
  try {
    await client.query(['BEGIN', 'SET LOCAL session_replication_role = replica', ...tables.map(name => `DELETE FROM ${name}`), 'COMMIT'].join(';\n'));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

/** The core and Shuttle state most workflow suites start from: one list instead of a copy per suite. */
export const CORE_STATE_TABLES = Object.freeze([
  'sophie_core.automation_recovery_actions',
  'sophie_core.automation_delivery_events',
  'sophie_core.automation_deliveries',
  'sophie_core.automation_events',
  'sophie_core.automation_cooldowns',
  'sophie_core.automation_policies',
  'sophie_core.case_answer_reviews',
  'sophie_core.curated_answers',
  'sophie_core.case_reply_events',
  'sophie_core.case_replies',
  'sophie_core.case_label_changes',
  'sophie_core.case_notes',
  'sophie_core.case_direct_notices',
  'sophie_core.case_attachment_jobs',
  'sophie_core.case_attachment_attempts',
  'sophie_core.case_attachment_capacity',
  'sophie_core.case_message_observations',
  'sophie_core.case_capture_gaps',
  'sophie_core.case_capture_channels',
  'sophie_core.case_participant_actions',
  'sophie_core.case_participants',
  'sophie_core.case_form_editor_actions',
  'sophie_core.case_form_drafts',
  'sophie_core.case_delivery_actions',
  'sophie_core.case_delivery_issues',
  'sophie_core.case_intake_messages',
  'sophie_core.case_intakes',
  'sophie_core.case_form_slots',
  'sophie_core.case_form_actions',
  'sophie_core.case_forms',
  'sophie_core.shuttle_editor_actions',
  'sophie_core.shuttle_draft_revisions',
  'sophie_core.dashboard_sessions',
  'sophie_core.dashboard_login_flows',
  'sophie_core.dashboard_auth_limits',
  'sophie_core.dashboard_auth_policies',
  'sophie_core.case_inspection_sweeps',
  'sophie_core.case_staff_actions',
  'sophie_core.case_lifecycle_actions',
  'sophie_core.shuttle_delivery_rechecks',
  'sophie_core.shuttle_delivery_issues',
  'sophie_core.shuttle_alerts',
  'sophie_core.shuttle_help_resolutions',
  'sophie_core.shuttle_screen_parts',
  'sophie_core.shuttle_screens',
  'sophie_core.shuttle_help_requests',
  'sophie_core.shuttle_publications',
  'sophie_core.shuttle_activity_runs',
  'sophie_core.shuttle_cases',
  'sophie_core.gateway_members',
  'sophie_core.gateway_lifecycle',
  'sophie_core.actor_authority',
  'sophie_core.capability_policies',
  'sophie_core.member_actions',
  'sophie_core.outbox',
  'sophie_core.receipts',
  'sophie_core.sessions',
  'sophie_core.members',
  'sophie_core.definitions',
  'sophie_core.case_channels',
  'sophie_core.case_provisions',
  'sophie_core.case_policies',
  'sophie_core.case_reservations',
  'sophie_core.case_budgets',
  'sophie_core.case_exclusions',
]);

/** Clears CORE_STATE_TABLES (see resetTables). */
export const resetCoreState = pool => resetTables(pool, CORE_STATE_TABLES.join(', '));
