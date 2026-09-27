import { spawn, execFileSync } from 'node:child_process';
import { mkdir, realpath, lstat, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, isAbsolute, relative } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** New operator-owned directories only; no recursive delete, inherited broad ACL or reused destination. */
export async function createRecoveryDirectory(parent, prefix) {
  requireCondition(isAbsolute(parent) && /^[a-z-]{1,32}$/.test(prefix), 'RECOVERY_PATH_INVALID');
  requireCondition(process.platform === 'win32', 'WINDOWS_RECOVERY_REQUIRED');
  const base = await realpath(parent);
  requireCondition((await lstat(parent)).isDirectory() && !(await lstat(parent)).isSymbolicLink(), 'RECOVERY_PATH_INVALID');
  const directory = resolve(base, `${prefix}-${randomBytes(16).toString('hex')}`); await mkdir(directory, { mode: 0o700 });
  const within = relative(base, await realpath(directory));
  requireCondition(within && !within.startsWith('..') && !isAbsolute(within), 'RECOVERY_PATH_INVALID');
  try {
    const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' });
    const sid = /S-1-[\d-]+/.exec(identity)?.[0]; requireCondition(sid, 'RECOVERY_IDENTITY_UNKNOWN');
    execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'],
      { windowsHide: true, stdio: 'pipe' });
  } catch { throw new ContractError('RECOVERY_DIRECTORY_ACL_FAILED'); }
  return directory;
}

/** Existing PostgreSQL test distribution only. No PATH lookup, downloads or production-distribution approval. */
export async function reviewedRecoveryTools(binaryRoot) {
  const base = await realpath(binaryRoot);
  const review = JSON.parse(await readFile(new URL('../../../legal/postgresql-test-runtime.json', import.meta.url), 'utf8'));
  for (const entry of review.files) {
    requireCondition(createHash('sha256').update(await readFile(resolve(base, entry.path))).digest('hex') === entry.sha256, 'POSTGRES_RUNTIME_REVIEW_REQUIRED');
  }
  requireCondition(['pg_dump', 'pg_restore'].every(name => review.files.some(entry => entry.path === `bin/${name}.exe`)), 'POSTGRES_RUNTIME_REVIEW_REQUIRED');
  return Object.freeze({ dump: resolve(base, 'bin/pg_dump.exe'), restore: resolve(base, 'bin/pg_restore.exe'), version: review.version });
}

/** Fixed PostgreSQL child processes only; credential contents never appear in argv, stderr or returned errors. */
export async function postgresEnvironment(database) {
  // Keep even temporary connection credentials outside the backup destination tree.
  const directory = await createRecoveryDirectory(tmpdir(), 'sophie-recovery');
  const path = resolve(directory, `pass-${randomBytes(12).toString('hex')}`);
  const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  requireCondition(!/[\r\n\0]/.test(database.password), 'DATABASE_PASSWORD_REQUIRED');
  await writeFile(path, [database.host, database.port, database.database, database.user, database.password].map(escape).join(':') + '\n', { flag: 'wx', mode: 0o600 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^PG/i.test(name)));
  return { env: { ...env, PGPASSFILE: path, PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'sophie-recovery' },
    close: () => unlink(path) };
}
export function runPostgres(executable, args, env) {
  const child = spawn(executable, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Node's spawn timeout can survive an executable-not-found error (no exit event).
  const timeout = setTimeout(() => child.kill(), 900000); timeout.unref();
  let diagnostics = false; child.stderr.on('data', () => { diagnostics = true; });
  const done = new Promise((yes, no) => {
    child.once('error', () => { clearTimeout(timeout); no(new ContractError('RECOVERY_POSTGRES_FAILED')); });
    child.once('close', code => { clearTimeout(timeout); if (code === 0 && !diagnostics) yes(); else no(new ContractError('RECOVERY_POSTGRES_FAILED')); });
  });
  // Callers may be consuming stdout before awaiting completion.
  done.catch(() => {});
  return { chunks: child.stdout, done, stop: async () => { child.kill(); await done.catch(() => {}); } };
}
