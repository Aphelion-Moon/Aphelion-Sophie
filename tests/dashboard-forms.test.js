import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormController } from '../apps/dashboard/form-controller.js';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';
import { createSyntheticFormApi } from './fixtures/dashboard-forms.js';
import { canonicalCaseFormDraft } from '../modules/tickets/intake.js';

async function workflow(options) {
  const f = createSyntheticFormApi(options); let id = 0;
  const controller = createFormController({ api: f.api, onChange: () => {}, newRequestId: () => (++id).toString(16).padStart(64, '0') });
  await controller.start(); return { ...f, controller, snapshot: controller.snapshot, record: (category = 'admin-help') => f.state.records.get(category) };
}

test('form editing saves retained revisions and publishes only the exact saved reviewed copy', async () => {
  const f = await workflow(); f.controller.updateTitle('Synthetic updated title'); f.controller.updateField(0, 'required', false);
  await f.controller.review(); assert.equal(f.snapshot().review, null); await f.controller.save(); await f.controller.review();
  assert.equal(f.snapshot().review.previous.title, 'Synthetic support form'); assert.equal(f.snapshot().review.nextVersion, 2);
  await f.controller.publish(); assert.equal(f.record().publications.length, 2); assert.equal(f.snapshot().overview.newRequestVersion, 2);
  const payload = f.state.calls.find(call => call.name === 'formPublish').args[0]; assert.equal(payload.caseType, 'admin-help');
  assert.equal(payload.expectedRevision, 2); assert.equal(payload.expectedHash, f.record().drafts.at(-1).sha256); assert.equal(payload.expectedLatestStatus, 'published');
});

test('category switching requires an explicit discard for unsaved work and retains independent saved history', async () => {
  const f = await workflow(); f.controller.updateTitle('Unsaved admin copy'); await f.controller.selectResource('tech-support');
  assert.equal(f.snapshot().resource, 'admin-help'); assert.equal(f.snapshot().resourceChoice, 'tech-support');
  f.controller.cancelResource(); assert.equal(f.snapshot().document.title, 'Unsaved admin copy');
  await f.controller.selectResource('tech-support'); await f.controller.confirmResource();
  assert.equal(f.snapshot().resource, 'tech-support'); assert.equal(f.snapshot().document.caseType, 'tech-support'); assert.equal(f.snapshot().overview.draft, null);
  f.controller.updateTitle('Synthetic tech help'); await f.controller.save(); await f.controller.selectResource('admin-help');
  assert.equal(f.snapshot().document.title, 'Synthetic support form'); assert.equal(f.record('tech-support').drafts.length, 1);
  await f.controller.selectResource('quick-help'); assert.equal(f.snapshot().resource, 'admin-help');
});

test('bounded questions and choices preserve stable keys through ordering and require review before destructive draft changes', async () => {
  const f = await workflow(); const first = f.snapshot().document.fields[0].id;
  f.controller.moveField(0, 1); assert.equal(f.snapshot().document.fields[1].id, first);
  const choices = f.snapshot().document.fields[0].options; f.controller.moveOption(0, 0, 1);
  assert.equal(f.snapshot().document.fields[0].options[1].value, choices[0].value);
  f.controller.changeKind(0, 'paragraph'); assert.ok(f.snapshot().pendingEdit); assert.equal(f.snapshot().document.fields[0].kind, 'select');
  f.controller.cancelEdit(); assert.equal(f.snapshot().document.fields[0].kind, 'select');
  f.controller.changeKind(0, 'paragraph'); f.controller.confirmEdit(); assert.equal(f.snapshot().document.fields[0].kind, 'paragraph');
  f.controller.changeKind(0, 'short'); f.controller.updateField(0, 'maxLength', 150); assert.equal(f.snapshot().document.fields[0].maxLength, 150);
  f.controller.removeField(1); assert.equal(f.snapshot().document.fields.length, 2); f.controller.confirmEdit(); assert.equal(f.snapshot().document.fields.length, 1);
  for (let i = 0; i < 8; i++) f.controller.addField('select'); assert.equal(f.snapshot().document.fields.length, 5);
  for (let i = 0; i < 30; i++) f.controller.addOption(1); assert.equal(f.snapshot().document.fields[1].options.length, 25);
  f.controller.removeOption(1, 4); f.controller.addOption(1); assert.equal(new Set(f.snapshot().document.fields[1].options.map(o => o.value)).size, 25);
  assert.deepEqual(canonicalCaseFormDraft(f.snapshot().document), f.snapshot().document);
});

