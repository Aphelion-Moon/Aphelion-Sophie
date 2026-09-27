import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepliesController } from '../apps/dashboard/replies-controller.js';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';

const body = 'Synthetic reply <img src=x onerror=alert(1)>\n@everyone';
const rid = value => value.toString(16).padStart(32, '0');
function fixture() {
  const state = { identity: { userId: '11', guildId: '12' }, version: 1, canReply: true, entries: [], next: null, saves: [], reads: [], result: 'pending' };
  const actor = () => ({ actorId: state.identity.userId, guildId: state.identity.guildId });
  const api = { session: async () => { if (state.sessionFailure) throw state.sessionFailure; return state.identity; }, logout: async () => {},
    answer: async name => { if (state.answerFailure) throw state.answerFailure; if (state.answerRead) return state.answerRead();
      return { ...actor(), name, revision: state.answerRevision ?? 1, sha256: 'a'.repeat(64), action: 'publish', document: { text: body } };
    },
    caseReplies: async (channelId, before) => {
      state.reads.push(before); if (state.read) return state.read();
      return { ...actor(), channelId, version: state.version, canReply: state.canReply, entries: state.entries, next: state.next };
    },
    requestCaseReply: async request => {
      state.saves.push(structuredClone(request)); if (state.send) return state.send();
      if (state.failure) throw state.failure;
      return { ...actor(), id: rid(99), state: state.result, duplicate: state.saves.length > 1 };
    } };
  const c = createRepliesController({ api, newRequestId: () => 'a'.repeat(64), onChange() {} });
  return { state, c, api };
}
async function draft(c) { await c.start(); await c.open('20'); c.edit(body); }
async function reviewed(c) { await draft(c); await c.review(); c.confirm(true); }
const cleared = c => { const s = c.snapshot(); assert.equal(s.page, null); assert.equal(s.draft, ''); assert.equal(s.review, null); assert.equal(s.pending, null); assert.equal(s.channelId, null); };

test('approved answer selection requires an empty draft and explicit review, retaining exact source identity', async () => {
  const { c, state } = fixture(); await draft(c); await c.selectAnswer('synthetic-help'); assert.equal(c.snapshot().answer, null);
  c.edit(''); await c.selectAnswer(''); assert.match(c.snapshot().error, /Enter an approved answer name/);
  await c.selectAnswer('synthetic-help'); const answer = c.snapshot().answer;
  assert.deepEqual(answer, { name: 'synthetic-help', revision: 1, sha256: 'a'.repeat(64) });
  c.edit('Changed'); assert.equal(c.snapshot().draft, body); await c.send(); assert.equal(state.saves.length, 0);
  await c.review(); assert.deepEqual(c.snapshot().review.answer, answer); c.confirm(true); await c.send();
  assert.deepEqual(state.saves[0].answer, answer); assert.equal(state.saves[0].text, body); assert.equal(c.snapshot().answer, null);
});

test('changed or withdrawn selections invalidate the review without silently replacing the approved text', async () => {
  for (const withdrawn of [false, true]) {
    const { c, state } = fixture(); await c.start(); await c.open('20'); await c.selectAnswer('synthetic-help');
    if (withdrawn) state.answerFailure = new DashboardFailure('missing'); else state.answerRevision = 2;
    await c.review(); assert.equal(c.snapshot().review, null); assert.equal(c.snapshot().answer, null); assert.equal(c.snapshot().draft, '');
    assert.match(c.snapshot().error, /unavailable or changed/); assert.equal(state.saves.length, 0); assert.equal(c.snapshot().page.channelId, '20');
  }
});

test('uncertain selected reply retries its original source and text after later publication changes', async () => {
  const { c, state } = fixture(); await c.start(); await c.open('20'); await c.selectAnswer('synthetic-help'); await c.review(); c.confirm(true);
  state.failure = new DashboardFailure('connection'); await c.send(); const pending = c.snapshot().pending;
  state.answerFailure = new DashboardFailure('missing'); await c.selectAnswer('different'); c.clearAnswer(); assert.deepEqual(c.snapshot().pending, pending);
  state.failure = null; await c.retry(); assert.deepEqual(state.saves[1], pending); assert.equal(state.saves.length, 2);
});

