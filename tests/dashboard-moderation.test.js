import test from 'node:test';
import assert from 'node:assert/strict';
import { createModerationController } from '../apps/dashboard/moderation-controller.js';
import { DashboardFailure } from '../apps/dashboard/api.js';
import { createModerationRecoveryHttp } from '../apps/core/http/moderation-recovery.js';
import { createDashboardAuthHttpServer } from '../apps/core/http/dashboard-auth.js';
import { createDashboardPresentation } from '../apps/core/http/dashboard-assets.js';
import { dashboardPageAllowed, dashboardSessionView, dashboardReturnPath } from '../contracts/dashboard-navigation.js';
import { ContractError } from '../contracts/validation.js';
import { dashboardConfiguration } from './fixtures/oauth.js';
import { dashboardBytes } from './fixtures/dashboard-http.js';

function fixture() {
  const state = { identity: { userId: '11', guildId: '12', canRecoverModeration: true }, fence: 2, writes: [], failure: null };
  const page = () => ({ guildId: '12', actorId: state.identity.userId, userId: '13', action: 'mute', actionRevision: 1,
    eligibilityEpoch: 0, hold: null, jobs: [{ operationId: 'member-action.100', fence: state.fence, status: 'parked', reason: 'BOT_PERMISSION_MISSING', retryAllowed: true }] });
  const api = { session: async () => state.identity, logout: async () => {}, reviewModeration: async () => state.read ? state.read() : page(),
    retryModeration: async body => { state.writes.push(structuredClone(body)); if (state.failure) throw state.failure; return { recorded: true, duplicate: state.writes.length > 1 }; } };
  return { state, page, c: createModerationController({ api, onChange() {}, newRequestId: () => 'a'.repeat(64) }) };
}
const prepare = async c => { await c.start(); await c.open('13'); c.review('member-action.100'); };

test('moderation retry requires explicit confirmation and refresh invalidates the review', async () => {
  const { state, c } = fixture(); await prepare(c); await c.submit(); assert.equal(state.writes.length, 0);
  c.confirm(true); state.fence = 3; await c.checkAccess(); await c.submit(); assert.equal(state.writes.length, 0);
  c.review('member-action.100'); c.confirm(true); await c.submit(); assert.equal(state.writes[0].expectedFence, 3);
  assert.equal(state.writes[0].confirmed, true); assert.match(c.snapshot().notice, /not yet confirmed/);
});

test('uncertain moderation retry preserves its exact binding and request ID through refresh', async () => {
  const { state, c } = fixture(); await prepare(c); c.confirm(true); state.failure = new DashboardFailure('connection');
  await c.submit(); const pending = c.snapshot().pending; state.fence = 9; await c.checkAccess(); await c.open('14');
  assert.deepEqual(c.snapshot().pending, pending); state.failure = null; await c.retry();
  assert.deepEqual(state.writes[0], state.writes[1]); assert.equal(c.snapshot().pending, null);
});

test('moderator account changes and lost authority clear the review before a retry can be sent', async () => {
  const { state, c } = fixture(); await prepare(c); c.confirm(true); state.identity = { ...state.identity, userId: '99' };
  await c.submit(); assert.equal(state.writes.length, 0); assert.equal(c.snapshot().page, null); assert.equal(c.snapshot().review, null);
  state.identity = { ...state.identity, userId: '11' }; await c.open('13'); c.review('member-action.100'); c.confirm(true);
  state.identity.canRecoverModeration = false; await c.submit(); assert.equal(state.writes.length, 0); assert.equal(c.snapshot().userId, null);
});

test('hidden-page races cannot restore moderation data or submit an old review', async () => {
  const { state, page, c } = fixture(); await prepare(c); let finish;
  state.read = () => new Promise(resolve => { finish = resolve; }); const pending = c.checkAccess();
  while (!finish) await new Promise(resolve => setImmediate(resolve)); c.suspend(); finish(page()); await pending;
  assert.equal(c.snapshot().page, null); assert.equal(c.snapshot().userId, null); assert.equal(c.snapshot().review, null);
});

test('held, malformed and stale moderation reviews never leave a usable confirmation', async () => {
  const { state, page, c } = fixture(); await c.start();
  state.read = async () => ({ ...page(), hold: 'decision_expired', jobs: [{ ...page().jobs[0], retryAllowed: false }] });
  await c.open('13'); c.review('member-action.100'); assert.equal(c.snapshot().review, null);
  state.read = async () => ({ ...page(), actorId: '99' }); await c.open('13'); assert.equal(c.snapshot().page, null);
  state.read = null; await c.open('13'); c.review('member-action.100'); c.confirm(true);
  state.failure = new DashboardFailure('conflict'); await c.submit(); assert.equal(c.snapshot().pending, null); assert.equal(c.snapshot().review, null);
});

