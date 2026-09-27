import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesController } from '../apps/dashboard/notes-controller.js';
import { DashboardFailure } from '../apps/dashboard/api.js';
import { requireNoteText } from '../modules/tickets/notes.js';

function fixture() {
  const state = { identity: { userId: '11', guildId: '12' }, saves: [], failure: null, read: null }; let ids = 0;
  const api = { session: async () => state.identity, logout: async () => {},
    caseNotes: async channelId => state.read ? state.read() : ({ channelId, entries: [], next: null }),
    appendCaseNote: async body => { state.saves.push(body); if (state.failure) throw state.failure; return { number: 1, duplicate: state.saves.length > 1 }; } };
  const controller = createNotesController({ api, newRequestId: () => String(++ids).padStart(64, '0'), onChange() {} });
  return { state, controller };
}
test('uncertain note saves keep one exact request and prevent competing drafts or channel changes', async () => {
  const { state, controller: c } = fixture(); await c.start(); await c.open('20'); c.edit('Synthetic note');
  state.failure = new DashboardFailure('connection'); await c.append();
  const pending = c.snapshot().pending; assert.equal(pending.text, 'Synthetic note'); c.edit('Replacement'); await c.open('21');
  assert.deepEqual(c.snapshot().pending, pending); assert.equal(c.snapshot().channelId, '20');
  state.failure = null; await c.retry(); assert.deepEqual(state.saves[0], state.saves[1]); assert.equal(c.snapshot().draft, '');
  assert.equal(c.snapshot().pending, null); assert.match(c.snapshot().notice, /Note 1 is saved/);
});
test('account changes and suspension clear private drafts and ignore late note responses', async () => {
  const { state, controller: c } = fixture(); await c.start(); await c.open('20'); c.edit('Synthetic private text');
  state.identity = { userId: '99', guildId: '12' }; await c.append(); assert.equal(state.saves.length, 0); assert.equal(c.snapshot().draft, '');
  await c.open('20'); let finish; state.read = () => new Promise(resolve => { finish = resolve; });
  const reading = c.checkAccess(); while (!finish) await new Promise(resolve => setImmediate(resolve));
  c.suspend(); finish({ channelId: '20', entries: [{ number: 1, authorId: '11', createdAt: 0, text: 'Late private text' }], next: null });
  await reading; assert.equal(c.snapshot().page, null); assert.equal(c.snapshot().draft, ''); assert.equal(c.snapshot().channelId, null);
});
test('denial clears notes and invalid input permits explicit correction without retrying a bad request', async () => {
  const { state, controller: c } = fixture(); await c.start(); await c.open('20'); c.edit('Synthetic note');
  state.failure = new DashboardFailure('invalid'); await c.append(); assert.equal(c.snapshot().pending, null); assert.equal(c.snapshot().draft, 'Synthetic note');
  state.read = async () => { throw new DashboardFailure('denied'); }; await c.checkAccess();
  assert.equal(c.snapshot().draft, ''); assert.equal(c.snapshot().page, null); assert.equal(c.snapshot().identity, null);
});
test('notes preserve literal text and newlines while rejecting empty oversized and control-character inputs', () => {
  requireNoteText('<script>literal authored test</script>\n@everyone');
  for (const text of ['', '  ', 'x'.repeat(4001), 'bad\u0000text']) assert.throws(() => requireNoteText(text), /CASE_NOTE_TEXT_INVALID/);
});
