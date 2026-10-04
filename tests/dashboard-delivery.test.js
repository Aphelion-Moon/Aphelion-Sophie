import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryController } from '../apps/dashboard/delivery-controller.js';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';
import { createCaseDeliveryIssuesHttp } from '../apps/core/http/case-delivery-issues.js';
import { createDashboardAuthHttpServer } from '../apps/core/http/dashboard-auth.js';
import { createDashboardPresentation } from '../apps/core/http/dashboard-assets.js';
import { dashboardPageAllowed, dashboardSessionView, dashboardReturnPath } from '../contracts/dashboard-navigation.js';
import { ContractError } from '../contracts/validation.js';
import { dashboardConfiguration } from './fixtures/oauth.js';
import { dashboardBytes } from './fixtures/dashboard-http.js';

const first = 'a'.repeat(32), second = 'b'.repeat(32), third = 'c'.repeat(32);
const entry = (issueId = first) => ({ issueId, userId: '13', revision: 2, channelId: '14', caseState: 'open', caseType: 'admin-help',
  kind: 'intake', reason: 'uncertain', attempted: true, recheckable: false, needsMessageId: true, channelChoice: null });
function fixture() {
  const state = { identity: { userId: '11', guildId: '12', canRecoverCases: true }, writes: [], failure: null,
    page: { state: 'ready', guildId: '12', entries: [entry(), { ...entry(second), kind: 'case', needsMessageId: false,
      channelChoice: { required: true, candidates: ['15', '16'], total: 2 } }, { ...entry(third), needsMessageId: false, recheckable: true }], next: null } };
  const api = { session: async () => state.identity, logout: async () => {}, caseDelivery: async after => state.read ? state.read(after) : structuredClone(state.page),
    changeCaseDelivery: async body => { state.writes.push(structuredClone(body)); if (state.failure) throw state.failure; return { recorded: true, duplicate: state.writes.length > 1 }; } };
  return { state, c: createDeliveryController({ api, onChange() {}, newRequestId: () => 'a'.repeat(64) }) };
}

test('recovery browser reviews exact evidence and requires explicit confirmation for all three actions', async () => {
  const { state, c } = fixture(); await c.start();
  for (const [issueId, action, resultId] of [[first, 'adopt_message', '17'], [second, 'select_channel', '15'], [third, 'recheck', null]]) {
    const before = state.writes.length; c.review(issueId, action, resultId); await c.submit(); assert.equal(state.writes.length, before);
    c.confirm(true); await c.submit(); assert.deepEqual(state.writes.at(-1), { issueId, action, resultId, expectedRevision: 2, requestId: 'a'.repeat(64), confirmed: true });
    assert.match(c.snapshot().notice, /not yet confirmed/);
  }
});
test('recovery browser refuses blind recheck, arbitrary candidates and unreviewed refreshed revisions', async () => {
  const { state, c } = fixture(); await c.start();
  for (const args of [[first, 'recheck'], [first, 'adopt_message', 'https://example.test'], [second, 'select_channel', '99']]) {
    c.review(...args); assert.equal(c.snapshot().review, null);
  }
  c.review(first, 'adopt_message', '17'); c.confirm(true); state.page.entries[0].revision++; await c.refresh(); await c.submit(); assert.equal(state.writes.length, 0);
});
test('uncertain recovery preserves its exact request across refresh and cannot switch to another repair', async () => {
  const { state, c } = fixture(); await c.start(); c.review(first, 'adopt_message', '17'); c.confirm(true);
  state.failure = new DashboardFailure('connection'); await c.submit(); const pending = c.snapshot().pending;
  state.page.entries[0].revision++; await c.refresh(); c.review(third, 'recheck'); assert.deepEqual(c.snapshot().pending, pending);
  state.failure = null; await c.retry(); assert.deepEqual(state.writes[0], state.writes[1]); assert.equal(c.snapshot().pending, null);
});
test('recovery browser clears private metadata on account change, denial, stale review and hidden-page races', async () => {
  const { state, c } = fixture(); await c.start(); c.review(first, 'adopt_message', '17'); c.confirm(true);
  state.identity = { ...state.identity, userId: '99' }; await c.submit(); assert.equal(state.writes.length, 0); assert.equal(c.snapshot().review, null);
  await c.refresh(); c.review(first, 'adopt_message', '17'); c.confirm(true); state.failure = new DashboardFailure('conflict'); await c.submit();
  assert.equal(c.snapshot().pending, null); assert.equal(c.snapshot().page, null);
  let finish; state.read = () => new Promise(resolve => { finish = resolve; }); const reading = c.refresh();
  while (!finish) await new Promise(resolve => setImmediate(resolve)); c.suspend(); assert.equal(c.snapshot().phase, 'loading'); finish(state.page); await reading; assert.equal(c.snapshot().page, null);
  state.read = null; await c.refresh(); state.identity.canRecoverCases = false; await c.checkAccess(); assert.equal(c.snapshot().identity, null); assert.equal(c.snapshot().page, null);
});
test('bounded recovery pagination rejects a foreign guild and malformed evidence controls', async () => {
  const { state, c } = fixture(); state.page.next = third; await c.start(); let after;
  state.read = async value => { after = value; return { ...state.page, entries: [], next: null }; }; await c.next(); assert.equal(after, third);
  state.read = async () => ({ ...state.page, guildId: '99' }); await c.refresh(); assert.equal(c.snapshot().page, null);
  state.read = null; state.page.entries[1].channelChoice.candidates = ['15', '15']; await c.refresh(); assert.equal(c.snapshot().page, null);
});

