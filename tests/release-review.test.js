import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = new URL('../scripts/build-release-verification.mjs', import.meta.url);
const generate = output => execFileSync(process.execPath, [fileURLToPath(script), '--output', output], { encoding: 'utf8', stdio: 'pipe' });
async function fixture(work) {
  const parent = resolve(tmpdir()), directory = await mkdtemp(join(parent, 'sophie-release-review-'));
  try { await work(join(directory, 'review.json')); }
  finally {
    assert.equal(dirname(directory), parent); assert.ok(basename(directory).startsWith('sophie-release-review-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('release review follows the selected provider without closing or dropping acceptance gates', async () => fixture(async output => {
  generate(output); generate(output); // An untouched generated ledger can be refreshed.
  const review = JSON.parse(await readFile(output, 'utf8'));
  const rows = new Map(review.rows.map(row => [row.id, row]));
  assert.equal(rows.size, 117);
  assert.deepEqual(review.rows.filter(row => row.kind === 'Acceptance test').map(row => row.id),
    Array.from({ length: 60 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`));
  assert.equal(review.requirements.length, 18);
  assert.match(review.requirements.find(item => item.id === 'R10').referenceTitle, /Local CPU inference/);
  assert.match(review.requirements.find(item => item.id === 'R10').title, /approved inference provider/);
  assert.match(rows.get('D07').prerequisite, /DeepSeek Flash/);
  assert.match(rows.get('T31').procedure, /provider\/model ID/);
  assert.match(rows.get('T32').expected, /does not establish anonymity/);
  assert.match(rows.get('T33').procedure, /provider latency\/outage\/cancellation/);
  assert.match(rows.get('G4').expected, /SAI-G/);
  assert.equal(rows.get('P08').readiness, 'Work remains');
  assert.match(rows.get('P08').procedure, /Independent live authentication/);
  assert.equal(review.selectedAiCapabilities.length, 7);
  assert.equal(review.productionReady, false);
  assert.ok(review.rows.every(row => row.result === 'Not run' && !row.actual && !row.evidence && !row.reviewer && !row.runDate && !row.runContext));
  assert.ok(Object.hasOwn(review.sources, 'scripts/build-release-verification.mjs'));
}));

test('regeneration refuses every human-result field and preserves the existing bytes', async () => fixture(async output => {
  generate(output);
  const blank = JSON.parse(await readFile(output, 'utf8'));
  for (const [field, value] of Object.entries({ result: 'Passed', actual: 'Synthetic observed outcome', evidence: 'synthetic-evidence', reviewer: 'Synthetic reviewer', runDate: '2026-10-04', runContext: 'Synthetic build' })) {
    const previous = structuredClone(blank); previous.rows.find(row => row.id === 'D07')[field] = value;
    const bytes = JSON.stringify(previous);
    await writeFile(output, bytes);
    assert.throws(() => generate(output), /RELEASE_HUMAN_RESULTS_RECONCILIATION_REQUIRED/);
    assert.equal(await readFile(output, 'utf8'), bytes, field);
  }
  await writeFile(output, '{"operator-note":"unrecognised existing document"}');
  assert.throws(() => generate(output), /RELEASE_HUMAN_RESULTS_RECONCILIATION_REQUIRED/);
  assert.equal(await readFile(output, 'utf8'), '{"operator-note":"unrecognised existing document"}');
}));
