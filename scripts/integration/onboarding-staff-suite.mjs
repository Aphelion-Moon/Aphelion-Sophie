import assert from 'node:assert/strict';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { parkedOnboardingMessage } from '../../tests/fixtures/onboarding-recovery.js';
import { duplicateOnboardingCase } from '../../tests/fixtures/onboarding-channel-choice.js';
import { GUILD, USER, OTHER } from '../../tests/fixtures/domain.js';
import { WHITELIST, MUZZLED } from '../../tests/fixtures/discord.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOnboardingStaffHttp } from '../../apps/core/http/onboarding-staff.js';

export async function runOnboardingStaffSuite(cluster, run) {
  const scenario = (name, work, options = {}) => run(name, async () => work(await onboardingWorkflow(cluster, options)));
  async function dashboard(f) {
    const d = dashboardServices(f), login = await d.login(OTHER), { csrfToken } = await d.auth.authenticate({ token: login.token });
    const store = createCoreStore({ pool: f.pool, clock: () => f.clock.now, authorize: d.dashboardAuthorization.authorize,
      casePolicy, caseVerification: f.discord.channels.verification, onboardingMessageVerification: f.discord.messages.verification,
      onboardingAlertVerification: f.discord.alerts.verification });
    const http = createOnboardingStaffHttp({ auth: d.auth, authorization: d.dashboardAuthorization, store, discord: f.discord.roles,
      channels: f.discord.channels, screenMessages: f.discord.messages, alertMessages: f.discord.alerts, enabled: () => f.clock.enabled });
    const credentials = { token: login.token, csrfToken, origin: dashboardConfiguration.origin };
    const call = (path, body = null, query = '') => http.execute({ path, method: body === null ? 'GET' : 'POST', query: new URLSearchParams(query), body, credentials });
    return { call, store, credentials };
  }
  const repair = (issue, action = 'recheck', resultId = null) => ({ issueId: issue.id, expectedRevision: issue.revision, action, resultId,
    requestId: 'a'.repeat(64), confirmed: true });
  const writes = f => f.discord.state.calls.filter(call => ['PUT', 'DELETE', 'POST', 'PATCH'].includes(call.method)).length;
  await scenario('SH01 OAuth assistance resolves and resumes once, replay avoids member observations and preserves progress', async f => {
    await f.open(); await f.help(); const before = await f.session(), d = await dashboard(f);
    const queue = await d.call('/api/shuttle/help'); assert.equal(queue.entries.length, 1); assert.equal(queue.entries[0].paused, true);
    const body = { helpId: queue.entries[0].requestId, expectedRevision: queue.entries[0].revision, requestId: 'b'.repeat(64), confirmed: true };
    assert.deepEqual(await d.call('/api/shuttle/help/resolve', body), { recorded: true, duplicate: false, resumed: true });
    const after = await f.session(); assert.equal(after.helpPaused, false); assert.equal(after.stepIndex, before.stepIndex);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false); assert.equal((await d.call('/api/shuttle/help')).entries.length, 0);
    await f.admin.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, 2, $2)', [GUILD, { ...casePolicy, version: 2 }]);
    f.discord.state.members.delete(USER); const offset = f.discord.state.calls.length;
    assert.deepEqual(await d.call('/api/shuttle/help/resolve', body), { recorded: true, duplicate: true, resumed: true });
    assert.equal(f.discord.state.calls.slice(offset).some(call => call.path.endsWith(`/members/${USER}`) || call.path.includes('/channels/')), false);
    assert.equal((await f.rows('shuttle_help_resolutions')).length, 1);
    await assert.rejects(d.call('/api/shuttle/help/resolve', { ...body, expectedRevision: body.expectedRevision + 1 }), /INTERACTION_ID_COLLISION/);
    f.discord.state.members.set(OTHER, []); await assert.rejects(d.call('/api/shuttle/help/resolve', body), /OPERATION_DENIED/);
  }, { helpPauses: true });
  await scenario('SH02 OAuth assistance denies Muzzled resume and unconfirmed or forged actor fields', async f => {
    await f.open(); await f.help(); const d = await dashboard(f), entry = (await d.call('/api/shuttle/help')).entries[0];
    const body = { helpId: entry.requestId, expectedRevision: entry.revision, requestId: 'b'.repeat(64), confirmed: true };
    for (const bad of [{ ...body, confirmed: false }, { ...body, guildId: GUILD }, { ...body, actor: { userId: OTHER } }])
      await assert.rejects(d.call('/api/shuttle/help/resolve', bad), /SHUTTLE_STAFF_INPUT_INVALID/);
    f.discord.state.members.get(USER).push(MUZZLED);
    await assert.rejects(d.call('/api/shuttle/help/resolve', body), /MEMBER_MUZZLED/);
    assert.equal((await f.rows('shuttle_help_resolutions')).length, 0); assert.equal((await f.session()).helpPaused, true);
    d.credentials.csrfToken = '0'.repeat(64); await assert.rejects(d.call('/api/shuttle/help/resolve', body), /DASHBOARD_CSRF_INVALID/);
  }, { helpPauses: true });
  for (const kind of ['screen', 'alert']) await scenario(`SH03-${kind} OAuth adopts an exact own message with shared opaque proofs and replays after channel loss`, async f => {
    const { issue, messageId } = await parkedOnboardingMessage(f, kind), d = await dashboard(f), count = writes(f);
    const page = await d.call('/api/shuttle/delivery'); assert.equal(page.entries[0].kind, kind); assert.equal(page.entries[0].needsMessageId, true);
    const body = repair(issue, 'adopt_message', messageId);
    assert.deepEqual(await d.call('/api/shuttle/delivery/change', body), { recorded: true, duplicate: false }); assert.equal(writes(f), count);
    // An adopted status card is not posted again; the worker then posts the step message and its card (and edits nothing else).
    await f.drain(kind === 'screen' ? f.screens : f.alerts); assert.equal(writes(f), count + (kind === 'screen' ? 2 : 0));
    const record = kind === 'screen' ? await f.current() : (await f.rows('shuttle_alerts'))[0]; assert.equal(record.message_id, messageId);
    f.discord.state.messages.delete(messageId); f.discord.state.channels.delete(record.channel_id);
    await f.admin.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, 2, $2)', [GUILD, { ...casePolicy, version: 2 }]); const offset = f.discord.state.calls.length;
    assert.deepEqual(await d.call('/api/shuttle/delivery/change', body), { recorded: true, duplicate: true });
    assert.equal(f.discord.state.calls.slice(offset).some(call => call.path.includes('/channels/') || call.path.endsWith(`/members/${USER}`)), false);
    await assert.rejects(d.call('/api/shuttle/delivery/change', { ...body, resultId: f.nextId() }), /INTERACTION_ID_COLLISION/);
    assert.equal((await f.rows('shuttle_delivery_rechecks')).length, 1);
    f.discord.state.members.set(OTHER, []); await assert.rejects(d.call('/api/shuttle/delivery/change', body), /OPERATION_DENIED/);
  });
  await scenario('SH04 OAuth channel choice records intent and leaves seal-before-open delivery to the worker', async f => {
    const { issue, original, duplicate } = await duplicateOnboardingCase(f), d = await dashboard(f), count = writes(f);
    const body = repair(issue, 'select_channel', duplicate.id);
    await assert.rejects(d.call('/api/shuttle/delivery/change', { ...body, resultId: f.nextId() }), /SHUTTLE_CHANNEL_CHOICE_INVALID/);
    assert.deepEqual(await d.call('/api/shuttle/delivery/change', body), { recorded: true, duplicate: false }); assert.equal(writes(f), count);
    assert.equal((await f.rows('case_reservations'))[0].state, 'pending'); await f.drain(f.cases);
    assert.equal((await f.rows('case_reservations'))[0].channel_id, duplicate.id);
    assert.equal(f.discord.state.channels.get(original.id).permission_overwrites.some(row => row.id === USER), false);
    assert.deepEqual(await d.call('/api/shuttle/delivery/change', body), { recorded: true, duplicate: true });
  });
  await scenario('SH05 OAuth Whitelist recheck records no role or progress effects before worker confirmation', async f => {
    await f.pending(); f.discord.state.roles.find(role => role.id === WHITELIST).position = 20;
    assert.equal((await f.grants.runOnce('blocked-grant')).code, 'ROLE_HIERARCHY_BLOCKED');
    f.discord.state.roles.find(role => role.id === WHITELIST).position = 2;
    const issue = (await f.rows('shuttle_delivery_issues'))[0], d = await dashboard(f), before = await f.session(), count = writes(f);
    assert.deepEqual(await d.call('/api/shuttle/delivery/change', repair(issue)), { recorded: true, duplicate: false });
    assert.deepEqual(await f.session(), before); assert.equal(writes(f), count); await f.drain(f.grants);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
  });
  await scenario('SH06 OAuth recovery loses authority during external proof and leaves all recovery state untouched', async f => {
    const { issue, messageId } = await parkedOnboardingMessage(f), d = await dashboard(f);
    f.discord.state.before = call => { if (call.path.includes(`/messages/${messageId}`)) { f.discord.state.before = null; f.discord.state.members.set(OTHER, []); f.discord.announce(); } };
    await assert.rejects(d.call('/api/shuttle/delivery/change', repair(issue, 'adopt_message', messageId)), /OPERATION_DENIED/);
    assert.equal((await f.rows('shuttle_delivery_rechecks')).length, 0); assert.equal((await f.current()).message_id, null);
  });
}
