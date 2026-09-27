import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createOnboardingCommands } from '../../apps/core/discord/onboarding-commands.js';
import { createOnboardingNavigation } from '../../apps/core/discord/onboarding-navigation.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { simulatedOnboarding } from '../../tests/fixtures/onboarding.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { CREW, BYOND_ROLE, WHITELIST, MUZZLED } from '../../tests/fixtures/discord.js';
import { syntheticInteractions, APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, definition, publication, command, observation } from '../../tests/fixtures/domain.js';

/** Generated metadata and authored synthetic copy; no real member sessions or case text. */
export async function runOnboardingNavigationSuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool, outbox = createOutbox({ pool });
  const limits = { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 };
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [LEAD], 'member.unmute': [LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  let now, discord, identities, authorization, store, commands, cases, navigation, healthy;
  let sequence = 840000000000000000n;
  const nextId = () => String(++sequence);
  const payload = (overrides = {}) => identities.payload({ id: nextId(), member: { user: { id: USER } },
    data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] }, ...overrides });
  const verified = value => identities.verifier.verify(identities.signed(value));
  const actor = (userId = USER) => authorization.resolveActor(verified(payload({ member: { user: { id: userId } } })));
  const rows = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  const describe = async () => store.describeOnboardingDestination({ actor: await actor(), observation: await discord.roles.observe(USER) });
  const makeNavigation = (channels = discord.channels) => createOnboardingNavigation({ authorization, discord: discord.roles,
    channels, store, enabled: () => healthy });
  async function provision() {
    for (let i = 0; i < 10; i++) {
      const result = await cases.runOnce('navigation-case-worker');
      if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed'].includes(result.status), `${result.status}/${result.code}`);
    }
    assert.fail('Synthetic case queue did not drain');
  }
  async function open() {
    const envelope = verified(payload());
    assert.equal(await commands.execute(envelope), 'shuttle_recorded'); await provision(); return envelope;
  }
  async function completeReading() {
    let session = (await rows('sessions')).find(row => row.current).state;
    for (let index = 0; index < 5; index++) {
      session = (await store.transition({ actor: await actor(), action: 'advance', interactionId: nextId(), sessionId: session.id,
        observation: await discord.roles.observe(USER), command: command(session) })).session;
    }
    assert.equal(session.status, 'complete'); return session;
  }
  const scenario = (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.automation_policies, sophie_core.case_answer_reviews, sophie_core.curated_answers, sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications,
      sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle,
      sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.member_actions,
      sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.members, sophie_core.definitions,
      sophie_core.case_channels, sophie_core.case_provisions, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    now = NOW; healthy = true; discord = simulatedOnboarding({ clock: () => now, enabled: () => healthy });
    discord.state.members.set(OTHER, [LEAD]); identities = syntheticInteractions({ clock: () => now });
    authorization = createCoreAuthorization({ principals: identities.verifier, discord: discord.roles,
      authorityStore: createActorAuthorityStore({ pool, clock: () => now }), policy, clock: () => now,
      isAuthorityCurrent: () => healthy, readContinuity: discord.roles.readContinuity });
    store = createCoreStore({ pool, clock: () => now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, casePolicy, caseVerification: discord.channels.verification,
      onboardingMessageVerification: discord.messages.verification });
    await store.publishOnboarding({ actor: await actor(OTHER), publication });
    commands = createOnboardingCommands({ authorization, discord: discord.roles, channels: discord.channels, store,
      enabled: () => healthy, definitionId: definition.id, limits });
    cases = createCaseDispatcher({ outbox, store, roles: discord.roles, channels: discord.channels, enabled: () => healthy });
    navigation = makeNavigation(); await work();
  });

  await scenario('N01 pending entry becomes a verified private destination and repeated visits reuse it', async () => {
    const envelope = verified(payload()); assert.equal(await commands.execute(envelope), 'shuttle_recorded');
    assert.deepEqual(await navigation.resolve(envelope), { state: 'preparing' });
    await provision(); const destination = await navigation.resolve(envelope);
    assert.deepEqual(destination, { state: 'ready', guildId: GUILD, channelId: (await rows('case_reservations'))[0].channel_id });
    assert.equal(await commands.execute(verified(payload())), 'shuttle_recorded');
    assert.deepEqual(await navigation.resolve(envelope), destination);
    assert.equal((await rows('sessions')).length, 1); assert.equal((await rows('case_reservations')).length, 1);
    assert.equal(discord.state.calls.some(call => call.method === 'PUT' || call.path.includes('/messages')), false);
  });

  await scenario('N02 Muzzled, departed and durably muted members receive no destination', async () => {
    const envelope = await open(); discord.state.members.get(USER).push(MUZZLED);
    assert.deepEqual(await navigation.resolve(envelope), { state: 'denied' });
    discord.state.members.delete(USER); assert.deepEqual(await navigation.resolve(envelope), { state: 'denied' });
    discord.state.members.set(USER, [CREW, BYOND_ROLE]);
    await store.requestMute({ actor: await actor(OTHER), interactionId: nextId(), observation: await discord.roles.observe(USER) });
    assert.deepEqual(await navigation.resolve(envelope), { state: 'denied' });
    assert.equal(discord.state.members.get(USER).includes(MUZZLED), false);
  });

  await scenario('N03 Whitelist loss invalidates navigation and rejoin needs a fresh private case', async () => {
    discord.state.members.get(USER).push(WHITELIST); const original = await open();
    const old = await navigation.resolve(original); discord.state.members.set(USER, [CREW, BYOND_ROLE]);
    assert.deepEqual(await navigation.resolve(original), { state: 'unavailable' });
    const renewed = await open(); assert.deepEqual(await navigation.resolve(renewed), old);
    await store.recordObservation(observation({ present: false, crew: false })); now += 2_000;
    assert.deepEqual(await navigation.resolve(original), { state: 'unavailable' });
    const rejoined = await open(), destination = await navigation.resolve(rejoined);
    assert.equal(destination.state, 'ready'); assert.notEqual(destination.channelId, old.channelId);
    assert.equal((await rows('sessions')).find(row => row.current).state.stepIndex, 0);
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('N04 an old completed receipt resolves the latest repeat without replacing progress', async () => {
    discord.state.members.get(USER).push(WHITELIST); const original = await open();
    const first = await completeReading(); assert.equal((await navigation.resolve(original)).state, 'ready');
    await open(); const latest = await describe(); assert.notEqual(latest.sessionId, first.id);
    assert.equal(await commands.execute(original), 'shuttle_recorded');
    assert.equal((await describe()).sessionId, latest.sessionId); assert.equal((await navigation.resolve(original)).state, 'ready');
    const second = await completeReading(); assert.equal((await describe()).sessionId, second.id);
    assert.equal((await rows('sessions')).length, 2);
  });

  await scenario('N05 broader permissions, channel moves, changed ownership and deletion suppress the link', async () => {
    const envelope = await open(), destination = await describe(), channel = discord.state.channels.get(destination.channelId);
    const original = structuredClone(channel);
    for (const change of [value => value.permission_overwrites.push({ id: OTHER, type: 1, allow: '1024', deny: '0' }),
      value => { value.parent_id = OTHER; }, value => { value.topic = `sophie:case:v1:${'a'.repeat(48)}`; }]) {
      change(channel); assert.deepEqual(await navigation.resolve(envelope), { state: 'unavailable' }); Object.assign(channel, structuredClone(original));
    }
    discord.state.channels.delete(destination.channelId);
    assert.deepEqual(await navigation.resolve(envelope), { state: 'unavailable' });
  });

  await scenario('N06 a closed case never returns an old destination', async () => {
    const envelope = await open(); await closeTestCase({ store, actor: await actor(OTHER), observation: await discord.roles.observe(USER), interactionId: nextId(), id: (await rows('shuttle_cases'))[0].case_id, worker: cases });
    assert.deepEqual(await navigation.resolve(envelope), { state: 'unavailable' });
  });

  await scenario('N07 a withdrawn publication cannot provide a Shuttle destination', async () => {
    const envelope = await open(); await store.withdrawDefinition({ actor: await actor(OTHER), id: definition.id, version: 1 });
    assert.deepEqual(await navigation.resolve(envelope), { state: 'unavailable' });
  });

  await scenario('N08 a newer case policy blocks navigation under the earlier audience', async () => {
    const envelope = await open();
    await admin.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, 2, $2)', [GUILD, { ...casePolicy, version: 2 }]);
    assert.deepEqual(await navigation.resolve(envelope), { state: 'unavailable' });
  });

  await scenario('N09 forged principals and serialized channel proofs cannot expose another case', async () => {
    const envelope = await open(); assert.deepEqual(await navigation.resolve({ ...envelope }), { state: 'denied' });
    assert.deepEqual(await navigation.resolve(verified(payload({ member: { user: { id: OTHER } } }))), { state: 'unavailable' });
    const destination = await describe(), proof = await discord.channels.inspect(destination.plan, destination.channelId);
    await assert.rejects(store.confirmOnboardingDestination({ actor: await actor(), observation: await discord.roles.observe(USER),
      sessionId: destination.sessionId, proof: { ...proof } }), /CASE_OBSERVATION_UNTRUSTED/);
    await assert.rejects(store.confirmOnboardingDestination({ actor: await actor(OTHER), observation: await discord.roles.observe(USER),
      sessionId: destination.sessionId, proof }), /OPERATION_DENIED/);
  });

  await scenario('N10 a revocation or delivery stop during channel inspection prevents the destination', async () => {
    const envelope = await open();
    const muted = makeNavigation({ inspect: async (...args) => {
      const proof = await discord.channels.inspect(...args); discord.state.members.get(USER).push(MUZZLED); return proof;
    } });
    assert.deepEqual(await muted.resolve(envelope), { state: 'denied' });
    discord.state.members.set(USER, [CREW, BYOND_ROLE]); await open();
    const stopped = makeNavigation({ inspect: async (...args) => {
      const proof = await discord.channels.inspect(...args); healthy = false; return proof;
    } });
    assert.deepEqual(await stopped.resolve(envelope), { state: 'disabled' });
    const reads = discord.state.calls.length; assert.deepEqual(await navigation.resolve(envelope), { state: 'disabled' });
    assert.equal(discord.state.calls.length, reads);
  });

  await scenario('N11 signed loopback entry waits for provisioning then returns one private verified link', async () => {
    const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION,
      enabled: () => healthy, clock: () => now, onboardingNavigation: navigation,
      wait: async () => { assert.equal(replies.length, 0); await provision(); },
      fetch: async (_, request) => { replies.push(JSON.parse(request.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: identities.verifier, commands, respond: responder.respond,
      enabled: () => healthy, onFault: code => faults.push(code) });
    const address = await server.listen();
    async function send(value, forged = false) {
      const signed = identities.signed(value);
      return fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
        body: forged ? Buffer.concat([signed.body, Buffer.from(' ')]) : signed.body,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
    }
    try {
      assert.deepEqual(await (await send(payload())).json(), { type: 5, data: { flags: 64 } }); await server.drain();
      assert.equal(replies.length, 1);
      assert.equal(replies[0].components[0].components[0].url, `https://discord.com/channels/${GUILD}/${(await rows('case_reservations'))[0].channel_id}`);
      assert.equal(replies[0].components[0].components[0].custom_id, undefined);
      assert.deepEqual(replies[0].allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
      assert.equal((await send(payload(), true)).status, 401); await server.drain();
      assert.equal(replies.length, 1); assert.equal((await rows('sessions')).length, 1); assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });
}
