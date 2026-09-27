import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createOnboardingCommands, createAdministrationCommands } from '../../apps/core/discord/onboarding-commands.js';
import { createModerationCommands } from '../../apps/core/discord/moderation-commands.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { ONBOARDING_ENTRY_ID } from '../../modules/onboarding/entry-controls.js';
import { simulatedCases, casePolicy } from '../../tests/fixtures/cases.js';
import { CREW, BYOND_ROLE, WHITELIST, MUZZLED } from '../../tests/fixtures/discord.js';
import { syntheticInteractions, APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW, definition, publication, command } from '../../tests/fixtures/domain.js';

/** Synthetic metadata, actual signatures/HTTP/transactions; no live case or onboarding text. */
export async function runOnboardingEntrySuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool;
  const limits = { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 };
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [LEAD], 'member.unmute': [LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
  let now, discord, identities, authorization, store, commands, worker, healthy;
  let sequence = 820000000000000000n;
  const nextId = () => String(++sequence);
  const rows = async table => (await admin.query(`SELECT * FROM sophie_core.${table}`)).rows;
  const payload = (overrides = {}) => identities.payload({ member: { user: { id: USER } },
    data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] }, ...overrides });
  const actor = async (userId = USER) => authorization.resolveActor(identities.verifier.verify(identities.signed(payload({ member: { user: { id: userId } } }))));
  async function open(overrides = {}) {
    const interactionId = nextId();
    return store.openOnboarding({ actor: await actor(), interactionId, id: `entry.${interactionId}`, nonce: `nonce.${interactionId}`,
      caseId: `entry-case.${interactionId}`, observation: await discord.roles.observe(USER), definitionId: definition.id, limits, ...overrides });
  }
  async function provision() {
    assert.equal((await worker.runOnce('shuttle-case-worker')).status, 'progressed');
    assert.equal((await worker.runOnce('shuttle-case-worker')).status, 'settled');
  }
  const scenario = (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle,
      sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.member_actions,
      sophie_core.outbox, sophie_core.receipts, sophie_core.sessions, sophie_core.members, sophie_core.definitions,
      sophie_core.case_channels, sophie_core.case_provisions, sophie_core.case_policies,
      sophie_core.case_reservations, sophie_core.case_budgets, sophie_core.case_exclusions`);
    now = NOW; healthy = true;
    discord = simulatedCases({ clock: () => now }); discord.state.members.set(OTHER, [LEAD]);
    identities = syntheticInteractions({ clock: () => now });
    authorization = createCoreAuthorization({ principals: identities.verifier, discord: discord.roles,
      authorityStore: createActorAuthorityStore({ pool, clock: () => now }), policy, clock: () => now,
      isAuthorityCurrent: () => healthy, readContinuity: discord.roles.readContinuity });
    store = createCoreStore({ pool, clock: () => now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, casePolicy, caseVerification: discord.channels.verification });
    await store.publishOnboarding({ actor: await actor(OTHER), publication });
    const onboarding = createOnboardingCommands({ authorization, discord: discord.roles, store,
      enabled: () => healthy, definitionId: definition.id, limits });
    const moderation = createModerationCommands({ authorization, discord: discord.roles, store, enabled: () => healthy });
    commands = createAdministrationCommands({ moderation, onboarding });
    worker = createCaseDispatcher({ outbox: createOutbox({ pool }), store, roles: discord.roles, channels: discord.channels, enabled: () => healthy });
    await work();
  });

  await scenario('U01 signed Shuttle entry commits a session, private case binding and provisioning intent together', async () => {
    const proof = identities.verifier.verify(identities.signed(payload()));
    assert.equal(await commands.execute(proof), 'shuttle_recorded');
    const session = (await rows('sessions'))[0].state, binding = (await rows('shuttle_cases'))[0];
    assert.equal(session.stepIndex, 0); assert.equal(binding.session_id, session.id); assert.equal(binding.user_id, USER);
    assert.equal((await rows('case_reservations'))[0].type, 'shuttle');
    assert.equal((await rows('outbox')).filter(row => row.kind === 'case.provision').length, 1);
    assert.equal((await rows('shuttle_screens')).length, 1);
    await provision();
    assert.equal((await rows('case_reservations'))[0].state, 'open');
    assert.equal((await rows('case_exclusions')).length, 1);
    assert.equal(discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('U02 duplicate or concurrent entry returns one current run and one case without losing progress', async () => {
    const request = { actor: await actor(), interactionId: nextId(), id: 'concurrent-entry', nonce: 'first',
      caseId: 'concurrent-case', observation: await discord.roles.observe(USER), definitionId: definition.id, limits };
    const [first, second] = await Promise.all([store.openOnboarding(request), store.openOnboarding({ ...request, interactionId: nextId(), id: 'other-entry', caseId: 'other-case' })]);
    assert.equal(first.session.id, second.session.id); assert.equal((await rows('sessions')).length, 1);
    assert.equal((await rows('case_reservations')).length, 1); assert.equal((await rows('outbox')).filter(row => row.kind === 'case.provision').length, 1);
    const moved = await store.transition({ actor: await actor(), action: 'advance', interactionId: nextId(), sessionId: first.session.id,
      command: command(first.session), observation: await discord.roles.observe(USER) });
    const duplicate = await store.openOnboarding(request);
    assert.equal(duplicate.duplicate, true); assert.equal(duplicate.session.stepIndex, moved.session.stepIndex);
    assert.equal((await rows('outbox')).filter(row => row.kind === 'case.provision').length, 1);
  });

  await scenario('U03 failed binding rolls back the session, case, receipt and provisioning job', async () => {
    await admin.query('ALTER TABLE sophie_core.shuttle_cases ADD CONSTRAINT synthetic_fail_binding CHECK (false) NOT VALID');
    try { await assert.rejects(open(), error => error.code === '23514'); }
    finally { await admin.query('ALTER TABLE sophie_core.shuttle_cases DROP CONSTRAINT synthetic_fail_binding'); }
    for (const table of ['sessions', 'shuttle_cases', 'shuttle_screens', 'case_reservations', 'case_provisions', 'outbox', 'receipts']) assert.equal((await rows(table)).length, 0);
  });

  await scenario('U04 entry rechecks Muzzled, restrictive mute intent, absence and authenticated ownership', async () => {
    const request = () => commands.execute(identities.verifier.verify(identities.signed(payload())));
    discord.state.members.get(USER).push(MUZZLED); assert.equal(await request(), 'denied');
    discord.state.members.set(USER, [CREW, BYOND_ROLE]);
    await store.requestMute({ actor: await actor(OTHER), interactionId: nextId(), observation: await discord.roles.observe(USER) });
    assert.equal(await request(), 'denied'); assert.equal((await rows('sessions')).length, 0);
    await assert.rejects(open({ actor: await actor(OTHER) }), /OPERATION_DENIED/);
    const proof = identities.verifier.verify(identities.signed(payload()));
    assert.equal(await commands.execute({ ...proof }), 'denied');
    discord.state.members.delete(USER); assert.equal(await request(), 'denied');
    assert.equal((await rows('case_reservations')).length, 0);
  });

  await scenario('U05 repeats use the newest definition and reuse an eligible private case without consuming another quota', async () => {
    discord.state.members.get(USER).push(WHITELIST);
    let opened = await open({ limits: { ...limits, memberOpen: 1 } }); await provision();
    const originalCase = opened.case.id;
    for (let version = 2; version <= 4; version++) {
      for (let step = 0; step < 5; step++) {
        opened = await store.transition({ actor: await actor(), action: 'advance', interactionId: nextId(), sessionId: opened.session.id,
          command: command(opened.session), observation: await discord.roles.observe(USER) });
      }
      assert.equal(opened.session.status, 'complete');
      await store.publishOnboarding({ actor: await actor(OTHER), publication: { ...publication, version } });
      opened = await open({ limits: { ...limits, memberOpen: 1 } });
      assert.equal(opened.session.definitionVersion, version); assert.equal(opened.session.stepIndex, 0);
      assert.equal(opened.case.id, originalCase);
    }
    assert.equal((await rows('sessions')).length, 4); assert.equal((await rows('case_reservations')).length, 1);
    assert.equal((await rows('outbox')).filter(row => row.kind === 'case.provision' && row.status === 'ready').length, 1);
    assert.ok(discord.state.members.get(USER).includes(WHITELIST));
    assert.equal(discord.state.calls.filter(call => ['PUT', 'DELETE'].includes(call.method)).length, 0);
  });

  await scenario('U06 Whitelist loss starts a fresh run; a changed membership episode cannot reuse the old case', async () => {
    discord.state.members.get(USER).push(WHITELIST);
    const first = await open(); await provision();
    const moved = await store.transition({ actor: await actor(), action: 'advance', interactionId: nextId(), sessionId: first.session.id,
      command: command(first.session), observation: await discord.roles.observe(USER) });
    assert.equal(moved.session.stepIndex, 1);
    discord.state.members.set(USER, [CREW, BYOND_ROLE]);
    const second = await open(); assert.notEqual(first.session.id, second.session.id);
    assert.equal(second.session.stepIndex, 0); assert.equal(second.case.id, first.case.id);
    discord.state.members.delete(USER); await store.recordObservation(await discord.roles.observe(USER));
    discord.state.members.set(USER, [CREW, BYOND_ROLE]); now += 1_001;
    const third = await open(); assert.notEqual(third.case.id, first.case.id); assert.equal(third.session.stepIndex, 0);
    assert.equal((await rows('sessions')).filter(row => row.current).length, 1);
  });

  await scenario('U07 withdrawal and case closure preserve history and prevent automatic reopening', async () => {
    const first = await open(); await provision();
    await closeTestCase({ store, actor: await actor(OTHER), observation: await discord.roles.observe(USER), interactionId: nextId(), id: first.case.id, worker: worker });
    await assert.rejects(open(), /SHUTTLE_CASE_UNAVAILABLE/);
    await store.withdrawDefinition({ actor: await actor(OTHER), id: definition.id, version: 1 });
    await assert.rejects(open(), /DEFINITION_WITHDRAWN/);
    assert.equal((await rows('sessions')).length, 1); assert.equal((await rows('shuttle_cases')).length, 1);
    assert.equal((await rows('case_reservations'))[0].state, 'closed');
  });

  await scenario('U08 a signed loopback button and slash command acknowledge privately and share one durable entry', async () => {
    const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION,
      enabled: () => healthy, clock: () => now, fetch: async (_, request) => {
        replies.push(JSON.parse(request.body)); return Response.json({});
      } });
    const server = createInteractionHttpServer({ verifier: identities.verifier, commands, respond: responder.respond,
      enabled: () => healthy, onFault: code => faults.push(code) });
    const address = await server.listen();
    async function post(value, tampered = false) {
      const signed = identities.signed(value);
      return fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp },
        body: tampered ? '{}' : signed.body });
    }
    try {
      const button = payload({ type: 3, message: { id: OTHER }, data: { component_type: 2, custom_id: ONBOARDING_ENTRY_ID } });
      assert.equal((await post(button, true)).status, 401);
      assert.deepEqual(await (await post(button)).json(), { type: 5, data: { flags: 64 } }); await server.drain();
      assert.deepEqual(await (await post(payload())).json(), { type: 5, data: { flags: 64 } }); await server.drain();
      assert.equal(replies.length, 2); assert.ok(replies.every(reply => /request is recorded/.test(reply.content)));
      assert.ok(replies.every(reply => reply.allowed_mentions.parse.length === 0));
      assert.equal((await rows('sessions')).length, 1); assert.equal((await rows('case_reservations')).length, 1);
      healthy = false;
      assert.match((await (await post(payload())).json()).data.content, /disabled/);
      assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });

  await scenario('U09 exhausted case budgets do not leave a session or receipt behind', async () => {
    await store.reserveCase({ actor: await actor(), interactionId: nextId(), id: 'ordinary-case', type: 'admin-help',
      observation: await discord.roles.observe(USER), limits });
    now += 1_001;
    await assert.rejects(open({ limits: { ...limits, memberOpen: 1 } }), /MEMBER_CASE_LIMIT/);
    assert.equal((await rows('sessions')).length, 0); assert.equal((await rows('shuttle_cases')).length, 0);
    assert.equal((await rows('receipts')).length, 1);
    assert.equal((await rows('case_reservations')).length, 1);
  });
}