test('moderation HTTP accepts only confirmed target-bound input and authenticates before observations', async () => {
  let allowed = false, active = true; const calls = [], actor = { guildId: '12', userId: '11' };
  const api = createModerationRecoveryHttp({ enabled: () => active,
    auth: { authenticate: async args => { calls.push(['authenticate', args]); return { proof: {} }; }, resolvePrincipal: async () => actor },
    authorization: { resolveActor: async () => actor, authorize: async () => allowed },
    discord: { observe: async userId => { calls.push(['observe', userId]); return { guildId: '12', userId }; } },
    store: { reviewModeration: async args => { calls.push(['read', args]); return {}; }, retryModeration: async args => { calls.push(['write', args]); return { recorded: true, duplicate: false }; } } });
  const query = new URLSearchParams(), body = { userId: '13', operationId: 'member-action.100', expectedFence: 2,
    expectedActionRevision: 1, expectedEligibilityEpoch: 0, requestId: 'a'.repeat(64), confirmed: true };
  const send = value => api.execute({ path: '/api/moderation/retry', method: 'POST', query, body: value, credentials: { csrfToken: 'synthetic', token: 'synthetic' } });
  await assert.rejects(send({ ...body, actor }), /MODERATION_INPUT_INVALID/);
  await assert.rejects(send({ ...body, confirmed: false }), /MODERATION_INPUT_INVALID/); assert.equal(calls.length, 0);
  await assert.rejects(send(body), /OPERATION_DENIED/); assert.equal(calls.some(([name]) => name === 'observe'), false);
  allowed = true; await send(body); const write = calls.find(([name]) => name === 'write')[1];
  assert.equal(write.actor, actor); assert.equal(write.observation.userId, '13'); assert.match(write.interactionId, /^dashboard\.[a-f0-9]{64}$/);
  assert.equal(calls[0][1].method, 'POST'); assert.equal(calls[0][1].csrfToken, 'synthetic');
  active = false; const count = calls.length; await assert.rejects(send(body), /OPERATION_DENIED/); assert.equal(calls.length, count);
  await assert.rejects(api.execute({ path: '/api/moderation/review', method: 'GET', query: new URLSearchParams('userId=13&userId=14'), body: null, credentials: {} }), /MODERATION_INPUT_INVALID/);
});

test('moderation navigation requires the installed recovery feature and a current configured capability', async () => {
  const actor = { guildId: '12', userId: '11', capabilities: { 'member.unmute': true } };
  assert.equal(dashboardPageAllowed('/moderation', dashboardSessionView(actor, 'a'.repeat(64))), false);
  const session = dashboardSessionView(actor, 'a'.repeat(64), { moderation: true });
  assert.equal(dashboardPageAllowed('/moderation', session), true); assert.equal(dashboardReturnPath('/moderation'), '/moderation');
  const presentation = await createDashboardPresentation();
  assert.match(presentation.get('/moderation', session).bytes.toString(), /moderation-app/);
  assert.equal(presentation.get('/cases', { ...session, canRecoverModeration: false }).bytes.toString().includes('href="/moderation"'), false);
});

test('moderation routes remain optional and safely classify denied, stale and invalid requests', async () => {
  let code = 'MODERATION_REVIEW_STALE';
  const create = moderation => createDashboardAuthHttpServer({ configuration: dashboardConfiguration, enabled: () => true,
    auth: {}, authorization: {}, moderation, onFault() { assert.fail('Expected contract failure must not become an internal error'); } });
  const absent = create(null), present = create({ execute: async () => { throw new ContractError(code); } });
  const a = await absent.listen(), b = await present.listen();
  try {
    assert.equal((await dashboardBytes(a, '/api/moderation/review?userId=13')).status, 404);
    assert.equal((await dashboardBytes(b, '/api/moderation/review?userId=13')).status, 409);
    code = 'MODERATION_TARGET_DENIED'; assert.equal((await dashboardBytes(b, '/api/moderation/review?userId=13')).status, 403);
    code = 'MODERATION_INPUT_INVALID'; assert.equal((await dashboardBytes(b, '/api/moderation/review?userId=13')).status, 400);
  } finally { await absent.close(); await present.close(); }
});
