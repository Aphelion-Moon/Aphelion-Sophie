import { requireCondition } from '../../../contracts/validation.js';
import { verifyCoreMigrations } from '../storage/migrate.js';
import { requireUnquarantinedDatabase } from './recovery.js';
import { runtimeDatabaseAvailable } from '../storage/runtime-maintenance.js';

export function requireStagingDatabase(configuration) {
  requireCondition(configuration?.host === '127.0.0.1' && /^sophie_stage_[a-z0-9_]{1,32}$/.test(configuration.database) &&
    /^sophie_stage_[a-z0-9_]{1,32}$/.test(configuration.user), 'ISOLATED_STAGING_DATABASE_REQUIRED');
}

/** The privileged coordinator must use a separate identity on the same isolated database. */
export function requireStagingOwnerDatabase(core, owner) {
  requireStagingDatabase(core); requireStagingDatabase(owner);
  requireCondition(core.host === owner.host && core.port === owner.port && core.database === owner.database &&
    core.user !== owner.user, 'STAGING_OWNER_DATABASE_MISMATCH');
}

/** Runtime credentials cannot own or delete case tables, create identities or administer the server. */
export async function checkRuntimeDatabase(pool) {
  const result = await checkRuntimeDatabaseIdentity(pool);
  requireCondition(await runtimeDatabaseAvailable(pool), 'RUNTIME_MAINTENANCE_ACTIVE');
  return result;
}

/** Host preflight also runs while a retained maintenance operation owns the barrier. */
export async function checkRuntimeDatabaseIdentity(pool) {
  await requireUnquarantinedDatabase(pool);
  const role = (await pool.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0];
  requireCondition(role && Object.values(role).every(value => value === false), 'RUNTIME_DATABASE_PRIVILEGES_INVALID');
  const tables = (await pool.query(`SELECT c.relname,
    has_table_privilege(c.oid, 'SELECT') AND has_table_privilege(c.oid, 'INSERT') AND has_table_privilege(c.oid, 'UPDATE') AS usable,
    has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE') OR pg_has_role(c.relowner, 'USAGE') AS privileged
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'sophie_core' AND c.relkind = 'r'`)).rows;
  requireCondition(tables.length > 0 && tables.every(row => row.usable && !row.privileged) &&
    ['members', 'case_reservations', 'case_attachment_jobs', 'case_message_observations', 'gateway_lifecycle'].every(name => tables.some(row => row.relname === name)),
  'RUNTIME_DATABASE_PRIVILEGES_INVALID');
  requireCondition((await pool.query("SELECT NOT has_schema_privilege('sophie_core', 'CREATE') AS restricted")).rows[0]?.restricted === true, 'RUNTIME_DATABASE_PRIVILEGES_INVALID');
  requireCondition((await pool.query(`SELECT NOT (has_schema_privilege('sophie_control', 'USAGE') OR
    has_schema_privilege('sophie_control', 'CREATE') OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'sophie_control' AND (has_table_privilege(c.oid, 'SELECT') OR has_table_privilege(c.oid, 'INSERT') OR
        has_table_privilege(c.oid, 'UPDATE') OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE')))) AS restricted`)).rows[0]?.restricted === true,
  'RUNTIME_CONTROL_PRIVILEGES_INVALID');
  requireCondition((await pool.query(`SELECT NOT (has_table_privilege('sophie_migrations.applied', 'INSERT') OR
    has_table_privilege('sophie_migrations.applied', 'UPDATE') OR has_table_privilege('sophie_migrations.applied', 'DELETE') OR
    has_table_privilege('sophie_migrations.applied', 'TRUNCATE') OR has_schema_privilege('sophie_migrations', 'CREATE')) AS restricted`)).rows[0]?.restricted === true,
  'RUNTIME_DATABASE_PRIVILEGES_INVALID');
  return { checkedTables: tables.length, ...await verifyCoreMigrations(pool) };
}
