import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';
import { createGuidanceController } from '../apps/dashboard/controller.js';
import { createSyntheticEditorApi } from './fixtures/dashboard-editor.js';
import { mountDashboardShell } from '../apps/dashboard/shell.js';

test('focus and visibility bursts do not repeatedly refresh or block an active editor', async () => {
  const events = {}, docEvents = {}; let time = 0, checks = 0, tick, release;
  const controller = { start() {}, snapshot: () => ({ phase: 'ready', busy: false }), checkAccess: async () => { checks++; await new Promise(resolve => { release = resolve; }); } };
  const window = { localStorage: { getItem: () => null }, addEventListener: (name, fn) => { events[name] = fn; }, setInterval: fn => { tick = fn; return 1; }, clearInterval() {} };
  const document = { visibilityState: 'visible', body: { classList: { toggle() {} } }, getElementById: () => ({ addEventListener() {} }),
    querySelectorAll: () => [], addEventListener: (name, fn) => { docEvents[name] = fn; } };
  mountDashboardShell({ window, document, controller, now: () => time });
  await events.focus(); await docEvents.visibilitychange(); assert.equal(checks, 0);
  time = 60_001; const first = events.focus(); await docEvents.visibilitychange(); await tick(); assert.equal(checks, 1);
  release(); await first; await events.focus(); assert.equal(checks, 1);
  time += 60_001; document.visibilityState = 'hidden'; await tick(); assert.equal(checks, 1);
  document.visibilityState = 'visible'; const next = docEvents.visibilitychange(); assert.equal(checks, 2); release(); await next;
});

async function workflow(options) {
  const f = createSyntheticEditorApi(options); let sequence = 0, rendered;
  const controller = createGuidanceController({ api: f.api, onChange: state => { rendered = state; }, newRequestId: () => (++sequence).toString(16).padStart(64, '0') });
  await controller.start(); return { ...f, controller, snapshot: controller.snapshot, rendered: () => rendered };
}

test('background access checks keep fields editable, deduplicate, preserve connection-failure edits and wait before saving', async () => {
  const f = createSyntheticEditorApi(); let release, calls = 0;
  const api = { ...f.api, session: async () => { calls++; if (release !== undefined) await new Promise(resolve => { release = resolve; }); return f.api.session(); } };
  const controller = createGuidanceController({ api, onChange: () => {}, newRequestId: () => 'ab'.repeat(32) }); await controller.start();
  release = null; const pending = controller.checkAccess();
  assert.equal(controller.checkAccess(), pending); assert.equal(controller.snapshot().busy, false);
  controller.updatePage(0, 'title', 'Edited while checking'); assert.equal(controller.snapshot().dirty, true);
  const saved = controller.save(); assert.equal(f.state.calls.filter(call => call.name === 'save').length, 0);
  release(); release = undefined; await pending; await saved;
  assert.equal(calls, 2); assert.equal(f.state.drafts.at(-1).document.stages[0].title, 'Edited while checking');
  f.state.faults.push({ method: 'session', kind: 'connection' }); await controller.checkAccess();
  assert.equal(controller.snapshot().stale, false); assert.equal(controller.snapshot().phase, 'ready');
  controller.updatePage(0, 'title', 'Still editable'); assert.equal(controller.snapshot().document.stages[0].title, 'Still editable');
  f.state.canEditOnboarding = false; await controller.checkAccess(); assert.equal(controller.snapshot().document, null);
});

test('screens save their boundaries and order, require confirmed removal, and survive publication', async () => {
  const f = await workflow(); f.controller.updateScreen(0, 0, '**First** screen'); f.controller.addScreen(0); f.controller.updateScreen(0, 1, 'Second screen');
  f.controller.moveScreen(0, 1, -1); assert.deepEqual(f.snapshot().document.stages[0].screens, ['Second screen', '**First** screen']);
  f.controller.removeScreen(0, 0); assert.equal(f.snapshot().document.stages[0].screens.length, 2); f.controller.cancelEdit();
  await f.controller.save(); await f.controller.review(); assert.equal(f.snapshot().review.valid, true);
  assert.deepEqual(f.snapshot().review.pages[0].segments, ['Second screen', '**First** screen']); await f.controller.publish();
  assert.deepEqual(f.state.publications.at(-1).publication.stages[0].screens, ['Second screen', '**First** screen']);
});