test('incomplete forms can be saved without enabling publication and unsupported client changes are ignored', async () => {
  const f = await workflow({ initial: false }); await f.controller.save(); await f.controller.review(); assert.equal(f.snapshot().review.valid, false);
  await f.controller.publish(); assert.equal(f.record().publications.length, 0); f.controller.closeReview();
  f.controller.addField(); const before = f.snapshot().document;
  f.controller.updateField(0, 'id', 'replacement'); f.controller.updateField(0, 'maxLength', 4_001); f.controller.changeKind(0, 'file');
  f.controller.addField('upload'); f.controller.updateTitle('x'.repeat(46)); assert.deepEqual(f.snapshot().document, before);
  f.controller.updateTitle('Synthetic first form'); f.controller.updateField(0, 'label', 'Synthetic question');
  await f.controller.save(); await f.controller.review(); assert.equal(f.snapshot().review.valid, true); await f.controller.publish(); assert.equal(f.record().publications.length, 1);
});

test('uncertain saves freeze category changes and retain exactly one request for receipt recovery', async () => {
  const f = await workflow(); f.controller.updateTitle('Synthetic uncertain save'); f.state.faults.push({ method: 'formSave', after: true, kind: 'connection' });
  await f.controller.save(); const pending = f.snapshot().pending; assert.ok(pending); assert.equal(f.record().drafts.length, 2);
  await f.controller.selectResource('staff-report'); f.controller.updateTitle('Must not overwrite'); await f.controller.save();
  assert.equal(f.snapshot().resource, 'admin-help'); assert.equal(f.snapshot().document.title, 'Synthetic uncertain save');
  await f.controller.retry(); assert.equal(f.snapshot().pending, null); assert.equal(f.record().drafts.length, 2);
  assert.deepEqual(f.state.calls.filter(call => call.name === 'formSave').map(call => call.args[0]), [pending.payload, pending.payload]);
});

test('uncertain publish and withdrawal retry old receipts then reload current availability without fallback', async () => {
  const f = await workflow(); await f.controller.review(); f.state.faults.push({ method: 'formPublish', after: true, kind: 'connection' });
  await f.controller.publish(); assert.ok(f.snapshot().pending); assert.equal(f.snapshot().review, null); await f.controller.retry();
  await f.controller.history(); await f.controller.inspect('publications', 2); assert.equal(f.snapshot().selected.newRequestVersionAfterWithdrawal, null);
  await f.controller.withdraw(); assert.equal(f.record().publications[1].status, 'published'); f.controller.reviewWithdrawal();
  f.state.faults.push({ method: 'formWithdraw', after: true, kind: 'connection' }); await f.controller.withdraw(); assert.ok(f.snapshot().pending);
  await f.controller.retry(); assert.equal(f.snapshot().overview.newRequestVersion, null); assert.equal(f.record().publications[0].status, 'published');
  assert.match(f.snapshot().notice, /retained/); assert.equal(f.record().publications.length, 2);
});

test('a recorded save with failed refresh exposes reload instead of submitting a second mutation', async () => {
  const f = await workflow(); f.controller.updateTitle('Synthetic acknowledged'); f.state.faults.push({ method: 'formDraft', kind: 'unavailable' });
  await f.controller.save(); assert.equal(f.snapshot().pending, null); assert.equal(f.snapshot().stale, true); assert.match(f.snapshot().notice, /was recorded/);
  await f.controller.save(); assert.equal(f.state.calls.filter(call => call.name === 'formSave').length, 1); await f.controller.reload(); assert.equal(f.snapshot().stale, false);
});

test('conflict comparison preserves complete local questions and rebases only after the operator chooses', async () => {
  const f = await workflow(); f.controller.updateTitle('Local form'); f.controller.addOption(1); f.controller.updateOption(1, 2, 'Local choice');
  const local = f.snapshot().document, remote = structuredClone(f.record().drafts[0].document); remote.title = 'Remote form';
  await f.api.formSave({ caseType: 'admin-help', requestId: 'ee'.repeat(32), expectedRevision: 1, document: remote }); await f.controller.save();
  assert.equal(f.snapshot().stale, true); await f.controller.reload(); assert.deepEqual(f.snapshot().conflict.local, local); assert.equal(f.snapshot().conflict.remote.title, 'Remote form');
  f.controller.resolveConflict('local'); await f.controller.save(); assert.deepEqual(f.record().drafts.at(-1).document, local); assert.equal(f.record().drafts.length, 3);
  f.controller.updateTitle('Discarded form'); await f.controller.reload(); f.controller.resolveConflict('remote'); assert.equal(f.snapshot().document.title, 'Local form');
});