function httpFixture() {
  const state = { calls: [], duplicate: false, kind: 'case.intake', allowed: true }, actor = { guildId: '12', userId: '11' };
  const inspect = name => async args => { state.calls.push([name, args]); return { name }; };
  const store = {
    listCaseDeliveryIssues: async args => { state.calls.push(['list', args]); return {}; },
    describeCaseDeliveryIssue: async args => { state.calls.push(['describe', args]); if (!state.allowed) throw new ContractError('OPERATION_DENIED');
      return { duplicate: state.duplicate, kind: state.kind, recordId: first, userId: '13', channelId: '14', plan: {}, candidateIds: ['15'] }; },
    changeCaseDeliveryIssue: async args => { state.calls.push(['write', args]); state.duplicate = true; return { duplicate: false }; },
  };
  const http = createCaseDeliveryIssuesHttp({ enabled: () => true, store,
    auth: { authenticate: async args => { state.calls.push(['auth', args]); return { proof: {} }; }, resolvePrincipal: async () => actor },
    authorization: { resolveActor: async () => actor }, discord: { observe: inspect('observe') },
    channels: { inspect: inspect('channel') }, messages: { inspect: inspect('intake') }, replyMessages: { inspect: inspect('reply') } });
  const body = { issueId: first, expectedRevision: 2, action: 'adopt_message', resultId: '17', requestId: 'a'.repeat(64), confirmed: true };
  const send = (value = body) => http.execute({ path: '/api/cases/delivery/change', method: 'POST', query: new URLSearchParams(), body: value, credentials: {} });
  return { state, http, body, send, actor };
}
test('recovery HTTP accepts only confirmed metadata and authorizes receipt preflight before external reads', async () => {
  const { state, body, send, http } = httpFixture();
  for (const bad of [{ ...body, actor: {} }, { ...body, confirmed: false }, { ...body, action: 'resend' }, { ...body, resultId: 'https://example.test' }]) await assert.rejects(send(bad));
  assert.equal(state.calls.length, 0); state.allowed = false; await assert.rejects(send(), /OPERATION_DENIED/);
  assert.deepEqual(state.calls.map(([name]) => name), ['auth', 'describe']);
  await assert.rejects(http.execute({ path: '/api/cases/delivery', method: 'GET', query: new URLSearchParams(`after=${first}&after=${second}`), body: null, credentials: {} }), /CASE_DELIVERY_INPUT_INVALID/);
});
test('shared recovery resolves exact duplicates without member/channel/message reads and uses the correct private reader', async () => {
  for (const kind of ['case.intake', 'case.reply']) {
    const { state, send, actor } = httpFixture(); state.kind = kind; assert.deepEqual(await send(), { recorded: true, duplicate: false });
    const write = state.calls.find(([name]) => name === 'write')[1]; assert.equal(write.actor, actor); assert.match(write.interactionId, /^dashboard\.[a-f0-9]{64}$/);
    assert.equal(write.message.name, kind === 'case.reply' ? 'reply' : 'intake'); assert.equal(state.calls[1][0], 'describe');
    state.calls.length = 0; assert.deepEqual(await send(), { recorded: true, duplicate: true }); assert.deepEqual(state.calls.map(([name]) => name), ['auth', 'describe']);
  }
});
test('retained channel selection rejects an unknown ID before any channel inspection', async () => {
  const { state, send, body } = httpFixture(); state.kind = 'case.provision';
  await assert.rejects(send({ ...body, action: 'select_channel', resultId: '99' }), /SHUTTLE_CHANNEL_CHOICE_INVALID/);
  assert.equal(state.calls.some(([name]) => name === 'channel'), false);
});
test('recovery routes are optional and classify authority, stale evidence and bad input without leaking details', async () => {
  let code = 'CASE_ISSUE_NOT_FOUND', faults = 0; const create = caseDelivery => createDashboardAuthHttpServer({ configuration: dashboardConfiguration, enabled: () => true,
    auth: {}, authorization: {}, caseDelivery, onFault: () => { faults++; } });
  const absent = create(null), present = create({ execute: async () => { throw new ContractError(code); } }); const a = await absent.listen(), b = await present.listen();
  try {
    assert.equal((await dashboardBytes(a, '/api/cases/delivery')).status, 404);
    for (const [value, expected] of [['CASE_ISSUE_NOT_FOUND', 403], ['STALE_CASE_ISSUE', 409], ['CASE_AUDIENCE_CHANGED', 409], ['OBSERVATION_INVALIDATED', 409], ['CASE_RECOVERY_DISABLED', 503], ['CASE_INTAKE_MESSAGE_CHANGED', 409], ['CASE_DELIVERY_INPUT_INVALID', 400]]) {
      code = value; const result = await dashboardBytes(b, '/api/cases/delivery'); assert.equal(result.status, expected); assert.equal(result.text.includes(code), false);
    }
    assert.equal(faults, 0);
  } finally { await absent.close(); await present.close(); }
});
test('recovery navigation and transport require feature/current Staff access and preserve exact retry bodies', async () => {
  const actor = { guildId: '12', userId: '11', capabilities: {}, canManageCases: true }, csrf = 'a'.repeat(64);
  assert.equal(dashboardPageAllowed('/case-delivery', dashboardSessionView(actor, csrf)), false);
  const session = dashboardSessionView(actor, csrf, { caseDelivery: true }); assert.equal(dashboardPageAllowed('/case-delivery', session), true);
  assert.equal(dashboardReturnPath('/case-delivery'), '/case-delivery');
  const presentation = await createDashboardPresentation(); assert.match(presentation.get('/case-delivery', session).bytes.toString(), /delivery-app/);
  assert.equal(presentation.get('/cases', { ...session, canRecoverCases: false }).bytes.toString().includes('href="/case-delivery"'), false);
  const calls = [], api = createDashboardApi({ document: null, fetch: async (path, options) => { calls.push([path, options]);
    return Response.json(path === '/auth/session' ? session : { recorded: true, duplicate: true }); } });
  assert.equal((await api.session()).canRecoverCases, true); const body = httpFixture().body; await api.changeCaseDelivery(body); await api.changeCaseDelivery(body);
  assert.equal(calls[1][0], '/api/cases/delivery/change'); assert.deepEqual(calls[1][1].body, calls[2][1].body); assert.equal(calls[1][1].headers['X-CSRF-Token'], csrf);
  await api.caseDelivery(first); assert.equal(calls.at(-1)[0], `/api/cases/delivery?after=${first}`);
  for (const cursor of ['a'.repeat(48), '../private', first + '&after=' + second]) assert.throws(() => api.caseDelivery(cursor), error => error.kind === 'invalid');
});
