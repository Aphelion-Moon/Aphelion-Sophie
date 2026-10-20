// Development loop for the isolated PostgreSQL suites: shards run at once, each on its own cluster. Suites are handed
// out one at a time, longest first by recorded time, to whichever shard is free, so shards finish together.
// Each shard writes its own log; the sequential `node scripts/test-storage.mjs` remains the plain full run.
import { spawn } from 'node:child_process';
import { availableParallelism, constants, setPriority } from 'node:os';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// Leave most of the machine free: a quarter of the logical cores by default (at most 4), never more than half.
const cores = availableParallelism(), limit = Math.max(1, Math.floor(cores / 2));
const requested = process.argv.find(value => value.startsWith('--shards='))?.slice(9) ?? null;
if (process.argv.slice(2).some(value => !value.startsWith('--shards='))) throw new Error('UNKNOWN_PARALLEL_STORAGE_ARGUMENT');
const count = requested === null ? Math.min(4, Math.max(1, Math.floor(cores / 4))) : Number(requested);
if (!Number.isSafeInteger(count) || count < 1 || count > limit) throw new Error(`PARALLEL_SHARDS_OUT_OF_RANGE: 1-${limit}`);
setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);

const logs = resolve(root, '.local/postgres-tests', `parallel-${new Date().toISOString().replace(/[:.]/gu, '-')}`);
await mkdir(logs, { recursive: true });
const started = Date.now();
let recorded = {};
try { recorded = JSON.parse(await readFile(resolve(root, '.local/storage-suite-timings.json'), 'utf8')); } catch { /* First run: unknown suites count as one minute. */ }
const cost = name => Number.isSafeInteger(recorded[name]) && recorded[name] > 0 ? recorded[name] : 60_000;
let pending = null; // Suite names still to hand out, longest first; set from the first shard's announcement.
console.log(`Running ${count} storage shards below normal priority (${cores} logical cores). Logs: ${logs}`);

function runShard(index) {
  return new Promise(async (resolveShard, reject) => {
    const log = await open(resolve(logs, `shard-${index}.log`), 'w');
    const child = spawn(process.execPath, ['scripts/test-storage.mjs', '--worker', '--keep-going'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.on('message', message => {
      if (Array.isArray(message?.suites) && pending === null) pending = [...message.suites].sort((a, b) => cost(b) - cost(a));
      child.send(pending?.shift() ?? null);
    });
    let text = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { text += chunk; void log.write(chunk); });
    child.on('error', reject);
    child.on('close', async code => {
      await log.close();
      const lines = text.split(/\r?\n/u), passed = lines.filter(line => line.startsWith('PASS ')).length;
      const failed = lines.filter(line => line.startsWith('FAIL ')).map(line => line.slice(5));
      const skipped = lines.filter(line => line.startsWith('SKIPPED remaining scenarios of ')).map(line => line.slice(31));
      const reasons = lines.filter(line => line.startsWith('REASON ')).map(line => line.slice(7));
      const timings = Object.fromEntries(lines.map(line => /^TIMING (run[A-Za-z]+Suite) (\d+)$/u.exec(line)).filter(Boolean).map(match => [match[1], Number(match[2])]));
      // A crash outside a scenario (cluster start-up, for example) shows as a non-zero exit with no FAIL line.
      const crashed = code !== 0 && failed.length === 0;
      console.log(`Shard ${index}/${count}: ${passed} passed, ${failed.length} failed${crashed ? ', stopped outside a scenario' : ''} (${Math.round((Date.now() - started) / 1000)} s)`);
      resolveShard({ index, code, passed, failed, skipped, reasons, timings, crashed });
    });
  });
}

const shards = await Promise.all(Array.from({ length: count }, (_, offset) => runShard(offset + 1)));
let previous = {};
try { previous = JSON.parse(await readFile(resolve(root, '.local/storage-suite-timings.json'), 'utf8')); } catch { /* First run. */ }
const timings = Object.assign(previous, ...shards.map(shard => shard.timings));
await writeFile(resolve(root, '.local/storage-suite-timings.json'), `${JSON.stringify(timings, null, 2)}\n`);

const failed = shards.flatMap(shard => shard.failed.map(name => `shard ${shard.index}: ${name}`));
const crashed = shards.filter(shard => shard.crashed).map(shard => `shard ${shard.index} (see shard-${shard.index}.log)`);
const slowest = Object.entries(timings).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, ms]) => `${name} ${Math.round(ms / 1000)} s`);
console.log(JSON.stringify({ shards: count, wallSeconds: Math.round((Date.now() - started) / 1000), passed: shards.reduce((sum, shard) => sum + shard.passed, 0),
  failed, reasons: shards.flatMap(shard => shard.reasons), skippedSuites: shards.flatMap(shard => shard.skipped), crashed, slowest, logs, productionReady: false }, null, 2));
if (failed.length > 0 || crashed.length > 0) process.exitCode = 1;
