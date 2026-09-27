import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseController } from '../apps/dashboard/case-controller.js';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';

const caseToken = 'a'.repeat(48), channelId = '123', reviewHash = 'b'.repeat(64);
function fixture() {
  const calls = [], downloads = [], state = { userId: '1', guildId: '2', denied: false, fault: null };
  const page = { caseToken, channelId, completeHistory: false, captureAvailable: true, next: 'nextpage', gapsNext: 'nextgaps', page: { observations: [{ content: 'Synthetic case message' }], gaps: [] } };
  const review = { caseToken, channelId, completeHistory: false, reviewHash, observations: 1, gaps: 0, bytes: 123 };
  const api = { async session() { if (state.denied) throw new DashboardFailure('denied'); return { userId: state.userId, guildId: state.guildId, canEditForms: false, canEditOnboarding: false }; },
    async transcriptChannel(id) { calls.push(['channel', id]); return structuredClone(page); },
    async transcript(value) { calls.push(['read', value]); if (state.fault) throw new DashboardFailure(state.fault); return structuredClone(page); },
    async exportReview(value) { calls.push(['review', value]); return structuredClone(review); },
    async exportDownload(value) { calls.push(['download', structuredClone(value)]); if (state.fault) throw new DashboardFailure(state.fault); return { blob: new Blob(['Synthetic export']), filename: 'synthetic.html' }; },
    async logout() { state.denied = true; },
  };
  const controller = createCaseController({ api, onChange: () => {}, newRequestId: () => 'c'.repeat(64), downloadFile: value => downloads.push(value) });
  return { api, state, page, review, calls, downloads, controller, snapshot: controller.snapshot };
}

test('case reader allows members, pages observations and gaps independently, and requires explicit export confirmation', async () => {
  const f = fixture(); await f.controller.start(); await f.controller.open(channelId);
  assert.equal(f.snapshot().phase, 'ready'); await f.controller.confirm(true); assert.equal(f.downloads.length, 0);
  await f.controller.next('observations'); await f.controller.next('gaps');
  assert.deepEqual(f.calls.filter(([name]) => name === 'read').map(([, request]) => [request.after, request.gapsAfter]), [['nextpage', null], ['nextpage', 'nextgaps']]);
  await f.controller.review(); await f.controller.confirm(false); assert.equal(f.downloads.length, 0);
  await f.controller.confirm(true); assert.equal(f.downloads.length, 1); assert.equal(f.snapshot().review, null);
  assert.deepEqual(f.calls.at(-1)[1], { caseToken, channelId, reviewHash, requestId: 'c'.repeat(64), confirmed: true });
});

test('uncertain downloads retry the exact confirmation and stale reviews require a fresh read', async () => {
  const f = fixture(); await f.controller.open(channelId); await f.controller.review(); f.state.fault = 'connection';
  await f.controller.confirm(true); const pending = f.snapshot().pending; assert.ok(pending); assert.equal(f.snapshot().page, null);
  f.state.fault = null; await f.controller.retry();
  assert.deepEqual(f.calls.filter(([name]) => name === 'download').map(([, value]) => value), [pending, pending]);
  await f.controller.open(channelId); await f.controller.review(); f.state.fault = 'conflict'; await f.controller.confirm(true);
  assert.equal(f.snapshot().pending, null); assert.equal(f.snapshot().page, null); assert.equal(f.snapshot().review, null);
  assert.match(f.snapshot().error, /review a new export/);
});

test('case permission loss clears retained content even while the account session remains valid', async () => {
  const f = fixture(); await f.controller.open(channelId); await f.controller.review(); f.state.fault = 'denied';
  await f.controller.checkAccess(); assert.equal(f.snapshot().phase, 'denied');
  for (const name of ['page', 'review', 'pending', 'identity', 'selection']) assert.equal(f.snapshot()[name], null);
});

test('account changes before confirmation cannot export the previous account review', async () => {
  const f = fixture(); await f.controller.open(channelId); await f.controller.review(); f.state.userId = '3';
  await f.controller.confirm(true); assert.equal(f.downloads.length, 0); assert.equal(f.snapshot().review, null); assert.equal(f.snapshot().selection, null);
});

test('hidden page and logout suppress late read and download delivery', async () => {
  for (const action of ['suspend', 'logout']) {
    const f = fixture(); await f.controller.open(channelId); await f.controller.review(); let finish;
    f.api.exportDownload = () => new Promise(resolve => { finish = resolve; });
    const pending = f.controller.confirm(true); await new Promise(resolve => setImmediate(resolve));
    await f.controller[action](); finish({ blob: new Blob(['Synthetic late bytes']), filename: 'synthetic.html' }); await pending;
    assert.equal(f.downloads.length, 0); assert.equal(f.snapshot().page, null); assert.equal(f.snapshot().review, null);
  }
  const f = fixture(); let finish; f.api.transcriptChannel = () => new Promise(resolve => { finish = resolve; });
  const pending = f.controller.open(channelId); await new Promise(resolve => setImmediate(resolve)); f.controller.suspend(); finish(f.page); await pending;
  assert.equal(f.snapshot().page, null);
});

test('case browser transport keeps reads fixed and requires CSRF plus exact attachment headers for download', async () => {
  const calls = []; let wrongFilename = false;
  const filename = `sophie-transcript-${caseToken}-${channelId}.html`, body = 'Synthetic HTML';
  const api = createDashboardApi({ fetch: async (path, options) => {
    calls.push({ path, options });
    if (path === '/auth/session') return Response.json({ userId: '1', guildId: '2', csrfToken: 'd'.repeat(64), canEditOnboarding: false, canEditForms: false });
    if (path.endsWith('/download')) return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(body.length),
      'Content-Disposition': `attachment; filename="${wrongFilename ? 'untrusted.html' : filename}"` } });
    return Response.json({});
  } });
  const request = { caseToken, channelId, reviewHash, requestId: 'c'.repeat(64), confirmed: true };
  await assert.rejects(api.exportDownload(request), error => error.kind === 'denied'); assert.equal(calls.length, 0);
  await api.session(); await api.transcriptChannel(channelId); await api.transcript({ caseToken, channelId, after: 'bound_cursor' });
  const file = await api.exportDownload(request); assert.equal(file.filename, filename); assert.equal(await file.blob.text(), body);
  const last = calls.at(-1); assert.equal(last.options.headers['X-CSRF-Token'], 'd'.repeat(64)); assert.equal(last.options.redirect, 'error'); assert.equal(last.options.credentials, 'same-origin');
  assert.equal(last.path, '/api/cases/export/download'); assert.equal(JSON.parse(last.options.body).confirmed, true);
  assert.throws(() => api.transcriptChannel('../private'), error => error.kind === 'invalid');
  wrongFilename = true; await assert.rejects(api.exportDownload(request), error => error.kind === 'unavailable');
});
