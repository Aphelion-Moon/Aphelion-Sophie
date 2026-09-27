import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';

const sources = ['members', 'actor_authority', 'case_reservations', 'case_provisions', 'case_participants', 'case_exclusions',
  'definitions', 'case_forms', 'capability_policies', 'case_policies', 'dashboard_auth_policies'];

/** Catalogue reads work without granting the runtime access to control rows. */
export async function verifyRecoveryControlCapture(pool) {
  const rows = (await pool.query(`SELECT c.relname AS source, t.tgenabled, t.tgtype,
    p.prosecdef AND p.proowner = c.relowner AS owned
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace fn ON fn.oid = p.pronamespace
    WHERE n.nspname = 'sophie_core' AND t.tgname = 'recovery_control_change' AND NOT t.tgisinternal
      AND fn.nspname = 'sophie_control' AND p.proname = 'capture'`)).rows;
  requireCondition(rows.length === sources.length && sources.every(source => rows.some(row => row.source === source &&
    row.tgenabled === 'O' && row.tgtype === 29 && row.owned)), 'RECOVERY_CONTROL_CAPTURE_INCOMPLETE');
}

/** Owner-only snapshot digest. It never returns control rows or certifies independent freshness. */
export async function snapshotRecoveryControls(client) {
  const isolation = (await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation;
  requireCondition(['repeatable read', 'serializable'].includes(isolation), 'RECOVERY_SNAPSHOT_REQUIRED');
  const digest = createHash('sha256'); let after = '0', count = 0;
  for (;;) {
    const rows = (await client.query(`SELECT id::text, source, operation, control_key, before_state, after_state
      FROM sophie_control.events WHERE id > $1::bigint ORDER BY id LIMIT 1000`, [after])).rows;
    for (const row of rows) { digest.update(JSON.stringify(row)); digest.update('\n'); count++; }
    if (rows.length < 1000) break;
    after = rows.at(-1).id;
  }
  return { formatVersion: 1, count, sha256: digest.digest('hex') };
}
