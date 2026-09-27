import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';
import { sha256 } from './repository-checks.mjs';
import { createDatabasePool } from '../../apps/core/storage/pool.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';

const root = resolve(import.meta.dirname, '../..');
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
function invoke(executable, args) {
  try { return execFileSync(executable, args,
    { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: safeEnv, stdio: 'pipe' }); }
  catch { throw new Error(`POSTGRES_TEST_COMMAND_FAILED:${executable.split(/[\\/]/).at(-1)}`); }
}

/** Await only the owned cluster's control process; keep Windows handles detached and fsync enabled. */
function control(executable, args) {
  // The full suite has measured a 53-second durable shutdown checkpoint. Async waiting
  // permits progress reporting; a timeout is still failure, never evidence of shutdown.
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-t', '90', ...args], { windowsHide: true, timeout: 95_000, env: safeEnv, stdio: 'ignore' });
    const failed = () => reject(new Error('POSTGRES_TEST_COMMAND_FAILED:pg_ctl.exe'));
    child.once('error', failed); child.once('close', code => { if (code === 0) resolve(); else failed(); });
  });
}

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
  const identity = invoke('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
  const sid = /S-1-[\d-]+/.exec(identity)?.[0];
  if (!sid) throw new Error('TEST_IDENTITY_UNKNOWN');
  invoke('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
  const password = randomBytes(32).toString('hex');
  const corePassword = randomBytes(32).toString('hex');
  const knowledgePassword = randomBytes(32).toString('hex');
  const passwordFile = resolve(directory, 'init-password');
  await writeFile(passwordFile, `${password}\n`, { flag: 'wx' });
  const data = resolve(directory, 'data');
  const executable = name => resolve(binaryRoot, 'bin', `${name}.exe`);
  invoke(executable('initdb'), ['-D', data, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--username=sophie_test_admin', `--pwfile=${passwordFile}`]);
  const port = await freePort();
  const configuration = { host: '127.0.0.1', port, database: `sophie_test_${randomBytes(8).toString('hex')}`, user: 'sophie_test_admin', password };
  const ctlOptions = ['-D', data, '-l', resolve(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=16 -c shared_buffers=16MB -c log_statement=none -c log_min_error_statement=panic`, '-w'];
  const pools = new Set();
  let running = false;
  const newPool = config => { const pool = createDatabasePool(config, () => {}); pools.add(pool); return pool; };
  async function closePools() {
    await Promise.all([...pools].map(pool => pool.ended ? undefined : pool.end()));
    pools.clear();
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
    await control(executable('pg_ctl'), [...ctlOptions, 'start']);
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
    const coreConfiguration = { ...configuration, user: 'sophie_test_core', password: corePassword };
    return {
      adminPool, corePool: newPool(coreConfiguration),
      knowledgePool: newPool({ ...configuration, user: 'sophie_test_knowledge', password: knowledgePassword }),
      runtime, stop,
      // Recovery tests receive only this freshly generated cluster's identity, never an existing login.
      recovery: { configuration: { ...configuration }, binaryRoot, directory,
        async createHistoricalSource() {
          const database = `sophie_test_${randomBytes(12).toString('hex')}`;
          await adminPool.query(`CREATE DATABASE ${database}`);
          await adminPool.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
          const target = { ...configuration, database };
          return { configuration: target, pool: newPool(target), corePool: newPool({ ...target, user: 'sophie_test_core', password: corePassword }) };
        },
        async createTarget() {
          const database = `sophie_restore_${randomBytes(12).toString('hex')}`;
          await adminPool.query(`CREATE DATABASE ${database}`);
          await adminPool.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
          const target = { ...configuration, database };
          return { configuration: target, pool: newPool(target) };
        } },
      async checkpoint() {
        // Fixture TRUNCATE churn can otherwise leave over 100,000 files to sync at shutdown.
        // Only between independent suites; never inside a scenario, and never relax durability.
        const client = await adminPool.connect();
        try { await client.query("SET statement_timeout = '120s'"); await client.query('CHECKPOINT'); }
        finally { client.release(true); }
      },
      async restart() {
        await closePools();
        await control(executable('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']); running = false;
        // Track startup before awaiting it so a lost acknowledgement still requires cleanup.
        running = true; await control(executable('pg_ctl'), [...ctlOptions, 'start']);
        return { adminPool: newPool(configuration), corePool: newPool(coreConfiguration) };
      },
    };
  } catch (error) { await stop(); throw error; }
}
