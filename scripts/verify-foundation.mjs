import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  if (result.status !== expectedStatus) throw new Error(`Verification command failed: node ${args.join(' ')}\n${result.error?.message ?? result.stderr}\n${result.stdout}`);
  return result.stdout;
}
const repository = JSON.parse(run(['scripts/check-repository.mjs']));
const tap = run(['--test', '--test-concurrency=1', '--test-reporter=tap', 'tests/*.test.js']);
const count = label => {
  const match = new RegExp(`^# ${label} (\\d+)$`, 'm').exec(tap);
  if (!match) throw new Error('TEST_REPORT_FORMAT_UNRECOGNISED');
  return Number(match[1]);
};
const tests = { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped') };
if (tests.failed || tests.skipped || tests.passed !== tests.total) throw new Error('FOUNDATION_TESTS_INCOMPLETE');
const demo = run(['scripts/demo-onboarding.mjs']);
if (!demo.includes('pending grant rejected') || !demo.includes('complete after role observation')) throw new Error('DEMO_INCOMPLETE');
const offline = JSON.parse(run(['apps/core/preflight.mjs']));
const production = JSON.parse(run(['apps/core/preflight.mjs', '--production'], 2));
if (offline.productionReady || production.deliveryEnabled || production.assistantEnabled) throw new Error('UNSAFE_PREFLIGHT');
console.log(JSON.stringify({ tests, repository }, null, 2));