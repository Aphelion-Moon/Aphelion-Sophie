import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelsController } from '../apps/dashboard/labels-controller.js';
import { DashboardFailure } from '../apps/dashboard/api.js';

function fixture() {
  const state = { identity: { userId: '11', guildId: '12' }, version: 1, priority: 'normal', tags: [], saves: [], failure: null };
  const api = { session: async () => state.identity, logout: async () => {},
    caseLabels: async channelId => state.read ? state.read() : ({ channelId, version: state.version, priority: state.priority, tags: state.tags, history: [], next: null }),
    saveCaseLabels: async body => { state.saves.push(body); if (state.failure) throw state.failure; state.version++; state.priority = body.priority; state.tags = body.tags; return { version: state.version, duplicate: state.saves.length > 1 }; } };
  return { state, c: createLabelsController({ api, newRequestId: () => 'a'.repeat(64), onChange() {} }) };
}
test('refresh never rebases a dirty draft onto another Staff edit', async () => {
  const { state, c } = fixture(); await c.start(); await c.open('20'); c.edit({ priority: 'high', tags: 'Synthetic' });
  state.version = 2; state.priority = 'low'; await c.checkAccess(); await c.save();
  assert.equal(state.saves.length, 0); assert.equal(c.snapshot().baseVersion, 1); assert.equal(c.snapshot().draft.priority, 'high');
  await c.open('20'); assert.equal(c.snapshot().baseVersion, 2); assert.equal(c.snapshot().draft.priority, 'low');
  c.edit({ priority: 'urgent', tags: '' }); await c.save(); assert.equal(state.saves[0].expectedVersion, 2);
});
test('uncertain saves keep one request ID and original version across refresh and retry', async () => {
  const { state, c } = fixture(); await c.start(); await c.open('20'); c.edit({ priority: 'high', tags: 'Synthetic' });
  state.failure = new DashboardFailure('connection'); await c.save(); const request = c.snapshot().pending;
  state.version = 2; await c.checkAccess(); c.edit({ priority: 'low', tags: 'wrong' }); await c.open('21');
  assert.deepEqual(c.snapshot().pending, request); state.failure = null; await c.retry();
  assert.deepEqual(state.saves[0], state.saves[1]); assert.equal(c.snapshot().dirty, false);
});
test('authorization and identity changes clear drafts; hidden-page late responses stay suppressed', async () => {
  const { state, c } = fixture(); await c.start(); await c.open('20'); c.edit({ priority: 'high', tags: 'Synthetic private' });
  state.identity = { userId: '99', guildId: '12' }; await c.save(); assert.equal(state.saves.length, 0); assert.equal(c.snapshot().draft.tags, '');
  await c.open('20'); let finish; state.read = () => new Promise(resolve => { finish = resolve; });
  const pending = c.checkAccess(); while (!finish) await new Promise(resolve => setImmediate(resolve));
  c.suspend(); finish({ channelId: '20', version: 2, priority: 'high', tags: ['Late'], history: [], next: null }); await pending;
  assert.equal(c.snapshot().page, null); state.read = async () => { throw new DashboardFailure('denied'); };
  await c.open('20'); assert.equal(c.snapshot().channelId, null); assert.equal(c.snapshot().identity, null);
});