test('Shuttle step addition, reordering and confirmed removal preserve stable identities and saved versions', async () => {
  const f = await workflow(), original = structuredClone(f.snapshot().document);
  f.controller.selectPage(4); f.controller.addPage();
  assert.equal(f.snapshot().document.stages.length, 6); assert.equal(f.snapshot().page, 5);
  const id = f.snapshot().document.stages[5].id;
  f.controller.updatePage(5, 'title', 'Additional step'); f.controller.updatePage(5, 'body', 'Synthetic extra guidance.');
  f.controller.movePage(-1); assert.equal(f.snapshot().page, 4); assert.equal(f.snapshot().document.stages[4].id, id);
  f.controller.removePage(); assert.ok(f.snapshot().pendingEdit); assert.equal(f.snapshot().document.stages.length, 6);
  f.controller.addPage(); f.controller.selectPage(0); await f.controller.save();
  assert.equal(f.snapshot().page, 4); assert.equal(f.state.drafts.length, 1);
  f.controller.cancelEdit(); assert.equal(f.snapshot().document.stages[4].id, id);
  f.controller.removePage(); f.controller.confirmEdit();
  assert.deepEqual(f.snapshot().document, original);
  f.controller.selectPage(4); f.controller.movePage(-1); await f.controller.save();
  assert.equal(f.state.drafts.length, 2); assert.deepEqual(f.state.drafts[0].document, original);
  await f.controller.review(); assert.equal(f.snapshot().review.valid, true);
});

