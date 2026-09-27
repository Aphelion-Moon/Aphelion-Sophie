import assert from 'node:assert/strict';
import { conversationWorkflow, syntheticConversation } from '../../tests/fixtures/case-conversations.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { BOT, CREW, mapping } from '../../tests/fixtures/discord.js';
import { createDiscordRoles } from '../../apps/core/discord/roles.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCaseChildAccess } from '../../apps/core/discord/case-child-access.js';
import { createCaseTranscripts } from '../../apps/core/storage/case-transcripts.js';
import { createCaseTranscriptsHttp } from '../../apps/core/http/case-transcripts.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { authDigest } from '../../apps/core/security/dashboard-auth.js';
import { closeCaseCaptureGap, recordCaseCaptureGap } from '../../apps/core/storage/case-capture-coverage.js';

const CHILD = '720000000000000001', INVITED = '100000000000000080';
export async function transcriptWorkflow(cluster) {
    const f = dashboardServices(await conversationWorkflow(cluster));
    const clock = () => f.clock.now;
    // Unlike the older delivery fixture, this composition uses the actual capture observer's continuity.
    const roles = createDiscordRoles({ transport: f.intakeTransport, mapping, clock, readContinuity: f.observer.readContinuity });
    const authorization = createCoreAuthorization({ principals: f.principals, discord: roles, policy: f.policy, clock,
      authorityStore: createActorAuthorityStore({ pool: f.pool, clock }), isAuthorityCurrent: f.observer.isCurrent, readContinuity: roles.readContinuity });
    const childAccess = createCaseChildAccess({ guildId: GUILD, botUserId: BOT, transport: f.intakeTransport, roles, clock });
    const caseToken = (await f.admin.query('SELECT operation_token FROM sophie_core.case_provisions WHERE case_id = $1', [f.opened.id])).rows[0].operation_token;
    const hooks = { afterRead: null, contentReads: 0 };
    const pool = { connect: () => f.pool.connect(), async query(sql, values) {
      const result = await f.pool.query(sql, values);
      if (sql.startsWith('WITH observations')) { hooks.contentReads++; await hooks.afterRead?.(); }
      return result;
    } };
    const transcripts = createCaseTranscripts({ pool, authorization, roles, childAccess, clock });
    const route = createCaseTranscriptsHttp({ auth: f.auth, authorization, transcripts });
    const loginActor = async (userId = USER) => {
      const session = await f.login(userId), { proof } = await f.auth.authenticate({ token: session.token });
      return { session, actor: await authorization.resolveActor(proof) };
    };
    const read = async (actor, options = {}) => transcripts.read({ actor, caseToken, ...options });
    const message = (overrides = {}) => f.send('MESSAGE_CREATE', syntheticConversation(f.opened.channel_id, overrides));
    const child = async () => {
      const data = { id: CHILD, guild_id: GUILD, parent_id: f.opened.channel_id, type: 12 };
      f.discord.state.channels.set(CHILD, data);
      for (const id of [USER, BOT]) f.discord.state.threadMembers.set(`${CHILD}:${id}`, { id: CHILD, user_id: id });
      await f.send('THREAD_CREATE', data); await message({ channel_id: CHILD, content: 'Synthetic child-only observation' });
    };
    const invite = async () => {
      f.discord.state.members.set(INVITED, [CREW]);
      const binding = await authorization.resolveCaseParticipant({ guildId: GUILD, userId: INVITED });
      const grant = await f.actor(OTHER);
      await f.admin.query(`INSERT INTO sophie_core.case_participants (guild_id, case_id, version, user_id, presence_epoch, operator_grant, status)
        VALUES ($1, $2, 1, $3, $4, $5, 'active')`, [GUILD, f.opened.id, INVITED, binding.presenceEpoch, grant]);
    };
    return { ...f, roles, authorization, caseToken, transcripts, route, hooks, loginActor, read, message, child, invite };
}
export async function runCaseTranscriptsSuite(cluster, run) {
  const fixture = () => transcriptWorkflow(cluster);
  const scenario = (name, work) => run(name, async () => work(await fixture()));

  await scenario('TR01 opener reads bounded immutable create partial-update delete pages without aggregating children', async f => {
    await f.child(); await f.message();
    for (let i = 0; i < 5; i++) await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001', content: `Synthetic revision ${i}` });
    await f.send('MESSAGE_DELETE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000001' });
    const { actor } = await f.loginActor(); const first = await f.read(actor), second = await f.read(actor, { after: first.next });
    assert.equal((first.html.match(/<article>/g) ?? []).length, 5); assert.equal((second.html.match(/<article>/g) ?? []).length, 2);
    assert.equal(second.next, null); assert.ok(second.html.includes('delete')); assert.equal(first.html.includes('child-only'), false);
    assert.equal(first.completeHistory, false); assert.ok(first.html.includes('before-capture')); assert.equal(first.captureAvailable, true);
    await assert.rejects(f.read(actor, { channelId: CHILD, after: first.next }), /TRANSCRIPT_INPUT_INVALID/);
  });
  await scenario('TR02 current Staff and lead ops follow case type while the opener retains Head Admin read access', async f => {
    await f.message(); f.discord.state.members.set(OTHER, [STAFF]); let { actor } = await f.loginActor(OTHER); await f.read(actor);
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact', version = version + 1 WHERE id = $1", [f.opened.id]);
    const count = f.hooks.contentReads; await assert.rejects(f.read(actor), /CASE_ACCESS_DENIED/); assert.equal(f.hooks.contentReads, count);
    await f.read((await f.loginActor()).actor); f.discord.state.members.set(OTHER, [LEAD]); actor = (await f.loginActor(OTHER)).actor; await f.read(actor);
    f.discord.state.members.set(OTHER, [CREW]); actor = (await f.loginActor(OTHER)).actor;
    await assert.rejects(f.read(actor), /CASE_ACCESS_DENIED/);
  });
  await scenario('TR03 departed and rejoined opener cannot reuse the old core membership episode', async f => {
    await f.message(); const { actor } = await f.loginActor();
    await f.send('GUILD_MEMBER_REMOVE', { guild_id: GUILD, user: { id: USER } }); f.discord.state.members.delete(USER);
    await assert.rejects(f.read(actor), /CASE_ACCESS_DENIED|OPERATION_DENIED/);
    f.discord.state.members.set(USER, [CREW]); await f.send('GUILD_MEMBER_ADD', { guild_id: GUILD, user: { id: USER }, roles: [CREW] });
    await assert.rejects(f.read((await f.loginActor()).actor), /CASE_ACCESS_DENIED/);
    assert.equal(f.hooks.contentReads, 0);
  });
  await scenario('TR04 active invitations require independent actor presence and do not grant other cases or pending access', async f => {
    await f.message(); await f.invite(); let { actor } = await f.loginActor(INVITED); await f.read(actor);
    await f.admin.query("UPDATE sophie_core.case_participants SET status = 'pending' WHERE user_id = $1", [INVITED]);
    await assert.rejects(f.read(actor), /CASE_ACCESS_DENIED/);
    await f.admin.query("UPDATE sophie_core.case_participants SET status = 'active' WHERE user_id = $1", [INVITED]);
    await f.send('GUILD_MEMBER_REMOVE', { guild_id: GUILD, user: { id: INVITED } });
    await f.send('GUILD_MEMBER_ADD', { guild_id: GUILD, user: { id: INVITED }, roles: [CREW] });
    actor = (await f.loginActor(INVITED)).actor; await assert.rejects(f.read(actor), /CASE_ACCESS_DENIED/);
    await assert.rejects(f.read(actor, { caseToken: 'a'.repeat(48) }), /CASE_ACCESS_DENIED/);
  });
  await scenario('TR05 invitation removal and case or audience version changes during reads suppress all content', async f => {
    await f.message(); await f.invite(); const { actor } = await f.loginActor(INVITED);
    f.hooks.afterRead = () => f.admin.query("UPDATE sophie_core.case_participants SET status = 'removed' WHERE user_id = $1", [INVITED]);
    await assert.rejects(f.read(actor), /CASE_ACCESS_DENIED/);
    const opener = (await f.loginActor()).actor;
    for (const sql of ['UPDATE sophie_core.case_reservations SET version = version + 1 WHERE id = $1',
      'UPDATE sophie_core.case_provisions SET audience_version = audience_version + 1 WHERE case_id = $1']) {
      f.hooks.afterRead = () => f.admin.query(sql, [f.opened.id]); await assert.rejects(f.read(opener), /CASE_ACCESS_DENIED/);
    }
  });
  await scenario('TR06 logout, role revocation and departure during reads suppress all content', async f => {
    await f.message(); const staff = await f.loginActor(OTHER);
    f.hooks.afterRead = () => f.authStore.revokeSession(authDigest(staff.session.token));
    await assert.rejects(f.read(staff.actor), /CASE_ACCESS_DENIED/);
    const next = await f.loginActor(OTHER); f.hooks.afterRead = async () => { f.discord.state.members.set(OTHER, [CREW]); };
    await assert.rejects(f.read(next.actor), /CASE_ACCESS_DENIED/);
    const opener = await f.loginActor(); f.hooks.afterRead = async () => { f.discord.state.members.delete(USER); };
    await assert.rejects(f.read(opener.actor), /CASE_ACCESS_DENIED/);
    f.hooks.afterRead = null; f.discord.state.members.set(USER, [CREW]);
    await assert.rejects(f.read((await f.loginActor()).actor), /CASE_ACCESS_DENIED/);
  });
  await scenario('TR07 child reads require current requester and bot thread access and reject moved deleted or missing channels', async f => {
    await f.child(); const { actor } = await f.loginActor(); assert.ok((await f.read(actor, { channelId: CHILD })).html.includes('child-only'));
    for (const id of [USER, BOT]) {
      f.discord.state.threadMembers.delete(`${CHILD}:${id}`); await assert.rejects(f.read(actor, { channelId: CHILD }), /DISCORD_RESOURCE_MISSING/);
      f.discord.state.threadMembers.set(`${CHILD}:${id}`, { id: CHILD, user_id: id });
    }
    const child = f.discord.state.channels.get(CHILD); child.parent_id = '99'; await assert.rejects(f.read(actor, { channelId: CHILD }), /CASE_CHILD_ACCESS_DENIED/);
    child.parent_id = f.opened.channel_id; await f.send('THREAD_DELETE', child);
    await assert.rejects(f.read(actor, { channelId: CHILD }), /CASE_CHILD_ACCESS_DENIED/);
    f.discord.state.channels.delete(CHILD); await assert.rejects(f.read(actor, { channelId: '729999999999999999' }), /CASE_ACCESS_DENIED/);
    assert.equal(f.hooks.contentReads, 1);
  });
  await scenario('TR08 child permission changes and Gateway interruptions during a read invalidate its proof', async f => {
    await f.child(); const { actor } = await f.loginActor();
    f.hooks.afterRead = async () => {
      f.discord.state.threadMembers.delete(`${CHILD}:${USER}`);
      await f.send('THREAD_MEMBERS_UPDATE', { guild_id: GUILD, id: CHILD, removed_member_ids: [USER] });
    };
    await assert.rejects(f.read(actor, { channelId: CHILD }), /OBSERVATION_INVALIDATED/);
    f.hooks.afterRead = () => f.observer.pause(f.connection()); await assert.rejects(f.read(actor), /OBSERVATION_UNAVAILABLE/);
  });
  await scenario('TR09 gap pagination retains initial and interruption evidence and reports current coverage separately', async f => {
    await f.message();
    await closeCaseCaptureGap(f.admin, { guildId: GUILD, channelId: f.opened.channel_id, at: f.clock.now, recovery: 'permissions-verified' });
    await closeCaseCaptureGap(f.admin, { guildId: GUILD, at: f.clock.now, recovery: 'resumed' });
    for (let i = 0; i < 30; i++) await recordCaseCaptureGap(f.admin, { guildId: GUILD, channelId: f.opened.channel_id,
      from: f.clock.now, to: f.clock.now, reason: 'gateway-sequence-gap', recovery: 'observed' });
    const { actor } = await f.loginActor(); const first = await f.read(actor); assert.equal(first.captureAvailable, true); assert.ok(first.gapsNext);
    const second = await f.read(actor, { gapsAfter: first.gapsNext }); assert.equal(second.gapsNext, null); assert.equal(second.completeHistory, false);
    await recordCaseCaptureGap(f.admin, { guildId: GUILD, channelId: f.opened.channel_id, from: f.clock.now, reason: 'permission-change' });
    assert.equal((await f.read(actor, { gapsAfter: first.gapsNext })).captureAvailable, false);
  });
  await scenario('TR10 escaped retained payloads expose attachment status only and retain partial update uncertainty', async f => {
    await f.message({ content: '</pre><script>bad()</script>', embeds: [{ description: '<img src=x>', url: 'signed-embed-secret' }],
      attachments: [{ id: '74', filename: '<x>.png', size: 12, url: 'signed-cdn-secret', proxy_url: 'proxy-secret' }] });
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: '730000000000000099', embeds: [] });
    const result = await f.read((await f.loginActor()).actor);
    for (const forbidden of ['<script>', '<img ', 'signed-cdn-secret', 'proxy-secret', 'signed-embed-secret', 'retained_slot']) assert.equal(result.html.includes(forbidden), false);
    assert.ok(result.html.includes('&lt;script&gt;')); assert.ok(result.html.includes('&lt;x&gt;.png')); assert.ok(result.html.includes('pending'));
    assert.ok(result.html.includes('only observed fields')); assert.equal(result.html.includes('Staff notes'), false);
    const page = JSON.stringify(result.page);
    for (const forbidden of ['signed-cdn-secret', 'proxy-secret', 'signed-embed-secret', 'retained_slot']) assert.equal(page.includes(forbidden), false);
    assert.equal(result.page.observations[0].patch.content, '</pre><script>bad()</script>');
  });
  await scenario('TR11 authenticated loopback route enforces fixed GET query cookies logout and no-store responses', async f => {
    await f.message(); const { session } = await f.loginActor();
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: f.auth, authorization: f.authorization,
      transcripts: f.route, enabled: () => f.clock.enabled, onFault: () => {} });
    try {
      const address = await server.listen(), path = `/api/cases/transcript?caseToken=${f.caseToken}`;
      const options = { headers: { Cookie: `${DASHBOARD_COOKIES.session}=${session.token}` } };
      const response = await dashboardHttp(address, path, options); assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store'); assert.ok(response.headers['content-security-policy'].includes("default-src 'none'"));
      assert.equal(response.body.channelId, f.opened.channel_id); assert.equal((await dashboardHttp(address, path)).status, 403);
      const channelPath = `/api/cases/transcript/channel?channelId=${f.opened.channel_id}`;
      assert.equal((await dashboardHttp(address, channelPath)).status, 403);
      const lookup = await dashboardHttp(address, channelPath, options);
      assert.equal(lookup.status, 200); assert.equal(lookup.body.caseToken, f.caseToken); assert.equal(lookup.body.page.observations.length, 1);
      assert.equal((await dashboardHttp(address, `${channelPath}&caseToken=${f.caseToken}`, options)).status, 400);
      assert.equal((await dashboardHttp(address, `${channelPath}&channelId=${f.opened.channel_id}`, options)).status, 400);
      assert.equal((await dashboardHttp(address, `${path}&caseToken=${f.caseToken}`, options)).status, 400);
      assert.equal((await dashboardHttp(address, `${path}&after=garbage`, options)).status, 400);
      assert.equal((await dashboardHttp(address, path, { ...options, method: 'POST' })).status, 403);
      f.hooks.afterRead = () => f.authStore.revokeSession(authDigest(session.token));
      const denied = await dashboardHttp(address, path, options); assert.equal(denied.status, 403); assert.equal(Object.hasOwn(denied.body, 'html'), false);
      assert.equal((await dashboardHttp(address, '/api/cases/download', options)).status, 404);
    } finally { await server.close(); }
  });
  await scenario('TR12 channel lookup preserves case child and revocation authorization before returning a token or content', async f => {
    await f.message(); await f.child();
    const { actor } = await f.loginActor();
    const lookup = (who, channelId = f.opened.channel_id) => f.transcripts.readChannel({ actor: who, channelId });
    assert.equal((await lookup(actor)).caseToken, f.caseToken);
    assert.ok((await lookup(actor, CHILD)).html.includes('child-only'));
    f.discord.state.threadMembers.delete(`${CHILD}:${USER}`);
    await assert.rejects(lookup(actor, CHILD), /DISCORD_RESOURCE_MISSING/);
    await assert.rejects(lookup(actor, '729999999999999999'), /CASE_ACCESS_DENIED/);
    await assert.rejects(lookup(actor, '../channel'), /INVALID_DISCORD_ID/);
    f.discord.state.members.set(OTHER, [STAFF]);
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact', version = version + 1 WHERE id = $1", [f.opened.id]);
    const count = f.hooks.contentReads;
    await assert.rejects(lookup((await f.loginActor(OTHER)).actor), /CASE_ACCESS_DENIED/);
    assert.equal(f.hooks.contentReads, count);
    f.hooks.afterRead = () => f.authStore.revokeSession(authDigest(session.token));
    const { session, actor: fresh } = await f.loginActor();
    await assert.rejects(lookup(fresh), /CASE_ACCESS_DENIED/);
  });
}
