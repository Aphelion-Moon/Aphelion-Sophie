import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inTransaction } from './transaction.js';
import { requireCondition } from '../../../contracts/validation.js';
import { verifyRecoveryControlCapture } from './recovery-controls.js';
import { verifyRuntimeWriteGuards } from './runtime-maintenance.js';

const migrations = ['001-core.sql', '002-discord-backoff.sql', '003-member-actions.sql', '004-actor-authority.sql', '005-case-provisioning.sql', '006-gateway-journal.sql', '007-gateway-identify-budget.sql', '008-shuttle-case-binding.sql', '009-shuttle-screens.sql', '010-shuttle-assistance.sql', '011-shuttle-pause.sql', '012-shuttle-alerts.sql', '013-shuttle-delivery-issues.sql', '014-shuttle-artifact-recovery.sql', '015-case-channel-selection.sql', '016-case-lifecycle.sql', '017-case-staff.sql', '018-case-inspections.sql', '019-dashboard-auth.sql', '020-shuttle-authoring.sql', '021-case-intake.sql', '022-case-intake-delivery.sql', '023-case-delivery-issues.sql', '024-case-form-authoring.sql', '025-player-reports.sql', '026-case-participant-presence.sql', '027-case-participants.sql', '028-staff-contact-intake.sql', '029-case-conversations.sql', '030-case-attachments.sql', '031-case-exports.sql', '032-case-direct-notices.sql', '033-recovery-controls.sql', '034-case-notes.sql', '035-case-labels.sql', '036-case-replies.sql', '037-case-reply-issues.sql', '038-curated-answers.sql', '039-case-reply-answers.sql', '040-case-answer-reviews.sql', '041-automation-policies.sql', '042-automation-admission.sql', '043-automation-delivery.sql', '044-automation-recovery.sql', '045-permission-editor.sql', '046-dashboard-return-path.sql', '047-runtime-maintenance.sql', '048-permission-channel-inventory.sql', '049-permission-sealing.sql', '050-permission-policy-application.sql', '051-onboarding-message.sql', '052-system-wording.sql', '053-wording-return-path.sql', '054-onboarding-channel-lifecycle.sql', '055-configuration-application.sql', '056-ai-controls.sql', '057-ai-boundaries.sql'];

/** Privileged maintenance API; never exposed through commands or dashboard routes. */
export async function migrateCore(pool) {
  return inTransaction(pool, async client => {
    // Fixed application key, independent of user input; serialises competing migrators.
    await client.query('SELECT pg_advisory_xact_lock(182745, 1)');
    await client.query('CREATE SCHEMA IF NOT EXISTS sophie_migrations');
    await client.query('REVOKE ALL ON SCHEMA sophie_migrations FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS sophie_migrations.applied (id text PRIMARY KEY, sha256 text NOT NULL)');
    const applied = await client.query('SELECT id, sha256 FROM sophie_migrations.applied');
    requireCondition(applied.rows.every(row => migrations.includes(row.id)), 'UNKNOWN_DATABASE_MIGRATION');
    for (const id of migrations) {
      const sql = await readFile(new URL(`./migrations/${id}`, import.meta.url), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const previous = applied.rows.find(row => row.id === id);
      if (previous) { requireCondition(previous.sha256 === hash, 'MIGRATION_CHECKSUM_MISMATCH'); continue; }
      await client.query(sql);
      await client.query('INSERT INTO sophie_migrations.applied (id, sha256) VALUES ($1, $2)', [id, hash]);
    }
    return { migrations: migrations.length };
  });
}

/** Shared checksum comparison; callers choose only the current set or the exact historical staging set. */
async function verifyMigrations(pool, expected) {
  const applied = (await pool.query('SELECT id, sha256 FROM sophie_migrations.applied')).rows;
  requireCondition(applied.length === expected.length && applied.every(row => expected.includes(row.id)), 'DATABASE_MIGRATIONS_INCOMPLETE');
  for (const id of expected) {
    const sql = await readFile(new URL(`./migrations/${id}`, import.meta.url), 'utf8');
    requireCondition(applied.find(row => row.id === id)?.sha256 === createHash('sha256').update(sql).digest('hex'), 'MIGRATION_CHECKSUM_MISMATCH');
  }
  return { migrations: expected.length };
}

/** Exact historical staging preservation gate. Never used to admit an old runtime. */
export async function verifyStaging032Migrations(pool) {
  const result = await verifyMigrations(pool, migrations.slice(0, 32));
  requireCondition((await pool.query("SELECT to_regnamespace('sophie_control') IS NULL AS absent")).rows[0].absent, 'STAGING_032_SCHEMA_REQUIRED');
  return result;
}

/** Read-only startup gate. The runtime still requires every current migration and control trigger. */
export async function verifyCoreMigrations(pool) {
  await verifyMigrations(pool, migrations);
  await verifyRecoveryControlCapture(pool);
  await verifyRuntimeWriteGuards(pool);
  return { migrations: migrations.length };
}
