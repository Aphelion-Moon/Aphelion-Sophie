import { verifyRuntimeWriteGuards } from '../../apps/core/storage/runtime-maintenance.js';

/**
 * Rebuild scenarios replay a pre-047 migration while 047 stays applied, so the rebuilt tables lack the write guard 047
 * gives every core table. Restore it as 047 does, for exactly the core tables without one, then verify the whole schema.
 * Suites share one database, and recovery bundles and runtime start-up refuse an unguarded table.
 */
export async function restoreRuntimeGuards(admin) {
  const missing = (await admin.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='sophie_core' AND c.relkind='r' AND NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=c.oid AND t.tgname='runtime_write_guard' AND NOT t.tgisinternal) ORDER BY c.relname`)).rows.map(row => row.relname);
  for (const table of missing) {
    await admin.query(`CREATE TRIGGER runtime_write_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
      ON sophie_core.${JSON.stringify(table)} FOR EACH STATEMENT EXECUTE FUNCTION sophie_control.guard_runtime_write()`);
  }
  await verifyRuntimeWriteGuards(admin);
  return missing;
}
