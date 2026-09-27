import { randomBytes, createHash } from 'node:crypto';
import { readFile, realpath, lstat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireCondition, requireKeys, requireInteger } from '../../../contracts/validation.js';
import { verifyCoreMigrations, verifyStaging032Migrations } from '../storage/migrate.js';
import { snapshotRecoveryControls } from '../storage/recovery-controls.js';
import { validateStagingRuntime } from '../runtime/configuration.js';
import { sealFile, unsealFile, openBackupSource } from './sealed-files.js';
import { createRecoveryDirectory, postgresEnvironment, runPostgres } from './local-operations.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const slotPattern = /^[a-f0-9]{48}$/;
const preparations = new WeakMap();
const connectionArgs = database => ['--host', database.host, '--port', String(database.port), '--username', database.user, '--dbname', database.database, '--no-password'];
function sourceIdentity(database) {
  requireCondition(database.host === '127.0.0.1' && /^sophie_(stage|test)_[a-z0-9_]{1,32}$/.test(database.database), 'ISOLATED_BACKUP_REQUIRED');
}
async function tables(client, guildId) {
  const rows = (await client.query(`SELECT t.table_name, EXISTS (SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'guild_id') AS guild_scoped
    FROM information_schema.tables t WHERE t.table_schema = 'sophie_core' AND t.table_type = 'BASE TABLE' ORDER BY t.table_name`)).rows;
  requireCondition(rows.length > 0 && rows.length <= 200 && rows.every(row => /^[a-z_]+$/.test(row.table_name)), 'RECOVERY_SCHEMA_INVALID');
  const counts = {};
  for (const { table_name: name, guild_scoped: guildScoped } of rows) {
    counts[name] = (await client.query(`SELECT count(*)::text AS total FROM sophie_core.${name}`)).rows[0].total;
    if (guildScoped) requireCondition(!(await client.query(`SELECT EXISTS (SELECT 1 FROM sophie_core.${name} WHERE guild_id <> $1) AS foreign_guild`, [guildId])).rows[0].foreign_guild,
      'BACKUP_GUILD_MISMATCH');
  }
  return counts;
}
async function retainedFiles(client) {
  const rows = (await client.query(`SELECT j.retained_slot AS slot, j.retained_sha256 AS sha256,
    j.retained_bytes::text AS bytes, a.vault_id AS "vaultId"
    FROM sophie_core.case_attachment_jobs j JOIN sophie_core.case_attachment_attempts a ON a.slot = j.retained_slot
    WHERE j.status = 'retained' ORDER BY j.retained_slot LIMIT 10001`)).rows;
  requireCondition(rows.length <= 10000, 'BACKUP_MANIFEST_LIMIT');
  return rows.map(row => ({ ...row, bytes: Number(row.bytes) }));
}
async function selectedVaults(roots) {
  requireCondition(Array.isArray(roots) && roots.length <= 32, 'BACKUP_VAULTS_INVALID');
  const vaults = new Map();
  for (const root of roots) {
    const path = await realpath(root), stat = await lstat(root);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'BACKUP_VAULTS_INVALID');
    const id = digest(process.platform === 'win32' ? path.toLowerCase() : path);
    requireCondition(!vaults.has(id), 'BACKUP_VAULTS_INVALID'); vaults.set(id, path);
  }
  return vaults;
}
function validateManifest(value) {
  requireKeys(value, ['schemaVersion', 'id', 'createdAt', 'buildId', 'configuration', 'configurationSha256', 'postgresVersion', 'migrations', 'tableCounts', 'controls', 'database', 'artifacts', 'recovery']);
  const legacy = value.schemaVersion === 3;
  requireCondition((value.schemaVersion === 2 || legacy) && /^[a-f0-9]{32}$/.test(value.id) && hashPattern.test(value.buildId) &&
    value.recovery === (legacy ? 'quarantined-staging-032-preservation-only' : 'quarantined-requires-independent-control-history'), 'BACKUP_MANIFEST_INVALID');
  validateStagingRuntime(value.configuration);
  requireCondition(value.configurationSha256 === digest(JSON.stringify(value.configuration)) && Array.isArray(value.artifacts) && value.artifacts.length <= 10000,
    'BACKUP_MANIFEST_INVALID');
  requireKeys(value.database, ['bytes', 'sha256']); requireInteger(value.database.bytes, 1); requireCondition(hashPattern.test(value.database.sha256), 'BACKUP_MANIFEST_INVALID');
  requireKeys(value.migrations, ['migrations']);
  if (legacy) requireCondition(value.migrations.migrations === 32 && value.controls === null, 'BACKUP_MANIFEST_INVALID');
  else {
    requireKeys(value.controls, ['formatVersion', 'count', 'sha256']); requireInteger(value.controls.count);
    requireCondition(value.controls.formatVersion === 1 && hashPattern.test(value.controls.sha256), 'BACKUP_MANIFEST_INVALID');
  }
  const slots = new Set();
  for (const artifact of value.artifacts) {
    requireKeys(artifact, ['slot', 'sha256', 'bytes', 'vaultId']);
    requireCondition(slotPattern.test(artifact.slot) && hashPattern.test(artifact.sha256) && hashPattern.test(artifact.vaultId) && !slots.has(artifact.slot), 'BACKUP_MANIFEST_INVALID');
    requireInteger(artifact.bytes, 1, 33554432); slots.add(artifact.slot);
  }
  requireCondition(value.tableCounts && typeof value.tableCounts === 'object' && !Array.isArray(value.tableCounts) &&
    Object.keys(value.tableCounts).length <= 200 && Object.entries(value.tableCounts).every(([name, count]) => /^[a-z_]+$/.test(name) && /^[0-9]+$/.test(count)), 'BACKUP_MANIFEST_INVALID');
}

