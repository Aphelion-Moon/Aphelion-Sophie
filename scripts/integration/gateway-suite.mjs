import assert from 'node:assert/strict';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createGatewayObserver } from '../../apps/core/discord/gateway-observer.js';
import { createGatewaySupervisor } from '../../apps/core/discord/gateway-supervisor.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createMembershipDispatcher } from '../../apps/core/discord/dispatcher.js';
import { simulatedCases, casePolicy } from '../../tests/fixtures/cases.js';
import { mapping, CREW, WHITELIST, MUZZLED, BYOND_ROLE, BOT } from '../../tests/fixtures/discord.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, definition, command } from '../../tests/fixtures/domain.js';
import { APPLICATION, syntheticInteractions } from '../../tests/fixtures/interactions.js';
import { gatewayEvent, readyEvent, guildEvent } from '../../tests/fixtures/gateway.js';
import { createLoopbackGateway, waitForGateway } from '../../tests/fixtures/gateway-server.js';
import { discoveryResponse, SYNTHETIC_GATEWAY_TOKEN } from '../../tests/fixtures/gateway-supervisor.js';

/** Real PostgreSQL, synthetic dispatch and one loopback native WebSocket scenario; no Discord connection. */
export async function runGatewaySuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool;
  let journal, observer, connection, sequence, discord, store, outbox, now, identities, authority;
  let interaction = 800000000000000000n;
  const nextId = () => String(++interaction);
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [STAFF, LEAD], 'member.unmute': [STAFF, LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  const read = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  const member = async () => (await read('members')).find(row => row.user_id === USER)?.state;
  const lifecycle = async () => (await read('gateway_lifecycle'))[0];
  const observed = () => discord.roles.observe(USER);
  const makeObserver = () => createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: () => now });
  const auth = (authorityStore = authority) => createCoreAuthorization({ principals: identities.verifier, discord: discord.roles,
    authorityStore, policy, clock: () => now, isAuthorityCurrent: observer.isCurrent, readContinuity: observer.readContinuity });
  const send = (type, data) => observer.accept(connection, gatewayEvent(++sequence, type, data));
  const memberEvent = (roles, userId = USER) => send('GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: userId }, roles });
  async function boot() {
    await observer.acquire('gateway-worker');
    ({ connection } = await observer.beginIdentify());
    await observer.accept(connection, readyEvent());
    observer.heartbeatAcknowledged(connection, 45_000);
    await observer.accept(connection, guildEvent()); sequence = 2;
  }
  async function start() {
    return (await store.start({ actor: {}, interactionId: nextId(), id: `gateway-session-${interaction}`, nonce: 'initial',
      observation: await observed(), definitionId: definition.id })).session;
  }
  async function advance(session) {
    return store.transition({ actor: {}, action: 'advance', interactionId: nextId(), sessionId: session.id,
      command: command(session), observation: await observed() });
  }
  const scenario = async (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.case_answer_reviews, sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle,
      sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.member_actions,
      sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.members, sophie_core.definitions,
      sophie_core.case_channels, sophie_core.case_provisions, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    now = NOW; journal = createGatewayJournal({ pool, mapping, clock: () => now }); observer = makeObserver();
    discord = simulatedCases({ clock: () => now, readContinuity: () => observer.readContinuity() });
    discord.state.members.set(OTHER, [STAFF]);
    store = createCoreStore({ pool, clock: () => now, authorize: async () => true, casePolicy,
      caseVerification: discord.channels.verification });
    outbox = createOutbox({ pool });
    authority = createActorAuthorityStore({ pool, clock: () => now });
    identities = syntheticInteractions({ clock: () => now });
    await authority.registerPolicy(policy); await store.publishDefinition({ actor: {}, definition });
    await work();
  });

  await scenario('G01 delivery needs a guild snapshot, heartbeat health and current durable owner', async () => {
    assert.deepEqual(await observer.acquire('gateway-worker'), { resumable: false });
    ({ connection } = await observer.beginIdentify());
    assert.equal(await observer.readContinuity(), null);
    await observer.accept(connection, readyEvent());
    observer.heartbeatAcknowledged(connection, 10_000);
    assert.equal(await observer.isCurrent(), false);
    await observer.accept(connection, guildEvent());
    assert.equal(await observer.isCurrent(), true);
    assert.equal((await lifecycle()).status, 'current');
    await observer.pause(connection);
    assert.equal(await observer.isCurrent(), false);
    assert.equal((await lifecycle()).status, 'offline');
  });

  await scenario('G02 Whitelist loss revokes old progress atomically and duplicate dispatch does not replay it', async () => {
    await boot(); discord.state.members.get(USER).push(WHITELIST);
    await memberEvent(discord.state.members.get(USER));
    const session = await start();
    discord.state.members.set(USER, [CREW, BYOND_ROLE]);
    const raw = gatewayEvent(++sequence, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: USER }, roles: [CREW, BYOND_ROLE] });
    await observer.accept(connection, raw);
    const revoked = await member();
    assert.equal((await read('sessions'))[0].current, false);
    assert.equal((await lifecycle()).sequence, String(sequence));
    assert.deepEqual(await observer.accept(connection, raw), { duplicate: true });
    assert.deepEqual(await member(), revoked);
    await assert.rejects(advance(session), /SHUTTLE_RESTART_REQUIRED/);
    const fresh = await start(); assert.equal(fresh.stepIndex, 0);
    assert.equal(discord.state.calls.filter(call => call.method !== 'GET').length, 0);
  });

  await scenario('G03 replayed staff loss and reacquisition invalidates the old operator grant before resuming', async () => {
    await boot(); await memberEvent([STAFF], OTHER);
    const authorization = auth(); const actor = await authorization.resolveActor(identities.mint());
    await observer.pause(connection); ({ connection } = await observer.beginResume());
    await memberEvent([], OTHER); await memberEvent([STAFF], OTHER);
    assert.equal(await observer.isCurrent(), false);
    assert.equal(await outbox.claim('blocked-worker'), null);
    await send('RESUMED', {}); observer.heartbeatAcknowledged(connection, 45_000);
    assert.equal(await observer.isCurrent(), true);
    assert.equal(await authorization.authorizeRecorded('member.mute', actor, { guildId: GUILD, userId: USER }), false);
    const current = await authorization.resolveActor(identities.mint());
    assert.ok(current.capabilityEpoch > actor.capabilityEpoch);
  });

  await scenario('G04 a new session invalidates unprovable old eligibility while retaining progress history', async () => {
    await boot(); let session = await start(); ({ session } = await advance(session));
    const before = await member(); const oldSnapshot = before.observation;
    ({ connection } = await observer.beginIdentify());
    assert.ok((await member()).eligibilityEpoch > before.eligibilityEpoch);
    assert.ok((await member()).presenceEpoch > before.presenceEpoch);
    assert.deepEqual((await member()).observation, oldSnapshot);
    assert.equal((await read('sessions'))[0].state.stepIndex, session.stepIndex);
    assert.equal((await read('sessions'))[0].current, false);
    assert.equal(await outbox.claim('worker'), null);
    await observer.accept(connection, readyEvent(1, 'new-synthetic-session'));
    await observer.accept(connection, guildEvent()); sequence = 2;
    observer.heartbeatAcknowledged(connection, 45_000);
    await assert.rejects(advance(session), /SHUTTLE_RESTART_REQUIRED/);
    assert.equal(discord.state.calls.filter(call => call.method !== 'GET').length, 0);
  });

  await scenario('G05 a replacement observer resumes the committed checkpoint without losing valid active progress', async () => {
    await boot(); let session = await start(); ({ session } = await advance(session));
    const before = await member(); const previousObserver = observer;
    await admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = clock_timestamp() - interval '1 second'");
    observer = makeObserver();
    assert.deepEqual(await observer.acquire('replacement-worker'), { resumable: true });
    const resumed = await observer.beginResume(); connection = resumed.connection;
    assert.equal(resumed.resume.sequence, 2);
    assert.equal(await previousObserver.isCurrent(), false);
    await assert.rejects(previousObserver.renew(), /GATEWAY_LEASE_LOST/);
    await send('RESUMED', {}); observer.heartbeatAcknowledged(connection, 45_000);
    assert.equal((await member()).eligibilityEpoch, before.eligibilityEpoch);
    assert.equal((await read('sessions'))[0].current, true);
    ({ session } = await advance(session)); assert.equal(session.stepIndex, 2);
  });

  await scenario('G06 a live Gateway owner cannot be replaced and expired fencing cannot append events', async () => {
    const first = await journal.acquire('first'); await journal.identify(first.lease);
    await assert.rejects(journal.acquire('second'), /GATEWAY_OWNER_ACTIVE/);
    await admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = clock_timestamp() - interval '1 second'");
    const second = await journal.acquire('second');
    assert.ok(second.lease.fence > first.lease.fence);
    await assert.rejects(journal.ready(first.lease, { sessionId: 'old', resumeUrl: 'wss://gateway.discord.gg/', sequence: 1 }), /GATEWAY_LEASE_LOST/);
    assert.equal((await lifecycle()).session_id, null);
  });

  await scenario('G07 transaction failure rolls back revocation, effects and cursor, then replay applies once', async () => {
    await boot(); discord.state.members.get(USER).push(WHITELIST);
    const session = await start(); const before = await member();
    await admin.query(`ALTER TABLE sophie_core.outbox ADD CONSTRAINT gateway_synthetic_abort
      CHECK (operation_id NOT LIKE 'member.%gateway%') NOT VALID`);
    const raw = gatewayEvent(++sequence, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: USER }, roles: [CREW] });
    try { await assert.rejects(observer.accept(connection, raw), /GATEWAY_PROCESSING_FAILED/); }
    finally { await admin.query('ALTER TABLE sophie_core.outbox DROP CONSTRAINT gateway_synthetic_abort'); }
    assert.deepEqual(await member(), before);
    assert.equal((await lifecycle()).sequence, '2');
    assert.equal((await read('sessions'))[0].current, true);
    assert.equal(await observer.isCurrent(), false);
    ({ connection } = await observer.beginResume());
    await observer.accept(connection, raw);
    assert.ok((await member()).eligibilityEpoch > before.eligibilityEpoch);
    assert.equal((await read('sessions'))[0].current, false);
    assert.equal((await read('sessions'))[0].id, session.id);
    assert.equal((await lifecycle()).sequence, String(sequence));
  });

  await scenario('G08 a REST response from before an intervening event cannot become current metadata', async () => {
    await boot();
    discord.state.before = async call => {
      if (!call.path.endsWith(`/members/${USER}`)) return;
      discord.state.before = null; await memberEvent([CREW]);
    };
    await assert.rejects(observed(), /OBSERVATION_INVALIDATED/);
    assert.equal(await observer.isCurrent(), true);
    await observed();
  });

  await scenario('G09 authorization rejects a healthy-to-healthy transition occurring during authority persistence', async () => {
    await boot(); let inject = true;
    const wrapped = { registerPolicy: authority.registerPolicy, async observe(...args) {
      const grant = await authority.observe(...args);
      if (inject) { inject = false; await send('GUILD_UPDATE', { id: GUILD }); }
      return grant;
    } };
    await assert.rejects(auth(wrapped).resolveActor(identities.mint()), /OBSERVATION_INVALIDATED/);
    assert.equal(await observer.isCurrent(), true);
    assert.equal((await read('member_actions')).length, 0);
  });

  await scenario('G10 a joined human receives Crew through the existing current-policy dispatcher', async () => {
    await boot(); discord.state.members.set(USER, [BYOND_ROLE]);
    await send('GUILD_MEMBER_ADD', { guild_id: GUILD, user: { id: USER }, roles: [BYOND_ROLE] });
    const worker = createMembershipDispatcher({ outbox, store, discord: discord.roles, enabled: observer.isCurrent });
    assert.deepEqual(await worker.runOnce('member-worker'), { status: 'settled' });
    assert.deepEqual(new Set(discord.state.members.get(USER)), new Set([BYOND_ROLE, CREW]));
    assert.equal(discord.state.calls.filter(call => call.method === 'PUT').length, 1);
  });

  await scenario('G11 leave and rejoin events invalidate the old membership episode even when REST already shows rejoin', async () => {
    await boot(); await start(); const before = await member();
    await send('GUILD_MEMBER_REMOVE', { guild_id: GUILD, user: { id: USER } });
    await send('GUILD_MEMBER_ADD', { guild_id: GUILD, user: { id: USER }, roles: [CREW] });
    assert.equal((await member()).presenceEpoch, before.presenceEpoch + 1);
    assert.equal((await read('sessions'))[0].current, false);
    assert.equal((await member()).observation.present, true); // Historical hints are not a fabricated REST absence.
  });

  await scenario('G12 child channel exclusions remain permanent after moves and deletion events', async () => {
    await boot(); const parent = '300000000000000020', child = '300000000000000021';
    await store.excludeCaseChannel({ actor: {}, guildId: GUILD, channelId: parent, parentId: null });
    await send('THREAD_CREATE', { guild_id: GUILD, id: child, parent_id: parent });
    await send('THREAD_UPDATE', { guild_id: GUILD, id: child, parent_id: OTHER });
    await send('THREAD_DELETE', { guild_id: GUILD, id: child, parent_id: OTHER });
    assert.equal(await store.hasCaseExclusion({ guildId: GUILD, lineage: [child] }), true);
    assert.equal((await read('case_exclusions')).length, 2);
    assert.equal((await read('gateway_members')).length, 0);
  });

  await scenario('G13 guild unavailability and configured-role deletion block delivery and invalidate prior eligibility', async () => {
    await boot(); await start(); const before = await member();
    await send('GUILD_DELETE', { id: GUILD, unavailable: true });
    assert.equal(await observer.isCurrent(), false); assert.equal(await outbox.claim('worker'), null);
    assert.ok((await member()).eligibilityEpoch > before.eligibilityEpoch);
    await observer.accept(connection, guildEvent(++sequence));
    assert.equal(await observer.isCurrent(), true);
    await send('GUILD_ROLE_DELETE', { guild_id: GUILD, role_id: WHITELIST });
    assert.equal(await observer.isCurrent(), false);
    const missing = guildEvent(++sequence); missing.d.roles = missing.d.roles.filter(role => role.id !== WHITELIST);
    await assert.rejects(observer.accept(connection, missing), /GATEWAY_PROCESSING_FAILED/);
    assert.equal(await observer.isCurrent(), false);
  });

  await scenario('G14 ignored events advance only the cursor; bot updates never schedule Crew grants', async () => {
    await boot(); await send('GUILD_MEMBER_REMOVE', { guild_id: OTHER, user: { id: USER } });
    await send('MESSAGE_CREATE', {});
    assert.equal((await read('members')).length, 0);
    assert.equal((await read('outbox')).length, 0);
    await send('GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: BOT, bot: true }, roles: [] });
    assert.equal((await read('outbox')).length, 0);
    assert.equal((await lifecycle()).sequence, String(sequence));
    const before = discord.state.calls.length;
    now += 45_000;
    await assert.rejects(discord.roles.observe(USER), /OBSERVATION_UNAVAILABLE/);
    assert.equal(discord.state.calls.length, before);
  });

  await scenario('G15 changed role ownership cannot silently reuse a saved Gateway session', async () => {
    await boot();
    const previous = await lifecycle();
    const lease = { guildId: GUILD, owner: previous.lease_owner, fence: previous.fence };
    const changed = createGatewayJournal({ pool, mapping: { ...mapping, whitelist: '100000000000000090' }, clock: () => now });
    assert.equal(await changed.readContinuity(lease), null);
    await assert.rejects(changed.renew(lease), /GATEWAY_CONFIGURATION_CHANGED/);
    await admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = clock_timestamp() - interval '1 second'");
    await assert.rejects(changed.acquire('different-configuration'), /GATEWAY_CONFIGURATION_CHANGED/);
    assert.equal((await lifecycle()).lease_owner, 'gateway-worker');
    assert.equal(await observer.isCurrent(), false);
  });

  await scenario('G16 Identify reservations are serialized, bounded and retained across owner replacement', async () => {
    await observer.acquire('budget-owner'); ({ connection } = await observer.beginIdentify());
    const [a, b] = await Promise.all([observer.reserveIdentify(), observer.reserveIdentify()]);
    assert.deepEqual([a.waitMs === 0, b.waitMs === 0].sort(), [false, true]);
    assert.equal((await lifecycle()).identify_attempts, 1);
    // Fault fixture advances only this test's budget timers; no wall-clock wait or production access.
    for (let i = 1; i < 20; i++) {
      await admin.query("UPDATE sophie_core.gateway_lifecycle SET identify_not_before = '-infinity'");
      assert.equal((await observer.reserveIdentify()).waitMs, 0);
    }
    assert.ok((await observer.reserveIdentify()).waitMs > 86_300_000);
    await admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = clock_timestamp() - interval '1 second'");
    const replacement = makeObserver(); await replacement.acquire('budget-replacement'); await replacement.beginIdentify();
    assert.ok((await replacement.reserveIdentify()).waitMs > 86_300_000);
    assert.equal((await lifecycle()).identify_attempts, 20);
    await assert.rejects(observer.reserveIdentify(), /GATEWAY_LEASE_LOST/);
    await admin.query(`UPDATE sophie_core.gateway_lifecycle SET identify_not_before = '-infinity',
      identify_window_started_at = clock_timestamp() - interval '25 hours'`);
    assert.equal((await replacement.reserveIdentify()).waitMs, 0);
    assert.equal((await lifecycle()).identify_attempts, 1);
  });

  await scenario('G17 native loopback WebSocket authenticates, grants Crew and resumes missed Whitelist revocation', async () => {
    observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: Date.now });
    discord = simulatedCases({ clock: Date.now, readContinuity: observer.readContinuity });
    store = createCoreStore({ pool, clock: Date.now, authorize: async () => true, casePolicy, caseVerification: discord.channels.verification });
    const server = await createLoopbackGateway({ onPacket(packet, peer) {
      if (packet.op === 2) { peer.send(readyEvent()); peer.send(guildEvent()); }
      if (packet.op === 6) {
        peer.send(gatewayEvent(5, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: USER }, roles: [CREW, BYOND_ROLE] }));
        peer.send(gatewayEvent(6, 'RESUMED'));
      }
    } });
    const supervisor = createGatewaySupervisor({ observer, transport: { getGatewayBot: async () => discoveryResponse() },
      connect: server.connect, token: SYNTHETIC_GATEWAY_TOKEN, clock: Date.now, random: () => 0.25, enabled: () => true });
    const finished = supervisor.start('native-gateway-worker');
    try {
      await waitForGateway(observer.isCurrent);
      assert.equal(server.connections[0].received[0].intents, 3);
      discord.state.members.set(USER, [BYOND_ROLE]);
      server.connections[0].send(gatewayEvent(3, 'GUILD_MEMBER_ADD', { guild_id: GUILD, user: { id: USER }, roles: [BYOND_ROLE] }));
      await waitForGateway(async () => (await lifecycle()).sequence === '3' && await observer.isCurrent());
      const worker = createMembershipDispatcher({ outbox, store, discord: discord.roles, enabled: observer.isCurrent });
      assert.deepEqual(await worker.runOnce('native-member-worker'), { status: 'settled' });
      assert.deepEqual(new Set(discord.state.members.get(USER)), new Set([CREW, BYOND_ROLE]));
      discord.state.members.get(USER).push(WHITELIST);
      server.connections[0].send(gatewayEvent(4, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: USER }, roles: [CREW, BYOND_ROLE, WHITELIST] }));
      await waitForGateway(async () => (await lifecycle()).sequence === '4' && await observer.isCurrent());
      await start(); const before = await member();
      server.connections[0].send({ op: 7 });
      await waitForGateway(async () => !await observer.isCurrent());
      assert.deepEqual(await worker.runOnce('paused-worker'), { status: 'disabled' });
      // The in-memory gate closes first; the durable pause is a separate awaited commit.
      await waitForGateway(async () => (await lifecycle()).status === 'offline');
      assert.equal(await outbox.claim('paused-worker'), null);
      discord.state.members.set(USER, [CREW, BYOND_ROLE]);
      await waitForGateway(async () => (await lifecycle()).sequence === '6' && await observer.isCurrent());
      assert.deepEqual(server.connections[1].received.find(packet => packet.op === 6),
        { op: 6, sessionId: 'synthetic-gateway-session', sequence: 4 });
      assert.equal((await member()).eligibilityEpoch, before.eligibilityEpoch + 1);
      assert.equal((await read('sessions'))[0].current, false);
      assert.equal((await lifecycle()).identify_attempts, 1);
      assert.deepEqual(server.errors, []);
    } finally { await supervisor.stop(); await finished; await server.stop(); }
    assert.equal((await lifecycle()).status, 'offline'); assert.equal(await observer.isCurrent(), false);
  });
}
