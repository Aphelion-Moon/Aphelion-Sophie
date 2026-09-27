import { requireCondition } from '../../../contracts/validation.js';

/** A restore drill never becomes a live bot by changing its local configuration or renaming the database. */
export async function requireUnquarantinedDatabase(pool) {
  const row = (await pool.query(`SELECT current_database() LIKE 'sophie_restore_%' AS restore_name,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'sophie_recovery') AS quarantined`)).rows[0];
  requireCondition(row?.restore_name === false && row.quarantined === false, 'RECOVERY_QUARANTINED');
}
