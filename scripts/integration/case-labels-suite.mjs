import assert from 'node:assert/strict';
import { createCaseLabels } from '../../apps/core/storage/case-labels.js';
import { createCaseLabelsHttp } from '../../apps/core/http/case-labels.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { createCaseTranscripts } from '../../apps/core/storage/case-transcripts.js';
import { conversationWorkflow } from '../../tests/fixtures/case-conversations.js';
import { caseStaffPayload } from '../../tests/fixtures/case-staff.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';

export async function runCaseLabelsSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await conversationWorkflow(cluster);
    await work({ ...f, labels: createCaseLabels({ pool: f.pool, authorize: f.authorization.authorize, clock: () => f.clock.now }),
      staff: await f.actor(OTHER), member: await f.actor(USER), channelId: f.opened.channel_id });
  });
  const request = (f, overrides = {}) => ({ actor: f.staff, channelId: f.channelId, expectedVersion: f.opened.version,
    requestId: 'a'.repeat(64), priority: 'high', tags: ['Synthetic-manual-tag'], ...overrides });
  const read = f => f.labels.readCaseLabels({ actor: f.staff, channelId: f.channelId });
  await scenario('CL01 manual labels retain attribution and exact replay without clobbering a later edit', async f => {
    const original = await read(f); assert.equal(original.priority, 'normal'); assert.deepEqual(original.tags, []);
    const input = request(f), result = await f.labels.changeCaseLabels(input); assert.equal(result.version, original.version + 1);
    const next = await read(f); assert.deepEqual(next.tags, input.tags); assert.equal(next.history[0].authorId, OTHER);
    await f.labels.changeCaseLabels(request(f, { requestId: 'b'.repeat(64), expectedVersion: next.version, priority: 'urgent', tags: ['Later'] }));
    assert.deepEqual(await f.labels.changeCaseLabels(input), { version: result.version, duplicate: true });
    assert.deepEqual((await read(f)).tags, ['Later']);
    await assert.rejects(f.labels.changeCaseLabels({ ...input, tags: ['Conflict'] }), /CASE_LABEL_REQUEST_COLLISION/);
    assert.equal((await f.rows('case_label_changes')).length, 2);
  });
  await scenario('CL02 members cannot read or change labels and ordinary Staff cannot inspect Head Admin labels', async f => {
    await assert.rejects(f.labels.readCaseLabels({ actor: f.member, channelId: f.channelId }), /CASE_ACCESS_DENIED/);
    await assert.rejects(f.labels.changeCaseLabels(request(f, { actor: f.member })), /CASE_ACCESS_DENIED/);
    await assert.rejects(f.labels.readCaseLabels({ actor: f.member, channelId: '99999' }), /CASE_ACCESS_DENIED/);
    f.discord.state.members.set(USER, [STAFF]); const staff = await f.actor(USER);
    await f.labels.changeCaseLabels(request(f, { actor: staff }));
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact' WHERE id = $1", [f.opened.id]);
    await assert.rejects(f.labels.readCaseLabels({ actor: staff, channelId: f.channelId }), /CASE_ACCESS_DENIED/);
    assert.equal((await read(f)).priority, 'high');
  });
  await scenario('CL03 role loss suppresses reads and rolls back both state and audit during saves', async f => {
    let checks = 0;
    const racing = createCaseLabels({ pool: f.pool, clock: () => f.clock.now, authorize: async (...args) => {
      if (++checks === 2) f.discord.state.members.set(OTHER, []);
      return f.authorization.authorize(...args);
    } });
    await assert.rejects(racing.changeCaseLabels(request(f)), /CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_label_changes')).length, 0);
    assert.equal((await f.rows('case_reservations')).find(row => row.id === f.opened.id).priority, 'normal');
    f.discord.state.members.set(OTHER, [LEAD]); f.staff = await f.actor(OTHER); checks = 0;
    await assert.rejects(racing.readCaseLabels({ actor: f.staff, channelId: f.channelId }), /CASE_ACCESS_DENIED/);
  });
  await scenario('CL04 concurrent saves use case versions and an old assignment cannot overwrite their version', async f => {
    const results = await Promise.allSettled([f.labels.changeCaseLabels(request(f)), f.labels.changeCaseLabels(request(f, { requestId: 'b'.repeat(64), tags: ['Other'] }))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'STALE_CASE_VERSION');
    await assert.rejects(f.store.changeCaseAssignment({ actor: f.staff, guildId: f.staff.guildId, interactionId: f.nextId(),
      id: f.opened.id, expectedVersion: f.opened.version, action: 'claim' }), /STALE_CASE_VERSION/);
    assert.equal((await f.rows('case_label_changes')).length, 1);
  });
  await scenario('CL05 retained history is bounded and paginated without losing the current labels', async f => {
    let version = f.opened.version;
    for (let i = 1; i <= 27; i++) version = (await f.labels.changeCaseLabels(request(f, { requestId: String(i).padStart(64, '0'), expectedVersion: version, tags: [`Synthetic-${i}`] }))).version;
    const first = await read(f); assert.equal(first.history.length, 25); assert.deepEqual(first.tags, ['Synthetic-27']);
    const second = await f.labels.readCaseLabels({ actor: f.staff, channelId: f.channelId, before: first.next });
    assert.equal(second.history.length, 2); assert.equal(second.next, null); assert.deepEqual(second.tags, first.tags);
    assert.ok(first.history.at(-1).version > second.history[0].version);
  });
  await scenario('CL06 signed Discord label changes share the same store and status excludes audit internals', async f => {
    const payload = caseStaffPayload(f, 'label', f.opened, { priority: 'urgent', tags: 'Signed, Follow-up' });
    assert.equal(await f.execute(payload), 'case_labels_recorded'); assert.equal(await f.execute(payload), 'case_labels_recorded');
    const view = await f.caseStaff.status(f.verified(payload)); assert.deepEqual(view.tags, ['Signed', 'Follow-up']);
    assert.equal(view.priority, 'urgent'); assert.equal(Object.hasOwn(view, 'operator_grant'), false);
    assert.equal((await f.rows('case_label_changes')).length, 1);
    assert.equal(await f.execute(caseStaffPayload(f, 'label', f.opened)), 'case_stale');
  });
  await scenario('CL07 authenticated labels HTTP requires CSRF and rejects revoked or expanded requests', async f => {
    const d = dashboardServices(f), authorization = d.dashboardAuthorization;
    const labels = createCaseLabels({ pool: f.pool, authorize: authorization.authorize, clock: () => f.clock.now });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: d.auth, authorization,
      labels: createCaseLabelsHttp({ auth: d.auth, authorization, labels }), enabled: () => true, onFault() {} });
    const address = await server.listen();
    try {
      const login = await d.login(OTHER), session = await d.auth.authenticate({ token: login.token }), cookie = `${DASHBOARD_COOKIES.session}=${login.token}`;
      const body = { channelId: f.channelId, requestId: 'e'.repeat(64), expectedVersion: f.opened.version, priority: 'low', tags: ['Web'] };
      const options = { method: 'POST', headers: { Cookie: cookie, Origin: dashboardConfiguration.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify(body) };
      assert.equal((await dashboardHttp(address, '/api/cases/labels/save', { ...options, headers: { ...options.headers, 'X-CSRF-Token': '' } })).status, 403);
      assert.equal((await dashboardHttp(address, '/api/cases/labels/save', { ...options, body: JSON.stringify({ ...body, actor: {} }) })).status, 400);
      assert.equal((await dashboardHttp(address, '/api/cases/labels/save', options)).status, 200);
      const page = await dashboardHttp(address, `/api/cases/labels?channelId=${f.channelId}`, { headers: { Cookie: cookie } });
      assert.equal(page.headers['cache-control'], 'no-store'); assert.deepEqual(page.body.tags, ['Web']);
      f.discord.state.members.set(OTHER, []);
      assert.equal((await dashboardHttp(address, `/api/cases/labels?channelId=${f.channelId}`, { headers: { Cookie: cookie } })).status, 403);
    } finally { await server.close(); }
  });
  await scenario('CL08 authored labels remain outside transcript, generic receipts, outbox and recovery controls', async f => {
    await f.labels.changeCaseLabels(request(f));
    const transcripts = createCaseTranscripts({ pool: f.pool, authorization: f.authorization, roles: f.discord.roles, childAccess: {}, clock: () => f.clock.now });
    const values = [await transcripts.readChannel({ actor: f.member, channelId: f.channelId }), await f.rows('outbox'), await f.rows('receipts'),
      (await f.admin.query('SELECT control_key, before_state, after_state FROM sophie_control.events')).rows];
    assert.equal(JSON.stringify(values).includes('Synthetic-manual-tag'), false);
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_label_changes'), error => error.code === '42501');
  });
  await scenario('CL09 closed cases retain manual labels while sealed cases reject changes without altering audience', async f => {
    const before = (await f.rows('case_provisions')).find(row => row.case_id === f.opened.id);
    await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed' WHERE id = $1", [f.opened.id]);
    await f.labels.changeCaseLabels(request(f));
    assert.equal((await read(f)).priority, 'high');
    const after = (await f.rows('case_provisions')).find(row => row.case_id === f.opened.id); assert.deepEqual(after, before);
    await f.admin.query("UPDATE sophie_core.case_reservations SET desired_access = 'sealed' WHERE id = $1", [f.opened.id]);
    await assert.rejects(read(f), /CASE_ACCESS_DENIED/);
    await assert.rejects(f.labels.changeCaseLabels(request(f)), /CASE_ACCESS_DENIED/);
  });
}
