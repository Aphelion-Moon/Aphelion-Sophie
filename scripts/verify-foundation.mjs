import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sha256, sourceFiles } from './lib/repository-checks.mjs';

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
const inputs = [
  ...await sourceFiles(root), 'package.json', 'package-lock.json', '.node-version', '.npmrc', '.gitattributes', '.gitignore', 'AGENTS.md', 'LICENSE', 'README.md',
  'config/example.json', 'content/onboarding/definition.json', 'content/onboarding/preview.md',
  'contracts/README.md', 'docs/workplan.json', 'docs/workplan.md', 'docs/acceptance-cases.json', 'docs/verification.md', 'docs/case-contacts.md', 'docs/case-conversations.md',
  'docs/discovery.md', 'docs/decisions/0001-owner-policy.md', 'docs/decisions/0002-storage-candidate.md',
  'docs/decisions/0003-storage-dependencies.md', 'docs/storage.md', 'apps/core/storage/migrations/001-core.sql',
  'apps/core/storage/migrations/002-discord-backoff.sql',
  'apps/core/storage/migrations/003-member-actions.sql',
  'apps/core/storage/migrations/004-actor-authority.sql',
  'apps/core/storage/migrations/005-case-provisioning.sql',
  'apps/core/storage/migrations/006-gateway-journal.sql',
  'apps/core/storage/migrations/007-gateway-identify-budget.sql',
  'apps/core/storage/migrations/008-shuttle-case-binding.sql',
  'apps/core/storage/migrations/009-shuttle-screens.sql',
  'apps/core/storage/migrations/010-shuttle-assistance.sql',
  'apps/core/storage/migrations/011-shuttle-pause.sql',
  'apps/core/storage/migrations/012-shuttle-alerts.sql',
  'apps/core/storage/migrations/013-shuttle-delivery-issues.sql',
  'apps/core/storage/migrations/014-shuttle-artifact-recovery.sql',
  'apps/core/storage/migrations/015-case-channel-selection.sql',
  'apps/core/storage/migrations/016-case-lifecycle.sql',
  'apps/core/storage/migrations/017-case-staff.sql',
  'apps/core/storage/migrations/018-case-inspections.sql',
  'apps/core/storage/migrations/019-dashboard-auth.sql',
  'apps/core/storage/migrations/020-shuttle-authoring.sql',
  'apps/core/storage/migrations/021-case-intake.sql',
  'apps/core/storage/migrations/022-case-intake-delivery.sql',
  'apps/core/storage/migrations/023-case-delivery-issues.sql',
  'apps/core/storage/migrations/024-case-form-authoring.sql',
  'apps/core/storage/migrations/025-player-reports.sql',
  'apps/core/storage/migrations/026-case-participant-presence.sql',
  'apps/core/storage/migrations/027-case-participants.sql',
  'apps/core/storage/migrations/028-staff-contact-intake.sql',
  'apps/core/storage/migrations/029-case-conversations.sql',
  'apps/core/storage/migrations/030-case-attachments.sql',
  'docs/case-attachments.md',
  'docs/discord-delivery.md',
  'docs/command-authorization.md',
  'docs/case-delivery.md',
  'docs/case-intake.md',
  'docs/player-reports.md',
  'docs/case-participant-authority.md',
  'docs/case-participants.md',
  'docs/case-intake-delivery.md',
  'docs/case-delivery-issues.md', 'docs/case-form-authoring.md',
  'docs/case-lifecycle.md',
  'docs/case-staff.md',
  'docs/case-inspections.md',
  'docs/dashboard-auth.md',
  'docs/shuttle-authoring.md',
  'docs/dashboard-ui.md', 'docs/dashboard-forms.md', 'apps/dashboard/index.html', 'apps/dashboard/ticket-forms.html', 'apps/dashboard/styles.css',
  'Sophie-Visual-Assets-v1/asset-manifest.json', 'Sophie-Visual-Assets-v1/brand-profile.json',
  'Sophie-Visual-Assets-v1/assets/sophie/neon-chibi-v1/sophie-avatar.png',
  'docs/gateway-continuity.md',
  'docs/shuttle-entry.md',
  'docs/shuttle-screens.md',
  'docs/shuttle-assistance.md',
  'docs/shuttle-pause.md',
  'docs/shuttle-alerts.md',
  'docs/shuttle-delivery-issues.md',
  'docs/shuttle-artifact-recovery.md',
  'docs/shuttle-channel-selection.md',
  'legal/DEPENDENCIES.json', 'legal/THIRD-PARTY-NOTICES', 'ops/windows/Get-SophieInventory.ps1',
  'legal/storage-packages.json', 'legal/postgresql-test-runtime.json',
  'Sophie-Implementation-Plans-v1.1/SHA256SUMS.txt', 'Sophie-Implementation-Plans-v1.1/shuttle-onboarding.md',
];
const dependencies = JSON.parse(await readFile(resolve(root, 'legal/storage-packages.json'), 'utf8'));
inputs.push(...dependencies.packages.map(item => item.noticePath));
const files = [];
for (const path of inputs.sort()) files.push({ path, sha256: sha256(await readFile(resolve(root, path))) });
const buildId = sha256(JSON.stringify(files));
const report = {
  schemaVersion: 1, recordedAt: new Date().toISOString(), buildId,
  scope: 'Offline domain foundation; no production gate is passed by this report',
  runtime: { version: process.version, binarySha256: sha256(await readFile(process.execPath)) },
  configurationSchemaVersion: 1, tester: 'Codex local automated execution; no independent human sign-off',
  tests, repository,
  checks: { syntheticDemo: 'passed', offlinePreflight: 'passed', productionActivation: 'rejected_as_expected_exit_2' },
  notRun: ['Live Discord integration and role/ACL tests', 'PostgreSQL integration is separately recorded in storage-verification.json', 'Live OAuth/TLS/browser and full dashboard acceptance; synthetic editor browser checks are documented separately', 'Windows service identity/ACL isolation', 'Off-host backup/restore, power-loss and host reboot drills', 'Model, shared-host benchmark and AI evaluation', 'Production deployment and independent visual/accessibility acceptance'],
};
if (process.argv.includes('--record')) {
  await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
  await writeFile(resolve(root, 'docs/evidence/foundation-source-manifest.json'), `${JSON.stringify({ buildId, files }, null, 2)}\n`);
  await writeFile(resolve(root, 'docs/evidence/foundation-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ buildId, tests, repository, productionReady: false, evidenceRecorded: process.argv.includes('--record') }, null, 2));