test('selected answer conflict needs another publication check and privacy clearing discards source references', async () => {
  const { c, state } = fixture(); await c.start(); await c.open('20'); await c.selectAnswer('synthetic-help'); await c.review(); c.confirm(true);
  state.failure = new DashboardFailure('conflict'); await c.send(); assert.equal(c.snapshot().answer.name, 'synthetic-help');
  state.answerRevision = 2; await c.checkAccess(); await c.review(); assert.equal(c.snapshot().answer, null); assert.equal(state.saves.length, 1);
  await c.selectAnswer('synthetic-help'); c.suspend(); cleared(c); assert.equal(c.snapshot().answer, null);
});

test('late or foreign publication responses cannot repopulate a cleared private reply page', async () => {
  const { c, state } = fixture(); await c.start(); await c.open('20'); let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  state.answerRead = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const selecting = c.selectAnswer('synthetic-help'); await ready; c.suspend(); release({}); await selecting;
  cleared(c); assert.equal(c.snapshot().answer, null);
  state.answerRead = async () => ({ actorId: '99', guildId: '12' }); await c.open('20'); await c.selectAnswer('synthetic-help'); cleared(c);
});

test('reply submission requires exact text review and explicit confirmation; editing invalidates both', async () => {
  const { state, c } = fixture(); await draft(c); await c.send(); assert.equal(state.saves.length, 0);
  await c.review(); await c.send(); assert.equal(state.saves.length, 0);
  c.confirm(true); c.edit(body + ' edited'); await c.send(); assert.equal(state.saves.length, 0);
  await c.review(); c.confirm(true); await c.send();
  assert.deepEqual(state.saves, [{ channelId: '20', requestId: 'a'.repeat(64), expectedVersion: 1, text: body + ' edited', confirmed: true }]);
  assert.match(c.snapshot().notice, /Delivery is pending/); assert.equal(c.snapshot().dirty, false);
});
test('refresh preserves the original draft version but invalidates review; changed cases need a fresh explicit review', async () => {
  const { state, c } = fixture(); await reviewed(c); state.version = 2; await c.checkAccess();
  assert.equal(c.snapshot().baseVersion, 1); assert.equal(c.snapshot().draft, body); assert.equal(c.snapshot().review, null);
  await c.send(); assert.equal(state.saves.length, 0); await c.review();
  assert.equal(c.snapshot().review.changed, true); assert.equal(c.snapshot().checked, false);
  c.confirm(true); await c.send(); assert.equal(state.saves[0].expectedVersion, 2);
});
test('uncertain submission and cooldown preserve one exact request through refresh, closure and retry', async () => {
  for (const failure of [new DashboardFailure('connection'), new DashboardFailure('unavailable', 429)]) {
    const { state, c } = fixture(); await reviewed(c); state.failure = failure; await c.send(); const request = c.snapshot().pending;
    c.edit('new copy'); await c.open('21'); await c.review(); await c.send();
    assert.deepEqual(c.snapshot().pending, request); assert.equal(state.saves.length, 1);
    state.version = 2; state.canReply = false; await c.checkAccess(); state.failure = null; state.result = 'confirmed'; await c.retry();
    assert.deepEqual(state.saves[1], request); assert.equal(c.snapshot().pending, null); assert.match(c.snapshot().notice, /delivery was confirmed/);
  }
});
test('definite conflict restores the draft but requires refreshed access and another review', async () => {
  const { state, c } = fixture(); await reviewed(c); state.failure = new DashboardFailure('conflict'); await c.send();
  assert.equal(c.snapshot().draft, body); assert.equal(c.snapshot().baseVersion, 1); assert.equal(c.snapshot().pending, null);
  state.failure = null; state.version = 2; await c.send(); assert.equal(state.saves.length, 1);
  await c.checkAccess(); await c.review(); assert.equal(c.snapshot().review.changed, true);
  c.confirm(true); await c.send(); assert.equal(state.saves[1].expectedVersion, 2);
});
test('delivery results distinguish recorded requests from confirmed, cancelled and withdrawn outcomes', async () => {
  for (const [result, notice] of [['confirmed', /delivery was confirmed/], ['cancelled', /cancelled before sending/], ['withdrawn', /withdrawn from Discord/]]) {
    const { state, c } = fixture(); await reviewed(c); state.result = result; await c.send(); assert.match(c.snapshot().notice, notice);
  }
});
test('identity changes, failed sessions and lost case access clear drafts and uncertain submissions', async () => {
  for (const change of ['identity', 'session', 'read']) {
    const { state, c } = fixture(); await reviewed(c); state.failure = new DashboardFailure('connection'); await c.send();
    if (change === 'identity') state.identity = { userId: '99', guildId: '12' };
    else if (change === 'session') state.sessionFailure = new DashboardFailure('connection');
    else state.read = async () => { throw new DashboardFailure('denied'); };
    await c.retry(); cleared(c); assert.equal(state.saves.length, 1); assert.match(c.snapshot().notice, /previous|submitted/);
  }
});
test('hidden pages suppress late reads and sends and warn that an in-flight request can still complete', async () => {
  for (const operation of ['read', 'send']) {
    const { state, c } = fixture(); await reviewed(c); let finish;
    state[operation] = () => new Promise(resolve => { finish = resolve; });
    const pending = operation === 'read' ? c.checkAccess() : c.send();
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    c.suspend(); finish({ actorId: '11', guildId: '12', channelId: '20', version: 1, canReply: true, entries: [], next: null, id: rid(99), state: 'confirmed', duplicate: false });
    await pending; cleared(c); assert.equal(c.snapshot().busy, false);
    if (operation === 'send') assert.match(c.snapshot().notice, /may still complete/);
  }
});
test('closed cases clear unsent drafts; invalid text cannot reach review or submission', async () => {
  const { state, c } = fixture(); await draft(c);
  for (const invalid of ['', ' ', 'x'.repeat(4001), '\ud800', 'Synthetic\x00']) { c.edit(invalid); await c.review(); assert.equal(c.snapshot().review, null); }
  c.edit(body); state.canReply = false; await c.checkAccess(); assert.equal(c.snapshot().draft, ''); assert.equal(c.snapshot().dirty, false);
  c.edit(body); await c.review(); assert.equal(c.snapshot().review, null); assert.equal(state.saves.length, 0);
});
test('history paging preserves its exact cursor during access refresh; malformed and foreign results fail closed', async () => {
  const { state, c } = fixture(); await c.start();
  state.entries = Array.from({ length: 25 }, (_, i) => ({ id: rid(30 - i), authorId: '11', text: 'Synthetic retained reply', createdAt: 30 - i, state: 'confirmed', delivery: 'confirmed', messageId: '44' }));
  state.next = { id: rid(6), createdAt: 6 }; await c.open('20'); await c.older(); await c.checkAccess();
  assert.deepEqual(state.reads.slice(-2), [state.next, state.next]);
  for (const patch of [{ actorId: '99' }, { channelId: '21' }, { entries: [null] }, { next: { id: rid(5), createdAt: 6 } }, { entries: [{ ...state.entries[0], messageId: null }] }]) {
    state.read = async () => ({ actorId: '11', guildId: '12', channelId: '20', version: 1, canReply: true, entries: state.entries, next: state.next, ...patch });
    await c.open('20'); cleared(c);
  }
});
test('browser reply API uses bounded fixed routes, paired cursors, same-origin credentials and CSRF', async () => {
  const calls = [], api = createDashboardApi({ fetch: async (path, options) => {
    calls.push({ path, options }); return { ok: true, json: async () => ({ userId: '11', guildId: '12', csrfToken: 'b'.repeat(64), canEditOnboarding: false, canEditForms: false }) };
  } });
  await assert.rejects(api.requestCaseReply({ channelId: '20' }), error => error.kind === 'denied');
  await api.session(); await api.caseReplies('20', { id: rid(1), createdAt: 0 });
  await api.requestCaseReply({ channelId: '20', requestId: 'a'.repeat(64), expectedVersion: 1, text: body, confirmed: true });
  assert.equal(calls[1].path, `/api/cases/replies?channelId=20&beforeAt=0&beforeId=${rid(1)}`);
  assert.equal(calls[2].path, '/api/cases/replies/request'); assert.equal(calls[2].options.headers['X-CSRF-Token'], 'b'.repeat(64));
  assert.equal(calls[2].options.credentials, 'same-origin'); assert.equal(calls[2].options.cache, 'no-store');
  assert.throws(() => api.caseReplies('../secrets'), error => error.kind === 'invalid');
  assert.throws(() => api.caseReplies('20', { id: rid(1), createdAt: -1 }), error => error.kind === 'invalid');
});
