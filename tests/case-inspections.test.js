import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaseInspectionStore } from '../apps/core/storage/case-inspections.js';
import { createCaseReconciler } from '../apps/core/discord/case-reconciler.js';
import { casePolicy } from './fixtures/cases.js';

test('case inspection scheduling requires bounded trusted configuration', () => {
  for (const change of [{ batchSize: 26 }, { batchSize: 0 }, { intervalMs: 59_999 }, { intervalMs: 86_400_001 },
    { batchDelayMs: 0 }, { batchDelayMs: 60_001 }, { intervalMs: '60000' }]) {
    assert.throws(() => createCaseInspectionStore({ pool: {}, policy: casePolicy, ...change }), /INVALID_INTEGER/);
  }
  assert.throws(() => createCaseReconciler({ store: {}, enabled: () => true }), /TRUSTED_ADAPTERS_REQUIRED/);
});

test('disabled case reconciliation does not touch storage or queue a retry', async () => {
  let calls = 0;
  const worker = createCaseReconciler({ store: { queueCaseInspections: async () => calls++ }, enabled: () => false });
  assert.deepEqual(await worker.runOnce(), { status: 'disabled' }); assert.equal(calls, 0);
});

test('overlapping case reconciliation ticks do not accumulate a local backlog', async () => {
  let release, calls = 0;
  const worker = createCaseReconciler({ enabled: () => true, store: { queueCaseInspections: () => {
    calls++; return new Promise(resolve => { release = resolve; });
  } } });
  const first = worker.runOnce(); await Promise.resolve();
  assert.deepEqual(await worker.runOnce(), { status: 'busy' }); assert.equal(calls, 1);
  release({ status: 'idle' }); assert.deepEqual(await first, { status: 'idle' });
});

test('an uncertain scheduling result propagates without pretending success or retrying its transaction', async () => {
  let calls = 0;
  const worker = createCaseReconciler({ enabled: () => true, store: { queueCaseInspections: async () => {
    if (++calls === 1) throw new Error('SYNTHETIC_COMMIT_RESPONSE_LOST');
    return { status: 'waiting', waitMs: 9_000 };
  } } });
  await assert.rejects(worker.runOnce(), /SYNTHETIC_COMMIT_RESPONSE_LOST/); assert.equal(calls, 1);
  assert.deepEqual(await worker.runOnce(), { status: 'waiting', waitMs: 9_000 });
});
