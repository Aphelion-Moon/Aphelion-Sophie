import assert from 'node:assert/strict';

/** Existing suites close through the versioned service and await verified permissions. */
export async function closeTestCase({ store, actor, observation, interactionId, id, worker }) {
  const current = await store.describeCase({ actor, guildId: observation.guildId, id });
  await store.closeCase({ actor, observation, interactionId, id, expectedVersion: current.version, reason: 'resolved' });
  for (let index = 0; index < 60; index++) {
    const result = await worker.runOnce('case-closure-test');
    if (result.status === 'idle') return;
    assert.ok(['settled', 'progressed'].includes(result.status), `${result.status}/${result.code}`);
  }
  assert.fail('Case closure did not settle');
}

export function ticketPayload(f, action, record, overrides = {}) {
  const options = action === 'status' ? (record ? [{ type: 3, name: 'case', value: record.id }] : []) : [
    { type: 3, name: 'case', value: `${record.id}@${record.version}` },
    { type: 3, name: 'reason', value: action === 'close' ? 'resolved' : 'follow-up' },
  ];
  return f.payload({ data: { type: 1, name: 'ticket', options: [{ type: 1, name: action, options }] }, ...overrides });
}