/** Snapshot and retained-file selection share one PostgreSQL transaction. No external service or deletion is involved. */
export async function createRecoveryBundle({ pool, database, tools, configuration, buildId, vaultRoots, parent, key, maxDatabaseBytes, preserveStaging032 = false }) {
  requireCondition(typeof preserveStaging032 === 'boolean', 'STAGING_032_SCHEMA_REQUIRED');
  sourceIdentity(database); validateStagingRuntime(configuration); requireCondition(hashPattern.test(buildId), 'BACKUP_BUILD_REQUIRED');
  requireInteger(maxDatabaseBytes, 1); requireCondition(Buffer.isBuffer(key) && key.length === 32, 'BACKUP_KEY_INVALID');
  const vaults = await selectedVaults(vaultRoots), directory = await createRecoveryDirectory(parent, 'backup');
  const credentials = await postgresEnvironment(database);
  let client;
  let child = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '20min'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const identity = (await client.query('SELECT current_database() AS database, current_user AS identity')).rows[0];
    requireCondition(identity.database === database.database && identity.identity === database.user, 'BACKUP_DATABASE_MISMATCH');
    const migrations = await (preserveStaging032 ? verifyStaging032Migrations : verifyCoreMigrations)(client), tableCounts = await tables(client, configuration.mapping.guildId), artifacts = await retainedFiles(client);
    // Schema 032 has no control ledger. Absence is explicit, never an invented empty watermark.
    const controls = preserveStaging032 ? null : await snapshotRecoveryControls(client);
    requireCondition(artifacts.every(artifact => vaults.has(artifact.vaultId)), 'BACKUP_VAULT_MISSING');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    requireCondition(/^[A-Fa-f0-9-]+$/.test(snapshot), 'BACKUP_SNAPSHOT_INVALID');
    const id = randomBytes(16).toString('hex');
    child = runPostgres(tools.dump, [...connectionArgs(database), '--format=custom', '--no-acl', '--schema=sophie_core', '--schema=sophie_migrations', ...(preserveStaging032 ? [] : ['--schema=sophie_control']), `--snapshot=${snapshot}`], credentials.env);
    const archive = await sealFile({ chunks: child.chunks, path: resolve(directory, 'database.sealed'), key, label: `${id}:database`, maxBytes: maxDatabaseBytes });
    await child.done; child = null;
    for (const artifact of artifacts) {
      const source = await openBackupSource(resolve(vaults.get(artifact.vaultId), `${artifact.slot}.blob`), artifact.bytes);
      try { await sealFile({ chunks: source.createReadStream({ autoClose: false }), path: resolve(directory, `${artifact.slot}.sealed`),
        key, label: `${id}:${artifact.slot}`, maxBytes: artifact.bytes, expected: artifact }); }
      finally { await source.close(); }
    }
    await client.query('COMMIT');
    const manifest = { schemaVersion: preserveStaging032 ? 3 : 2, id, createdAt: new Date().toISOString(), buildId, configuration,
      configurationSha256: digest(JSON.stringify(configuration)), postgresVersion: tools.version, migrations,
      tableCounts, controls, database: archive, artifacts, recovery: preserveStaging032 ? 'quarantined-staging-032-preservation-only' : 'quarantined-requires-independent-control-history' };
    validateManifest(manifest);
    const bytes = Buffer.from(JSON.stringify(manifest));
    await sealFile({ chunks: [bytes], path: resolve(directory, 'manifest.sealed'), key, label: 'sophie:manifest:v1', maxBytes: 8 * 1024 * 1024 });
    // Only the authenticated manifest marks completion. Earlier partial output cannot be restored.
    return { directory, artifacts: artifacts.length, databaseBytes: archive.bytes, manifestSha256: digest(await readFile(resolve(directory, 'manifest.sealed'))),
      productionReady: false, independentRecoveryVerified: false,
      ...(preserveStaging032 ? { preservationOnly: true, sourceMigrations: 32, controlHistoryAvailable: false } : {}) };
  } catch (error) { await child?.stop(); await client?.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client?.release(true); await credentials.close(); }
}

