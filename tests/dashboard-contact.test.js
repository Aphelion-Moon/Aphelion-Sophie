import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactController } from '../apps/dashboard/contact-controller.js';
import { DashboardFailure } from '../apps/dashboard/api.js';
import { syntheticCaseForm } from './fixtures/case-intake.js';

function fixture() {
  const selected = { state: 'review', token: 'a'.repeat(48), openerId: '11', recipientIds: ['22'] };
  const state = { identity: { userId: '11', guildId: '12' }, writes: [], failure: null, accessFailure: null, generation: 0 };
  const api = { session: async () => state.identity, logout: async () => {},
    contactAccess: async () => { if (state.accessFailure) throw state.accessFailure; return { canCreate: true }; },
    contactReview: async () => selected, contactDestination: async () => ({ state: 'preparing', caseToken: 'b'.repeat(48) }),
    contactChange: async (action, body) => { state.writes.push({ action, body }); if (state.failure) throw state.failure;
      if (state.defer) return state.defer();
      return action === 'select' ? selected : action === 'confirm' ? { token: selected.token, version: 1, form: syntheticCaseForm('staff-contact') } : action === 'cancel' ? { cancelled: true } : { recorded: true, duplicate: false }; } };
  const c = createContactController({ api, onChange() {}, newRequestId: () => String(++state.generation).padStart(64, '0') });
  const select = async () => { await c.start(); c.editRecipients('22'); await c.select(); };
  const form = async () => { await select(); c.confirm(true); await c.openForm(); c.editValue('details', 'Synthetic answers only.'); };
  return { c, state, api, select, form };
}
test('contact selection and final creation each require an explicit unchecked review', async () => {
  const { c, state, select } = fixture(); await select(); await c.openForm(); assert.equal(state.writes.length, 1);
  assert.equal(c.snapshot().stage, 'audience'); c.confirm(true); await c.openForm(); assert.equal(c.snapshot().values[0].value, '');
  c.editValue('details', 'Synthetic answer.'); c.reviewSubmission(); await c.submit(); assert.equal(state.writes.length, 2);
  c.confirm(true); await c.submit(); assert.equal(c.snapshot().stage, 'submitted'); assert.deepEqual(c.snapshot().values, []);
  assert.equal(c.snapshot().destination.state, 'preparing'); assert.match(c.snapshot().notice, /must still be verified/);
});
test('unknown submission keeps exact answers and request identity until the original request is retried', async () => {
  const { c, state, form } = fixture(); await form(); c.reviewSubmission(); c.confirm(true); state.failure = new DashboardFailure('connection'); await c.submit();
  const pending = c.snapshot().pending; c.editValue('details', 'Changed value'); c.cancel(); c.reset(); await c.checkAccess();
  assert.deepEqual(c.snapshot().pending, pending); state.failure = null; await c.retry(); assert.deepEqual(state.writes.at(-1), state.writes.at(-2));
  assert.equal(c.snapshot().pending, null); assert.deepEqual(c.snapshot().values, []);
});
test('background access refresh preserves unfinished answers but invalidates confirmation', async () => {
  const { c, form } = fixture(); await form(); c.reviewSubmission(); c.confirm(true); await c.checkAccess();
  assert.equal(c.snapshot().stage, 'form'); assert.equal(c.snapshot().confirmed, false); assert.equal(c.snapshot().values[0].value, 'Synthetic answers only.');
});
test('a different account cannot send a previous users selected audience or answers', async () => {
  const { c, state, form } = fixture(); await form(); c.reviewSubmission(); c.confirm(true); state.identity = { userId: '33', guildId: '12' }; await c.submit();
  assert.equal(state.writes.length, 2); assert.equal(c.snapshot().audience, null); assert.deepEqual(c.snapshot().values, []);
});
test('denial, uncertain access and page hiding clear private form values and fence late responses', async () => {
  for (const kind of ['denied', 'connection']) { const { c, state, form } = fixture(); await form(); state.accessFailure = new DashboardFailure(kind); await c.checkAccess();
    assert.deepEqual(c.snapshot().values, []); assert.equal(c.snapshot().audience, null); }
  const { c, state, select } = fixture(); await select(); let finish; state.defer = () => new Promise(resolve => { finish = resolve; }); c.confirm(true);
  const request = c.openForm(); while (!finish) await new Promise(resolve => setImmediate(resolve)); c.suspend(); finish({}); await request;
  assert.equal(c.snapshot().form, null); assert.equal(c.snapshot().pending, null); assert.equal(c.snapshot().audience, null);
});
test('invalid submitted answers return to the editable form while changed or expired selection is cleared', async () => {
  const { c, state, form } = fixture(); await form(); c.reviewSubmission(); c.confirm(true); state.failure = new DashboardFailure('invalid'); await c.submit();
  assert.equal(c.snapshot().stage, 'form'); assert.equal(c.snapshot().values[0].value, 'Synthetic answers only.'); assert.equal(c.snapshot().pending, null);
  c.reviewSubmission(); c.confirm(true); state.failure = new DashboardFailure('conflict'); await c.submit(); assert.equal(c.snapshot().audience, null);
});
test('recipient IDs are bounded and distinct before reservation and cancellation creates no submission', async () => {
  const { c, state, select } = fixture(); await c.start(); c.editRecipients('22 22'); await c.select(); assert.equal(state.writes.length, 0);
  await select(); await c.cancel(); assert.equal(c.snapshot().stage, 'select'); assert.equal(state.writes.some(row => row.action === 'submit'), false);
});
