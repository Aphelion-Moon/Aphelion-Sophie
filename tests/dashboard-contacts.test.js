import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactsController } from '../apps/dashboard/contacts-controller.js';
import { DashboardFailure } from '../apps/dashboard/api.js';

function fixture() {
  const first = 'a'.repeat(48), next = 'b'.repeat(48), row = value => ({ token: value, openerId: '13', createdAt: 0, access: 'open' });
  const state = { identity: { guildId: '11', userId: '12' }, calls: [], failure: null, destination: 'ready' };
  const api = { session: async () => state.identity, logout: async () => {},
    receivedContacts: async after => { state.calls.push(['list', after]); if (state.failure) throw state.failure;
      return state.read ? state.read() : { ...state.identity, actorId: state.identity.userId, state: 'queue', items: [row(after ? next : first)], next: after ? null : next }; },
    receivedContactDestination: async caseToken => { state.calls.push(['destination', caseToken]); if (state.failure) throw state.failure;
      return state.readDestination ? state.readDestination() : { guildId: '11', actorId: '12', state: state.destination, ...(state.destination === 'ready' ? { channelId: '14', access: 'closed' } : { caseToken }) }; } };
  const c = createContactsController({ api, onChange() {} }); return { c, state, first, next };
}
test('recipient navigation pages through bounded metadata and only checks a destination after explicit selection', async () => {
  const { c, state, first, next } = fixture(); await c.start(); assert.equal(c.snapshot().destination, null);
  await c.open(first); assert.equal(c.snapshot().destination.access, 'closed'); assert.equal(c.snapshot().focusDestination, true);
  await c.next(); assert.equal(c.snapshot().destination, null); assert.equal(c.snapshot().page.items[0].token, next);
  await c.open(first); assert.equal(state.calls.filter(row => row[0] === 'destination').length, 1);
  await c.reload(); assert.equal(c.snapshot().after, null);
});
test('preparing contacts have no channel link and periodic refresh rechecks selected access without stealing focus', async () => {
  const { c, state, first } = fixture(); await c.start(); state.destination = 'preparing'; await c.open(first);
  assert.equal(c.snapshot().destination.channelId, undefined); state.destination = 'ready'; await c.checkAccess();
  assert.equal(c.snapshot().destination.channelId, '14'); assert.equal(c.snapshot().focusDestination, false);
});
test('account changes, access denial and uncertain reads clear private contact metadata and links', async () => {
  for (const kind of ['denied', 'connection']) { const { c, state, first } = fixture(); await c.start(); await c.open(first);
    state.failure = new DashboardFailure(kind); await c.checkAccess(); assert.equal(c.snapshot().page, null); assert.equal(c.snapshot().destination, null); }
  const { c, state, first } = fixture(); await c.start(); state.identity = { guildId: '11', userId: '99' }; await c.open(first);
  assert.equal(c.snapshot().page, null); assert.equal(state.calls.some(row => row[0] === 'destination'), false);
});
test('hidden-page late responses cannot restore a private destination', async () => {
  const { c, state, first } = fixture(); await c.start(); let finish;
  state.readDestination = () => new Promise(resolve => { finish = resolve; }); const opening = c.open(first);
  while (!finish) await new Promise(resolve => setImmediate(resolve)); c.suspend(); finish({ guildId: '11', actorId: '12', state: 'ready', channelId: '14', access: 'open' }); await opening;
  assert.equal(c.snapshot().destination, null); assert.equal(c.snapshot().page, null);
});
test('wrong-identity responses, duplicate rows and malformed destinations cannot produce contact links', async () => {
  const { c, state, first } = fixture(); state.read = async () => ({ guildId: '11', actorId: '99', state: 'queue', items: [], next: null });
  await c.start(); assert.equal(c.snapshot().page, null);
  state.read = null; await c.reload(); state.readDestination = async () => ({ guildId: '99', actorId: '12', state: 'ready', channelId: '14', access: 'open' });
  await c.open(first); assert.equal(c.snapshot().destination, null);
  state.read = async () => ({ guildId: '11', actorId: '12', state: 'queue', items: [{ token: first }, { token: first }], next: null });
  await c.reload(); assert.equal(c.snapshot().page, null);
});
