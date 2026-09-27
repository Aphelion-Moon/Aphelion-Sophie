import assert from 'node:assert/strict';
import { createCaseNotes } from '../../apps/core/storage/case-notes.js';
import { createCaseNotesHttp } from '../../apps/core/http/case-notes.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { createCaseTranscripts } from '../../apps/core/storage/case-transcripts.js';
import { conversationWorkflow } from '../../tests/fixtures/case-conversations.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';

export async function runCaseNotesSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await conversationWorkflow(cluster);
    const notes = createCaseNotes({ pool: f.pool, authorize: f.authorization.authorize, clock: () => f.clock.now });
    await work({ ...f, notes, channelId: f.opened.channel_id, staff: await f.actor(OTHER), member: await f.actor(USER) });
  });
  const request = (f, text = 'Synthetic restricted note', requestId = 'a'.repeat(64)) => ({ actor: f.staff, channelId: f.channelId, text, requestId });
  await scenario('CN01 authorized append retains attributed text and retries one receipt without creating duplicate notes', async f => {
    assert.deepEqual(await f.notes.append(request(f)), { number: 1, duplicate: false });
    assert.deepEqual(await f.notes.append(request(f)), { number: 1, duplicate: true });
    const page = await f.notes.read({ actor: f.staff, channelId: f.channelId });
    assert.deepEqual(page.entries, [{ number: 1, authorId: OTHER, createdAt: f.clock.now, text: 'Synthetic restricted note' }]);
    await assert.rejects(f.notes.append(request(f, 'Different text')), /CASE_NOTE_REQUEST_COLLISION/);
    assert.equal((await f.rows('case_notes')).length, 1);
  });
  await scenario('CN02 member and unknown-channel requests disclose no notes and do not create a record', async f => {
    await f.notes.append(request(f));
    await assert.rejects(f.notes.read({ actor: f.member, channelId: f.channelId }), /CASE_ACCESS_DENIED/);
    await assert.rejects(f.notes.append({ ...request(f), actor: f.member }), /CASE_ACCESS_DENIED/);
    await assert.rejects(f.notes.read({ actor: f.member, channelId: '99999999999' }), /CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_notes')).length, 1);
  });
  await scenario('CN03 ordinary Staff can use ordinary notes but a Staff requester cannot use Head Admin contact notes', async f => {
    f.discord.state.members.set(USER, [STAFF]); const staffRequester = await f.actor(USER);
    await f.notes.append({ ...request(f), actor: staffRequester });
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact' WHERE id = $1", [f.opened.id]);
    await assert.rejects(f.notes.read({ actor: staffRequester, channelId: f.channelId }), /CASE_ACCESS_DENIED/);
    assert.equal((await f.notes.read({ actor: f.staff, channelId: f.channelId })).entries.length, 1);
  });
  await scenario('CN04 role loss after a read or insert starts suppresses delivery and rolls back an unauthorized append', async f => {
    await f.notes.append(request(f)); let calls = 0;
    const racing = createCaseNotes({ pool: f.pool, clock: () => f.clock.now, authorize: async (...args) => {
      const allowed = await f.authorization.authorize(...args); if (++calls === 1) f.discord.state.members.set(OTHER, []); return allowed;
    } });
    await assert.rejects(racing.read({ actor: f.staff, channelId: f.channelId }), /CAPABILITY_REVOKED|CASE_ACCESS_DENIED/);
    f.discord.state.members.set(OTHER, [f.policy.leadOps]); const staff = await f.actor(OTHER); calls = 0;
    await assert.rejects(racing.append({ ...request(f, 'Must roll back', 'b'.repeat(64)), actor: staff }), /CAPABILITY_REVOKED|CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_notes')).length, 1);
  });
  await scenario('CN05 competing saves serialize note numbers and bound reverse-ordered pagination', async f => {
    const results = await Promise.all([f.notes.append(request(f)), f.notes.append(request(f, 'Second note', 'b'.repeat(64)))]);
    assert.deepEqual(results.map(r => r.number).sort(), [1, 2]);
    for (let i = 3; i <= 27; i++) await f.notes.append(request(f, `Synthetic note ${i}`, String(i).padStart(64, '0')));
    const page = await f.notes.read({ actor: f.staff, channelId: f.channelId }); assert.equal(page.entries.length, 25); assert.equal(page.entries[0].number, 27); assert.equal(page.next, 3);
    const older = await f.notes.read({ actor: f.staff, channelId: f.channelId, before: page.next }); assert.deepEqual(older.entries.map(n => n.number), [2, 1]); assert.equal(older.next, null);
  });
  await scenario('CN06 closed notes stay available to responders while sealed cases and knowledge access are denied', async f => {
    await f.notes.append(request(f));
    await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed' WHERE id = $1", [f.opened.id]);
    assert.equal((await f.notes.read({ actor: f.staff, channelId: f.channelId })).entries.length, 1);
    await f.notes.append(request(f, 'Closed follow-up', 'b'.repeat(64)));
    await assert.rejects(cluster.knowledgePool.query('SELECT body FROM sophie_core.case_notes'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_notes'), { code: '42501' });
    await f.admin.query("UPDATE sophie_core.case_reservations SET desired_access = 'sealed' WHERE id = $1", [f.opened.id]);
    await assert.rejects(f.notes.read({ actor: f.staff, channelId: f.channelId }), /CASE_ACCESS_DENIED/);
  });
  await scenario('CN07 transcript and recovery-control projections exclude note text and author grants', async f => {
    const sentinel = 'SYNTHETIC-RESTRICTED-NOTE-e58f'; await f.notes.append(request(f, sentinel));
    const transcripts = createCaseTranscripts({ pool: f.pool, authorization: f.authorization, roles: f.discord.roles, childAccess: {}, clock: () => f.clock.now });
    const transcript = await transcripts.readChannel({ actor: f.member, channelId: f.channelId });
    assert.equal(JSON.stringify(transcript).includes(sentinel), false);
    const controls = (await f.admin.query('SELECT control_key, before_state, after_state FROM sophie_control.events')).rows;
    assert.equal(JSON.stringify(controls).includes(sentinel), false);
  });
  await scenario('CN08 authenticated HTTP requires CSRF for writes, checks every reader and does not cache note responses', async f => {
    const dashboard = dashboardServices(f), authorization = dashboard.dashboardAuthorization;
    const notes = createCaseNotes({ pool: f.pool, authorize: authorization.authorize, clock: () => f.clock.now });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: dashboard.auth, authorization,
      notes: createCaseNotesHttp({ auth: dashboard.auth, authorization, notes }), enabled: () => true, onFault() {} });
    const address = await server.listen();
    try {
      const login = await dashboard.login(OTHER), cookie = `${DASHBOARD_COOKIES.session}=${login.token}`;
      const session = await dashboard.auth.authenticate({ token: login.token });
      const options = { method: 'POST', headers: { Cookie: cookie, Origin: dashboardConfiguration.origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: f.channelId, requestId: 'd'.repeat(64), text: '<script>synthetic literal</script>' }) };
      const denied = await dashboardHttp(address, '/api/cases/notes/append', { ...options, headers: { ...options.headers, 'X-CSRF-Token': '' } }); assert.equal(denied.status, 403);
      const saved = await dashboardHttp(address, '/api/cases/notes/append', options); assert.equal(saved.status, 200);
      const page = await dashboardHttp(address, `/api/cases/notes?channelId=${f.channelId}`, { headers: { Cookie: cookie } });
      assert.equal(page.status, 200); assert.equal(page.headers['cache-control'], 'no-store');
      assert.equal(page.body.entries[0].text, '<script>synthetic literal</script>');
      f.discord.state.members.set(OTHER, []);
      const revoked = await dashboardHttp(address, `/api/cases/notes?channelId=${f.channelId}`, { headers: { Cookie: cookie } }); assert.equal(revoked.status, 403);
      assert.equal(JSON.stringify(revoked.body).includes('synthetic literal'), false);
    } finally { await server.close(); }
  });
}
