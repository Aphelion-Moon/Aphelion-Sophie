import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagementController, availableManagementActions, MANAGEMENT_ACTIONS } from '../apps/dashboard/management-controller.js';
import { DashboardFailure } from '../apps/dashboard/api.js';
import { requireReceiptId } from '../apps/core/storage/receipts.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { requireCaseActionReason } from '../modules/tickets/lifecycle.js';
import { requireParticipantChange } from '../modules/tickets/participants.js';

function fixture() {
  const state = { identity: { userId: '11', guildId: '12' }, version: 1, writes: [], failure: null };
  const api = { session: async () => state.identity, logout: async () => {},
    managedCase: async channelId => state.read ? state.read() : ({ state: 'ready', channelId, actorId: '11', userId: '13', type: 'admin-help', caseState: 'open', version: state.version,
      assigneeId: null, assignmentStatus: null, participantIds: [] }),
    changeCase: async body => { state.writes.push(body); if (state.failure) throw state.failure; return { recorded: true, duplicate: state.writes.length > 1 }; } };
  return { state, c: createManagementController({ api, newRequestId: () => 'a'.repeat(64), onChange() {} }) };
}
test('case changes need explicit review and confirmation; a refresh invalidates the old review', async () => {
  const { state, c } = fixture(); await c.start(); await c.open('20'); c.review(); await c.submit(); assert.equal(state.writes.length, 0);
  c.confirm(true); state.version = 2; await c.checkAccess(); await c.submit(); assert.equal(state.writes.length, 0); assert.equal(c.snapshot().review, null);
  c.review(); c.confirm(true); await c.submit(); assert.equal(state.writes[0].expectedVersion, 2); assert.equal(state.writes[0].confirmed, true);
  assert.match(c.snapshot().notice, /may still be pending/);
});
test('uncertain requests keep their exact reviewed version and actor selection across refresh and retry', async () => {
  const { state, c } = fixture(); await c.start(); await c.open('20'); c.edit({ action: 'add-participant', targetId: '44', reason: 'case-context' }); c.review(); c.confirm(true);
  state.failure = new DashboardFailure('connection'); await c.submit(); const request = c.snapshot().pending;
  state.version = 2; await c.checkAccess(); c.edit({ action: 'close', targetId: '', reason: 'resolved' }); await c.open('21');
  assert.deepEqual(c.snapshot().pending, request); state.failure = null; await c.retry(); assert.deepEqual(state.writes[0], state.writes[1]); assert.equal(c.snapshot().pending, null);
});
test('routine access refresh preserves an unfinished member selection but requires a new review', async () => {
  const { c } = fixture(); await c.start(); await c.open('20');
  c.edit({ action: 'add-participant', targetId: '44', reason: 'case-context' }); c.review(); c.confirm(true); await c.checkAccess();
  assert.equal(c.snapshot().draft.targetId, '44'); assert.equal(c.snapshot().draft.action, 'add-participant');
  assert.equal(c.snapshot().review, null); assert.equal(c.snapshot().confirmed, false); assert.equal(c.snapshot().dirty, true);
});
test('account changes, denied operations and hidden-page races clear private state without sending an old review', async () => {
  const { state, c } = fixture(); await c.start(); await c.open('20'); c.review(); c.confirm(true); state.identity = { userId: '99', guildId: '12' };
  await c.submit(); assert.equal(state.writes.length, 0); assert.equal(c.snapshot().review, null);
  state.identity = { userId: '11', guildId: '12' }; await c.start(); await c.open('20'); let finish;
  state.read = () => new Promise(resolve => { finish = resolve; }); const request = c.checkAccess();
  while (!finish) await new Promise(resolve => setImmediate(resolve)); c.suspend(); finish({ state: 'ready' }); await request; assert.equal(c.snapshot().page, null);
  state.read = async () => { throw new DashboardFailure('denied'); }; await c.open('20'); assert.equal(c.snapshot().identity, null); assert.equal(c.snapshot().channelId, null);
});
test('case controls show state-appropriate actions and their reason values match the shared services', () => {
  assert.deepEqual(availableManagementActions({ caseState: 'closed', actorId: '11', assigneeId: '11', participantIds: ['44'] }), ['reopen', 'unclaim', 'remove-participant']);
  for (const action of ['close', 'reopen']) for (const reason of MANAGEMENT_ACTIONS[action][1]) requireCaseActionReason(action, reason);
  for (const action of ['add-participant', 'remove-participant']) for (const reason of MANAGEMENT_ACTIONS[action][1]) requireParticipantChange({ action: action.split('-')[0], userId: '44', reason, confirmed: true });
});
test('dashboard receipts occupy a strict separate namespace and cannot impersonate a signed Discord ID', () => {
  requireReceiptId('123'); requireReceiptId(`dashboard.${'a'.repeat(64)}`);
  for (const value of ['dashboard.123', 'other.' + 'a'.repeat(64), 'dashboard.' + 'A'.repeat(64), '0', '']) assert.throws(() => requireReceiptId(value));
  const f = syntheticInteractions(), payload = f.payload({ id: `dashboard.${'a'.repeat(64)}` });
  assert.throws(() => f.verifier.verify(f.signed(payload)), /INVALID_DISCORD_ID/);
});
