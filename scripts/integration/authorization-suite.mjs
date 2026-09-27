import assert from 'node:assert/strict';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createMembershipDispatcher } from '../../apps/core/discord/dispatcher.js';
import { createModerationCommands } from '../../apps/core/discord/moderation-commands.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { syntheticInteractions, APPLICATION } from '../../tests/fixtures/interactions.js';
import { simulatedDiscord, CREW, MUZZLED, BOT, BYOND_ROLE } from '../../tests/fixtures/discord.js';
import { GUILD, OTHER, USER, STAFF, LEAD, NOW } from '../../tests/fixtures/domain.js';
import { CASE_TYPES } from '../../modules/tickets/index.js';
import { defaultSystemText } from '../../contracts/system-messages.js';

export async function runAuthorizationSuite(cluster, run) {
  const pool = cluster.corePool;
  const admin = cluster.adminPool;
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [STAFF, LEAD], 'member.unmute': [STAFF, LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  const scope = { guildId: GUILD, userId: USER };
  let discord, interactions, authority, auth, store, dispatcher, healthy;
  const authorization = configured => createCoreAuthorization({ principals: interactions.verifier, discord: discord.roles,
    authorityStore: authority, policy: configured, clock: () => NOW, isAuthorityCurrent: () => healthy, readContinuity: discord.roles.readContinuity });
  const principal = async (overrides = {}) => {
    const proof = interactions.mint(overrides);
    return { proof, actor: await auth.resolveActor(proof) };
  };
  const scenario = async (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.automation_policies, sophie_core.case_answer_reviews, sophie_core.curated_answers, sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle, sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.member_actions,
      sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.members, sophie_core.definitions,
      sophie_core.case_provisions, sophie_core.case_channels, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    healthy = true;
    discord = simulatedDiscord(); discord.state.members.set(OTHER, [STAFF]);
    interactions = syntheticInteractions();
    authority = createActorAuthorityStore({ pool, clock: () => NOW });
    auth = authorization(policy);
    store = createCoreStore({ pool, clock: () => NOW, authorize: auth.authorize, authorizeRecorded: auth.authorizeRecorded });
    dispatcher = createMembershipDispatcher({ outbox: createOutbox({ pool }), store, discord: discord.roles, enabled: () => true });
    await work();
    assert.ok(discord.state.members.get(USER)?.includes(BYOND_ROLE));
  });
  async function requestMute() {
    const { proof, actor } = await principal();
    await store.requestMute({ actor, interactionId: proof.interactionId, observation: await discord.roles.observe(USER) });
    return actor;
  }

  await scenario('A18 dashboard navigation follows current responder and publisher roles without granting case access', async () => {
    const proof = interactions.mint();
    let view = await auth.dashboardAccess(proof);
    assert.equal(view.canManageCases, true); assert.equal(view.canCreateContacts, true);
    assert.equal(view.capabilities['shuttle.publish'], false);
    discord.state.members.set(OTHER, []); view = await auth.dashboardAccess(proof);
    assert.equal(view.canManageCases, false); assert.equal(view.canCreateContacts, false);
    const custom = authorization({ ...policy, version: 2, grants: { ...policy.grants, 'shuttle.publish': ['701'] },
      responders: Object.fromEntries(CASE_TYPES.map(type => [type.id, type.id === 'tech-support' ? ['701'] : [LEAD]])) });
    discord.state.roles.push({ id: '701', position: 5, managed: false, mentionable: false, permissions: '0' });
    discord.state.members.set(OTHER, ['701']); view = await custom.dashboardAccess(proof);
    assert.equal(view.canManageCases, true); assert.equal(view.canCreateContacts, false);
    assert.equal(view.capabilities['shuttle.publish'], true);
    discord.state.members.set(OTHER, ['701', MUZZLED]); view = await custom.dashboardAccess(proof);
    assert.equal(view.canManageCases, false); assert.equal(view.capabilities['shuttle.publish'], false);
    healthy = false; await assert.rejects(custom.dashboardAccess(proof), /AUTHORITY_UNCERTAIN/);
  });

  await scenario('A01 a signed command, fresh role authority and the stored decision drive actual moderation', async () => {
    await requestMute();
    assert.equal((await dispatcher.runOnce('authorized-worker')).status, 'progressed');
    assert.equal((await dispatcher.runOnce('authorized-worker')).status, 'settled');
    assert.deepEqual(new Set(discord.state.members.get(USER)), new Set([BYOND_ROLE, MUZZLED]));
    const recorded = (await admin.query('SELECT operator_grant FROM sophie_core.member_actions')).rows[0].operator_grant;
    assert.deepEqual(recorded, { guildId: GUILD, userId: OTHER, capabilityEpoch: 1, policyVersion: 1 });
  });

  await scenario('A02 serialized or caller-constructed actor objects cannot authorize a command', async () => {
    const { actor } = await principal();
    assert.equal(await auth.authorize('member.mute', { ...actor }, scope), false);
    assert.equal(await auth.authorize('member.mute', { ...actor, administrator: true, roleIds: [LEAD] }, scope), false);
    await assert.rejects(auth.resolveActor({ userId: OTHER, guildId: GUILD }), /UNTRUSTED_PRINCIPAL/);
    assert.equal(await auth.authorize('member.mute', actor, { ...scope, guildId: USER }), false);
  });

  await scenario('A03 current staff role loss cancels authority before the queued Muzzled write', async () => {
    await requestMute();
    discord.state.members.set(OTHER, []);
    assert.deepEqual(await dispatcher.runOnce('authorized-worker'), { status: 'operator_required', code: 'OPERATION_DENIED' });
    assert.deepEqual(discord.state.members.get(USER), [BYOND_ROLE]);
    const row = (await admin.query('SELECT capability_epoch FROM sophie_core.actor_authority WHERE user_id = $1', [OTHER])).rows[0];
    assert.equal(Number(row.capability_epoch), 2);
  });

  await scenario('A04 observed staff loss and reacquisition never revive the old recorded grant', async () => {
    const oldActor = await requestMute();
    discord.state.members.set(OTHER, []);
    await principal();
    discord.state.members.set(OTHER, [STAFF]);
    const { actor: newActor } = await principal();
    assert.equal(newActor.capabilityEpoch, oldActor.capabilityEpoch + 2);
    assert.equal(await auth.authorizeRecorded('member.mute', oldActor, scope), false);
    assert.equal(await auth.authorize('member.mute', newActor, scope), true);
    assert.equal((await dispatcher.runOnce('authorized-worker')).status, 'operator_required');
    assert.equal(discord.state.members.get(USER).includes(MUZZLED), false);
  });

  await scenario('A05 capability policy versions are immutable and an older configuration cannot resume authority', async () => {
    const { actor } = await principal();
    const changed = { ...policy, grants: { ...policy.grants, 'member.mute': [LEAD] } };
    await assert.rejects(authorization(changed).resolveActor(interactions.mint()), /CAPABILITY_POLICY_IMMUTABLE/);
    const newer = authorization({ ...policy, version: 2 });
    assert.equal(await newer.authorizeRecorded('member.mute', actor, scope), false);
    await assert.rejects(auth.authorize('member.mute', actor, scope), /CAPABILITY_POLICY_ROLLBACK/);
  });

  await scenario('A06 the interaction role array and Discord Administrator do not grant application capabilities', async () => {
    discord.state.members.set(OTHER, [CREW]);
    discord.state.roles.find(role => role.id === CREW).permissions = '8';
    const { actor } = await principal({ member: { user: { id: OTHER }, roles: [STAFF, LEAD], permissions: '8' } });
    assert.equal(await auth.authorize('member.mute', actor, scope), false);
    assert.equal(await auth.authorize('shuttle.publish', actor, { definitionId: 'shuttle-v1' }), false);
  });

  await scenario('A07 Head Admin case management requires current lead ops; Staff Report accepts Staff', async () => {
    const staff = (await principal()).actor;
    const caseScope = { guildId: GUILD, caseId: 'synthetic-case', openerId: OTHER, type: 'head-admin-contact' };
    assert.equal(await auth.authorize('case.manage', staff, caseScope), false);
    assert.equal(await auth.authorize('case.manage', staff, { ...caseScope, type: 'staff-report' }), true);
    discord.state.members.set(OTHER, [LEAD]);
    const lead = (await principal()).actor;
    assert.equal(await auth.authorize('case.manage', lead, caseScope), true);
  });

  const customRole = '701';
  const useCustomRole = () => {
    discord.state.roles.push({ id: customRole, position: 8, managed: false, permissions: '0' });
    discord.state.members.set(OTHER, [customRole]);
    auth = authorization({ ...policy, grants: { ...policy.grants, 'member.mute': [customRole], 'shuttle.publish': [customRole] } });
    store = createCoreStore({ pool, clock: () => NOW, authorize: auth.authorize, authorizeRecorded: auth.authorizeRecorded });
    dispatcher = createMembershipDispatcher({ outbox: createOutbox({ pool }), store, discord: discord.roles, enabled: () => true });
  };

  await scenario('A15 a custom operator role drives authorized moderation without granting case access or other capabilities', async () => {
    useCustomRole();
    const actor = await requestMute();
    assert.equal(await auth.authorize('shuttle.publish', actor, { definitionId: 'shuttle-v1' }), true);
    assert.equal(await auth.authorize('member.unmute', actor, scope), false);
    for (const type of ['quick-help', 'head-admin-contact']) {
      const caseScope = { guildId: GUILD, caseId: 'synthetic-case', type, openerId: USER, openerEligible: false };
      assert.equal(await auth.authorize('case.manage', actor, caseScope), false);
      assert.equal(await auth.authorize('case.read', actor, caseScope), false);
    }
    assert.equal((await dispatcher.runOnce('custom-worker')).status, 'progressed');
    assert.equal((await dispatcher.runOnce('custom-worker')).status, 'settled');
    assert.deepEqual(new Set(discord.state.members.get(USER)), new Set([BYOND_ROLE, MUZZLED]));
  });

  await scenario('A16 losing and reacquiring a custom role never revives an earlier queued grant', async () => {
    useCustomRole(); const oldActor = await requestMute();
    discord.state.members.set(OTHER, []); await principal();
    discord.state.members.set(OTHER, [customRole]); const { actor } = await principal();
    assert.equal(await auth.authorize('member.mute', actor, scope), true);
    assert.equal(await auth.authorizeRecorded('member.mute', oldActor, scope), false);
    assert.equal((await dispatcher.runOnce('custom-revoked-worker')).status, 'operator_required');
    assert.equal(discord.state.members.get(USER).includes(MUZZLED), false);
  });

  await scenario('A17 removing a custom grant in a newer policy blocks queued delivery and old configuration', async () => {
    useCustomRole(); const oldActor = await requestMute();
    const newer = authorization({ ...policy, version: 2, grants: { ...policy.grants, 'member.mute': [] } });
    assert.equal(await newer.authorizeRecorded('member.mute', oldActor, scope), false);
    await assert.rejects(auth.authorize('member.mute', oldActor, scope), /CAPABILITY_POLICY_ROLLBACK/);
    store = createCoreStore({ pool, clock: () => NOW, authorize: newer.authorize, authorizeRecorded: newer.authorizeRecorded });
    dispatcher = createMembershipDispatcher({ outbox: createOutbox({ pool }), store, discord: discord.roles, enabled: () => true });
    assert.equal((await dispatcher.runOnce('custom-policy-worker')).status, 'operator_required');
    assert.equal(discord.state.members.get(USER).includes(MUZZLED), false);
  });

  await scenario('A08 moderation rejects current peer, self, owner, administrator and bot targets', async () => {
    const { actor } = await principal();
    assert.equal(await auth.authorize('member.mute', actor, { ...scope, userId: OTHER }), false);
    assert.equal(await auth.authorize('member.mute', actor, { ...scope, userId: BOT }), false);
    discord.state.ownerId = USER;
    assert.equal(await auth.authorize('member.mute', actor, scope), false);
    discord.state.ownerId = '100000000000000099';
    discord.state.members.get(USER).push(STAFF);
    assert.equal(await auth.authorize('member.mute', actor, scope), false);
    discord.state.members.set(USER, [BYOND_ROLE, CREW]);
    discord.state.roles.find(role => role.id === CREW).permissions = '8';
    assert.equal(await auth.authorize('member.mute', actor, scope), false);
  });

  await scenario('A09 an outage or unknown observation never erases the last recorded authority', async () => {
    const { actor } = await principal();
    discord.state.before = call => call.path.endsWith(`/members/${OTHER}`) ? new Response(null, { status: 503 }) : null;
    await assert.rejects(auth.authorize('member.mute', actor, scope), /DISCORD_UNAVAILABLE/);
    const row = (await admin.query('SELECT capability_epoch, observation FROM sophie_core.actor_authority WHERE user_id = $1', [OTHER])).rows[0];
    assert.equal(Number(row.capability_epoch), 1);
    assert.deepEqual(row.observation.roleIds, [STAFF]);
    discord.state.before = null;
    discord.state.members.delete(OTHER);
    assert.equal(await auth.authorize('member.mute', actor, scope), false);
  });

  await scenario('A10 an uncertain observation lifecycle blocks authorization before HTTP or state changes', async () => {
    const { actor } = await principal();
    healthy = false;
    const calls = discord.state.calls.length;
    await assert.rejects(auth.authorize('member.mute', actor, scope), /AUTHORITY_UNCERTAIN/);
    assert.equal(discord.state.calls.length, calls);
  });

  await scenario('A11 self-service checks derive the member from the authenticated identity', async () => {
    const { actor } = await principal({ member: { user: { id: USER }, roles: [STAFF] } });
    assert.equal(await auth.authorize('shuttle.self', actor, scope), true);
    assert.equal(await auth.authorize('case.create', actor, { ...scope, userId: OTHER }), false);
    discord.state.members.get(USER).push(MUZZLED);
    assert.equal(await auth.authorize('shuttle.self', actor, scope), false);
    const refreshed = (await principal({ member: { user: { id: USER } } })).actor;
    assert.equal(await auth.authorize('shuttle.self', refreshed, scope), false);
  });

  await scenario('A12 a replayed signed command does not duplicate the durable moderation decision', async () => {
    const { proof, actor } = await principal();
    const request = { actor, interactionId: proof.interactionId, observation: await discord.roles.observe(USER) };
    await store.requestMute(request); await store.requestMute(request);
    assert.equal(Number((await admin.query('SELECT count(*) FROM sophie_core.member_actions')).rows[0].count), 1);
    assert.equal(Number((await admin.query('SELECT count(*) FROM sophie_core.outbox')).rows[0].count), 1);
  });

  async function endpoint(work) {
    const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: interactions.verifier, applicationId: APPLICATION, clock: () => NOW,
      enabled: () => true, fetch: async (url, options) => {
        assert.equal(url, `https://discord.com/api/v10/webhooks/${APPLICATION}/synthetic-interaction-reply-token/messages/@original`);
        assert.equal(options.method, 'PATCH'); assert.equal(options.redirect, 'error');
        replies.push(JSON.parse(options.body)); return new Response('{}', { status: 200 });
      } });
    const commands = createModerationCommands({ authorization: auth, discord: discord.roles, store, enabled: () => true });
    const server = createInteractionHttpServer({ verifier: interactions.verifier, commands, respond: responder.respond,
      enabled: () => true, onFault: code => faults.push(code) });
    const address = await server.listen();
    const post = async (value, alteredBody = null) => {
      const signed = interactions.signed(value);
      return fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp },
        body: alteredBody ?? signed.body });
    };
    try { await work({ post, server, replies }); assert.deepEqual(faults, []); }
    finally { await server.close(); }
  }

  await scenario('A13 signed loopback HTTP commands acknowledge, commit, reply and deliver mute then unmute', async () => {
    await endpoint(async ({ post, server, replies }) => {
      assert.deepEqual(await (await post(interactions.payload())).json(), { type: 5, data: { flags: 64 } });
      await server.drain();
      assert.match(replies[0].content, /Request recorded/);
      assert.equal((await dispatcher.runOnce('http-worker')).status, 'progressed');
      assert.equal((await dispatcher.runOnce('http-worker')).status, 'settled');
      assert.deepEqual(new Set(discord.state.members.get(USER)), new Set([BYOND_ROLE, MUZZLED]));
      const unmute = interactions.payload(); unmute.data.name = 'unmute';
      assert.equal((await (await post(unmute)).json()).type, 5); await server.drain();
      assert.equal((await dispatcher.runOnce('http-worker')).status, 'progressed');
      assert.equal((await dispatcher.runOnce('http-worker')).status, 'settled');
      assert.deepEqual(new Set(discord.state.members.get(USER)), new Set([BYOND_ROLE, CREW]));
      assert.equal(replies.length, 2);
      assert.ok(replies.every(reply => reply.allowed_mentions.parse.length === 0));
    });
  });

  await scenario('A14 tampered HTTP and signed unauthorized commands create no moderation decisions', async () => {
    await endpoint(async ({ post, server, replies }) => {
      assert.equal((await post(interactions.payload(), '{}')).status, 401);
      discord.state.members.set(OTHER, []);
      assert.equal((await (await post(interactions.payload())).json()).type, 5); await server.drain();
      assert.equal(replies[0].content, defaultSystemText('reply.denied'));
      assert.equal(Number((await admin.query('SELECT count(*) FROM sophie_core.member_actions')).rows[0].count), 0);
      assert.equal(Number((await admin.query('SELECT count(*) FROM sophie_core.outbox')).rows[0].count), 0);
      assert.deepEqual(new Set(discord.state.members.get(USER)), new Set([BYOND_ROLE, CREW]));
    });
  });
}
