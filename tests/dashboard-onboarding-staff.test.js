import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistanceController } from '../apps/dashboard/assistance-controller.js';
import { createDeliveryController } from '../apps/dashboard/delivery-controller.js';
import { createDashboardApi, DashboardFailure } from '../apps/dashboard/api.js';
import { createDashboardAuthHttpServer } from '../apps/core/http/dashboard-auth.js';
import { createDashboardPresentation } from '../apps/core/http/dashboard-assets.js';
import { dashboardPageAllowed, dashboardSessionView, dashboardReturnPath } from '../contracts/dashboard-navigation.js';
import { ContractError } from '../contracts/validation.js';
import { dashboardConfiguration } from './fixtures/oauth.js';
import { dashboardBytes } from './fixtures/dashboard-http.js';

const help = { requestId: '17', userId: '13', revision: 2, channelId: '14', caseState: 'open', paused: true };
function fixture() {
  const state = { identity: { userId: '11', guildId: '12', canManageOnboarding: true }, writes: [], failure: null,
    page: { state: 'ready', guildId: '12', entries: [help], next: null } };
  const api = { session: async () => state.identity, logout: async () => {}, onboardingHelp: async after => state.read ? state.read(after) : structuredClone(state.page),
    resolveOnboardingHelp: async body => { state.writes.push(structuredClone(body)); if (state.failure) throw state.failure; return { recorded: true, duplicate: state.writes.length > 1, resumed: true }; } };
  return { state, c: createAssistanceController({ api, onChange() {}, newRequestId: () => 'a'.repeat(64) }) };
}
test('assistance requires reviewed confirmation and retries the exact request after an uncertain response', async () => {
  const { state, c } = fixture(); await c.start(); c.review('17'); await c.submit(); assert.equal(state.writes.length, 0);
  c.confirm(true); state.failure = new DashboardFailure('connection'); await c.submit();
  assert.ok(c.snapshot().pending); c.review('17'); assert.equal(c.snapshot().review, null);
  state.failure = null; await c.retry(); assert.deepEqual(state.writes[0], state.writes[1]); assert.equal(c.snapshot().pending, null);
  assert.match(c.snapshot().notice, /run resumed/); assert.equal(state.writes[0].helpId, '17');
});
test('assistance clears private state on actor changes, conflict, authority loss and hidden-page races', async () => {
  const { state, c } = fixture(); await c.start(); c.review('17'); c.confirm(true); state.identity = { ...state.identity, userId: '99' };
  await c.submit(); assert.equal(state.writes.length, 0); assert.equal(c.snapshot().review, null);
  await c.refresh(); c.review('17'); c.confirm(true); state.failure = new DashboardFailure('conflict'); await c.submit();
  assert.equal(c.snapshot().page, null); assert.equal(c.snapshot().pending, null);
  let finish; state.read = () => new Promise(resolve => { finish = resolve; }); const reading = c.refresh();
  while (!finish) await new Promise(resolve => setImmediate(resolve)); c.suspend(); finish(state.page); await reading;
  assert.equal(c.snapshot().phase, 'loading'); assert.equal(c.snapshot().page, null);
  state.read = null; state.identity.canManageOnboarding = false; await c.checkAccess(); assert.equal(c.snapshot().identity, null);
});
test('assistance pagination preserves numeric IDs and rejects foreign or malformed queues', async () => {
  const { state, c } = fixture(); state.page.next = '17'; await c.start(); let after;
  state.read = async value => { after = value; return { ...state.page, entries: [], next: null }; }; await c.next(); assert.equal(after, '17');
  for (const page of [{ ...state.page, guildId: '99' }, { ...state.page, entries: [help, help] }, { ...state.page, next: '18' }]) {
    state.read = async () => page; await c.refresh(); assert.equal(c.snapshot().page, null);
  }
});
test('shared delivery UI uses only Shuttle routes, authority and closed kinds in Shuttle scope', async () => {
  const id = 'a'.repeat(32), calls = [], state = { allowed: true, kind: 'screen' };
  const api = { session: async () => ({ guildId: '12', userId: '11', canRecoverCases: true, canManageOnboarding: state.allowed }),
    onboardingDelivery: async () => ({ state: 'ready', guildId: '12', entries: [{ issueId: id, userId: '13', channelId: '14', revision: 2,
      caseState: 'open', kind: state.kind, reason: 'review', attempted: true, needsMessageId: true, recheckable: false, channelChoice: null }], next: null }),
    changeOnboardingDelivery: async body => { calls.push(body); return { recorded: true, duplicate: false }; } };
  const c = createDeliveryController({ api, scope: 'shuttle', onChange() {}, newRequestId: () => 'a'.repeat(64) });
  for (const kind of ['screen', 'alert']) { state.kind = kind; await c.refresh(); c.review(id, 'adopt_message', '17'); c.confirm(true); await c.submit(); }
  assert.equal(calls.length, 2); state.kind = 'reply'; await c.refresh(); assert.equal(c.snapshot().page, null);
  state.allowed = false; await c.checkAccess(); assert.equal(c.snapshot().phase, 'denied');
});
test('Shuttle routes are optional and classify expected denials, eligibility conflicts and closed input errors', async () => {
  let code, faults = 0; const create = onboardingStaff => createDashboardAuthHttpServer({ configuration: dashboardConfiguration, enabled: () => true,
    auth: {}, authorization: {}, onboardingStaff, onFault: () => { faults++; } });
  const absent = create(null), present = create({ execute: async () => { throw new ContractError(code); } });
  try {
    const off = await absent.listen(0), on = await present.listen(0); assert.equal((await dashboardBytes(off, '/api/shuttle/help')).status, 404);
    for (const [failure, expected] of [['SHUTTLE_HELP_NOT_FOUND', 403], ['SHUTTLE_ISSUE_NOT_FOUND', 403], ['STALE_SHUTTLE_HELP', 409],
      ['MEMBER_MUZZLED', 409], ['SHUTTLE_RECOVERY_MESSAGE_CHANGED', 409], ['SHUTTLE_STAFF_INPUT_INVALID', 400], ['SHUTTLE_STAFF_DISABLED', 503]]) {
      code = failure; const result = await dashboardBytes(on, '/api/shuttle/help'); assert.equal(result.status, expected); assert.equal(result.text.includes(code), false);
    }
    assert.equal(faults, 0);
  } finally { await absent.close(); await present.close(); }
});
test('Shuttle navigation needs feature availability and Shuttle authority; browser transport keeps both cursor types bounded', async () => {
  const actor = { guildId: '12', userId: '11', capabilities: {}, canManageCases: true, canManageOnboarding: true }, csrf = 'a'.repeat(64);
  const session = dashboardSessionView(actor, csrf, { onboardingStaff: true }), presentation = await createDashboardPresentation();
  for (const path of ['/shuttle-assistance', '/shuttle-delivery']) {
    assert.equal(dashboardReturnPath(path), path); assert.equal(dashboardPageAllowed(path, session), true);
    assert.equal(dashboardPageAllowed(path, dashboardSessionView(actor, csrf)), false);
    assert.equal(dashboardPageAllowed(path, { ...session, canManageOnboarding: false }), false);
    assert.match(presentation.get(path, session).bytes.toString(), /Shuttle/);
  }
  const calls = [], api = createDashboardApi({ document: null, fetch: async (path, options) => { calls.push([path, options]); return Response.json(path === '/auth/session' ? session : {}); } });
  assert.equal((await api.session()).canManageOnboarding, true); await api.onboardingHelp('17'); assert.equal(calls.at(-1)[0], '/api/shuttle/help?after=17');
  await api.onboardingDelivery('b'.repeat(32)); assert.equal(calls.at(-1)[0], '/api/shuttle/delivery?after=' + 'b'.repeat(32));
  assert.throws(() => api.onboardingHelp('17&after=18')); assert.throws(() => api.onboardingDelivery('b'.repeat(48)));
  const body = { helpId: '17', expectedRevision: 2, confirmed: true, requestId: csrf }; await api.resolveOnboardingHelp(body); await api.resolveOnboardingHelp(body);
  assert.equal(calls.at(-1)[1].body, calls.at(-2)[1].body); assert.equal(calls.at(-1)[1].headers['X-CSRF-Token'], csrf);
});
