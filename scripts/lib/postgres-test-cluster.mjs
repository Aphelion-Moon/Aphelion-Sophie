import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { getPriority, setPriority } from 'node:os';
import pg from 'pg';
import { sha256 } from './repository-checks.mjs';
import { createDatabasePool } from '../../apps/core/storage/pool.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';

const root = resolve(import.meta.dirname, '../..');
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
// Windows tools by absolute path: a shell's PATH (Git Bash ships its own whoami.exe) must not choose them.
const system32 = name => resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32', name);
function invoke(executable, args) {
  try { return execFileSync(executable, args,
    { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: safeEnv, stdio: 'pipe' }); }
  catch { throw new Error(`POSTGRES_TEST_COMMAND_FAILED:${executable.split(/[\\/]/).at(-1)}`); }
}

/** Await only the owned cluster's control process; keep Windows handles detached. */
function control(executable, args) {
  // The full suite has measured a 53-second durable shutdown checkpoint. Async waiting
  // permits progress reporting; a timeout is still failure, never evidence of shutdown.
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-t', '90', ...args], { windowsHide: true, timeout: 95_000, env: safeEnv, stdio: 'ignore' });
    const failed = () => reject(new Error('POSTGRES_TEST_COMMAND_FAILED:pg_ctl.exe'));
    child.once('error', failed); child.once('close', code => { if (code === 0) resolve(); else failed(); });
  });
}

// The AI, knowledge and configuration suites' own suite-level grants (see those suites), fixed text only.
const SUITE_BASELINE_GRANTS = Object.freeze([
  'GRANT USAGE ON SCHEMA sophie_ai TO sophie_test_core',
  'GRANT SELECT,INSERT,UPDATE ON sophie_ai.state,sophie_ai.publications,sophie_ai.consents,sophie_ai.request_receipts,sophie_ai.request_tombstones TO sophie_test_core',
  'GRANT SELECT,INSERT,UPDATE,DELETE ON sophie_ai.effects TO sophie_test_core',
  'GRANT SELECT ON sophie_ai.qualifications TO sophie_test_core',
  'GRANT SELECT,INSERT,UPDATE ON sophie_ai.budget_policies,sophie_ai.budget_periods,sophie_ai.provider_attempts,sophie_ai.budget_hold_receipts TO sophie_test_core',
  'GRANT DELETE ON sophie_ai.budget_periods,sophie_ai.provider_attempts TO sophie_test_core',
  'GRANT SELECT,INSERT,UPDATE ON sophie_ai.response_preferences TO sophie_test_core',
  'GRANT SELECT,INSERT,UPDATE,DELETE ON sophie_ai.consents,sophie_ai.request_receipts,sophie_ai.request_tombstones,sophie_ai.effect_erasure,sophie_ai.response_preferences TO sophie_test_core',
  'GRANT USAGE ON SCHEMA sophie_knowledge TO sophie_test_knowledge',
  'GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sophie_knowledge TO sophie_test_knowledge',
  'GRANT USAGE ON SCHEMA sophie_migrations TO sophie_test_core',
  'GRANT SELECT ON sophie_migrations.applied TO sophie_test_core',
]);

async function freePort() {
  const listener = createServer();
  await new Promise((yes, no) => { listener.once('error', no); listener.listen(0, '127.0.0.1', yes); });
  const port = listener.address().port;
  await new Promise((yes, no) => listener.close(error => error ? no(error) : yes()));
  return port;
}