/** Authenticate all inputs before any SQL execution. Prepared plaintext remains inside a new restricted directory. */
export async function prepareRecoveryBundle({ directory, parent, key, maxDatabaseBytes, confirmGuildId, expectedManifestSha256 }) {
  requireCondition(hashPattern.test(expectedManifestSha256), 'BACKUP_MANIFEST_RECEIPT_REQUIRED');
  requireInteger(maxDatabaseBytes, 1);
  const base = await realpath(directory);
  requireCondition((await lstat(directory)).isDirectory() && !(await lstat(directory)).isSymbolicLink(), 'RECOVERY_PATH_INVALID');
  const manifestPath = resolve(base, 'manifest.sealed');
  // The operator's saved receipt selects the exact backup; possession of any old backup is not freshness evidence.
  const manifestStat = await lstat(manifestPath); requireCondition(manifestStat.size <= 8 * 1024 * 1024 + 36, 'BACKUP_MANIFEST_LIMIT');
  requireCondition(digest(await readFile(manifestPath)) === expectedManifestSha256, 'BACKUP_MANIFEST_RECEIPT_MISMATCH');
  const manifest = JSON.parse((await unsealFile({ path: manifestPath, key, label: 'sophie:manifest:v1', maxBytes: 8 * 1024 * 1024 })).toString('utf8'));
  validateManifest(manifest);
  requireCondition(manifest.configuration.mapping.guildId === confirmGuildId && manifest.database.bytes <= maxDatabaseBytes, 'BACKUP_SELECTION_MISMATCH');
  const working = await createRecoveryDirectory(parent, 'restore');
  const archive = resolve(working, 'database.dump');
  await unsealFile({ path: resolve(base, 'database.sealed'), destination: archive, key, label: `${manifest.id}:database`, maxBytes: maxDatabaseBytes, expected: manifest.database });
  for (const artifact of manifest.artifacts) {
    await unsealFile({ path: resolve(base, `${artifact.slot}.sealed`), destination: resolve(working, `${artifact.slot}.blob`), key,
      label: `${manifest.id}:${artifact.slot}`, maxBytes: artifact.bytes, expected: artifact });
  }
  await writeFile(resolve(working, 'QUARANTINED.json'), JSON.stringify({ manifestSha256: expectedManifestSha256,
    deliveryEnabled: false, confidentialServingEnabled: false, independentRecoveryVerified: false }) + '\n', { flag: 'wx', mode: 0o600 });
  const prepared = Object.freeze({ working, artifacts: manifest.artifacts.length });
  preparations.set(prepared, { working, archive, manifest }); return prepared;
}

