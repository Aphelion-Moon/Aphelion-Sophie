import assert from 'node:assert/strict';
import { createCaseManagementHttp } from '../../apps/core/http/case-management.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { conversationWorkflow } from '../../tests/fixtures/case-conversations.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { caseStaffPayload } from '../../tests/fixtures/case-staff.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { PARTICIPANT } from '../../tests/fixtures/case-participants.js';
import { CREW } from '../../tests/fixtures/discord.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';

export async function runCaseManagementSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await conversationWorkflow(cluster), d = dashboardServices(f), enabled = () => f.clock.enabled;
    let beforeObserve = null, sequence = 0; const errors = [];
    const management = createCaseManagementHttp({ auth: d.auth, authorization: d.dashboardAuthorization, store: d.protectedStore,
      discord: { async observe(id) { const observation = await f.discord.roles.observe(id); if (beforeObserve) await beforeObserve(); return observation; } },
      limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1000 }, enabled });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: d.auth, authorization: d.dashboardAuthorization,
      management: { async execute(input) { try { return await management.execute(input); } catch (error) { errors.push(error.code ?? error.name); throw error; } } }, enabled, onFault() {} });
    const address = await server.listen();
    async function login(userId = OTHER) {
      const login = await d.login(userId), session = await d.auth.authenticate({ token: login.token });
      return { Cookie: `${DASHBOARD_COOKIES.session}=${login.token}`, Origin: dashboardConfiguration.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
    }
    const headers = await login(), current = async () => (await f.rows('case_reservations')).find(row => row.id === f.opened.id);
    const get = (path = `/api/cases/manage?channelId=${f.opened.channel_id}`, selectedHeaders = headers) => dashboardHttp(address, path, { headers: selectedHeaders });
    const body = async (action, overrides = {}) => ({ channelId: f.opened.channel_id, requestId: String(++sequence).padStart(64, '0'), expectedVersion: (await current()).version,
      action, targetId: null, reason: action === 'close' ? 'resolved' : action === 'reopen' ? 'follow-up' : null, confirmed: true, ...overrides });
    const post = (value, selectedHeaders = headers) => dashboardHttp(address, '/api/cases/manage/change', { method: 'POST', headers: selectedHeaders, body: JSON.stringify(value) });
    try { await work({ ...f, d, errors, current, login, headers, get, body, post, beforeObserve: hook => { beforeObserve = hook; } }); }
    finally { await server.close(); }
  });
  await scenario('MG01 strict management routes reject members, missing CSRF, unconfirmed changes and supplied actor snapshots', async f => {
    const member = await f.login(USER), request = await f.body('close');
    assert.equal((await f.get(undefined, member)).status, 403); assert.equal((await f.get('/api/cases/queue', member)).status, 403);
    assert.equal((await f.post(request, member)).status, 403);
    assert.equal((await f.post(request, { ...f.headers, 'X-CSRF-Token': '' })).status, 403);
    for (const extra of [{ confirmed: false }, { actor: { userId: OTHER } }, { observation: {} }, { targetId: USER }]) assert.equal((await f.post({ ...request, ...extra })).status, 400);
    assert.equal((await f.rows('case_lifecycle_actions')).length, 0);
    assert.equal((await f.get('/api/cases/manage?channelId=99999')).status, 403);
  });
  await scenario('MG02 browser ownership uses durable receipts and the same version and authority rules as signed Discord', async f => {
    const request = await f.body('claim'); assert.equal((await f.post(request)).body.recorded, true);
    assert.equal((await f.post(request)).body.duplicate, true); assert.equal((await f.rows('case_staff_actions')).length, 1);
    assert.equal((await f.post({ ...request, action: 'unclaim' })).status, 409);
    assert.equal((await f.post(await f.body('unclaim'))).status, 200);
    assert.equal(await f.execute(caseStaffPayload(f, 'claim', await f.current())), 'case_staff_recorded');
    assert.equal((await f.post(request)).body.duplicate, true); assert.equal((await f.current()).assignee_grant.userId, OTHER);
    f.discord.state.members.set(PARTICIPANT, [STAFF]);
    assert.equal((await f.post(await f.body('assign', { targetId: PARTICIPANT, reason: 'handoff' }))).status, 200);
    assert.equal((await f.current()).assignee_grant.userId, PARTICIPANT);
    assert.equal((await f.post(await f.body('unclaim'))).status, 409);
    const receipts = await f.rows('receipts'); assert.ok(receipts.some(row => /^dashboard\.[a-f0-9]{64}$/.test(row.interaction_id)));
    assert.ok(receipts.some(row => /^[0-9]+$/.test(row.interaction_id)));
  });
  await scenario('MG03 browser close and reopen preserve asynchronous delivery and reconcile actual private channel permissions', async f => {
    const request = await f.body('close'), writes = f.discord.state.calls.filter(call => call.method !== 'GET').length;
    assert.equal((await f.post(request)).status, 200); assert.equal((await f.current()).state, 'closing');
    assert.equal(f.discord.state.calls.filter(call => call.method !== 'GET').length, writes);
    assert.ok((await f.rows('outbox')).some(row => row.operation_id.startsWith('case.lifecycle.dashboard.')));
    await f.drain(f.cases); assert.equal((await f.current()).state, 'closed');
    f.clock.now += 2000; assert.equal((await f.post(await f.body('reopen'))).status, 200); assert.equal((await f.current()).state, 'pending');
    await f.drain(f.cases); assert.equal((await f.current()).state, 'open');
    const description = await f.store.describeCase({ actor: await f.actor(OTHER), guildId: GUILD, id: f.opened.id });
    await f.discord.channels.verification.channel(await f.discord.channels.inspect(description.plan, description.channelId), description.plan, 'open');
    assert.equal((await f.post(request)).body.duplicate, true); assert.equal((await f.current()).state, 'open');
  });
  await scenario('MG04 confirmed participant controls retain invitations and revoke explicit access through the existing worker', async f => {
    f.discord.state.members.set(PARTICIPANT, [CREW]);
    const request = await f.body('add-participant', { targetId: PARTICIPANT, reason: 'case-context' });
    assert.equal((await f.post({ ...request, confirmed: false })).status, 400);
    assert.equal((await f.post(request)).status, 200); assert.equal((await f.rows('case_participants'))[0].status, 'pending');
    assert.equal(f.discord.state.channels.get(f.opened.channel_id).permission_overwrites.some(row => row.id === PARTICIPANT), false);
    await f.drain(f.cases); assert.equal((await f.rows('case_participants'))[0].status, 'active');
    assert.equal(f.discord.state.channels.get(f.opened.channel_id).permission_overwrites.some(row => row.id === PARTICIPANT), true);
    assert.equal((await f.post(request)).body.duplicate, true);
    assert.equal((await f.get()).body.participantIds.includes(PARTICIPANT), true);
    assert.equal((await f.post(await f.body('remove-participant', { targetId: PARTICIPANT, reason: 'no-longer-needed' }))).status, 200);
    await f.drain(f.cases); assert.equal((await f.rows('case_participants'))[0].status, 'removed');
    assert.equal(f.discord.state.channels.get(f.opened.channel_id).permission_overwrites.some(row => row.id === PARTICIPANT), false);
  });
  await scenario('MG05 case queues and management reads are private and exclude Head Admin cases from ordinary Staff', async f => {
    const page = await f.get(); assert.equal(page.status, 200); assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(Object.hasOwn(page.body, 'plan'), false); assert.equal(Object.hasOwn(page.body, 'operator_grant'), false);
    const queue = await f.get('/api/cases/queue?filter=active'); assert.equal(queue.status, 200); assert.equal(queue.body.entries.length, 1);
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact' WHERE id = $1", [f.opened.id]);
    f.discord.state.members.set(USER, [STAFF]); const ordinary = await f.login(USER);
    assert.equal((await f.get(undefined, ordinary)).status, 403); assert.equal((await f.get('/api/cases/queue', ordinary)).body.entries.length, 0);
    assert.equal((await f.get()).status, 200);
  });
  await scenario('MG06 losing authority during fresh member observation prevents a lifecycle write', async f => {
    f.beforeObserve(() => f.discord.state.members.set(OTHER, []));
    assert.equal((await f.post(await f.body('close'))).status, 403);
    assert.equal((await f.rows('case_lifecycle_actions')).length, 0); assert.equal((await f.current()).state, 'open');
  });
  await scenario('MG07 the bounded HTTP lane rejects a competing request and its exact retry cannot overwrite the committed version', async f => {
    const claim = await f.body('claim'), close = await f.body('close');
    const results = await Promise.all([f.post(claim), f.post(close)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 503]);
    const busy = results.findIndex(result => result.status === 503);
    assert.equal(results[busy].body.error, 'Sign-in is busy. Please try again shortly.'); assert.deepEqual(f.errors, []);
    assert.equal((await f.post([claim, close][busy])).status, 409); assert.deepEqual(f.errors, ['STALE_CASE_VERSION']);
    assert.equal((await f.rows('case_staff_actions')).length + (await f.rows('case_lifecycle_actions')).length, 1);
  });
  await scenario('MG08 queued browser reopening rechecks the retained Staff grant before granting Discord write access', async f => {
    assert.equal((await f.post(await f.body('close'))).status, 200); await f.drain(f.cases);
    f.clock.now += 2000; assert.equal((await f.post(await f.body('reopen'))).status, 200);
    f.discord.state.members.set(OTHER, []); await f.drain(f.cases);
    assert.equal((await f.current()).state, 'closed');
    assert.equal((await f.rows('case_lifecycle_actions')).find(row => row.action === 'reopen').status, 'revoked');
    assert.equal((await f.get()).status, 403);
  });
}
