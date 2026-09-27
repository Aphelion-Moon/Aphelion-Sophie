import assert from 'node:assert/strict';
import { createContactEntryHttp } from '../../apps/core/http/contact-entry.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { createCaseIntakeStore } from '../../apps/core/storage/case-intake.js';
import { contactWorkflow } from '../../tests/fixtures/case-contacts.js';
import { syntheticCaseForm, syntheticCaseValues } from '../../tests/fixtures/case-intake.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { PARTICIPANT } from '../../tests/fixtures/case-participants.js';
import { CREW } from '../../tests/fixtures/discord.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';

export async function runContactEntrySuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await contactWorkflow(cluster), d = dashboardServices(f), authorization = d.dashboardAuthorization;
    const store = createCaseIntakeStore({ pool: f.pool, clock: () => f.clock.now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, resolveCaseParticipant: authorization.resolveCaseParticipant,
      authorizeCaseParticipant: authorization.authorizeCaseParticipant, policy: casePolicy,
      limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1000 }, verification: f.discord.channels.verification });
    const contactEntry = createContactEntryHttp({ auth: d.auth, authorization, store, discord: f.discord.roles, channels: f.discord.channels, enabled: () => f.clock.enabled });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: d.auth, authorization, contactEntry, enabled: () => f.clock.enabled,
      onFault: () => {} });
    const address = await server.listen();
    async function login(userId = OTHER) { const login = await d.login(userId), session = await d.auth.authenticate({ token: login.token });
      return { Cookie: `${DASHBOARD_COOKIES.session}=${login.token}`, Origin: dashboardConfiguration.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }; }
    const headers = await login(), post = (action, body, selected = headers) => dashboardHttp(address, `/api/contacts/${action}`, { method: 'POST', headers: selected, body: JSON.stringify(body) });
    const get = (path, selected = headers) => dashboardHttp(address, `/api/contacts/${path}`, { headers: selected });
    const selection = { requestId: 'a'.repeat(64), recipientIds: [PARTICIPANT] };
    const select = async () => { const response = await post('select', selection); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
    const confirm = async token => { const response = await post('confirm', { formToken: token, confirmed: true }); assert.equal(response.status, 200); return response.body; };
    const submit = token => ({ formToken: token, requestId: 'b'.repeat(64), values: syntheticCaseValues(), confirmed: true });
    try { await f.publish(syntheticCaseForm('staff-contact')); await work({ ...f, d, store, authorization, login, headers, post, get, selection, select, confirm, submit }); }
    finally { await server.close(); }
  });
  await scenario('CE01 contact entry requires current Staff authority, exact request fields, CSRF and explicit audience confirmation', async f => {
    const member = await f.login(USER);
    assert.equal((await f.get('access', member)).status, 403);
    assert.equal((await f.post('select', f.selection, member)).status, 403);
    assert.equal((await f.post('select', f.selection, { ...f.headers, 'X-CSRF-Token': '' })).status, 403);
    for (const extra of [{ actor: { userId: OTHER } }, { recipientIds: [PARTICIPANT, PARTICIPANT] }, { requestId: '123' }]) assert.equal((await f.post('select', { ...f.selection, ...extra })).status, 400);
    const selected = await f.select();
    assert.equal((await f.post('confirm', { formToken: selected.token, confirmed: false })).status, 400);
    assert.equal((await f.post('submit', f.submit(selected.token))).status, 409);
    assert.equal((await f.rows('case_intakes')).length, 0);
  });
  await scenario('CE02 reviewed browser contact records one pinned intake and verified private destination through the existing delivery worker', async f => {
    const selected = await f.select(); assert.deepEqual((await f.select()).recipientIds, [PARTICIPANT]);
    assert.equal((await f.rows('case_form_slots')).length, 1); const confirmed = await f.confirm(selected.token);
    assert.equal(confirmed.form.caseType, 'staff-contact'); assert.equal(confirmed.version, 1);
    await f.publish({ ...syntheticCaseForm('staff-contact'), title: 'New synthetic revision' }, 2);
    const request = f.submit(selected.token); assert.equal((await f.post('submit', request)).body.recorded, true);
    assert.equal((await f.post('submit', request)).body.duplicate, true); assert.equal((await f.rows('case_intakes')).length, 1);
    const intake = (await f.rows('case_intakes'))[0]; assert.equal(intake.form_version, 1); assert.deepEqual(intake.answers, request.values);
    assert.match(intake.interaction_id, /^dashboard\.[a-f0-9]{64}$/);
    assert.equal((await f.rows('case_participant_actions')).length, 1);
    assert.equal((await f.get(`destination?requestId=${request.requestId}`)).body.state, 'preparing');
    await f.drain(f.cases); await f.drain(f.intakeWorker);
    const destination = await f.get(`destination?requestId=${request.requestId}`); assert.equal(destination.status, 200); assert.equal(destination.body.state, 'ready');
    const acl = f.discord.state.channels.get(destination.body.channelId).permission_overwrites;
    assert.ok(acl.some(row => row.id === PARTICIPANT)); assert.ok(!acl.some(row => row.id === USER));
    for (const table of ['receipts', 'outbox', 'case_participant_actions']) assert.equal(JSON.stringify(await f.rows(table)).includes(request.values[0].value), false);
    assert.equal((await f.get(`destination?requestId=${request.requestId}`, await f.login(USER))).status, 403);
  });
  await scenario('CE03 form ownership and recipient revocation remain authoritative at browser confirmation and submission', async f => {
    const selected = await f.select(); f.discord.state.members.set(USER, [STAFF]); const otherStaff = await f.login(USER);
    assert.equal((await f.post('confirm', { formToken: selected.token, confirmed: true }, otherStaff)).status, 403);
    await f.confirm(selected.token); f.discord.state.members.delete(PARTICIPANT);
    assert.equal((await f.post('submit', f.submit(selected.token))).status, 403); assert.equal((await f.rows('case_intakes')).length, 0);
  });
  await scenario('CE04 cancellation and expiry leave no case and reject stale browser handles', async f => {
    const selected = await f.select();
    for (let n = 0; n < 2; n++) assert.equal((await f.post('cancel', { formToken: selected.token })).body.cancelled, true);
    assert.equal((await f.post('confirm', { formToken: selected.token, confirmed: true })).status, 409);
    await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 second'");
    assert.equal((await f.get(`review?requestId=${f.selection.requestId}`)).status, 409);
    assert.equal((await f.rows('case_intakes')).length, 0);
  });
  await scenario('CE05 contact submission rejects an ordinary member-form handle and never coerces its audience', async f => {
    await f.publish(syntheticCaseForm());
    const prepared = await f.prepare('admin-help', { member: { user: { id: OTHER } } }); assert.equal(prepared.result.status, 'modal');
    assert.equal((await f.post('submit', f.submit(prepared.result.modal.token))).status, 400);
    assert.equal((await f.rows('case_intakes')).length, 0);
  });
  await scenario('CE06 exact browser receipt retries never replace answers or create another contact after an ambiguous response', async f => {
    const selected = await f.select(); await f.confirm(selected.token); const request = f.submit(selected.token);
    assert.equal((await f.post('submit', request)).status, 200);
    const changed = structuredClone(request); changed.values[0].value = 'Different synthetic answers.';
    assert.equal((await f.post('submit', changed)).status, 409);
    const fresh = { ...request, requestId: 'c'.repeat(64) }; assert.equal((await f.post('submit', fresh)).body.duplicate, true);
    assert.equal((await f.rows('case_intakes')).length, 1); assert.equal((await f.rows('case_participant_actions')).length, 1);
  });
  await scenario('CE07 current Staff loss blocks browser read and submission and queued contact creation remains fenced', async f => {
    const selected = await f.select(); await f.confirm(selected.token); const request = f.submit(selected.token);
    assert.equal((await f.post('submit', request)).status, 200); f.discord.state.members.set(OTHER, [CREW]);
    assert.equal((await f.get('access')).status, 403); assert.equal((await f.post('submit', request)).status, 403);
    await f.drain(f.cases); assert.equal(f.discord.state.calls.filter(call => call.method !== 'GET').length, 0);
    assert.equal((await f.rows('case_reservations'))[0].state, 'failed');
    assert.equal((await f.rows('case_intakes'))[0].contact_status, 'revoked');
  });
}