/** Only a new, empty, owner-controlled restore database; never --clean, --create, a source DB or runtime credentials. */
export async function restoreRecoveryBundle({ prepared, pool, database, tools }) {
  requireCondition(database.host === '127.0.0.1' && /^sophie_restore_[a-f0-9]{16,32}$/.test(database.database), 'ISOLATED_RESTORE_REQUIRED');
  const verified = preparations.get(prepared); requireCondition(verified, 'RESTORE_PREPARATION_REQUIRED');
  preparations.delete(prepared); prepared = verified;
  const client = await pool.connect(); let credentials, child;
  try {
    const selected = (await client.query(`SELECT current_database() AS database, current_user AS identity,
      pg_has_role(datdba, 'USAGE') AS owned FROM pg_database WHERE datname = current_database()`)).rows[0];
    requireCondition(selected.database === database.database && selected.identity === database.user && selected.owned, 'RESTORE_DATABASE_OWNERSHIP_REQUIRED');
    requireCondition((await client.query(`SELECT count(*)::int AS total FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg_%'`)).rows[0].total === 0 &&
      (await client.query(`SELECT count(*)::int AS total FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`)).rows[0].total === 0,
    'RESTORE_DATABASE_NOT_EMPTY');
    requireCondition(prepared.manifest.postgresVersion === tools.version, 'RESTORE_RUNTIME_MISMATCH');
    // Restore databases never receive bot-role grants. Failed or partial restoration stays unavailable too.
    await client.query(`REVOKE ALL ON DATABASE ${database.database} FROM PUBLIC`);
    requireCondition((await client.query(`SELECT count(*)::int AS total FROM pg_database d,
      LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
      WHERE d.datname = current_database() AND a.grantee <> d.datdba AND a.privilege_type = 'CONNECT'`)).rows[0].total === 0,
    'RESTORE_DATABASE_ACCESS_NOT_ISOLATED');
    // Install the persistent fence before SQL import so interrupted and failed restores remain fenced.
    await client.query('CREATE SCHEMA sophie_recovery');
    await client.query('REVOKE ALL ON SCHEMA sophie_recovery FROM PUBLIC');
    credentials = await postgresEnvironment(database);
    child = runPostgres(tools.restore, [...connectionArgs(database), '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', prepared.archive], credentials.env);
    child.chunks.resume(); await child.done; child = null;
    const legacy = prepared.manifest.schemaVersion === 3;
    await (legacy ? verifyStaging032Migrations : verifyCoreMigrations)(client);
    requireCondition(JSON.stringify(await tables(client, prepared.manifest.configuration.mapping.guildId)) === JSON.stringify(prepared.manifest.tableCounts), 'RESTORE_COUNTS_MISMATCH');
    requireCondition(JSON.stringify(await retainedFiles(client)) === JSON.stringify(prepared.manifest.artifacts), 'RESTORE_ARTIFACT_MANIFEST_MISMATCH');
    if (!legacy) {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      requireCondition(JSON.stringify(await snapshotRecoveryControls(client)) === JSON.stringify(prepared.manifest.controls), 'RESTORE_CONTROL_HISTORY_MISMATCH');
      await client.query('COMMIT');
    }
    await client.query('BEGIN');
    await client.query("UPDATE sophie_core.outbox SET status = 'parked', lease_owner = NULL, lease_until = NULL, fence = fence + 1, last_error_code = 'RESTORE_QUARANTINED' WHERE status IN ('ready', 'leased')");
    await client.query("UPDATE sophie_core.gateway_lifecycle SET status = 'offline', guild_available = false, lease_until = '-infinity', fence = fence + 1");
    await client.query('UPDATE sophie_core.dashboard_sessions SET revoked = true');
    await client.query("UPDATE sophie_core.dashboard_login_flows SET phase = 'consumed', expires_at = '-infinity'");
    await client.query('REVOKE ALL ON SCHEMA sophie_core, sophie_migrations FROM PUBLIC');
    if (!legacy) {
      await client.query('REVOKE ALL ON SCHEMA sophie_control FROM PUBLIC');
      await client.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sophie_control FROM PUBLIC');
    }
    await client.query(`ALTER DATABASE ${database.database} SET default_transaction_read_only = on`);
    await client.query('COMMIT');
    return { database: database.database, artifacts: prepared.manifest.artifacts.length, tableCountsVerified: true,
      deliveryEnabled: false, confidentialServingEnabled: false, independentRecoveryVerified: false, productionReady: false,
      ...(legacy ? { preservationOnly: true, sourceMigrations: 32, controlHistoryAvailable: false } : {}) };
  } catch (error) { await child?.stop(); await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(true); await credentials?.close(); }
}
