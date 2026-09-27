import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createOnboardingCommands } from '../../apps/core/discord/onboarding-commands.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createOnboardingDispatcher } from '../../apps/core/discord/onboarding-dispatcher.js';
import { createRoleDispatcher } from '../../apps/core/discord/dispatcher.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { simulatedOnboarding } from '../../tests/fixtures/onboarding.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { CREW, BYOND_ROLE, WHITELIST, MUZZLED } from '../../tests/fixtures/discord.js';
import { syntheticInteractions, APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, definition, publication, observation } from '../../tests/fixtures/domain.js';

/** Authored synthetic copy only; the actual HTTP adapters, signatures and database are exercised. */
export async function runOnboardingScreenSuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool, outbox = createOutbox({ pool });
  const limits = { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 };
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [LEAD], 'member.unmute': [LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  let now, discord, identities, authorization, store, commands, screens, cases, grants, healthy;
  let sequence = 830000000000000000n;
  const nextId = () => String(++sequence);
  const rows = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  const currentScreen = async () => (await rows('shuttle_screens')).find(row => row.current);
  const session = async () => (await admin.query('SELECT state FROM sophie_core.sessions ORDER BY id DESC LIMIT 1')).rows[0].state;
  const payload = (overrides = {}) => identities.payload({ id: nextId(), member: { user: { id: USER } },
    data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] }, ...overrides });
  const verified = value => identities.verifier.verify(identities.signed(value));
  const actor = async (userId = USER) => authorization.resolveActor(verified(payload({ member: { user: { id: userId } } })));
  const entry = async value => commands.execute(verified(value ?? payload()));
  const controlPayload = (screen, action, overrides = {}) => payload({ type: 3, channel_id: screen.channel_id, message: { id: screen.message_id },
    data: { component_type: 2, custom_id: `sophie:shuttle:v1:${screen.id}:${action}:${screen.control_version}` }, ...overrides });
  const click = (screen, action, overrides = {}) => commands.execute(verified(controlPayload(screen, action, overrides)));
  const messageWrites = method => discord.state.calls.filter(call => call.method === method && /\/messages(?:\/\d+)?$/.test(call.path));
  const makeDue = () => admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second' WHERE status = 'ready'");
  async function drain(worker, name = 'shuttle-worker') {
    for (let i = 0; i < 50; i++) {
      const result = await worker.runOnce(name);
      if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed'].includes(result.status), `Unexpected worker result: ${result.status}/${result.code}`);
    }
    assert.fail('Synthetic queue did not drain within its bound');
  }
  async function open() {
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases); await drain(screens); return currentScreen();
  }
  async function direct(screen, action, interactionId = nextId()) {
    const currentActor = await actor();
    const control = { screenId: screen.id, channelId: screen.channel_id, messageId: screen.message_id, controlVersion: screen.control_version };
    const { plan } = await store.describeOnboardingControl({ actor: currentActor, observation: await discord.roles.observe(USER), ...control });
    return { actor: currentActor, action, interactionId, ...control, proof: await discord.channels.inspect(plan, screen.channel_id),
      observation: await discord.roles.observe(USER) };
  }
  const scenario = (name, work, publish = true) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.automation_policies, sophie_core.case_answer_reviews, sophie_core.curated_answers, sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications,
      sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle,
      sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.member_actions,
      sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.members, sophie_core.definitions,
      sophie_core.case_channels, sophie_core.case_provisions, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    now = NOW; healthy = true;
    discord = simulatedOnboarding({ clock: () => now, enabled: () => healthy }); discord.state.members.set(OTHER, [LEAD]);
    identities = syntheticInteractions({ clock: () => now });
    authorization = createCoreAuthorization({ principals: identities.verifier, discord: discord.roles,
      authorityStore: createActorAuthorityStore({ pool, clock: () => now }), policy, clock: () => now,
      isAuthorityCurrent: () => healthy, readContinuity: discord.roles.readContinuity });
    store = createCoreStore({ pool, clock: () => now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, casePolicy, caseVerification: discord.channels.verification,
      onboardingMessageVerification: discord.messages.verification });
    if (publish) await store.publishOnboarding({ actor: await actor(OTHER), publication });
    commands = createOnboardingCommands({ authorization, discord: discord.roles, channels: discord.channels, store,
      enabled: () => healthy, definitionId: definition.id, limits });
    cases = createCaseDispatcher({ outbox, store, roles: discord.roles, channels: discord.channels, enabled: () => healthy });
    screens = createOnboardingDispatcher({ outbox, store, roles: discord.roles, messages: discord.messages, enabled: () => healthy });
    grants = createRoleDispatcher({ outbox, store, discord: discord.roles, enabled: () => healthy });
    await work();
  });

  await scenario('V01 signed controls deliver all five pinned pages and show completion only after observed Whitelist', async () => {
    const anchor = await open();
    await store.publishOnboarding({ actor: await actor(OTHER), publication: { ...publication, version: 2,
      stages: publication.stages.map(stage => ({ ...stage, body: 'Different synthetic next-version guidance.' })) } });
    for (let index = 0; index < 5; index++) {
      const screen = await currentScreen(), current = await session();
      assert.equal(screen.message_id, anchor.message_id); assert.equal(screen.id, anchor.id);
      assert.equal(current.definitionVersion, 1); assert.equal(current.stepIndex, index); assert.equal(screen.ready, true);
      assert.equal(discord.state.messages.get(screen.message_id).embeds[0].description, publication.stages[index].body);
      assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
      assert.equal(await click(screen, 'advance'), 'shuttle_progress_recorded'); await drain(screens);
    }
    assert.equal((await session()).status, 'role_pending');
    assert.match(discord.state.messages.get((await currentScreen()).message_id).embeds[0].title, /Nearly there/);
    await drain(grants); await drain(screens);
    assert.equal((await session()).status, 'complete'); assert.ok(discord.state.members.get(USER).includes(WHITELIST));
    assert.match(discord.state.messages.get((await currentScreen()).message_id).embeds[0].description, /Welcome aboard/);
    assert.equal(discord.state.calls.filter(call => call.method === 'PUT' && call.path.endsWith(WHITELIST)).length, 1);
    assert.ok(discord.state.members.get(USER).includes(BYOND_ROLE));
    assert.equal(messageWrites('POST').length, 1); assert.equal((await rows('shuttle_screens')).length, 1);
  });

  await scenario('V02 duplicate and competing controls commit one transition and never reactivate an old message', async () => {
    const screen = await open(), request = await direct(screen, 'advance');
    const results = await Promise.all([store.actOnOnboarding(request), store.actOnOnboarding(request)]);
    assert.deepEqual(results.map(result => result.duplicate).sort(), [false, true]); assert.equal((await session()).stepIndex, 1);
    assert.equal(await click(screen, 'advance'), 'shuttle_stale');
    await drain(screens);
    assert.equal((await currentScreen()).message_id, screen.message_id);
    assert.equal(await click(screen, 'advance'), 'shuttle_stale');
    const second = await direct(await currentScreen(), 'back');
    const competing = await Promise.allSettled([store.actOnOnboarding(second), store.actOnOnboarding({ ...second, interactionId: nextId() })]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(competing.find(result => result.status === 'rejected').reason.code, 'STALE_SHUTTLE_CONTROL');
    assert.equal((await session()).stepIndex, 0);
  });

  await scenario('V03 failed screen intent rolls back progression, receipt and current-screen replacement', async () => {
    const screen = await open(), request = await direct(screen, 'advance'), count = (await rows('receipts')).length;
    await admin.query("ALTER TABLE sophie_core.outbox ADD CONSTRAINT synthetic_screen_failure CHECK (kind <> 'shuttle.render') NOT VALID");
    try { await assert.rejects(store.actOnOnboarding(request), error => error.code === '23514'); }
    finally { await admin.query('ALTER TABLE sophie_core.outbox DROP CONSTRAINT synthetic_screen_failure'); }
    assert.equal((await session()).stepIndex, 0); assert.equal((await currentScreen()).id, screen.id);
    assert.equal((await rows('receipts')).length, count); assert.equal((await rows('shuttle_screens')).length, 1);
  });

  await scenario('V04 Muzzled invalidates controls immediately and unmuted recovery preserves eligible progress', async () => {
    let screen = await open(); assert.equal(await click(screen, 'advance'), 'shuttle_progress_recorded'); await drain(screens);
    screen = await currentScreen(); discord.state.members.get(USER).push(MUZZLED);
    assert.equal(await click(screen, 'advance'), 'denied');
    await store.recordObservation(observation({ observedAt: now, muzzled: true })); await drain(screens);
    assert.equal(await currentScreen(), undefined); assert.ok(discord.state.messages.get(screen.message_id).components.flatMap(row => row.components).every(button => button.disabled));
    discord.state.members.set(USER, [CREW, BYOND_ROLE]);
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases); await drain(screens);
    assert.equal((await session()).stepIndex, 1); assert.notEqual((await currentScreen()).id, screen.id);
    assert.equal(await click(screen, 'advance'), 'shuttle_stale');
  });

  await scenario('V05 Whitelist loss retires a repeat screen and a new run begins at page one', async () => {
    discord.state.members.get(USER).push(WHITELIST);
    const first = await open(); assert.equal(await click(first, 'advance'), 'shuttle_progress_recorded'); await drain(screens);
    const old = await currentScreen(); discord.state.members.set(USER, [CREW, BYOND_ROLE]);
    assert.equal(await click(old, 'advance'), 'shuttle_review'); await drain(screens);
    assert.equal(await currentScreen(), undefined);
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases); await drain(screens);
    assert.equal((await session()).stepIndex, 0); assert.notEqual((await currentScreen()).session_id, first.session_id);
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('V06 another member, channel, message or changed audience cannot use a valid-looking control', async () => {
    const screen = await open();
    assert.equal(await click(screen, 'advance', { member: { user: { id: OTHER } } }), 'shuttle_stale');
    assert.equal(await click(screen, 'advance', { channel_id: OTHER }), 'denied');
    assert.equal(await click(screen, 'advance', { message: { id: OTHER } }), 'denied');
    discord.state.channels.get(screen.channel_id).permission_overwrites.push({ id: OTHER, type: 1, allow: '1024', deny: '0' });
    assert.equal(await click(screen, 'advance'), 'shuttle_review'); assert.equal((await session()).stepIndex, 0);
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases); await drain(screens);
    assert.equal(await click(await currentScreen(), 'advance'), 'shuttle_progress_recorded');
  });

  await scenario('V07 lost create response parks without a blind POST; explicit recovery replaces its authority', async () => {
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases);
    const old = await currentScreen();
    discord.state.afterWrite = call => { if (call.method === 'POST' && call.path.endsWith('/messages')) { discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_MESSAGE_RESPONSE'); } };
    assert.equal((await screens.runOnce('lost-create')).status, 'retry_scheduled');
    now += 600_000; await makeDue();
    assert.equal((await screens.runOnce('inspect-create')).code, 'SHUTTLE_MESSAGE_UNCERTAIN');
    assert.equal(messageWrites('POST').length, 1);
    const unknownMessage = [...discord.state.messages.values()][0];
    assert.equal(await click({ ...old, channel_id: unknownMessage.channel_id, message_id: unknownMessage.id }, 'advance'), 'denied');
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases); await drain(screens);
    assert.equal(messageWrites('POST').length, 2); assert.equal((await session()).stepIndex, 0);
    assert.notEqual((await currentScreen()).id, old.id);
    assert.equal((await rows('shuttle_screens')).find(row => row.id === old.id).current, false);
  });

  await scenario('V08 a lost retirement response is observed without repeating the edit', async () => {
    const screen = await open();
    discord.state.members.get(USER).push(MUZZLED); await store.recordObservation(observation({ muzzled: true }));
    discord.state.afterWrite = call => { if (call.method === 'PATCH' && call.path.includes('/messages/')) { discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_EDIT_RESPONSE'); } };
    assert.equal((await screens.runOnce('lost-edit')).status, 'retry_scheduled');
    await makeDue(); await drain(screens);
    assert.ok(discord.state.messages.get(screen.message_id).components.flatMap(row => row.components).every(button => button.disabled)); assert.equal(messageWrites('PATCH').length, 1);
  });

  await scenario('V09 a screen created during revocation retains its ID and is made inert before any progression', async () => {
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases);
    discord.state.afterWrite = async call => {
      if (call.method === 'POST' && call.path.endsWith('/messages')) {
        discord.state.afterWrite = null; discord.state.members.get(USER).push(MUZZLED);
        await store.recordObservation(observation({ muzzled: true }));
      }
    };
    assert.equal((await screens.runOnce('late-screen')).status, 'progressed'); await drain(screens);
    const retained = (await rows('shuttle_screens'))[0]; assert.ok(retained.message_id);
    assert.equal(retained.current, false); assert.equal(retained.ready, false);
    assert.ok(discord.state.messages.get(retained.message_id).components.flatMap(row => row.components).every(button => button.disabled));
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('V10 lease loss retains an authentic message result without allowing the expired worker to confirm', async () => {
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases);
    discord.state.afterWrite = async call => {
      if (call.method === 'POST' && call.path.endsWith('/messages')) {
        discord.state.afterWrite = null;
        await admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = 'shuttle.render' AND status = 'leased'");
      }
    };
    assert.equal((await screens.runOnce('expired-screen')).status, 'lease_lost');
    assert.ok((await currentScreen()).message_id); assert.equal((await currentScreen()).ready, false);
    await drain(screens); assert.equal((await currentScreen()).ready, true); assert.equal(messageWrites('POST').length, 1);
  });

  await scenario('V11 entry recovers a deleted message without changing progress or reusing obsolete controls', async () => {
    const first = await open(); assert.equal(await click(first, 'advance'), 'shuttle_progress_recorded'); await drain(screens);
    const old = await currentScreen(); discord.state.messages.delete(old.message_id);
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases); await drain(screens);
    const replacement = await currentScreen(); assert.notEqual(replacement.id, old.id); assert.equal(replacement.snapshot.stepIndex, 1);
    assert.equal(await click(old, 'advance'), 'shuttle_stale');
    assert.equal((await rows('shuttle_screens')).find(row => row.id === old.id).message_id, old.message_id);
  });

  await scenario('V12 publication requires current authority and immutable copy; metadata alone cannot start a screen', async () => {
    await store.publishDefinition({ actor: await actor(OTHER), definition });
    assert.equal(await entry(), 'shuttle_review'); assert.equal((await rows('sessions')).length, 0);
    await assert.rejects(store.publishOnboarding({ actor: await actor(), publication }), /OPERATION_DENIED/);
    await store.publishOnboarding({ actor: await actor(OTHER), publication });
    await assert.rejects(store.publishOnboarding({ actor: await actor(OTHER), publication: { ...publication,
      stages: publication.stages.map(stage => ({ ...stage, body: 'Changed synthetic guidance.' })) } }), /SHUTTLE_COPY_IMMUTABLE/);
    assert.deepEqual((await rows('shuttle_publications'))[0].publication, publication);
    await assert.rejects(cluster.knowledgePool.query('SELECT publication FROM sophie_core.shuttle_publications'), error => error.code === '42501');
    await assert.rejects(pool.query('DELETE FROM sophie_core.shuttle_screens'), error => error.code === '42501');
    await open();
  }, false);

  await scenario('V13 Ask Staff records one retained request and permits continued reading under the published rule', async () => {
    const first = await open(), body = controlPayload(first, 'help');
    assert.equal(await commands.execute(verified(body)), 'shuttle_help_recorded');
    assert.equal(await commands.execute(verified(body)), 'shuttle_help_recorded'); await drain(screens);
    assert.equal((await rows('shuttle_help_requests')).length, 1); assert.equal((await session()).stepIndex, 0);
    const current = await currentScreen(); assert.equal(current.help_requested, true);
    assert.equal(await click(current, 'help'), 'shuttle_help_recorded'); assert.equal((await rows('shuttle_help_requests')).length, 1);
    assert.equal(await click(current, 'advance'), 'shuttle_progress_recorded'); assert.equal((await session()).stepIndex, 1);
  });

  await scenario('V14 signed loopback controls acknowledge silently and disabled delivery makes no further writes', async () => {
    const screen = await open(), replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION,
      enabled: () => healthy, clock: () => now, fetch: async (_, request) => { replies.push(JSON.parse(request.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: identities.verifier, commands, respond: responder.respond,
      enabled: () => healthy, onFault: code => faults.push(code) });
    const address = await server.listen();
    try {
      const signed = identities.signed(controlPayload(screen, 'advance'));
      const response = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST', body: signed.body,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
      assert.deepEqual(await response.json(), { type: 6 }); await server.drain();
      assert.equal(replies.length, 0);
      assert.equal((await session()).stepIndex, 1); const writes = messageWrites('POST').length;
      healthy = false; assert.equal((await screens.runOnce('disabled')).status, 'disabled'); assert.equal(messageWrites('POST').length, writes);
      assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });

  await scenario('V15 an old completed entry receipt cannot replace the screen of a newer repeat', async () => {
    discord.state.members.get(USER).push(WHITELIST);
    const original = payload(); assert.equal(await entry(original), 'shuttle_recorded'); await drain(cases); await drain(screens);
    for (let i = 0; i < 5; i++) { assert.equal(await click(await currentScreen(), 'advance'), 'shuttle_progress_recorded'); await drain(screens); }
    assert.equal((await session()).status, 'complete');
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases); await drain(screens);
    const latest = await currentScreen(); assert.equal(latest.snapshot.stepIndex, 0);
    assert.equal(await entry(original), 'shuttle_recorded'); await drain(cases); await drain(screens);
    assert.equal((await currentScreen()).id, latest.id); assert.equal((await rows('sessions')).length, 2);
  });

  await scenario('V16 withdrawal prevents queued stage content and leaves inert retained screens', async () => {
    const first = await open(); assert.equal(await click(first, 'advance'), 'shuttle_progress_recorded');
    await store.withdrawDefinition({ actor: await actor(OTHER), id: definition.id, version: 1 });
    await drain(screens); assert.equal(messageWrites('POST').length, 1);
    assert.ok(discord.state.messages.get(first.message_id).components.flatMap(row => row.components).every(button => button.disabled)); assert.equal(await currentScreen(), undefined);
    assert.equal(await click(first, 'advance'), 'shuttle_review');
    assert.equal((await rows('shuttle_publications')).length, 1); assert.equal((await rows('shuttle_screens')).length, 1);
  });

  await scenario('V17 closing a ready private case queues screen cleanup and prevents further controls', async () => {
    const screen = await open(), binding = (await rows('shuttle_cases'))[0];
    await closeTestCase({ store, actor: await actor(OTHER), observation: await discord.roles.observe(USER), interactionId: nextId(), id: binding.case_id, worker: cases });
    assert.equal(await click(screen, 'advance'), 'shuttle_review'); await drain(screens);
    assert.ok(discord.state.messages.get(screen.message_id).components.flatMap(row => row.components).every(button => button.disabled)); assert.equal(await currentScreen(), undefined);
    assert.equal((await session()).stepIndex, 0); assert.equal((await rows('case_reservations'))[0].state, 'closed');
    assert.equal((await rows('case_exclusions')).length, 1);
  });

  await scenario('V18 a changed publication hash blocks delivery before any authored screen is sent', async () => {
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases);
    await admin.query("UPDATE sophie_core.shuttle_publications SET sha256 = repeat('0', 64)");
    assert.equal((await screens.runOnce('copy-integrity')).code, 'SHUTTLE_COPY_INVALID');
    assert.equal(messageWrites('POST').length, 0); assert.equal((await currentScreen()).ready, false);
  });

  await scenario('V19 policy replacement retains a late message ID but cannot confirm the old screen', async () => {
    assert.equal(await entry(), 'shuttle_recorded'); await drain(cases);
    discord.state.afterWrite = async call => {
      if (call.method === 'POST' && call.path.endsWith('/messages')) {
        discord.state.afterWrite = null;
        await admin.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, 2, $2)',
          [GUILD, { ...casePolicy, version: 2 }]);
      }
    };
    assert.equal((await screens.runOnce('changed-policy')).code, 'CASE_POLICY_CHANGED');
    assert.ok((await currentScreen()).message_id); assert.equal((await currentScreen()).ready, false);
    assert.equal((await session()).stepIndex, 0); assert.equal(messageWrites('POST').length, 1);
  });
  await scenario('V20 a lost page-edit response reconciles the same message without another post or transition', async () => {
    const first = await open(); assert.equal(await click(first, 'advance'), 'shuttle_progress_recorded');
    discord.state.afterWrite = call => { if (call.method === 'PATCH' && call.path.includes('/messages/')) {
      discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_PAGE_EDIT');
    } };
    assert.equal((await screens.runOnce('lost-page')).status, 'retry_scheduled');
    await makeDue(); await drain(screens);
    const current = await currentScreen(); assert.equal(current.message_id, first.message_id); assert.equal(current.ready, true);
    assert.equal(messageWrites('POST').length, 1); assert.equal(messageWrites('PATCH').length, 1);
    assert.equal((await session()).stepIndex, 1); assert.equal(await click(first, 'advance'), 'shuttle_stale');
  });
}