test('Shuttle editor bounds step count, preserves structural changes on uncertain retry and clears on access loss', async () => {
  const f = await workflow(); for (let i = 0; i < 30; i++) f.controller.addPage();
  assert.equal(f.snapshot().document.stages.length, 20);
  assert.equal(new Set(f.snapshot().document.stages.map(stage => stage.id)).size, 20);
  for (let i = 0; i < 25; i++) { f.controller.removePage(); f.controller.confirmEdit(); }
  assert.equal(f.snapshot().document.stages.length, 1); assert.equal(f.snapshot().page, 0);
  f.state.faults.push({ method: 'save', kind: 'connection', after: true });
  await f.controller.save();
  const pending = f.snapshot().pending; assert.ok(pending); assert.equal(f.state.drafts.length, 2);
  f.controller.addPage(); assert.deepEqual(f.snapshot().pending, pending);
  await f.controller.retry(); assert.equal(f.snapshot().pending, null); assert.equal(f.state.drafts.length, 2);
  assert.equal(f.snapshot().document.stages.length, 1);
  f.state.canEditOnboarding = false; await f.controller.checkAccess();
  assert.equal(f.snapshot().document, null); assert.equal(f.snapshot().pendingEdit, null);
});
test('editor saves explicit revisions, reviews saved copy and publishes against the exact reviewed state', async () => {
  const f = await workflow(); f.controller.updatePage(0, 'body', 'Synthetic changed guidance.');
  await f.controller.review(); assert.equal(f.snapshot().review, null); assert.equal(f.state.publications.length, 1);
  await f.controller.save(); assert.equal(f.snapshot().dirty, false); assert.equal(f.snapshot().overview.draft.revision, 2);
  await f.controller.review(); assert.equal(f.snapshot().review.previous.version, 1); assert.equal(f.snapshot().review.publication.version, 2);
  await f.controller.publish(); assert.equal(f.state.publications.length, 2); assert.equal(f.snapshot().overview.currentPublishedVersion, 2);
  const request = f.state.calls.find(call => call.name === 'publish').args[0];
  assert.equal(request.expectedRevision, 2); assert.equal(request.expectedHash, f.state.drafts.at(-1).sha256); assert.equal(request.expectedLatestStatus, 'published');
  assert.equal(f.snapshot().review, null); assert.match(f.snapshot().notice, /was recorded/);
});
test('incomplete drafts can be saved but invalid reviews cannot publish', async () => {
  const f = await workflow({ initial: false }); await f.controller.save(); await f.controller.review();
  assert.equal(f.snapshot().review.valid, false); await f.controller.publish(); assert.equal(f.state.publications.length, 0);
});
test('lost save responses preserve the exact request and disable competing mutations until receipt recovery', async () => {
  const f = await workflow(); f.controller.updatePage(0, 'body', 'Synthetic retained edit.');
  f.state.faults.push({ method: 'save', after: true, kind: 'connection' }); await f.controller.save();
  const held = f.snapshot().pending; assert.equal(f.state.drafts.length, 2); assert.equal(f.snapshot().stale, true);
  f.controller.updatePage(0, 'body', 'Must not replace the uncertain request'); await f.controller.save();
  assert.equal(f.snapshot().document.stages[0].body, 'Synthetic retained edit.');
  await f.controller.retry(); assert.equal(f.state.drafts.length, 2); assert.equal(f.snapshot().pending, null); assert.equal(f.snapshot().stale, false);
  assert.deepEqual(f.state.calls.filter(call => call.name === 'save').map(call => call.args[0]), [held.payload, held.payload]);
});
test('uncertain publish closes review so receipt retry is reachable and rereads present publication status', async () => {
  const f = await workflow(); await f.controller.review(); f.state.faults.push({ method: 'publish', after: true, kind: 'connection' });
  await f.controller.publish(); assert.equal(f.snapshot().review, null); assert.equal(f.snapshot().pending.kind, 'publish');
  f.state.publications.at(-1).status = 'withdrawn'; await f.controller.retry();
  assert.equal(f.state.publications.length, 2); assert.equal(f.snapshot().overview.latest.status, 'withdrawn');
  assert.equal(f.snapshot().overview.currentPublishedVersion, 1); assert.match(f.snapshot().notice, /Publication of version 2 was recorded/);
});
test('acknowledged saves with failed refresh do not present an uncertain mutation or issue a new save', async () => {
  const f = await workflow(); f.controller.updatePage(0, 'title', 'Synthetic new title'); f.state.faults.push({ method: 'draft', kind: 'connection' });
  await f.controller.save(); assert.equal(f.snapshot().pending, null); assert.equal(f.snapshot().stale, true); assert.equal(f.snapshot().dirty, false);
  assert.match(f.snapshot().notice, /revision 2 was recorded/); await f.controller.retry(); await f.controller.save();
  assert.equal(f.state.calls.filter(call => call.name === 'save').length, 1); await f.controller.reload(); assert.equal(f.snapshot().overview.draft.revision, 2);
});
test('stale save comparison preserves local edits and explicitly rebases the next revision', async () => {
  const f = await workflow(); f.controller.updatePage(0, 'body', 'My synthetic change');
  const remote = structuredClone(f.state.drafts[0].document); remote.stages[0].body = 'Other synthetic change';
  await f.api.save({ requestId: 'ff'.repeat(32), expectedRevision: 1, document: remote });
  await f.controller.save(); assert.equal(f.snapshot().stale, true); assert.equal(f.snapshot().document.stages[0].body, 'My synthetic change');
  await f.controller.reload(); assert.equal(f.snapshot().conflict.remote.stages[0].body, 'Other synthetic change');
  f.controller.resolveConflict('local'); assert.equal(f.snapshot().overview.draft.revision, 2); assert.equal(f.snapshot().dirty, true);
  await f.controller.save(); assert.equal(f.state.drafts.length, 3); assert.equal(f.state.drafts[2].document.stages[0].body, 'My synthetic change');
});
test('choosing the latest copy discards local edits only after explicit conflict resolution', async () => {
  const f = await workflow(); f.controller.updatePage(0, 'body', 'Temporary synthetic edit'); await f.controller.reload();
  assert.equal(f.snapshot().dirty, true); f.controller.resolveConflict('remote'); assert.equal(f.snapshot().dirty, false);
  assert.deepEqual(f.snapshot().document, f.state.drafts[0].document); assert.equal(f.state.drafts.length, 1);
});
test('permission loss, account change and logout clear drafts, reviews, history and pending requests', async () => {
  const f = await workflow(); await f.controller.history(); await f.controller.inspect('publications', 1); f.state.canEditOnboarding = false;
  await f.controller.checkAccess(); assert.equal(f.snapshot().phase, 'denied');
  for (const key of ['document', 'baseline', 'overview', 'selected', 'review', 'pending']) assert.equal(f.snapshot()[key], null);
  assert.deepEqual(f.snapshot().history.entries, []); f.state.canEditOnboarding = true; await f.controller.checkAccess();
  f.controller.updatePage(0, 'body', 'Account-specific unsaved copy'); f.state.userId = '100000000000000003'; await f.controller.reload();
  assert.equal(f.snapshot().dirty, false); assert.equal(f.snapshot().conflict, null);
  await f.controller.logout(); assert.equal(f.snapshot().phase, 'signed-out'); assert.equal(f.snapshot().identity, null); assert.equal(f.snapshot().document, null);
});
test('history inspection does not overwrite unsaved edits and using retained copy needs an explicit new save', async () => {
  const f = await workflow(); f.controller.updatePage(0, 'body', 'Unsaved working copy'); await f.controller.history('drafts'); await f.controller.inspect('drafts', 1);
  f.controller.useSelected(); assert.equal(f.snapshot().document.stages[0].body, 'Unsaved working copy'); assert.equal(f.state.drafts.length, 1);
  f.controller.closeReview(); f.controller.showEditor(); await f.controller.save(); await f.controller.history('drafts'); await f.controller.inspect('drafts', 1);
  f.controller.useSelected(); assert.equal(f.snapshot().section, 'editor'); assert.equal(f.snapshot().dirty, true); assert.equal(f.state.drafts.length, 2);
  await f.controller.save(); assert.equal(f.state.drafts.length, 3);
});
test('withdrawal requires its own review, retries without duplicate actions and displays the remaining publication', async () => {
  const f = await workflow(); await f.controller.review(); await f.controller.publish(); await f.controller.history(); await f.controller.inspect('publications', 2);
  await f.controller.withdraw(); assert.equal(f.state.publications[1].status, 'published');
  f.controller.reviewWithdrawal(); assert.equal(f.snapshot().selected.newRunVersionAfterWithdrawal, 1);
  f.state.faults.push({ method: 'withdraw', after: true, kind: 'connection' }); await f.controller.withdraw();
  assert.equal(f.snapshot().selected, null); await f.controller.retry(); assert.equal(f.state.receipts.size, 2);
  assert.equal(f.snapshot().overview.currentPublishedVersion, 1); assert.match(f.snapshot().notice, /cleanup may still be pending/);
});
test('overlapping controller work is excluded while the original save remains in flight', async () => {
  const f = await workflow(); const save = f.api.save; let release; f.api.save = async value => { await new Promise(resolve => { release = resolve; }); return save(value); };
  f.controller.updatePage(0, 'title', 'Synthetic concurrency'); const pending = f.controller.save();
  await f.controller.save(); await f.controller.checkAccess(); assert.equal(f.snapshot().busy, true); release(); await pending; assert.equal(f.state.drafts.length, 2);
});
test('browser transport keeps CSRF private, fixes same-origin routes and sends logout with an empty body', async () => {
  const calls = [], api = createDashboardApi({ fetch: async (path, options) => { calls.push({ path, options }); return Response.json(path === '/auth/session' ?
    { userId: '123', guildId: '456', csrfToken: 'ab'.repeat(32), canEditOnboarding: true, canEditForms: false } : { status: 'ok' }); } });
  await assert.rejects(api.save({}), error => error.kind === 'denied'); assert.equal(calls.length, 0);
  assert.deepEqual(await api.session(), { userId: '123', guildId: '456', canEditOnboarding: true, canEditForms: false, canEditAnswers: false, canEditPermissions: false, canEditAutomation: false });
  await api.save({ requestId: 'cd'.repeat(32) }); await api.logout();
  const save = calls[1].options, logout = calls[2].options;
  assert.equal(save.credentials, 'same-origin'); assert.equal(save.redirect, 'error'); assert.equal(save.headers['X-CSRF-Token'], 'ab'.repeat(32));
  assert.equal(logout.method, 'POST'); assert.equal(Object.hasOwn(logout, 'body'), false);
  await assert.rejects(api.publish({}), DashboardFailure); assert.throws(() => api.history('arbitrary'), DashboardFailure);
  assert.throws(() => api.publication('../secret'), DashboardFailure);
});
test('browser transport redacts response text and treats unavailable mutation results as uncertain', async () => {
  const api = createDashboardApi({ fetch: async () => new Response('synthetic-secret-error', { status: 503 }) });
  await assert.rejects(api.session(), error => error.kind === 'unavailable' && !error.message.includes('secret'));
  const down = createDashboardApi({ fetch: async () => { throw new Error('synthetic-provider-secret'); } });
  await assert.rejects(down.session(), error => error.message === 'connection');
});

test('server session bootstrap avoids a duplicate lookup and is consumed before later access refresh', async () => {
  let removed = 0, requests = 0;
  const session = { userId: '123', guildId: '456', csrfToken: 'ab'.repeat(32), canEditOnboarding: true, canEditForms: false };
  const node = { content: encodeURIComponent(JSON.stringify(session)), remove() { removed++; } };
  const api = createDashboardApi({ document: { querySelector: () => node, querySelectorAll: () => [] }, fetch: async () => {
    requests++; return Response.json({ ...session, canEditOnboarding: false });
  } });
  assert.equal((await api.session()).canEditOnboarding, true); assert.equal(requests, 0); assert.equal(removed, 1);
  assert.equal((await api.session()).canEditOnboarding, false); assert.equal(requests, 1);
});
