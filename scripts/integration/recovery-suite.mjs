import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { requireUnquarantinedDatabase } from '../../apps/core/runtime/recovery.js';
import { createStagingRuntime } from '../../apps/core/runtime/staging.js';
import { createCaseNotes } from '../../apps/core/storage/case-notes.js';
import { createCaseReplies } from '../../apps/core/storage/case-replies.js';
import { attachmentWorkflow, syntheticFileBytes } from '../../tests/fixtures/case-attachments.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';
import { GUILD, USER, OTHER } from '../../tests/fixtures/domain.js';

/** Real pg_dump/pg_restore on one new local synthetic cluster. No bot connection or existing database. */
export async function runRecoverySuite(cluster, run) {
  const f = await attachmentWorkflow(cluster);
  const notes = createCaseNotes({ pool: f.pool, authorize: f.authorization.authorize, clock: () => f.clock.now });
  await notes.append({ actor: await f.actor(OTHER), channelId: f.opened.channel_id, requestId: 'd'.repeat(64), text: 'Authored synthetic retained Staff note.' });
  await f.store.changeCaseLabels({ actor: await f.actor(OTHER), channelId: f.opened.channel_id, requestId: 'e'.repeat(64),
    expectedVersion: f.opened.version, priority: 'high', tags: ['Synthetic-retained-label'] });
  const replies = createCaseReplies({ pool: f.pool, authorize: f.authorization.authorize, clock: () => f.clock.now });
  await replies.request({ actor: await f.actor(OTHER), channelId: f.opened.channel_id, requestId: 'f'.repeat(64),
    expectedVersion: f.opened.version + 1, text: 'Authored synthetic pending reply retained through encrypted restore.' });
  await f.addFile(); assert.equal((await f.attachmentWorker.runOnce('recovery-fixture')).status, 'retained');
  const original = (await f.jobs())[0], configuration = stagingConfiguration('a'.repeat(64));
  await f.admin.query('INSERT INTO sophie_core.dashboard_auth_policies (guild_id, version, policy) VALUES ($1, 1, $2)', [GUILD, configuration.dashboard]);
  await f.admin.query(`INSERT INTO sophie_core.dashboard_sessions (guild_id, slot, policy_version, user_id, token_hash, expires_at)
    VALUES ($1, 1, 1, $2, $3, clock_timestamp() + interval '1 hour')`, [GUILD, USER, 'a'.repeat(64)]);
  await f.admin.query(`INSERT INTO sophie_core.dashboard_login_flows (guild_id, slot, policy_version, state_hash, binding_hash, expires_at, phase)
    VALUES ($1, 1, 1, $2, $3, clock_timestamp() + interval '1 hour', 'pending')`, [GUILD, 'b'.repeat(64), 'c'.repeat(64)]);
  const { configuration: database, binaryRoot, directory: parent } = cluster.recovery;
  const tools = await reviewedRecoveryTools(binaryRoot), key = randomBytes(32), maxDatabaseBytes = 33554432;
  const options = { pool: cluster.adminPool, database, tools, configuration, buildId: 'a'.repeat(64), vaultRoots: [f.vaultRoot], parent, key, maxDatabaseBytes };
  let backup;
  const prepare = (overrides = {}) => prepareRecoveryBundle({ directory: backup.directory, parent, key, maxDatabaseBytes,
    confirmGuildId: GUILD, expectedManifestSha256: backup.manifestSha256, ...overrides });
  await run('RB01 exported PostgreSQL snapshot and hash-verified retained artifacts produce only encrypted completed backup files', async () => {
    backup = await createRecoveryBundle(options); assert.equal(backup.artifacts, 1); assert.equal(backup.independentRecoveryVerified, false);
    const files = await readdir(backup.directory); assert.equal(files.length, 3); assert.ok(files.every(name => name.endsWith('.sealed')));
    for (const name of files) assert.equal((await readFile(resolve(backup.directory, name))).includes(syntheticFileBytes), false);
    await requireUnquarantinedDatabase(cluster.adminPool);
  });
  await run('RB02 wrong key, guild, saved receipt and size limit reject selection before SQL restoration', async () => {
    await assert.rejects(prepare({ key: randomBytes(32) }), /BACKUP_AUTHENTICATION_FAILED/);
    await assert.rejects(prepare({ confirmGuildId: '99' }), /BACKUP_SELECTION_MISMATCH/);
    await assert.rejects(prepare({ expectedManifestSha256: '0'.repeat(64) }), /BACKUP_MANIFEST_RECEIPT_MISMATCH/);
    await assert.rejects(prepare({ maxDatabaseBytes: 1 }), /BACKUP_SELECTION_MISMATCH/);
  });
  await run('RB03 actual restore retains captured records and exact file bytes but fences runtime, old jobs and confidential serving', async () => {
    const prepared = await prepare(), target = await cluster.recovery.createTarget();
    const result = await restoreRecoveryBundle({ prepared, pool: target.pool, database: target.configuration, tools });
    assert.equal(result.tableCountsVerified, true); assert.equal(result.deliveryEnabled, false); assert.equal(result.independentRecoveryVerified, false);
    assert.deepEqual(await readFile(resolve(prepared.working, `${original.retained_slot}.blob`)), syntheticFileBytes);
    assert.equal((await target.pool.query('SELECT count(*)::int AS total FROM sophie_core.case_message_observations')).rows[0].total,
      (await f.admin.query('SELECT count(*)::int AS total FROM sophie_core.case_message_observations')).rows[0].total);
    assert.equal((await target.pool.query("SELECT count(*)::int AS total FROM sophie_core.outbox WHERE status IN ('ready','leased')")).rows[0].total, 0);
    assert.equal((await target.pool.query('SELECT revoked FROM sophie_core.dashboard_sessions')).rows[0].revoked, true);
    assert.equal((await target.pool.query('SELECT phase FROM sophie_core.dashboard_login_flows')).rows[0].phase, 'consumed');
    assert.deepEqual((await target.pool.query('SELECT patch FROM sophie_core.case_message_observations ORDER BY sequence')).rows,
      (await f.admin.query('SELECT patch FROM sophie_core.case_message_observations ORDER BY sequence')).rows);
    assert.deepEqual((await target.pool.query('SELECT number, author_id, operator_grant, body, sha256, created_at_ms FROM sophie_core.case_notes')).rows,
      (await f.admin.query('SELECT number, author_id, operator_grant, body, sha256, created_at_ms FROM sophie_core.case_notes')).rows);
    assert.deepEqual((await target.pool.query('SELECT * FROM sophie_core.case_label_changes')).rows,
      (await f.admin.query('SELECT * FROM sophie_core.case_label_changes')).rows);
    for (const table of ['case_replies', 'case_reply_events']) assert.deepEqual((await target.pool.query(`SELECT * FROM sophie_core.${table}`)).rows,
      (await f.admin.query(`SELECT * FROM sophie_core.${table}`)).rows);
    assert.deepEqual((await target.pool.query('SELECT priority, tags FROM sophie_core.case_reservations ORDER BY id')).rows,
      (await f.admin.query('SELECT priority, tags FROM sophie_core.case_reservations ORDER BY id')).rows);
    await assert.rejects(requireUnquarantinedDatabase(target.pool), /RECOVERY_QUARANTINED/);
    let contacted = false;
    await assert.rejects(createStagingRuntime({ configuration, pool: target.pool, token: 'unused', onFault() {},
      fetch() { contacted = true; }, connect() { contacted = true; } }), /RECOVERY_QUARANTINED/);
    assert.equal(contacted, false);
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
    await assert.rejects(target.pool.query("UPDATE sophie_core.outbox SET status = 'ready'"), error => error.code === '25006');
  });
  await run('RB04 source and nonempty target databases cannot be overwritten and prepared receipts cannot be forged', async () => {
    await assert.rejects(restoreRecoveryBundle({ prepared: await prepare(), pool: cluster.adminPool, database, tools }), /ISOLATED_RESTORE_REQUIRED/);
    const target = await cluster.recovery.createTarget(); await target.pool.query('CREATE TABLE public.sentinel (id int)');
    await assert.rejects(restoreRecoveryBundle({ prepared: await prepare(), pool: target.pool, database: target.configuration, tools }), /RESTORE_DATABASE_NOT_EMPTY/);
    assert.equal((await target.pool.query('SELECT count(*)::int AS total FROM public.sentinel')).rows[0].total, 0);
    await assert.rejects(restoreRecoveryBundle({ prepared: {}, pool: target.pool, database: target.configuration, tools }), /RESTORE_PREPARATION_REQUIRED/);
  });
  await run('RB05 damaged retained backup bytes fail authentication before a restored database can be populated', async () => {
    const path = resolve(backup.directory, `${original.retained_slot}.sealed`), saved = await readFile(path);
    const corrupted = Buffer.from(saved); corrupted[24] ^= 1; await writeFile(path, corrupted);
    try { await assert.rejects(prepare(), /BACKUP_AUTHENTICATION_FAILED/); } finally { await writeFile(path, saved); }
  });
  await run('RB06 missing or modified retained source files and absent vault mappings cannot complete a new backup', async () => {
    await assert.rejects(createRecoveryBundle({ ...options, vaultRoots: [] }), /BACKUP_VAULT_MISSING/);
    const path = resolve(f.vaultRoot, `${original.retained_slot}.blob`), saved = await readFile(path);
    const corrupted = Buffer.from(saved); corrupted[1] ^= 1; await writeFile(path, corrupted);
    try { await assert.rejects(createRecoveryBundle(options), /BACKUP_FILE_MISMATCH/); } finally { await writeFile(path, saved); }
  });
  await run('RB07 a concurrent committed attachment stays outside both the exported snapshot and its file manifest', async () => {
    const snapshotPool = { async connect() {
      const client = await cluster.adminPool.connect();
      return { release: discard => client.release(discard), async query(sql, ...args) {
        const result = await client.query(sql, ...args);
        if (sql === 'SELECT pg_export_snapshot() AS snapshot') {
          await f.addFile(); assert.equal((await f.attachmentWorker.runOnce('recovery-concurrent')).status, 'retained');
        }
        return result;
      } };
    } };
    const snapshotBackup = await createRecoveryBundle({ ...options, pool: snapshotPool }); assert.equal(snapshotBackup.artifacts, 1);
    const prepared = await prepare({ directory: snapshotBackup.directory, expectedManifestSha256: snapshotBackup.manifestSha256 });
    const target = await cluster.recovery.createTarget(); await restoreRecoveryBundle({ prepared, pool: target.pool, database: target.configuration, tools });
    assert.equal((await target.pool.query('SELECT count(*)::int AS total FROM sophie_core.case_attachment_jobs')).rows[0].total, 1);
    assert.equal((await f.jobs()).length, 2);
  });
  await run('RB08 the isolated operator CLI restores a selected authenticated bundle and reports only quarantine metadata', async () => {
    const target = await cluster.recovery.createTarget(), keyPath = resolve(parent, 'recovery-key.json');
    const databasePath = resolve(parent, 'recovery-target.json'), requestPath = resolve(parent, 'recovery-request.json');
    await writeFile(keyPath, JSON.stringify({ keyHex: key.toString('hex') }), { flag: 'wx' });
    await writeFile(databasePath, JSON.stringify(target.configuration), { flag: 'wx' });
    await writeFile(requestPath, JSON.stringify({ environment: 'staging', databasePath, keyPath, binaryRoot, parent,
      maxDatabaseBytes, confirmGuildId: GUILD, bundleDirectory: backup.directory, manifestSha256: backup.manifestSha256 }), { flag: 'wx' });
    try {
      const result = await promisify(execFile)(process.execPath, ['apps/core/recovery.mjs', 'restore', '--request', requestPath], { windowsHide: true, timeout: 60000 });
      const output = JSON.parse(result.stdout); assert.equal(output.productionReady, false); assert.equal(output.independentRecoveryVerified, false);
      assert.equal(output.database, target.configuration.database); assert.equal(output.tableCountsVerified, true);
      assert.equal(result.stdout.includes(key.toString('hex')), false); assert.equal(result.stderr, '');
    } finally { await unlink(keyPath); await unlink(databasePath); }
    await assert.rejects(requireUnquarantinedDatabase(target.pool), /RECOVERY_QUARANTINED/);
  });
  await run('RB09 an interrupted restore tool leaves a persistent quarantine fence and no imported case tables', async () => {
    const target = await cluster.recovery.createTarget();
    await assert.rejects(restoreRecoveryBundle({ prepared: await prepare(), pool: target.pool, database: target.configuration,
      tools: { ...tools, restore: resolve(parent, 'missing-pg-restore.exe') } }), /RECOVERY_POSTGRES_FAILED/);
    await assert.rejects(requireUnquarantinedDatabase(target.pool), /RECOVERY_QUARANTINED/);
    assert.equal((await target.pool.query("SELECT to_regclass('sophie_core.case_message_observations') IS NULL AS absent")).rows[0].absent, true);
  });
  await run('RB10 a source containing another guild cannot be labelled with the selected staging configuration', async () => {
    await f.admin.query("INSERT INTO sophie_core.case_budgets (guild_id) VALUES ('99')");
    try { await assert.rejects(createRecoveryBundle(options), /BACKUP_GUILD_MISMATCH/); }
    finally { await f.admin.query("DELETE FROM sophie_core.case_budgets WHERE guild_id = '99'"); }
  });
  key.fill(0);
}