/** Creates only a new synthetic cluster; never accepts existing database credentials. */
export async function createTestCluster() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_TEST_RUNTIME_REQUIRED');
  const local = JSON.parse(await readFile(resolve(root, '.local/postgres-runtime.json'), 'utf8'));
  const runtime = JSON.parse(await readFile(resolve(root, 'legal/postgresql-test-runtime.json'), 'utf8'));
  const binaryRoot = await realpath(local.binaryRoot);
  for (const file of runtime.files) {
    if (sha256(await readFile(resolve(binaryRoot, file.path))) !== file.sha256) throw new Error('POSTGRES_RUNTIME_REVIEW_REQUIRED');
  }
  const base = resolve(root, '.local/postgres-tests');
  await mkdir(base, { recursive: true });
  const directory = resolve(base, `run-${randomUUID()}`);
  await mkdir(directory);
  const within = relative(await realpath(base), await realpath(directory));
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('TEST_PATH_ESCAPE');
  // Restrict only this new run directory, before writing passwords or database files.
  const identity = invoke(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
  const sid = /S-1-[\d-]+/.exec(identity)?.[0];
  if (!sid) throw new Error('TEST_IDENTITY_UNKNOWN');
  invoke(system32('icacls.exe'), [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
  const password = randomBytes(32).toString('hex');
  const corePassword = randomBytes(32).toString('hex');
  const knowledgePassword = randomBytes(32).toString('hex');
  const passwordFile = resolve(directory, 'init-password');
  await writeFile(passwordFile, `${password}\n`, { flag: 'wx' });
  const data = resolve(directory, 'data');
  const executable = name => resolve(binaryRoot, 'bin', `${name}.exe`);
  invoke(executable('initdb'), ['-D', data, '--no-sync', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--username=sophie_test_admin', `--pwfile=${passwordFile}`]);
  const port = await freePort();
  const configuration = { host: '127.0.0.1', port, database: `sophie_test_${randomBytes(8).toString('hex')}`, user: 'sophie_test_admin', password };
  const ctlOptions = ['-D', data, '-l', resolve(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=16 -c shared_buffers=16MB -c log_statement=none -c log_min_error_statement=panic` +
    // Owner decision, 20 October 2026: these throwaway synthetic clusters need not survive a host crash. Every stop and
    // restart here is a clean (fast) shutdown, so restart scenarios still prove recovery from committed state.
    ' -c fsync=off -c synchronous_commit=off -c full_page_writes=off', '-w'];
  const pools = new Set();
  let running = false;
  const newPool = config => { const pool = createDatabasePool(config, () => {}); pools.add(pool); return pool; };
  async function closePools() {
    await Promise.all([...pools].map(pool => pool.ended ? undefined : pool.end()));
    pools.clear();
  }
  // pg_ctl does not pass on a lowered priority. A parallel shard runs below normal, so lower the postmaster to match
  // before any connection exists; backends it starts later inherit it. A normal-priority run changes nothing.
  async function matchPriority() {
    const own = getPriority(0); if (own <= 0) return;
    // The first line of postmaster.pid is the server's process ID.
    const pid = Number.parseInt(await readFile(resolve(data, 'postmaster.pid'), 'utf8'), 10);
    if (Number.isSafeInteger(pid) && pid > 0) setPriority(pid, own);
  }
  async function stop() {
    await closePools();
    if (running) { await control(executable('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']); running = false; }
    // Keep the protected synthetic data for diagnosis; no recursive deletion or production cleanup.
    await writeFile(passwordFile, 'retired\n');
    await writeFile(resolve(directory, 'STOPPED'), `${new Date().toISOString()}\n`);
  }
  try {
    running = true;
    await control(executable('pg_ctl'), [...ctlOptions, 'start']); await matchPriority();
    const bootstrap = new pg.Client({ ...configuration, database: 'postgres', ssl: false, connectionTimeoutMillis: 5_000 });
    try {
      await bootstrap.connect();
      // Generated hex names/passwords only; no external SQL identifiers or input here.
      await bootstrap.query(`CREATE DATABASE ${configuration.database}`);
      await bootstrap.query(`CREATE ROLE sophie_test_core LOGIN PASSWORD '${corePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await bootstrap.query(`CREATE ROLE sophie_test_knowledge LOGIN PASSWORD '${knowledgePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
      await bootstrap.query(`REVOKE ALL ON DATABASE ${configuration.database} FROM PUBLIC`);
      await bootstrap.query(`GRANT CONNECT ON DATABASE ${configuration.database} TO sophie_test_core, sophie_test_knowledge`);
    } finally { await bootstrap.end(); }
    const adminPool = newPool(configuration);
    await migrateCore(adminPool);
    await adminPool.query('GRANT USAGE ON SCHEMA sophie_core TO sophie_test_core');
    await adminPool.query('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA sophie_core TO sophie_test_core');
    // Grants that suites used to leave behind for the suites after them, applied once here so suites can run in any
    // order on any shard (test-storage-parallel.mjs schedules them dynamically). The suites still issue their own.
    for (const statement of SUITE_BASELINE_GRANTS) await adminPool.query(statement);
    const coreConfiguration = { ...configuration, user: 'sophie_test_core', password: corePassword };
    const knowledgeConfiguration = { ...configuration, user: 'sophie_test_knowledge', password: knowledgePassword };
    // The migrated database becomes a template that no suite uses directly; see fresh().
    const template = configuration.database;
    const cluster = {
      adminPool, corePool: newPool(coreConfiguration), knowledgePool: newPool(knowledgeConfiguration),
      runtime, stop,
      // Recovery tests receive only this freshly generated cluster's identity, never an existing login.
      recovery: { get configuration() { return { ...configuration }; }, binaryRoot, directory,
        async createHistoricalSource() {
          const database = `sophie_test_${randomBytes(12).toString('hex')}`;
          await cluster.adminPool.query(`CREATE DATABASE ${database}`);
          await cluster.adminPool.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
          const target = { ...configuration, database };
          return { configuration: target, pool: newPool(target), corePool: newPool({ ...target, user: 'sophie_test_core', password: corePassword }) };
        },
        async createTarget() {
          const database = `sophie_restore_${randomBytes(12).toString('hex')}`;
          await cluster.adminPool.query(`CREATE DATABASE ${database}`);
          await cluster.adminPool.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
          const target = { ...configuration, database };
          return { configuration: target, pool: newPool(target) };
        } },
      async checkpoint() {
        // Fixture TRUNCATE churn can otherwise leave over 100,000 files to sync at shutdown.
        // Only between independent suites; never inside a scenario.
        const client = await cluster.adminPool.connect();
        // Parallel shards share the disk, so a large checkpoint may take a while; the timeout is generous.
        try { await client.query("SET statement_timeout = '300s'"); await client.query('CHECKPOINT'); }
        finally { client.release(true); }
      },
      /**
       * Gives the next suite its own copy of the migrated template, so nothing a suite changes (rows, grants, dropped or
       * replayed tables, triggers) reaches another, in whatever order or shard they run. The previous suite's copy is
       * dropped unless keepPrevious (a failed suite's data is kept for diagnosis).
       */
      async fresh({ keepPrevious = false } = {}) {
        await closePools();
        const previous = configuration.database === template ? null : configuration.database;
        const database = `sophie_test_suite_${randomBytes(8).toString('hex')}`; // Isolated-backup tooling accepts only sophie_test_* names.
        const client = new pg.Client({ ...configuration, database: 'postgres', ssl: false, connectionTimeoutMillis: 5_000 });
        await client.connect();
        try {
          // Generated hex names only.
          if (previous && !keepPrevious) await client.query(`DROP DATABASE ${previous} WITH (FORCE)`);
          await client.query(`CREATE DATABASE ${database} TEMPLATE ${template} STRATEGY FILE_COPY`);
          // A database's own privileges are not copied from its template.
          await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
          await client.query(`GRANT CONNECT ON DATABASE ${database} TO sophie_test_core, sophie_test_knowledge`);
        } finally { await client.end(); }
        for (const target of [configuration, coreConfiguration, knowledgeConfiguration]) target.database = database;
        Object.assign(cluster, { adminPool: newPool(configuration), corePool: newPool(coreConfiguration), knowledgePool: newPool(knowledgeConfiguration) });
      },
      async restart() {
        await closePools();
        await control(executable('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']); running = false;
        // Track startup before awaiting it so a lost acknowledgement still requires cleanup.
        running = true; await control(executable('pg_ctl'), [...ctlOptions, 'start']); await matchPriority();
        // Suites run in any order, so the cluster's own pools are replaced too: a later suite must not get ended pools.
        Object.assign(cluster, { adminPool: newPool(configuration), corePool: newPool(coreConfiguration), knowledgePool: newPool(knowledgeConfiguration) });
        return { adminPool: cluster.adminPool, corePool: cluster.corePool };
      },
    };
    return cluster;
  } catch (error) { await stop(); throw error; }
}