test('permission loss, identity changes and logout erase loaded forms, pending edits, history and uncertainty', async () => {
  const f = await workflow(); await f.controller.history(); await f.controller.inspect('publications', 1); f.controller.removeField(0);
  f.state.canEditForms = false; await f.controller.checkAccess(); assert.equal(f.snapshot().phase, 'denied');
  for (const key of ['document', 'overview', 'pendingEdit', 'selected', 'review', 'pending', 'conflict']) assert.equal(f.snapshot()[key], null);
  assert.deepEqual(f.snapshot().history.entries, []); f.state.canEditForms = true; await f.controller.checkAccess();
  f.controller.updateTitle('Private local edit'); f.state.userId = '100000000000000009'; await f.controller.checkAccess(); assert.equal(f.snapshot().dirty, false);
  f.controller.updateTitle('Another local edit'); await f.controller.selectResource('tech-support'); await f.controller.logout(); assert.equal(f.snapshot().document, null); assert.equal(f.snapshot().resourceChoice, null);
});

test('history reuse creates a new draft and pagination stays within the selected category', async () => {
  const f = await workflow(); for (let i = 0; i < 11; i++) { f.controller.updateTitle(`Synthetic revision ${i}`); await f.controller.save(); }
  await f.controller.history('drafts'); assert.equal(f.snapshot().history.entries.length, 10); const cursor = f.snapshot().history.nextBefore;
  await f.controller.history('drafts', cursor, 'older'); assert.equal(f.snapshot().history.entries.length, 2);
  await f.controller.inspect('drafts', 1); f.controller.useSelected(); assert.equal(f.snapshot().dirty, true); await f.controller.save(); assert.equal(f.record().drafts.length, 13);
  await f.controller.selectResource('head-admin-contact'); assert.deepEqual(f.snapshot().history.entries, []); await f.controller.history('drafts'); assert.equal(f.snapshot().history.entries.length, 0);
});

test('an in-flight mutation excludes overlapping edits, navigation and additional saves', async () => {
  const f = await workflow(); f.controller.updateTitle('In-flight copy'); const save = f.api.formSave; let release;
  f.api.formSave = async payload => { await new Promise(resolve => { release = resolve; }); return save(payload); };
  const running = f.controller.save(); await f.controller.selectResource('tech-support'); f.controller.updateTitle('Wrong copy'); await f.controller.save();
  assert.equal(f.snapshot().document.title, 'In-flight copy'); release(); await running; assert.equal(f.record().drafts.length, 2);
});

test('form transport uses closed same-origin routes, private CSRF and validated category/cursor inputs', async () => {
  const calls = [], api = createDashboardApi({ fetch: async (path, options) => { calls.push({ path, options }); return Response.json(path === '/auth/session' ?
    { userId: '123', guildId: '456', csrfToken: 'ab'.repeat(32), canEditOnboarding: false, canEditForms: true } : {}); } });
  assert.deepEqual(await api.session(), { userId: '123', guildId: '456', canEditOnboarding: false, canEditForms: true, canEditAnswers: false, canEditAutomation: false, canEditPermissions: false });
  await api.formDraft('staff-report', 2); await api.formHistory('staff-report', 'drafts', 3); await api.formReview('staff-report', 2); await api.formPublication('staff-report', 1);
  await api.formSave({ caseType: 'staff-report' }); await api.formPublish({ caseType: 'staff-report' }); await api.formWithdraw({ caseType: 'staff-report' });
  assert.deepEqual(calls.slice(1).map(call => call.path), ['/api/ticket-forms/draft?caseType=staff-report&revision=2', '/api/ticket-forms/history?caseType=staff-report&kind=drafts&before=3',
    '/api/ticket-forms/review?caseType=staff-report&revision=2', '/api/ticket-forms/publication?caseType=staff-report&version=1', '/api/ticket-forms/save', '/api/ticket-forms/publish', '/api/ticket-forms/withdraw']);
  for (const { options } of calls) { assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); }
  assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'ab'.repeat(32));
  await api.formDraft('staff-contact'); await api.formHistory('staff-contact', 'drafts'); await api.formReview('staff-contact', 1); await api.formPublication('staff-contact', 1);
  assert.deepEqual(calls.slice(-4).map(call => call.path), ['/api/ticket-forms/draft?caseType=staff-contact', '/api/ticket-forms/history?caseType=staff-contact&kind=drafts',
    '/api/ticket-forms/review?caseType=staff-contact&revision=1', '/api/ticket-forms/publication?caseType=staff-contact&version=1']);
  assert.throws(() => api.formDraft('admin-help&caseId=1'), DashboardFailure); assert.throws(() => api.formHistory('admin-help', 'answers'), DashboardFailure);
  assert.throws(() => api.formReview('admin-help', 0), DashboardFailure); assert.throws(() => api.formPublication('admin-help', '../1'), DashboardFailure);
});
