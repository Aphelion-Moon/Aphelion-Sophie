import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createOnboardingCommands, createAdministrationCommands } from '../../apps/core/discord/onboarding-commands.js';
import { createOnboardingAssistance } from '../../apps/core/discord/onboarding-assistance.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createOnboardingDispatcher } from '../../apps/core/discord/onboarding-dispatcher.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { simulatedOnboarding } from '../../tests/fixtures/onboarding.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { CREW, BYOND_ROLE, WHITELIST, MUZZLED } from '../../tests/fixtures/discord.js';
import { syntheticInteractions, APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, definition, publication } from '../../tests/fixtures/domain.js';

/** Authored synthetic guidance and help metadata only, never conversations or notes. */
export async function runOnboardingAssistanceSuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool, outbox = createOutbox({ pool });
  const limits = { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 };
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [LEAD], 'member.unmute': [LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  let now, discord, identities, authorization, store, commands, assistance, cases, screens, healthy;
  let sequence = 850000000000000000n;
  const nextId = () => String(++sequence);
  const rows = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  const currentScreen = async (userId = USER) => (await rows('shuttle_screens')).find(row => row.current && row.user_id === userId);
  const payload = (overrides = {}) => identities.payload({ id: nextId(), member: { user: { id: USER } },
    data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] }, ...overrides });
  const verified = value => identities.verifier.verify(identities.signed(value));
  const actor = (userId = USER) => authorization.resolveActor(verified(payload({ member: { user: { id: userId } } })));
  const queueEnvelope = (userId = OTHER, after = null) => verified(payload({ member: { user: { id: userId } },
    ...(after === null ? { data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'queue' }] } } :
      { type: 3, message: { id: OTHER }, data: { component_type: 2, custom_id: `sophie:shuttle-help:v1:queue:${after}` } }) }));
  const resolutionPayload = (request, overrides = {}) => payload({ type: 3, member: { user: { id: OTHER } }, message: { id: OTHER },
    data: { component_type: 2, custom_id: `sophie:shuttle-help:v1:resolve:${request.interaction_id}:${request.revision}` }, ...overrides });
  const resolve = (request, overrides = {}) => commands.execute(verified(resolutionPayload(request, overrides)));
  const makeStore = (authorize = authorization.authorize) => createCoreStore({ pool, clock: () => now, authorize,
    authorizeRecorded: authorization.authorizeRecorded, casePolicy, caseVerification: discord.channels.verification,
    onboardingMessageVerification: discord.messages.verification });
  async function drain(worker) {
    for (let count = 0; count < 60; count++) {
      const result = await worker.runOnce('assistance-worker');
      if (result.status === 'idle') return;
      assert.ok(['progressed', 'settled'].includes(result.status), `${result.status}/${result.code}`);
    }
    assert.fail('Synthetic assistance queue did not drain');
  }
  async function open(userId = USER) {
    if (!discord.state.members.has(userId)) discord.state.members.set(userId, [CREW, BYOND_ROLE]);
    assert.equal(await commands.execute(verified(payload({ member: { user: { id: userId } } }))), 'shuttle_recorded');
    await drain(cases); await drain(screens); return currentScreen(userId);
  }
  async function click(action, userId = USER, id = nextId()) {
    const screen = await currentScreen(userId);
    const result = await commands.execute(verified(payload({ id, type: 3, member: { user: { id: userId } },
      channel_id: screen.channel_id, message: { id: screen.message_id },
      data: { component_type: 2, custom_id: `sophie:shuttle:v1:${screen.id}:${action}` } })));
    await drain(screens); return result;
  }
  async function help(userId = USER, id = nextId()) {
    await open(userId); assert.equal(await click('help', userId, id), 'shuttle_help_recorded');
    return (await rows('shuttle_help_requests')).find(row => row.interaction_id === id);
  }
  async function direct(request) {
    return { actor: await actor(OTHER), interactionId: nextId(), requestId: request.interaction_id,
      expectedRevision: request.revision, observation: await discord.roles.observe(request.user_id) };
  }
  const scenario = (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests,
      sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle,
      sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.member_actions,
      sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.members, sophie_core.definitions,
      sophie_core.case_channels, sophie_core.case_provisions, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    now = NOW; healthy = true; discord = simulatedOnboarding({ clock: () => now, enabled: () => healthy });
    discord.state.members.set(OTHER, [LEAD]); identities = syntheticInteractions({ clock: () => now });
    authorization = createCoreAuthorization({ principals: identities.verifier, discord: discord.roles,
      authorityStore: createActorAuthorityStore({ pool, clock: () => now }), policy, clock: () => now,
      isAuthorityCurrent: () => healthy, readContinuity: discord.roles.readContinuity });
    store = makeStore(); await store.publishOnboarding({ actor: await actor(OTHER), publication });
    discord.state.members.set(OTHER, [STAFF]);
    assistance = createOnboardingAssistance({ authorization, discord: discord.roles, store, enabled: () => healthy });
    commands = createAdministrationCommands({ assistance, onboarding: createOnboardingCommands({ authorization,
      discord: discord.roles, channels: discord.channels, store, enabled: () => healthy, definitionId: definition.id, limits }) });
    cases = createCaseDispatcher({ outbox, store, roles: discord.roles, channels: discord.channels, enabled: () => healthy });
    screens = createOnboardingDispatcher({ outbox, store, roles: discord.roles, messages: discord.messages, enabled: () => healthy });
    await work();
  });

  await scenario('H01 Staff resolve a retained request and members can ask again without losing progress', async () => {
    const request = await help(), before = await currentScreen();
    assert.equal(await commands.execute(queueEnvelope()), 'shuttle_help_queue');
    const page = await assistance.queue(queueEnvelope()); assert.equal(page.entries[0].requestId, request.interaction_id);
    assert.equal(await resolve(request), 'shuttle_help_resolved'); await drain(screens);
    const current = await currentScreen(); assert.deepEqual(current.snapshot, before.snapshot); assert.equal(current.help_requested, false);
    assert.equal((await rows('shuttle_help_requests'))[0].status, 'resolved');
    assert.equal((await rows('shuttle_help_resolutions'))[0].operator_grant.userId, OTHER);
    assert.equal((await assistance.queue(queueEnvelope())).entries.length, 0);
    assert.equal(await click('help'), 'shuttle_help_recorded'); assert.equal((await rows('shuttle_help_requests')).length, 2);
    assert.equal(await resolve(request), 'shuttle_help_stale'); assert.equal((await currentScreen()).help_requested, true);
    assert.equal(discord.state.calls.some(call => call.method === 'PUT'), false);
  });

  await scenario('H02 requester status, asserted roles and Discord Administrator cannot replace current Staff authority', async () => {
    const request = await help();
    assert.equal(await resolve(request, { member: { user: { id: USER }, roles: [STAFF], permissions: '8' } }), 'denied');
    assert.deepEqual(await assistance.queue(queueEnvelope(USER)), { state: 'denied' });
    discord.state.roles.find(role => role.id === CREW).permissions = '8'; discord.state.members.set(OTHER, [CREW]);
    assert.deepEqual(await assistance.queue(queueEnvelope()), { state: 'denied' });
    discord.state.members.set(OTHER, [STAFF, MUZZLED]); assert.equal(await resolve(request), 'denied');
    discord.state.members.set(OTHER, [STAFF]); discord.state.before = call => call.path.endsWith(`/members/${OTHER}`) ?
      Response.json({ user: { id: OTHER, bot: false }, roles: [STAFF], communication_disabled_until: new Date(now + 60_000).toISOString() }) : null;
    assert.equal(await resolve(request), 'denied'); discord.state.before = null;
    assert.equal((await rows('shuttle_help_resolutions')).length, 0); assert.equal((await rows('shuttle_help_requests'))[0].status, 'open');
  });

  await scenario('H03 concurrent duplicate resolution commits once and a competing stale action commits nothing', async () => {
    const first = await help(), request = await direct(first);
    const outcomes = await Promise.all([store.resolveOnboardingHelp(request), store.resolveOnboardingHelp(request)]);
    assert.deepEqual(outcomes.map(row => row.duplicate).sort(), [false, true]);
    assert.equal((await rows('shuttle_help_resolutions')).length, 1); await drain(screens);
    assert.equal(await click('help'), 'shuttle_help_recorded');
    const second = (await rows('shuttle_help_requests')).find(row => row.status === 'open'), competing = await direct(second);
    const results = await Promise.allSettled([store.resolveOnboardingHelp(competing), store.resolveOnboardingHelp({ ...competing, interactionId: nextId() })]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(results.find(row => row.status === 'rejected').reason.code, 'STALE_SHUTTLE_HELP');
    assert.equal((await rows('shuttle_help_resolutions')).length, 2);
  });

  await scenario('H04 failed audit or screen intent rolls back resolution, receipt and presentation together', async () => {
    const request = await help(), before = await currentScreen(), receipts = (await rows('receipts')).length;
    for (const table of ['shuttle_help_resolutions', 'outbox']) {
      const condition = table === 'outbox' ? "kind <> 'shuttle.render'" : 'revision <> 1';
      await admin.query(`ALTER TABLE sophie_core.${table} ADD CONSTRAINT synthetic_help_failure CHECK (${condition}) NOT VALID`);
      try { await assert.rejects(store.resolveOnboardingHelp(await direct(request)), error => error.code === '23514'); }
      finally { await admin.query(`ALTER TABLE sophie_core.${table} DROP CONSTRAINT synthetic_help_failure`); }
      assert.equal((await rows('shuttle_help_requests'))[0].status, 'open'); assert.equal((await rows('shuttle_help_resolutions')).length, 0);
      assert.equal((await rows('receipts')).length, receipts); assert.equal((await currentScreen()).id, before.id);
    }
  });

  await scenario('H05 losing Staff during resolution rolls back the entire human action', async () => {
    const request = await help(), before = await currentScreen(), operation = await direct(request);
    let checks = 0;
    const guarded = makeStore(async (...args) => {
      if (args[0] === 'case.manage' && ++checks === 3) discord.state.members.set(OTHER, []);
      return authorization.authorize(...args);
    });
    await assert.rejects(guarded.resolveOnboardingHelp(operation), /OPERATION_DENIED/);
    assert.equal((await rows('shuttle_help_requests'))[0].status, 'open'); assert.equal((await rows('shuttle_help_resolutions')).length, 0);
    assert.equal((await currentScreen()).id, before.id);
    discord.state.members.set(OTHER, [STAFF]);
    await assert.rejects(store.resolveOnboardingHelp(operation), /OPERATION_DENIED/);
    assert.equal(await resolve(request), 'shuttle_help_resolved');
  });

  await scenario('H06 queue delivery reauthorizes Staff after command execution and suppresses revoked metadata', async () => {
    await help(); const envelope = queueEnvelope(), status = await commands.execute(envelope), replies = [];
    assert.equal(status, 'shuttle_help_queue'); discord.state.members.set(OTHER, []);
    const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION, clock: () => now,
      enabled: () => healthy, onboardingAssistance: assistance,
      fetch: async (_, value) => { replies.push(JSON.parse(value.body)); return Response.json({}); } });
    await responder.respond(envelope, status);
    assert.match(replies[0].content, /requires current Staff/); assert.deepEqual(replies[0].embeds, []); assert.deepEqual(replies[0].components, []);
    assert.equal(JSON.stringify(replies).includes(USER), false);
  });

  await scenario('H07 bounded numeric pagination survives resolution of an earlier page', async () => {
    const requests = [];
    for (let index = 0; index < 7; index++) requests.push(await help(String(100000000000000050n + BigInt(index)), String([9, 100, 11, 99, 101, 12, 102][index])));
    const first = await assistance.queue(queueEnvelope());
    assert.deepEqual(first.entries.map(row => row.requestId), ['9', '11', '12', '99', '100']); assert.equal(first.next, '100');
    assert.equal(await resolve(requests[0]), 'shuttle_help_resolved');
    const second = await assistance.queue(queueEnvelope(OTHER, first.next));
    assert.deepEqual(second.entries.map(row => row.requestId), ['101', '102']); assert.equal(second.next, null);
    const refreshed = await assistance.queue(queueEnvelope()); assert.equal(refreshed.entries.length, 5); assert.equal(refreshed.entries[0].requestId, '11');
  });

  await scenario('H08 resolving an earlier completed run cannot replace a newer repeat or close its help request', async () => {
    discord.state.members.get(USER).push(WHITELIST); const original = await help();
    for (let index = 0; index < 5; index++) assert.equal(await click('advance'), 'shuttle_progress_recorded');
    const latest = await help(), before = await currentScreen(); assert.notEqual(original.session_id, latest.session_id);
    assert.equal(await resolve(original), 'shuttle_help_resolved'); await drain(screens);
    assert.equal((await currentScreen()).id, before.id); assert.equal((await currentScreen()).help_requested, true);
    assert.equal((await rows('shuttle_help_requests')).find(row => row.interaction_id === latest.interaction_id).status, 'open');
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), true);
  });

  await scenario('H09 resolving help while the member is Muzzled never unmutes or restores progression', async () => {
    const request = await help(); assert.equal(await click('advance'), 'shuttle_progress_recorded');
    discord.state.members.get(USER).push(MUZZLED);
    assert.equal(await resolve(request), 'shuttle_help_resolved'); await drain(screens);
    assert.equal(await currentScreen(), undefined); assert.equal(discord.state.members.get(USER).includes(MUZZLED), true);
    assert.equal(await commands.execute(verified(payload())), 'denied');
    discord.state.members.set(USER, [CREW, BYOND_ROLE]); const recovered = await open();
    assert.equal(recovered.snapshot.stepIndex, 1); assert.equal(recovered.help_requested, false);
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('H10 closed, withdrawn and departed requests remain resolvable without reopening a case', async () => {
    const request = await help();
    await closeTestCase({ store, actor: await actor(OTHER), observation: await discord.roles.observe(USER), interactionId: nextId(), id: (await rows('shuttle_cases'))[0].case_id, worker: cases });
    discord.state.members.set(OTHER, [LEAD]); await store.withdrawDefinition({ actor: await actor(OTHER), id: definition.id, version: 1 });
    discord.state.members.delete(USER);
    assert.equal((await assistance.queue(queueEnvelope())).entries[0].caseState, 'closed');
    assert.equal(await resolve(request), 'shuttle_help_resolved');
    assert.equal((await rows('case_reservations'))[0].state, 'closed'); assert.equal((await rows('case_exclusions')).length, 1);
    assert.equal((await rows('shuttle_publications')).length, 1); assert.equal((await rows('shuttle_help_requests')).length, 1);
    assert.equal(await currentScreen(), undefined); assert.equal(discord.state.calls.some(call => call.method === 'PUT'), false);
  });

  await scenario('H11 forged actors, foreign ownership and stale revisions cannot resolve a request', async () => {
    const request = await help(), operation = await direct(request);
    await assert.rejects(store.resolveOnboardingHelp({ ...operation, actor: { ...operation.actor } }), /OPERATION_DENIED/);
    await assert.rejects(store.resolveOnboardingHelp({ ...operation, observation: await discord.roles.observe(OTHER) }), /MEMBER_MISMATCH/);
    await assert.rejects(store.resolveOnboardingHelp({ ...operation, expectedRevision: 1 }), /STALE_SHUTTLE_HELP/);
    await assert.rejects(store.listOnboardingHelp({ actor: operation.actor, guildId: USER }), /CASE_CONFIGURATION_REQUIRED/);
    assert.equal(await assistance.execute({ ...verified(resolutionPayload(request)) }), 'denied');
    assert.equal((await rows('shuttle_help_resolutions')).length, 0);
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.shuttle_help_resolutions'), error => error.code === '42501');
    await assert.rejects(pool.query('DELETE FROM sophie_core.shuttle_help_requests'), error => error.code === '42501');
    await assert.rejects(pool.query('DELETE FROM sophie_core.shuttle_help_resolutions'), error => error.code === '42501');
    await admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact'");
    assert.equal((await assistance.queue(queueEnvelope())).entries.length, 0);
    assert.equal(await resolve(request), 'shuttle_help_stale');
  });

  await scenario('H12 a newer case policy and a stopped gate prevent queue reads and resolution', async () => {
    const request = await help();
    await admin.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, 2, $2)', [GUILD, { ...casePolicy, version: 2 }]);
    assert.deepEqual(await assistance.queue(queueEnvelope()), { state: 'unavailable' });
    assert.equal(await resolve(request), 'unavailable'); healthy = false;
    const reads = discord.state.calls.length; assert.equal(await resolve(request), 'disabled');
    assert.deepEqual(await assistance.queue(queueEnvelope()), { state: 'disabled' }); assert.equal(discord.state.calls.length, reads);
    assert.equal((await rows('shuttle_help_requests'))[0].status, 'open');
  });

  await scenario('H13 signed loopback Staff queue and resolution stay private and retain one human action', async () => {
    await help(); const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION, clock: () => now,
      enabled: () => healthy, onboardingAssistance: assistance,
      fetch: async (_, value) => { replies.push(JSON.parse(value.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: identities.verifier, commands, respond: responder.respond,
      enabled: () => healthy, onFault: code => faults.push(code) });
    const address = await server.listen();
    const send = async value => {
      const signed = identities.signed(value);
      const response = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST', body: signed.body,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
      assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
    };
    try {
      await send(payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'queue' }] } }));
      assert.equal(replies[0].embeds.length, 1);
      const customId = replies[0].components[0].components[0].custom_id;
      const resolution = payload({ member: { user: { id: OTHER } }, type: 3, message: { id: OTHER }, data: { component_type: 2, custom_id: customId } });
      await send(resolution); await send(resolution);
      assert.match(replies[1].content, /marked as resolved/); assert.deepEqual(replies[1].embeds, []);
      assert.equal((await rows('shuttle_help_resolutions')).length, 1);
      for (const reply of replies) assert.deepEqual(reply.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
      assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });
}
