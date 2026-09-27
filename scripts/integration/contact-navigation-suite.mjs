import assert from 'node:assert/strict';
import { createContactNavigationHttp } from '../../apps/core/http/contact-navigation.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { createCaseIntakeStore } from '../../apps/core/storage/case-intake.js';
import { contactWorkflow, contactEntryPayload } from '../../tests/fixtures/case-contacts.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { GUILD, USER, OTHER } from '../../tests/fixtures/domain.js';
import { PARTICIPANT, participantServices } from '../../tests/fixtures/case-participants.js';
import { CREW } from '../../tests/fixtures/discord.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';

export async function runContactNavigationSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await contactWorkflow(cluster), opened = await f.openContact(), d = dashboardServices(f), authorization = d.dashboardAuthorization;
    const store = createCaseIntakeStore({ pool: f.pool, clock: () => f.clock.now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, resolveCaseParticipant: authorization.resolveCaseParticipant,
      authorizeCaseParticipant: authorization.authorizeCaseParticipant, policy: casePolicy, limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1000 }, verification: f.discord.channels.verification });
    let afterInspection = null;
    const contactNavigation = createContactNavigationHttp({ auth: d.auth, authorization, store, discord: f.discord.roles,
      channels: { async inspect(...args) { const proof = await f.discord.channels.inspect(...args); if (afterInspection) await afterInspection(); return proof; } }, enabled: () => f.clock.enabled });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: d.auth, authorization, contactNavigation, enabled: () => f.clock.enabled, onFault() {} });
    const address = await server.listen();
    async function login(userId = PARTICIPANT) { const login = await d.login(userId), session = await d.auth.authenticate({ token: login.token });
      return { Cookie: `${DASHBOARD_COOKIES.session}=${login.token}`, Origin: dashboardConfiguration.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }; }
    const headers = await login(), request = (path, selected = headers, method = 'GET') => dashboardHttp(address, path, { headers: selected, method });
    const get = (suffix = '', selected = headers) => request(`/api/contacts/received${suffix}`, selected);
    const token = (await f.rows('case_provisions'))[0].operation_token;
    try { await work({ ...f, d, opened, token, headers, login, request, get, afterInspection: hook => { afterInspection = hook; }, destination: selected => get(`/destination?caseToken=${token}`, selected) }); }
    finally { await server.close(); }
  });
  await scenario('RN01 recipient HTTP lists match signed Discord metadata without contact content or Staff-only access', async f => {
    const response = await f.get(), signed = await f.contacts.view(f.verified(contactEntryPayload(f, 'contacts', PARTICIPANT)));
    assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, { ...signed, actorId: PARTICIPANT, guildId: GUILD });
    assert.deepEqual(Object.keys(response.body.items[0]).sort(), ['access', 'createdAt', 'openerId', 'token']);
    assert.equal((await f.get('', await f.login(OTHER))).body.items.length, 0);
    assert.equal((await f.get('', await f.login(USER))).body.items.length, 0);
    const next = await f.get(`?after=${f.token}`); assert.equal(next.status, 200); assert.deepEqual(next.body.items, []);
    assert.equal((await f.get(`?after=${f.token}`, await f.login(USER))).status, 403);
  });
  await scenario('RN02 a copied recipient reference never grants another member or uninvited Staff a destination', async f => {
    const current = await f.destination(); assert.equal(current.status, 200); assert.equal(current.body.channelId, f.opened.row.channel_id); assert.equal(current.body.access, 'open');
    assert.equal((await f.destination(await f.login(USER))).status, 403); assert.equal((await f.destination(await f.login(OTHER))).status, 403);
    assert.equal((await f.get(`/destination?caseToken=${'a'.repeat(48)}`)).status, 403);
    assert.equal(JSON.stringify(current.body).includes('plan'), false);
  });
  await scenario('RN03 explicit invitation removal clears recipient HTTP discovery and access while retaining the contact', async f => {
    await participantServices(f).changeParticipant(f.opened.row, { action: 'remove' });
    assert.equal((await f.get()).body.items.length, 0); assert.equal((await f.destination()).status, 403);
    assert.equal((await f.rows('case_intakes')).length, 1); assert.equal((await f.rows('case_participants'))[0].status, 'removed');
  });
  await scenario('RN04 late recipient departure during channel inspection denies the link and rejoining cannot revive its invitation', async f => {
    let departed = false;
    f.discord.state.before = call => { if (!departed && call.method === 'GET' && call.path.endsWith(`/channels/${f.opened.row.channel_id}`)) {
      departed = true; f.discord.state.members.delete(PARTICIPANT);
    } };
    assert.equal((await f.destination()).status, 403); assert.equal(departed, true);
    f.discord.state.members.set(PARTICIPANT, [CREW]); const renewed = await f.login();
    assert.equal((await f.destination(renewed)).status, 403); assert.equal((await f.get('', renewed)).body.items.length, 0);
  });
  await scenario('RN05 closed recipient links remain read-only and channel-category or ACL drift never yields a verified destination', async f => {
    assert.equal(await f.execute(ticketPayload(f, 'close', f.opened.row, { member: { user: { id: OTHER } } })), 'case_change_recorded'); await f.drain(f.cases);
    const closed = await f.destination(); assert.equal(closed.status, 200); assert.equal(closed.body.access, 'closed');
    const channel = f.discord.state.channels.get(f.opened.row.channel_id), parent = channel.parent_id;
    channel.parent_id = USER; const moved = await f.destination(); assert.equal(moved.status, 503); assert.equal(Object.hasOwn(moved.body, 'channelId'), false);
    channel.parent_id = parent; channel.permission_overwrites.push({ id: USER, type: 1, allow: '1024', deny: '0' });
    assert.equal((await f.destination()).status, 503);
  });
  await scenario('RN06 recipient endpoints reject forged snapshots and extra query fields and honor the delivery gate', async f => {
    for (const query of ['?actor=123', '?after=123', `?after=${f.token}&after=${f.token}`, `/destination?caseToken=${f.token}&userId=${USER}`, '/destination']) assert.equal((await f.get(query)).status, 400);
    assert.equal((await f.request('/api/contacts/received', f.headers, 'POST')).status, 403);
    f.clock.enabled = false;
    for (const response of [await f.get(), await f.destination()]) {
      assert.equal(response.status, 503); assert.deepEqual(response.body, { error: 'Sign-in is currently unavailable.' });
    }
  });
  await scenario('RN07 logout revokes recipient HTTP access and no mutation or content is exposed by navigation', async f => {
    const before = (await f.rows('case_reservations'))[0]; await f.get(); await f.destination();
    assert.equal((await f.rows('case_reservations'))[0].version, before.version); assert.equal((await f.rows('case_lifecycle_actions')).length, 0);
    assert.equal((await f.request('/auth/logout', f.headers, 'POST')).status, 200);
    assert.equal((await f.get()).status, 403); assert.equal((await f.destination()).status, 403);
  });
  await scenario('RN08 a delivery gate lost after channel inspection prevents returning a verified recipient link', async f => {
    f.afterInspection(() => { f.clock.enabled = false; }); const response = await f.destination();
    assert.equal(response.status, 403); assert.deepEqual(response.body, { error: 'Sign-in or request could not be verified.' });
  });
}
