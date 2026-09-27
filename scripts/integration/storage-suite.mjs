import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import { caseStaffPayload } from '../../tests/fixtures/case-staff.js';
import assert from 'node:assert/strict';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createCaseInspectionStore } from '../../apps/core/storage/case-inspections.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { inTransaction } from '../../apps/core/storage/transaction.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { simulatedDiscord, MUZZLED, CREW, mapping } from '../../tests/fixtures/discord.js';
import { simulatedCases, casePolicy } from '../../tests/fixtures/cases.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createCaseChannels } from '../../apps/core/discord/case-channels.js';
import { createOnboardingDispatcher } from '../../apps/core/discord/onboarding-dispatcher.js';
import { createOnboardingAlertDispatcher } from '../../apps/core/discord/onboarding-alert-dispatcher.js';
import { createOnboardingAlertMessages } from '../../apps/core/discord/onboarding-alert-messages.js';
import { simulatedOnboarding } from '../../tests/fixtures/onboarding.js';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { dashboardWorkflow, dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { sessionCsrf } from '../../apps/core/security/dashboard-auth.js';
import { authoringWorkflow, authoringServices, draftDocument, editorRequestId } from '../../tests/fixtures/onboarding-authoring.js';
import { formAuthoringWorkflow, formAuthoringServices, formRequestId } from '../../tests/fixtures/case-form-authoring.js';
import { intakeWorkflow, caseIntakeServices, syntheticCaseForm, intakeSubmitPayload, playerReportPayload } from '../../tests/fixtures/case-intake.js';
import { intakeDeliveryWorkflow, intakeDeliveryServices } from '../../tests/fixtures/case-intake-delivery.js';
import { participantServices, PARTICIPANT } from '../../tests/fixtures/case-participants.js';
import { contactWorkflow, contactControlPayload } from '../../tests/fixtures/case-contacts.js';
import { conversationWorkflow, syntheticConversation } from '../../tests/fixtures/case-conversations.js';
import { attachmentWorkflow, attachmentServices, syntheticFileBytes } from '../../tests/fixtures/case-attachments.js';
import { createAttachmentVault } from '../../apps/core/storage/attachment-vault.js';
import { Readable } from 'node:stream';
import { createCaseMessageCapture } from '../../apps/core/discord/case-message-capture.js';
import { createGatewayObserver } from '../../apps/core/discord/gateway-observer.js';
import { gatewayEvent } from '../../tests/fixtures/gateway.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { createCaseIntakeDispatcher } from '../../apps/core/discord/case-intake-dispatcher.js';
import { caseIssueWorkflow, caseIssueServices, issuePayload, parkIntake } from '../../tests/fixtures/case-delivery-issues.js';
import { parkedOnboardingMessage, recoveryPayload } from '../../tests/fixtures/onboarding-recovery.js';
import { duplicateOnboardingCase, channelChoicePayload } from '../../tests/fixtures/onboarding-channel-choice.js';
import { createRoleDispatcher } from '../../apps/core/discord/dispatcher.js';
import { definition, publication, GUILD, NOW, OTHER, USER, STAFF, LEAD, observation, command, moderator } from '../../tests/fixtures/domain.js';

/** Synthetic fixtures only. This suite has no live Discord, model or real case-content connector. */
export async function runStorageSuite(cluster, run) {
  let admin = cluster.adminPool;
  let core = cluster.corePool;
  let sequence = 200000000000000000n;
  let now = NOW;
  let denied = false;
  const self = userId => ({ userId });
  const nextId = () => String(++sequence);
  const authorize = async (capability, actor, scope) => !denied && (actor?.moderator === true ||
    (['shuttle.self', 'case.create'].includes(capability) && actor?.userId === scope.userId));
  let cases = simulatedCases({ clock: () => now });
  let store = createCoreStore({ pool: core, clock: () => now, authorize, casePolicy, caseVerification: cases.channels.verification });
  let outbox = createOutbox({ pool: core });
  const obs = overrides => observation({ observedAt: now, ...overrides });
  const read = async (table, columns = '*') => (await admin.query(`SELECT ${columns} FROM sophie_core.${table}`)).rows;
  const start = (overrides = {}) => store.start({ actor: self(USER), interactionId: nextId(), id: `s${sequence}`, nonce: 'initial-nonce', observation: obs(), definitionId: definition.id, ...overrides });
  const step = (session, overrides = {}) => store.transition({ actor: self(session.userId), action: 'advance', interactionId: nextId(), sessionId: session.id, command: command(session), observation: obs({ userId: session.userId }), ...overrides });
  async function pending() {
    let { session } = await start();
    for (let i = 0; i < 5; i++) ({ session } = await step(session));
    return session;
  }
  async function reset() {
    now = NOW; denied = false;
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await admin.query(`TRUNCATE sophie_core.case_reply_events, sophie_core.case_replies, sophie_core.case_label_changes, sophie_core.case_notes, sophie_core.case_direct_notices, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity, sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_participant_actions, sophie_core.case_participants, sophie_core.case_form_editor_actions, sophie_core.case_form_drafts, sophie_core.case_delivery_actions, sophie_core.case_delivery_issues, sophie_core.case_intake_messages, sophie_core.case_intakes, sophie_core.case_form_slots, sophie_core.case_form_actions, sophie_core.case_forms, sophie_core.shuttle_editor_actions, sophie_core.shuttle_draft_revisions, sophie_core.dashboard_sessions, sophie_core.dashboard_login_flows, sophie_core.dashboard_auth_limits, sophie_core.dashboard_auth_policies, sophie_core.case_inspection_sweeps, sophie_core.case_staff_actions, sophie_core.case_lifecycle_actions, sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues, sophie_core.shuttle_alerts, sophie_core.shuttle_help_resolutions, sophie_core.shuttle_screens, sophie_core.shuttle_help_requests, sophie_core.shuttle_publications, sophie_core.shuttle_cases, sophie_core.gateway_members, sophie_core.gateway_lifecycle, sophie_core.actor_authority, sophie_core.capability_policies, sophie_core.outbox, sophie_core.receipts, sophie_core.sessions,
      sophie_core.member_actions, sophie_core.members, sophie_core.definitions, sophie_core.case_provisions,
      sophie_core.case_channels, sophie_core.case_policies, sophie_core.case_reservations,
      sophie_core.case_budgets, sophie_core.case_exclusions`);
    await store.publishDefinition({ actor: moderator, definition });
  }
  const scenario = async (name, work) => run(name, async () => { await reset(); await work(); });

  await scenario('S01 migrations are repeatable and detect a changed applied checksum', async () => {
    assert.deepEqual(await migrateCore(admin), { migrations: 57 });
    const original = await admin.query('SELECT id, sha256 FROM sophie_migrations.applied');
    await admin.query("UPDATE sophie_migrations.applied SET sha256 = 'invalid'");
    await assert.rejects(migrateCore(admin), /MIGRATION_CHECKSUM_MISMATCH/);
    for (const row of original.rows) await admin.query('UPDATE sophie_migrations.applied SET sha256 = $1 WHERE id = $2', [row.sha256, row.id]);
    await migrateCore(admin);
  });

  await scenario('S02 knowledge identity cannot read core; core cannot delete records or migrate', async () => {
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.members'), { code: '42501' });
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_reservations'), { code: '42501' });
    await assert.rejects(core.query('DELETE FROM sophie_core.case_reservations'), { code: '42501' });
    await assert.rejects(migrateCore(core), { code: '42501' });
    assert.equal((await core.query('SELECT count(*) FROM sophie_core.members')).rows[0].count, '0');
  });

  await scenario('S03 duplicate starts commit one receipt and one session', async () => {
    const interactionId = nextId();
    const results = await Promise.all([start({ interactionId, id: 'start-a' }), start({ interactionId, id: 'start-b' })]);
    assert.deepEqual(results.map(x => x.duplicate).sort(), [false, true]);
    assert.equal(results[0].session.id, results[1].session.id);
    assert.equal((await read('sessions')).length, 1);
    assert.equal((await read('receipts')).length, 1);
    await assert.rejects(start({ interactionId, actor: self(OTHER), observation: obs({ userId: OTHER }) }), /INTERACTION_ID_COLLISION/);
  });

  await scenario('S04 simultaneous distinct starts cannot create two current sessions', async () => {
    const results = await Promise.allSettled([start({ id: 'start-a' }), start({ id: 'start-b' })]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.match(results.find(x => x.status === 'rejected').reason.message, /SHUTTLE_ALREADY_ACTIVE/);
    assert.equal((await read('sessions')).length, 1);
  });

  await scenario('S05 duplicate controls advance once; stale and foreign controls are rejected', async () => {
    const { session } = await start();
    const interactionId = nextId();
    const results = await Promise.all([step(session, { interactionId }), step(session, { interactionId })]);
    assert.deepEqual(results.map(x => x.duplicate).sort(), [false, true]);
    assert.equal(results[0].session.stepIndex, 1);
    await assert.rejects(step(session, { command: command(session, { nextNonce: 'fresh-nonce-for-stale-control' }) }), /STALE_SHUTTLE_CONTROL/);
    await assert.rejects(step(results[0].session, { actor: self(OTHER) }), /OPERATION_DENIED/);
    assert.equal((await read('sessions'))[0].state.version, 1);
  });

  await scenario('S06 outbox insert failure rolls back progress and the interaction receipt', async () => {
    let { session } = await start();
    for (let i = 0; i < 4; i++) ({ session } = await step(session));
    const interactionId = nextId();
    await admin.query(`CREATE FUNCTION sophie_core.test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS
      'BEGIN RAISE EXCEPTION ''synthetic outbox fault''; END';
      CREATE TRIGGER test_fail_outbox BEFORE INSERT ON sophie_core.outbox FOR EACH ROW EXECUTE FUNCTION sophie_core.test_fail_outbox()`);
    try { await assert.rejects(step(session, { interactionId }), { code: 'P0001' }); }
    finally { await admin.query('DROP TRIGGER test_fail_outbox ON sophie_core.outbox; DROP FUNCTION sophie_core.test_fail_outbox()'); }
    assert.equal((await read('sessions'))[0].state.status, 'active');
    assert.equal((await read('sessions'))[0].state.version, 4);
    assert.equal((await read('receipts')).some(x => x.interaction_id === interactionId), false);
    await step(session, { interactionId });
    assert.equal((await read('outbox')).length, 1);
    assert.equal((await read('sessions'))[0].state.status, 'role_pending');
  });

  await scenario('S07 concurrent workers obtain at most one lease; expired fencing cannot renew or confirm', async () => {
    await pending();
    const claims = await Promise.all([outbox.claim('worker-a'), outbox.claim('worker-b')]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean).claim;
    await store.inspectGrant({ claim: first, observation: obs() });
    await admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second'");
    const second = (await outbox.claim('worker-c')).claim;
    assert.ok(second.fence > first.fence);
    await assert.rejects(outbox.renew(first), /OUTBOX_LEASE_LOST/);
    await assert.rejects(store.inspectGrant({ claim: first, observation: obs({ whitelist: true }), confirm: true }), /OUTBOX_LEASE_LOST/);
    const result = await store.inspectGrant({ claim: second, observation: obs({ whitelist: true }) });
    assert.equal(result.confirmed, true);
    assert.equal((await read('outbox'))[0].status, 'done');
  });

  await scenario('S08 queued grant is cancelled after a durable mute intent even before Muzzled appears', async () => {
    await pending();
    await store.requestMute({ actor: moderator, interactionId: nextId(), observation: obs() });
    const claim = (await outbox.claim('worker')).claim;
    const result = await store.inspectGrant({ claim, observation: obs() });
    assert.equal(result.deliver, false);
    assert.equal((await read('members'))[0].state.muteRequested, true);
    assert.equal((await read('outbox')).filter(x => x.kind === 'whitelist.grant')[0].status, 'cancelled');
    assert.equal((await read('sessions'))[0].state.status, 'role_pending');
  });

  await scenario('S09 a late role result after mute creates durable compensation and stays incomplete', async () => {
    await pending();
    const claim = (await outbox.claim('worker')).claim;
    assert.equal((await store.inspectGrant({ claim, observation: obs() })).deliver, true);
    await store.requestMute({ actor: moderator, interactionId: nextId(), observation: obs() });
    const result = await store.inspectGrant({ claim, observation: obs({ whitelist: true }), confirm: true });
    assert.equal(result.reconciliationRequired, true);
    assert.equal((await read('sessions'))[0].state.status, 'role_pending');
    assert.equal((await read('outbox')).filter(x => x.kind === 'whitelist.reconcile').length, 1);
    assert.equal((await read('outbox')).filter(x => x.kind === 'whitelist.grant')[0].status, 'cancelled');
  });

  await scenario('S10 observed Whitelist loss survives a rejected old control and permits a fresh five-stage run', async () => {
    const { session } = await start({ observation: obs({ whitelist: true }) });
    await assert.rejects(step(session, { observation: obs({ whitelist: false }) }), /SHUTTLE_RESTART_REQUIRED/);
    const state = (await read('members'))[0].state;
    assert.equal(state.eligibilityEpoch, 1);
    assert.equal((await read('sessions'))[0].current, false);
    let fresh = (await start({ id: 'fresh-after-loss' })).session;
    assert.equal(fresh.stepIndex, 0);
    assert.equal(fresh.eligibilityEpoch, 1);
    for (let i = 0; i < 5; i++) ({ session: fresh } = await step(fresh));
    const job = (await outbox.claim('worker')).claim;
    assert.equal((await store.inspectGrant({ claim: job, observation: obs() })).deliver, true);
  });

  await scenario('S11 departed members cannot replay pending grants after rejoining', async () => {
    const old = await pending();
    await store.recordObservation(obs({ present: false, crew: false }));
    await store.recordObservation(obs());
    const claim = (await outbox.claim('worker')).claim;
    assert.equal((await store.inspectGrant({ claim, observation: obs() })).reason, 'SHUTTLE_RESTART_REQUIRED');
    await assert.rejects(step(old), /SHUTTLE_RESTART_REQUIRED/);
    assert.equal((await start({ id: 'rejoined' })).session.eligibilityEpoch, 1);
  });

  await scenario('S12 active definitions remain pinned, repeats use latest, and withdrawn content blocks delivery', async () => {
    const { session } = await start({ observation: obs({ whitelist: true }) });
    await store.publishDefinition({ actor: moderator, definition: { ...definition, version: 2 } });
    let current = session;
    for (let i = 0; i < 5; i++) ({ session: current } = await step(current, { observation: obs({ whitelist: true }) }));
    assert.equal(current.definitionVersion, 1);
    const repeated = (await start({ id: 'repeat', observation: obs({ whitelist: true }) })).session;
    assert.equal(repeated.definitionVersion, 2);
    assert.equal((await read('outbox')).length, 0);
    await store.withdrawDefinition({ actor: moderator, id: definition.id, version: 2 });
    await assert.rejects(step(repeated, { observation: obs({ whitelist: true }) }), /DEFINITION_WITHDRAWN/);
    await assert.rejects(store.publishDefinition({ actor: moderator, definition: { ...definition, version: 2 } }), /DEFINITION_IMMUTABLE/);
  });

  await scenario('S13 concurrent case requests respect member and guild quotas atomically', async () => {
    const limits = { memberOpen: 1, guildPending: 1, cooldownMs: 1_000 };
    const reserve = userId => store.reserveCase({ actor: self(userId), interactionId: nextId(), id: `case${sequence}`, type: 'admin-help', observation: obs({ userId }), limits });
    const results = await Promise.allSettled([reserve(USER), reserve(USER), reserve(OTHER)]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal((await read('case_reservations')).length, 1);
    assert.equal((await read('outbox')).length, 1);
    assert.equal((await read('receipts')).length, 1);
  });

  await scenario('S14 case provisioning releases pending capacity, closure retains records and permanent exclusions', async () => {
    const interactionId = nextId();
    const request = { actor: self(USER), interactionId, id: 'retained-case', type: 'head-admin-contact', observation: obs(), limits: { memberOpen: 1, guildPending: 1, cooldownMs: 1_000 } };
    await store.reserveCase(request);
    assert.equal((await store.reserveCase(request)).duplicate, true);
    const dispatcher = createCaseDispatcher({ outbox, store, roles: cases.roles, channels: cases.channels, enabled: () => true });
    assert.equal((await dispatcher.runOnce('worker')).status, 'progressed');
    assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled', opened: true });
    const channelId = (await read('case_reservations'))[0].channel_id;
    denied = true;
    await assert.rejects(closeTestCase({ store, actor: moderator, observation: obs(), interactionId: nextId(), id: request.id, worker: dispatcher }), /OPERATION_DENIED/);
    denied = false;
    await closeTestCase({ store, actor: moderator, observation: obs(), interactionId: nextId(), id: request.id, worker: dispatcher });
    assert.equal((await read('case_reservations'))[0].state, 'closed');
    assert.equal(await store.hasCaseExclusion({ guildId: GUILD, lineage: ['300000000000000002', channelId] }), true);
    await store.excludeCaseChannel({ actor: moderator, guildId: GUILD, channelId: '300000000000000002', parentId: channelId });
    assert.equal(await store.hasCaseExclusion({ guildId: GUILD, lineage: ['300000000000000002'] }), true);
    assert.equal((await read('case_exclusions')).length, 2);
  });

  await scenario('S15 database-authoritative backoff and fencing prevent immediate retry or stale completion', async () => {
    await pending();
    const { claim } = await outbox.claim('worker');
    await outbox.retry(claim, 'DISCORD_UNAVAILABLE');
    assert.equal(await outbox.claim('worker'), null);
    await assert.rejects(outbox.retry(claim, 'DISCORD_UNAVAILABLE'), /OUTBOX_LEASE_LOST/);
    const rows = await read('outbox');
    assert.equal(rows[0].last_error_code, 'DISCORD_UNAVAILABLE');
    assert.equal(rows[0].attempts, 1);
    await admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second', attempts = 10");
    assert.equal((await outbox.claim('worker')).parked, true);
    assert.equal((await read('outbox'))[0].status, 'parked');
  });

  await scenario('S16 transaction rollback after a severed database connection leaves no partial state', async () => {
    await assert.rejects(inTransaction(core, async client => {
      await client.query("INSERT INTO sophie_core.case_budgets VALUES ('999')");
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      // The PID belongs to this test's checked-out connection in this isolated cluster.
      const disconnected = new Promise(resolve => client.once('error', resolve));
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      await disconnected;
      await client.query('SELECT 1');
    }));
    assert.equal((await read('case_budgets')).length, 0);
  });

  await scenario('S18 old receipts cannot surface completed or withdrawn sessions as current', async () => {
    const interactionId = nextId();
    const request = { interactionId, id: 'receipt-session', observation: obs({ whitelist: true }) };
    let { session } = await start(request);
    for (let i = 0; i < 5; i++) ({ session } = await step(session, { observation: obs({ whitelist: true }) }));
    await assert.rejects(start({ ...request, observation: obs({ whitelist: false }) }), /SHUTTLE_RESTART_REQUIRED/);
    const fresh = await start({ id: 'after-receipt-loss' });
    const event = nextId();
    await step(fresh.session, { interactionId: event });
    await store.withdrawDefinition({ actor: moderator, id: definition.id, version: 1 });
    await assert.rejects(step(fresh.session, { interactionId: event }), /DEFINITION_WITHDRAWN/);
  });

  await scenario('S19 unmute confirmation preserves reading and requires a fresh final grant acknowledgement', async () => {
    const session = await pending();
    await store.requestMute({ actor: moderator, interactionId: nextId(), observation: obs() });
    await assert.rejects(store.confirmUnmuted({ actor: moderator, interactionId: nextId(), observation: obs({ muzzled: true }) }), /UNMUTE_NOT_CONFIRMED/);
    await store.confirmUnmuted({ actor: moderator, interactionId: nextId(), observation: obs({ muzzled: false }) });
    const original = (await outbox.claim('worker')).claim;
    assert.equal((await store.inspectGrant({ claim: original, observation: obs() })).reason, 'STALE_GRANT');
    const renewed = await step(session, { action: 'retry' });
    assert.equal(renewed.session.status, 'role_pending');
    assert.ok(renewed.session.version > session.version);
    assert.equal((await read('outbox')).filter(x => x.kind === 'whitelist.grant' && x.status === 'ready').length, 1);
  });

  await scenario('S20 permission loss rejects duplicate operations without new state or effects', async () => {
    const interactionId = nextId();
    await start({ interactionId });
    denied = true;
    await assert.rejects(start({ interactionId }), /OPERATION_DENIED/);
    await assert.rejects(store.requestMute({ actor: moderator, interactionId: nextId(), observation: obs() }), /OPERATION_DENIED/);
    assert.equal((await read('receipts')).length, 1);
    assert.equal((await read('outbox')).length, 0);
    assert.equal((await read('members'))[0].state.muteRequested, false);
  });

  await scenario('S17 progress, screens, assistance pause/audit/alerts, delivery pause and Gateway state survive database restart', async () => {
    let journal = createGatewayJournal({ pool: core, mapping, clock: () => now });
    let acquired = await journal.acquire('before-restart');
    await journal.identify(acquired.lease);
    assert.equal((await journal.reserveIdentify(acquired.lease)).waitMs, 0);
    await journal.ready(acquired.lease, { sessionId: 'restart-session', resumeUrl: 'wss://gateway.discord.gg/', sequence: 1 });
    await journal.dispatch(acquired.lease, { sessionId: 'restart-session', sequence: 2, change: { kind: 'guild', available: true } });
    const session = await pending();
    const oldClaim = (await outbox.claim('worker-old')).claim;
    await store.inspectGrant({ claim: oldClaim, observation: obs() });
    const screenMember = '100000000000000015', screenDiscord = simulatedOnboarding({ clock: () => now });
    screenDiscord.state.members.set(screenMember, []);
    const newScreenStore = () => createCoreStore({ pool: core, clock: () => now, authorize, casePolicy,
      caseVerification: screenDiscord.channels.verification, onboardingMessageVerification: screenDiscord.messages.verification,
      onboardingAlertVerification: screenDiscord.alerts.verification });
    let screenStore = newScreenStore();
    const pausedPublication = { ...publication, helpPauses: true };
    await screenStore.publishOnboarding({ actor: moderator, publication: pausedPublication });
    const opened = await screenStore.openOnboarding({ actor: self(screenMember), interactionId: nextId(), id: 'restart-screen-session', nonce: 'restart-screen-nonce',
      caseId: 'restart-screen-case', observation: obs({ userId: screenMember, crew: false }), definitionId: definition.id,
      limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 } });
    const caseWorker = createCaseDispatcher({ outbox, store: screenStore, roles: screenDiscord.roles, channels: screenDiscord.channels, enabled: () => true });
    assert.equal((await caseWorker.runOnce('restart-case')).status, 'progressed');
    assert.equal((await caseWorker.runOnce('restart-case')).status, 'settled');
    let screenWorker = createOnboardingDispatcher({ outbox, store: screenStore, roles: screenDiscord.roles, messages: screenDiscord.messages, enabled: () => true });
    async function drainScreens() {
      for (let index = 0; index < 20; index++) {
        const result = await screenWorker.runOnce('restart-screen');
        if (result.status === 'idle') return;
        assert.equal(result.status, 'settled');
      }
      assert.fail('Restart screen queue did not drain');
    }
    assert.equal((await screenWorker.runOnce('restart-screen')).status, 'settled');
    const firstScreen = (await read('shuttle_screens'))[0], retainedMessage = firstScreen.message_id;
    const control = { screenId: firstScreen.id, channelId: firstScreen.channel_id, messageId: retainedMessage };
    const screenObservation = obs({ userId: screenMember, crew: false });
    const { plan } = await screenStore.describeOnboardingControl({ actor: self(screenMember), observation: screenObservation, ...control });
    const helpRequestId = nextId();
    await screenStore.actOnOnboarding({ actor: self(screenMember), observation: screenObservation, ...control,
      interactionId: helpRequestId, action: 'help', proof: await screenDiscord.channels.inspect(plan, firstScreen.channel_id) });
    assert.equal((await screenStore.resolveOnboardingHelp({ actor: moderator, observation: screenObservation, interactionId: nextId(),
      requestId: helpRequestId, expectedRevision: 0 })).resumed, true);
    const resumedSession = (await read('sessions')).find(row => row.id === opened.session.id).state;
    await screenStore.transition({ actor: self(screenMember), action: 'advance', interactionId: nextId(), sessionId: opened.session.id,
      command: command(resumedSession, { userId: screenMember }), observation: obs({ userId: screenMember, crew: false }) });
    await drainScreens();
    const nextScreen = (await read('shuttle_screens')).find(row => row.current), retainedPauseId = nextId();
    await screenStore.actOnOnboarding({ actor: self(screenMember), observation: screenObservation,
      screenId: nextScreen.id, channelId: nextScreen.channel_id, messageId: nextScreen.message_id,
      interactionId: retainedPauseId, action: 'help', proof: await screenDiscord.channels.inspect(plan, nextScreen.channel_id) });
    const pendingScreen = (await read('shuttle_screens')).find(row => row.current).id;
    const pendingAlerts = (await read('shuttle_alerts')).map(row => row.id).sort(); assert.equal(pendingAlerts.length, 2);
    const moderationTarget = '100000000000000014';
    await store.requestMute({ actor: moderator, interactionId: nextId(), observation: obs({ userId: moderationTarget }) });
    const discord = simulatedDiscord({ clock: () => now }); discord.state.members.set(OTHER, [STAFF]);
    const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
      grants: { 'member.mute': [STAFF], 'member.unmute': [STAFF], 'shuttle.publish': [LEAD], 'case.registry': [LEAD] } };
    let authorityStore = createActorAuthorityStore({ pool: core, clock: () => now });
    await authorityStore.registerPolicy(policy);
    const oldAuthority = await authorityStore.observe(await discord.roles.observeActor(OTHER), policy.version);
    discord.state.members.set(OTHER, []);
    await authorityStore.observe(await discord.roles.observeActor(OTHER), policy.version);
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = true WHERE singleton');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    store = createCoreStore({ pool: core, clock: () => now, authorize });
    outbox = createOutbox({ pool: core });
    authorityStore = createActorAuthorityStore({ pool: core, clock: () => now });
    const auth = createCoreAuthorization({ principals: { resolvePrincipal: () => { throw new Error('No incoming command in this check'); } },
      discord: discord.roles, authorityStore, policy, clock: () => now, isAuthorityCurrent: () => true, readContinuity: discord.roles.readContinuity });
    assert.ok((await read('sessions')).some(row => row.state.id === session.id));
    assert.equal((await read('shuttle_screens')).find(row => row.current).id, pendingScreen);
    assert.ok((await read('shuttle_screens')).some(row => row.message_id === retainedMessage));
    assert.deepEqual((await read('shuttle_publications'))[0].publication, pausedPublication);
    assert.equal((await read('shuttle_help_requests')).find(row => row.interaction_id === helpRequestId).status, 'resolved');
    assert.equal((await read('shuttle_help_requests')).find(row => row.interaction_id === retainedPauseId).status, 'open');
    assert.equal((await read('sessions')).find(row => row.id === opened.session.id).state.helpPaused, true);
    assert.deepEqual((await read('shuttle_alerts')).map(row => row.id).sort(), pendingAlerts);
    assert.equal((await read('shuttle_help_resolutions'))[0].request_id, helpRequestId);
    assert.equal((await read('shuttle_help_resolutions'))[0].resumed_version, resumedSession.version);
    assert.deepEqual((await read('shuttle_help_resolutions'))[0].operator_grant,
      { guildId: GUILD, userId: OTHER, capabilityEpoch: 1, policyVersion: 1 });
    assert.equal((await read('members')).find(row => row.user_id === moderationTarget).state.muteRequested, true);
    assert.deepEqual((await read('member_actions'))[0].operator_grant, oldAuthority);
    assert.equal(await auth.authorizeRecorded('member.mute', oldAuthority, { guildId: GUILD, userId: moderationTarget }), false);
    assert.equal(await outbox.claim('worker-paused'), null);
    journal = createGatewayJournal({ pool: core, mapping, clock: () => now });
    assert.equal((await read('gateway_lifecycle'))[0].identify_attempts, 1);
    await admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = clock_timestamp() - interval '1 second'");
    acquired = await journal.acquire('after-restart');
    assert.deepEqual(acquired.resume, { sessionId: 'restart-session', resumeUrl: 'wss://gateway.discord.gg/', sequence: 2 });
    const resumedGateway = await journal.resume(acquired.lease);
    await journal.dispatch(acquired.lease, { sessionId: resumedGateway.sessionId, sequence: 3, change: { kind: 'resumed' } });
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false WHERE singleton');
    await admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second'");
    const resumed = (await outbox.claim('worker-new', 30_000, ['whitelist.grant'])).claim;
    assert.ok(resumed.fence > oldClaim.fence);
    const result = await store.inspectGrant({ claim: resumed, observation: obs({ whitelist: true }) });
    assert.equal(result.confirmed, true);
    assert.equal((await read('outbox')).find(row => row.kind === 'whitelist.grant').status, 'done');
    screenStore = newScreenStore();
    screenWorker = createOnboardingDispatcher({ outbox, store: screenStore, roles: screenDiscord.roles, messages: screenDiscord.messages, enabled: () => true });
    await drainScreens();
    assert.equal((await screenWorker.runOnce('resumed-screen')).status, 'idle');
    const recovered = (await read('shuttle_screens')).find(row => row.current);
    assert.equal(recovered.id, pendingScreen); assert.equal(recovered.ready, true); assert.equal(recovered.snapshot.stepIndex, 1);
    assert.equal(recovered.help_requested, true); assert.equal(recovered.snapshot.helpPaused, true);
    assert.deepEqual(screenDiscord.state.messages.get(retainedMessage).components, []);
    const alertWorker = createOnboardingAlertDispatcher({ outbox, store: screenStore, roles: screenDiscord.roles, messages: screenDiscord.alerts, enabled: () => true });
    assert.equal((await alertWorker.runOnce('restart-obsolete-alert')).obsolete, true);
    assert.equal((await alertWorker.runOnce('restart-current-alert')).confirmed, true);
    assert.equal((await alertWorker.runOnce('restart-alert-idle')).status, 'idle');
    assert.equal((await read('shuttle_alerts')).find(row => row.source_id === helpRequestId).state, 'obsolete');
    assert.equal((await read('shuttle_alerts')).find(row => row.source_id === retainedPauseId).state, 'confirmed');
    await assert.rejects(screenStore.transition({ actor: self(screenMember), action: 'advance', interactionId: nextId(), sessionId: opened.session.id,
      command: command(recovered.snapshot, { userId: screenMember }), observation: screenObservation }), /SHUTTLE_PAUSED/);
    assert.equal((await screenStore.resolveOnboardingHelp({ actor: moderator, observation: screenObservation, interactionId: nextId(),
      requestId: retainedPauseId, expectedRevision: 0 })).resumed, true);
    await drainScreens();
    const afterResume = (await read('shuttle_screens')).find(row => row.current);
    assert.equal(afterResume.ready, true); assert.equal(afterResume.snapshot.helpPaused, false); assert.equal(afterResume.snapshot.stepIndex, 1);
    assert.equal(afterResume.help_requested, false); assert.equal((await read('shuttle_help_resolutions')).length, 2);
    assert.equal((await read('outbox')).filter(row => row.kind === 'whitelist.grant' && row.user_id === screenMember).length, 0);
  });

  await run('S21 role issues and Staff recheck history survive restart without clearing possible effects or delivery pause', async () => {
    const f = await onboardingWorkflow({ ...cluster, adminPool: admin, corePool: core });
    await f.pending();
    const initial = await f.outbox.claim('restart-role-issue', 30_000, ['whitelist.grant']);
    await f.store.inspectGrant({ claim: initial.claim, observation: await f.discord.roles.observe(USER) });
    await f.outbox.park(initial.claim, 'BOT_PERMISSION_MISSING');
    const first = (await f.rows('shuttle_delivery_issues'))[0], actor = await f.actor(OTHER);
    const source = await f.store.describeOnboardingDeliveryIssue({ actor, guildId: GUILD, issueId: first.id });
    const firstRequest = { actor, interactionId: f.nextId(), issueId: first.id, expectedRevision: first.revision,
      observation: await f.discord.roles.observe(USER), proof: await f.discord.channels.inspect(source.plan, source.channelId) };
    await f.store.recheckOnboardingDeliveryIssue(firstRequest);
    const again = await f.outbox.claim('restart-still-blocked', 30_000, ['whitelist.grant']); await f.outbox.park(again.claim, 'BOT_PERMISSION_MISSING');
    const retained = (await f.rows('shuttle_delivery_issues'))[0], audit = await f.rows('shuttle_delivery_rechecks');
    assert.ok(retained.revision > first.revision);
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = true');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual((await read('shuttle_delivery_issues'))[0], retained); assert.deepEqual(await read('shuttle_delivery_rechecks'), audit);
    const recovered = createCoreStore({ pool: core, clock: () => f.clock.now, authorize, casePolicy, caseVerification: f.discord.channels.verification });
    const resumedOutbox = createOutbox({ pool: core });
    assert.equal((await recovered.listOnboardingDeliveryIssues({ actor: moderator, guildId: GUILD })).entries[0].issueId, retained.id);
    assert.equal(await resumedOutbox.claim('still-paused'), null);
    const request = { ...firstRequest, actor: moderator, observation: await f.discord.roles.observe(USER),
      proof: await f.discord.channels.inspect(source.plan, source.channelId) };
    assert.equal((await recovered.recheckOnboardingDeliveryIssue(request)).duplicate, true);
    assert.equal((await read('shuttle_delivery_rechecks')).length, 1);
    await recovered.recheckOnboardingDeliveryIssue({ ...request, interactionId: f.nextId(), expectedRevision: retained.revision });
    const job = (await read('outbox')).find(row => row.operation_id === initial.claim.operationId);
    assert.equal(job.status, 'ready'); assert.equal(job.dispatch_started, true);
    assert.equal((await read('shuttle_delivery_rechecks')).length, 2); assert.equal(await resumedOutbox.claim('recheck-still-paused'), null);
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false');
    const worker = createRoleDispatcher({ outbox: resumedOutbox, store: recovered, discord: f.discord.roles, enabled: () => true });
    assert.equal((await worker.runOnce('recovered-inspection')).status, 'settled');
    assert.equal((await read('sessions'))[0].state.status, 'complete');
    assert.equal((await recovered.listOnboardingDeliveryIssues({ actor: moderator, guildId: GUILD })).entries.length, 0);
    assert.equal((await read('shuttle_delivery_issues')).length, 1);
  });

  await run('S22 identified message evidence and audit survive restart before confirmation without another POST', async () => {
    const f = await onboardingWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const { issue, record, messageId } = await parkedOnboardingMessage(f, 'alert');
    const payload = recoveryPayload(f, issue, messageId);
    assert.equal(await f.execute(payload), 'shuttle_recovery_recorded');
    const audit = await read('shuttle_delivery_rechecks');
    assert.equal(audit[0].action, 'adopt_message'); assert.equal(audit[0].result_id, messageId);
    const posts = f.discord.state.calls.filter(call => call.method === 'POST').length;
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = true');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('shuttle_delivery_rechecks'), audit);
    const retained = (await read('shuttle_alerts')).find(row => row.id === record.id);
    assert.equal(retained.message_id, messageId); assert.equal(retained.create_started, true); assert.equal(retained.state, 'pending');
    const messages = createOnboardingAlertMessages({ transport: f.discord.transport, roles: f.discord.roles,
      channels: f.discord.channels, mapping, policy: casePolicy, clock: () => f.clock.now });
    const recovered = createCoreStore({ pool: core, clock: () => f.clock.now, authorize, casePolicy,
      caseVerification: f.discord.channels.verification, onboardingAlertVerification: messages.verification });
    assert.equal((await recovered.recoverOnboardingMessage({ actor: moderator, interactionId: payload.id, issueId: issue.id,
      expectedRevision: issue.revision, resultId: messageId, observation: await f.discord.roles.observe(USER) })).duplicate, true);
    assert.equal((await read('shuttle_delivery_rechecks')).length, 1);
    const worker = createOnboardingAlertDispatcher({ outbox: createOutbox({ pool: core }), store: recovered,
      roles: f.discord.roles, messages, enabled: () => true });
    assert.equal((await worker.runOnce('recovered-message-paused')).status, 'idle');
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false');
    assert.equal((await worker.runOnce('recovered-message-confirm')).confirmed, true);
    assert.equal((await read('shuttle_alerts')).find(row => row.id === record.id).state, 'confirmed');
    assert.equal(f.discord.state.calls.filter(call => call.method === 'POST').length, posts);
  });

  await run('S23 a selected channel and all duplicate evidence survive restart behind the delivery pause', async () => {
    const f = await onboardingWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const { original, duplicate, issue } = await duplicateOnboardingCase(f), payload = channelChoicePayload(f, issue, duplicate.id);
    assert.equal(await f.execute(payload), 'shuttle_channel_recorded');
    const audit = await read('shuttle_delivery_rechecks'), provision = (await read('case_provisions'))[0];
    const posts = f.discord.state.calls.filter(call => call.method === 'POST').length;
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = true');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('shuttle_delivery_rechecks'), audit); assert.deepEqual((await read('case_provisions'))[0], provision);
    assert.equal((await read('case_reservations'))[0].state, 'pending');
    const channels = createCaseChannels({ transport: f.discord.transport, roles: f.discord.roles, mapping, policy: casePolicy, clock: () => f.clock.now });
    const recovered = createCoreStore({ pool: core, clock: () => f.clock.now, authorize, casePolicy, caseVerification: channels.verification });
    assert.equal((await recovered.chooseOnboardingChannel({ actor: moderator, interactionId: payload.id, issueId: issue.id,
      expectedRevision: issue.revision, resultId: duplicate.id, observation: await f.discord.roles.observe(USER) })).duplicate, true);
    const worker = createCaseDispatcher({ outbox: createOutbox({ pool: core }), store: recovered, roles: f.discord.roles, channels, enabled: () => true });
    assert.equal((await worker.runOnce('restart-choice-paused')).status, 'idle');
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false');
    assert.equal((await worker.runOnce('restart-choice-confirm')).opened, true);
    assert.equal((await read('case_reservations'))[0].channel_id, duplicate.id);
    assert.equal((await read('case_channels')).length, 2); assert.equal((await read('case_exclusions')).length, 2);
    assert.equal((await read('shuttle_delivery_rechecks')).length, 1);
    const plan = { id: provision.case_id, guildId: GUILD, openerId: USER, type: 'shuttle',
      policyVersion: provision.policy_version, token: provision.operation_token, presenceEpoch: Number(provision.presence_epoch) };
    await channels.verification.channel(await channels.inspect(plan, original.id), plan, true);
    await channels.verification.channel(await channels.inspect(plan, duplicate.id), plan, false);
    assert.equal(f.discord.state.calls.filter(call => call.method === 'POST').length, posts);
  });

  await run('S24 a pending closure, actor audit and retired controls survive restart before verified read-only delivery', async () => {
    const f = await onboardingWorkflow({ ...cluster, adminPool: admin, corePool: core }); await f.open();
    const row = (await read('case_reservations'))[0], actor = await f.actor(OTHER), interactionId = f.nextId();
    const request = { actor, interactionId, id: row.id, observation: await f.discord.roles.observe(USER), expectedVersion: row.version, reason: 'resolved' };
    await f.store.closeCase(request); const audit = await read('case_lifecycle_actions'), retained = (await read('case_reservations'))[0];
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = true');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('case_lifecycle_actions'), audit); assert.deepEqual((await read('case_reservations'))[0], retained);
    assert.equal((await read('shuttle_screens'))[0].current, false);
    const recovered = createCoreStore({ pool: core, clock: () => f.clock.now, authorize, casePolicy, caseVerification: f.discord.channels.verification });
    assert.equal((await recovered.closeCase({ ...request, actor: moderator })).duplicate, true);
    const worker = createCaseDispatcher({ outbox: createOutbox({ pool: core }), store: recovered, roles: f.discord.roles, channels: f.discord.channels, enabled: () => true });
    assert.equal((await worker.runOnce('restart-close-paused')).status, 'idle');
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false');
    assert.equal((await worker.runOnce('restart-close-confirm')).opened, false);
    assert.equal((await read('case_reservations'))[0].state, 'closed'); assert.equal((await read('case_lifecycle_actions'))[0].status, 'confirmed');
    const source = await recovered.describeCase({ actor: moderator, guildId: GUILD, id: row.id });
    await f.discord.channels.verification.channel(await f.discord.channels.inspect(source.plan, source.channelId), source.plan, 'closed');
    assert.equal((await read('case_channels')).length, 1); assert.equal((await read('case_exclusions')).length, 1);
  });

  await run('S25 ownership audit and duplicate receipts survive restart while assignment authority is checked again', async () => {
    const f = await onboardingWorkflow({ ...cluster, adminPool: admin, corePool: core }); await f.open();
    const initial = (await read('case_reservations'))[0], request = caseStaffPayload(f, 'claim', initial);
    assert.equal(await f.execute(request), 'case_staff_recorded');
    const recorded = (await read('case_reservations'))[0], audit = await read('case_staff_actions'), count = f.discord.state.calls.filter(call => call.method !== 'GET').length;
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual((await read('case_reservations'))[0], recorded); assert.deepEqual(await read('case_staff_actions'), audit);
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
    const recovered = createCoreStore({ pool: core, clock: () => f.clock.now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, resolveCaseResponder: authorization.resolveCaseResponder, casePolicy, caseVerification: f.discord.channels.verification });
    const operator = await authorization.resolveActor(f.verified(request));
    assert.equal((await recovered.listCases({ actor: operator, guildId: GUILD })).entries[0].assignmentStatus, 'current');
    assert.equal((await recovered.changeCaseAssignment({ actor: operator, guildId: GUILD, interactionId: request.id,
      id: initial.id, expectedVersion: initial.version, action: 'claim' })).duplicate, true);
    const replacement = '100000000000000030'; f.discord.state.members.set(replacement, [LEAD]); f.discord.state.members.set(OTHER, []);
    const lead = await authorization.resolveActor(f.verified(caseStaffPayload(f, 'queue', null, { userId: replacement })));
    assert.equal((await recovered.listCases({ actor: lead, guildId: GUILD })).entries[0].assignmentStatus, 'needs_review');
    assert.deepEqual((await read('case_reservations'))[0], recorded); assert.equal((await read('case_staff_actions')).length, 1);
    f.discord.state.members.set(OTHER, [STAFF]);
    await recovered.changeCaseAssignment({ actor: lead, guildId: GUILD, interactionId: f.nextId(), id: initial.id,
      expectedVersion: recorded.version, action: 'assign', assigneeId: OTHER, reason: 'coverage' });
    assert.equal((await recovered.listCases({ actor: lead, guildId: GUILD })).entries[0].assignmentStatus, 'current');
    assert.equal((await read('case_staff_actions')).length, 2); assert.equal(f.discord.state.calls.filter(call => call.method !== 'GET').length, count);
  });

  await run('S26 inspection cadence and queued work survive restart behind the delivery barrier without claiming permission freshness', async () => {
    const f = await onboardingWorkflow({ ...cluster, adminPool: admin, corePool: core }); await f.open();
    const record = (await read('case_reservations'))[0], remote = f.discord.state.channels.get(record.channel_id);
    remote.permission_overwrites = [];
    assert.equal((await createCaseInspectionStore({ pool: core, policy: casePolicy, batchDelayMs: 60_000 }).queueCaseInspections()).queued, 1);
    const provision = (await read('case_provisions'))[0], sweep = (await read('case_inspection_sweeps'))[0];
    const job = (await read('outbox')).find(row => row.operation_id === provision.last_inspection_operation_id);
    assert.equal(job.status, 'ready'); await f.outbox.pauseDiscordDelivery();
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual((await read('case_provisions'))[0], provision); assert.deepEqual((await read('case_inspection_sweeps'))[0], sweep);
    const inspections = createCaseInspectionStore({ pool: core, policy: casePolicy });
    assert.equal((await inspections.queueCaseInspections()).status, 'waiting');
    await admin.query("UPDATE sophie_core.case_inspection_sweeps SET not_before = '-infinity'");
    assert.deepEqual(await inspections.queueCaseInspections(), { status: 'paused' });
    const authority = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
    const recovered = createCoreStore({ pool: core, clock: () => f.clock.now, authorize: authority.authorize,
      authorizeRecorded: authority.authorizeRecorded, casePolicy, caseVerification: f.discord.channels.verification });
    const worker = createCaseDispatcher({ outbox: createOutbox({ pool: core }), store: recovered,
      roles: f.discord.roles, channels: f.discord.channels, enabled: () => true });
    assert.equal((await worker.runOnce('restart-paused-inspection')).status, 'idle');
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false');
    assert.equal((await inspections.queueCaseInspections()).status, 'idle');
    const count = f.discord.state.calls.filter(call => call.method === 'POST').length;
    await f.drain(worker);
    assert.equal((await read('outbox')).find(row => row.operation_id === job.operation_id).status, 'done');
    assert.deepEqual((await read('case_reservations'))[0], record); assert.deepEqual((await read('case_provisions'))[0], provision);
    const plan = { id: record.id, guildId: GUILD, openerId: USER, type: record.type, policyVersion: provision.policy_version,
      token: provision.operation_token, presenceEpoch: Number(provision.presence_epoch) };
    await f.discord.channels.verification.channel(await f.discord.channels.inspect(plan, record.channel_id), plan, 'open');
    assert.equal(f.discord.state.calls.filter(call => call.method === 'POST').length, count);
    assert.equal((await read('outbox')).filter(row => row.operation_id.startsWith('case.periodic.')).length, 1);
  });

  await run('S27 hashed sessions, callback consumption and logout survive restart without restoring browser authority', async () => {
    const f = await dashboardWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const session = await f.login(), { proof } = await f.auth.authenticate({ token: session.token }), flow = await f.begin();
    await f.complete(flow); const rows = await read('dashboard_sessions'), calls = f.provider.state.calls.length;
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('dashboard_sessions'), rows);
    let recovered = dashboardServices({ ...f, pool: core, admin });
    await assert.rejects(recovered.auth.resolvePrincipal(proof), /UNTRUSTED_PRINCIPAL/);
    await assert.rejects(recovered.complete(flow), /DASHBOARD_LOGIN_INVALID/);
    assert.equal(recovered.provider.state.calls.length, 0); assert.equal(f.provider.state.calls.length, calls);
    const fresh = await recovered.auth.authenticate({ token: session.token });
    const actor = await recovered.dashboardAuthorization.resolveActor(fresh.proof);
    assert.equal(await recovered.dashboardAuthorization.authorize('case.manage', actor, { guildId: GUILD, type: 'staff-report', openerId: USER }), true);
    await recovered.auth.logout({ token: session.token, method: 'POST', origin: dashboardConfiguration.origin, csrfToken: sessionCsrf(session.token) });
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    recovered = dashboardServices({ ...f, pool: core, admin });
    await assert.rejects(recovered.auth.authenticate({ token: session.token }), /DASHBOARD_SESSION_INVALID/);
    assert.equal((await read('dashboard_sessions')).filter(row => row.revoked).length, 1);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });

  await run('S28 authored revisions, publication/withdrawal receipts and pending screen cleanup survive restart without republishing', async () => {
    const f = await authoringWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const save = { actor: await f.editorActor(), requestId: editorRequestId(), expectedRevision: 0, document: draftDocument() };
    await f.editorStore.saveOnboardingDraft(save);
    const publish = { actor: await f.editorActor(), ...f.publishRequest(await f.review(1)) };
    await f.editorStore.publishOnboardingDraft(publish); await f.open();
    const screen = await f.current(), source = await f.editorStore.readOnboardingPublication({ actor: await f.editorActor(), version: 2 });
    const withdraw = { actor: await f.editorActor(), requestId: editorRequestId(), version: 2, expectedHash: source.sha256, confirm: true };
    await f.editorStore.withdrawOnboardingPublication(withdraw); await f.outbox.pauseDiscordDelivery();
    const revisions = await read('shuttle_draft_revisions'), audit = await read('shuttle_editor_actions'), publications = await read('shuttle_publications');
    const writes = f.discord.state.calls.filter(call => call.method !== 'GET').length;
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    const recovered = authoringServices(dashboardServices({ ...f, pool: core, admin })), actor = await recovered.editorActor();
    assert.deepEqual(await read('shuttle_draft_revisions'), revisions); assert.deepEqual(await read('shuttle_editor_actions'), audit);
    assert.deepEqual(await read('shuttle_publications'), publications);
    assert.equal((await recovered.editorStore.saveOnboardingDraft({ ...save, actor })).duplicate, true);
    assert.equal((await recovered.editorStore.publishOnboardingDraft({ ...publish, actor })).duplicate, true);
    assert.equal((await recovered.editorStore.withdrawOnboardingPublication({ ...withdraw, actor })).duplicate, true);
    assert.equal((await recovered.editorStore.readOnboardingPublication({ actor, version: 2 })).status, 'withdrawn');
    const store = createCoreStore({ pool: core, clock: () => f.clock.now, authorize: recovered.dashboardAuthorization.authorize,
      casePolicy, caseVerification: f.discord.channels.verification, onboardingMessageVerification: f.discord.messages.verification });
    const worker = createOnboardingDispatcher({ outbox: createOutbox({ pool: core }), store, roles: f.discord.roles,
      messages: f.discord.messages, enabled: () => true });
    assert.equal((await worker.runOnce('restart-editor-paused')).status, 'idle');
    assert.equal(f.discord.state.calls.filter(call => call.method !== 'GET').length, writes);
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false'); await f.drain(worker);
    assert.deepEqual(f.discord.state.messages.get(screen.message_id).components, []);
    assert.equal((await read('shuttle_editor_actions')).length, 3); assert.equal((await read('shuttle_publications')).length, 2);
    assert.equal((await read('shuttle_screens')).filter(row => row.current).length, 0);
  });

  await run('S29 form pins, retained submissions and withdrawals survive restart without duplicating cases or bypassing the delivery barrier', async () => {
    const f = await intakeWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const first = await f.publish(), held = (await f.prepare()).result.modal.token, request = intakeSubmitPayload(f, held);
    assert.equal(await f.executeIntake(request), 'ticket_recorded');
    await f.publish({ ...syntheticCaseForm(), title: 'Synthetic restart revision' }, 2); f.clock.now += 1_001;
    await admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '4 seconds'");
    const pending = (await f.prepare()).result.modal.token;
    await f.forms.withdrawCaseForm({ actor: await f.actor(OTHER), caseType: 'admin-help', version: 1, expectedHash: first.sha256, confirm: true });
    await f.outbox.pauseDiscordDelivery();
    const retained = new Map();
    for (const table of ['case_forms', 'case_form_actions', 'case_form_slots', 'case_intakes', 'receipts']) retained.set(table, await read(table));
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    for (const [table, rows] of retained) assert.deepEqual(await read(table), rows);
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
    const actor = (userId = USER) => authorization.resolveActor(f.verified(f.payload({ member: { user: { id: userId } } })));
    const recovered = caseIntakeServices({ ...f, pool: core, admin, authorization, actor });
    assert.equal(await recovered.executeIntake(request), 'ticket_recorded'); assert.equal((await read('case_intakes')).length, 1);
    assert.equal(await recovered.submit(pending), 'ticket_recorded'); assert.equal((await read('case_intakes')).length, 2);
    assert.equal((await read('case_intakes')).find(row => row.form_token === pending).form_version, 2);
    const store = createCoreStore({ pool: core, clock: () => f.clock.now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, casePolicy, caseVerification: f.discord.channels.verification });
    const worker = createCaseDispatcher({ outbox: createOutbox({ pool: core }), store, roles: f.discord.roles,
      channels: f.discord.channels, enabled: () => true });
    assert.equal((await worker.runOnce('restart-intake-paused')).status, 'idle'); assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false'); await f.drain(worker);
    assert.equal((await recovered.intake.destination(f.verified(request))).state, 'ready');
    f.discord.state.members.delete(USER); assert.equal((await recovered.intake.destination(f.verified(request))).state, 'denied');
    assert.equal((await read('case_intakes')).length, 2); assert.equal((await read('case_form_actions')).length, 3);
    assert.equal((await read('case_forms')).find(row => row.version === 1).status, 'withdrawn');
  });

  await run('S30 partially confirmed intake and a known pending message survive restart behind the delivery barrier without duplicate posts', async () => {
    const f = await intakeDeliveryWorkflow({ ...cluster, adminPool: admin, corePool: core }); await f.openTicket();
    assert.equal((await f.intakeWorker.runOnce('restart-first-answer')).status, 'progressed');
    const worker = createCaseIntakeDispatcher({ outbox: f.outbox, roles: f.intakeRoles, messages: f.intakeMessages, enabled: () => true,
      store: { ...f.intakeDeliveryStore, confirmCaseIntakeMessage: async () => { throw new Error('SYNTHETIC_CONFIRMATION_OUTAGE'); } } });
    assert.equal((await worker.runOnce('restart-known-second-answer')).status, 'retry_scheduled');
    await f.outbox.pauseDiscordDelivery(); const records = (await read('case_intake_messages')).sort((a, b) => a.ordinal - b.ordinal);
    assert.equal(records[0].state, 'confirmed'); assert.notEqual(records[1].message_id, null); assert.equal(records[1].state, 'pending');
    const submitted = await read('case_intakes'), posts = () => f.discord.state.calls.filter(call => call.method === 'POST' && /\/messages$/.test(call.path)).length;
    assert.equal(posts(), 2); ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual((await read('case_intake_messages')).sort((a, b) => a.ordinal - b.ordinal), records); assert.deepEqual(await read('case_intakes'), submitted);
    const recovered = intakeDeliveryServices({ ...f, pool: core, admin });
    assert.equal((await recovered.intakeWorker.runOnce('restart-intake-delivery-paused')).status, 'idle'); assert.equal(posts(), 2);
    await admin.query("UPDATE sophie_core.discord_backoff SET paused = false, until_at = '-infinity'; UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
    await f.drain(recovered.intakeWorker); assert.equal(posts(), 3);
    assert.equal((await read('case_intake_messages')).every(row => row.state === 'confirmed'), true);
    assert.equal([...f.discord.state.messages.values()].filter(message => message.mention_roles.length).length, 1);
  });

  await run('S31 ordinary issue audit, receipts and recovered message IDs survive restart with fresh authorization and no repeated POST', async () => {
    const f = await caseIssueWorkflow({ ...cluster, adminPool: admin, corePool: core }), { issue, message } = await parkIntake(f);
    const request = issuePayload(f, 'recover', issue, message.id); assert.equal(await f.executeIssue(request), 'case_recovery_recorded');
    await f.outbox.pauseDiscordDelivery(); const retained = new Map();
    for (const table of ['case_delivery_issues', 'case_delivery_actions', 'case_intake_messages', 'receipts']) retained.set(table, await read(table));
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    for (const [table, rows] of retained) assert.deepEqual(await read(table), rows);
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
    const base = { ...f, pool: core, admin, authorization }, delivery = intakeDeliveryServices(base), recovered = caseIssueServices({ ...base, ...delivery });
    assert.equal(await recovered.executeIssue(request), 'case_recovery_recorded'); assert.equal((await read('case_delivery_actions')).length, 1);
    assert.equal((await delivery.intakeWorker.runOnce('restart-recovery-paused')).status, 'idle');
    const posts = () => f.discord.state.calls.filter(call => call.method === 'POST' && /\/messages$/.test(call.path)).length; assert.equal(posts(), 1);
    await admin.query("UPDATE sophie_core.discord_backoff SET paused = false, until_at = '-infinity'"); await f.drain(delivery.intakeWorker);
    assert.equal(posts(), 3); assert.equal((await read('case_intake_messages')).every(row => row.state === 'confirmed'), true);
    assert.equal((await recovered.issueQueue()).entries.length, 0); assert.equal((await read('case_delivery_issues')).length, 1);
    f.discord.state.members.set(OTHER, [CREW]); assert.equal(await recovered.executeIssue(request), 'denied');
    assert.equal((await read('case_delivery_actions')).length, 1);
  });
  await run('S32 form drafts, immutable publications and exact editor receipts survive restart without restoring withdrawn entry', async () => {
    const f = await formAuthoringWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const save = { actor: await f.formActor(), caseType: 'admin-help', requestId: formRequestId(), expectedRevision: 0, document: syntheticCaseForm() };
    await f.formEditor.saveCaseFormDraft(save); await f.publishForm(1);
    const held = (await f.prepare()).result.modal.token; assert.equal(await f.submit(held), 'ticket_recorded');
    const publish = { actor: await f.formActor(), ...f.publishFormRequest(await f.reviewForm(1)) };
    const published = await f.formEditor.publishCaseFormDraft(publish);
    const withdraw = { actor: await f.formActor(), caseType: 'admin-help', requestId: formRequestId(), version: 2, expectedHash: published.sha256, confirm: true };
    await f.formEditor.withdrawCaseFormPublication(withdraw);
    const drafts = await read('case_form_drafts'), audit = await read('case_form_editor_actions'), forms = await read('case_forms'), intakes = await read('case_intakes');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    const recovered = formAuthoringServices(dashboardServices({ ...f, pool: core, admin })), actor = await recovered.formActor();
    assert.deepEqual(await read('case_form_drafts'), drafts); assert.deepEqual(await read('case_form_editor_actions'), audit);
    assert.deepEqual(await read('case_forms'), forms); assert.deepEqual(await read('case_intakes'), intakes);
    await assert.rejects(recovered.formEditor.saveCaseFormDraft(save), /OPERATION_DENIED/);
    assert.equal((await recovered.formEditor.saveCaseFormDraft({ ...save, actor })).duplicate, true);
    assert.equal((await recovered.formEditor.publishCaseFormDraft({ ...publish, actor })).duplicate, true);
    assert.equal((await recovered.formEditor.withdrawCaseFormPublication({ ...withdraw, actor })).duplicate, true);
    const view = await recovered.formEditor.readCaseFormDraft({ actor, caseType: 'admin-help' }); assert.equal(view.newRequestVersion, null); assert.equal(view.latest.status, 'withdrawn');
    assert.equal((await read('case_forms')).find(row => row.version === 1).status, 'published'); assert.equal((await read('case_form_editor_actions')).length, 4);
    f.discord.state.members.set(OTHER, [STAFF]); await assert.rejects(recovered.formEditor.publishCaseFormDraft({ ...publish, actor }), /OPERATION_DENIED/);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });
  await run('S33 report subject pins, retained answers and partially delivered messages survive restart behind the delivery barrier', async () => {
    const f = await intakeDeliveryWorkflow({ ...cluster, adminPool: admin, corePool: core }), subject = '100000000000000099';
    await f.publish(syntheticCaseForm('player-report'));
    const prepared = await f.intake.prepare(f.verified(playerReportPayload(f, subject)), { isCurrent: () => true }); assert.equal(prepared.status, 'modal');
    const request = intakeSubmitPayload(f, prepared.modal.token); assert.equal(await f.executeIntake(request), 'ticket_recorded');
    await f.drain(f.cases); assert.equal((await f.intakeWorker.runOnce('report-before-restart')).status, 'progressed');
    const oldActor = await f.actor(); await f.outbox.pauseDiscordDelivery();
    const intakes = await read('case_intakes'), slots = await read('case_form_slots'), messages = await read('case_intake_messages');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
    const base = { ...f, pool: core, admin, authorization }, recovered = caseIntakeServices(base), delivery = intakeDeliveryServices(base);
    assert.deepEqual(await read('case_intakes'), intakes); assert.deepEqual(await read('case_form_slots'), slots); assert.deepEqual(await read('case_intake_messages'), messages);
    await assert.rejects(recovered.intakeStore.describeTicketDestination({ actor: oldActor, observation: await f.discord.roles.observe(USER), interactionId: request.id }), /OPERATION_DENIED/);
    assert.equal(await recovered.executeIntake(request), 'ticket_recorded'); assert.equal((await read('case_intakes')).length, 1);
    assert.equal((await delivery.intakeWorker.runOnce('report-paused-after-restart')).status, 'idle');
    const posts = () => f.discord.state.calls.filter(call => call.method === 'POST' && /\/messages$/.test(call.path)).length; assert.equal(posts(), 1);
    await admin.query("UPDATE sophie_core.discord_backoff SET paused = false, until_at = '-infinity'"); await f.drain(delivery.intakeWorker);
    assert.equal(posts(), 3); assert.equal((await read('case_intake_messages')).every(row => row.state === 'confirmed'), true);
    assert.equal((await read('case_intakes'))[0].subject_id, subject);
    const row = (await read('case_reservations'))[0]; assert.equal(f.discord.state.channels.get(row.channel_id).permission_overwrites.some(entry => entry.id === subject), false);
  });
  await run('S34 participant presence revocations survive restart and current membership still requires a separately recorded invitation', async () => {
    const f = await onboardingWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const scope = { guildId: GUILD, userId: USER }, oldGrant = await f.authorization.resolveCaseParticipant(scope);
    f.discord.state.members.delete(USER); assert.equal(await f.authorization.authorizeCaseParticipant(oldGrant), false);
    f.discord.state.members.set(USER, [CREW]); const newGrant = await f.authorization.resolveCaseParticipant(scope);
    assert.ok(newGrant.presenceEpoch > oldGrant.presenceEpoch); const authorityRows = await read('actor_authority');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('actor_authority'), authorityRows);
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
    f.clock.enabled = false; await assert.rejects(authorization.authorizeCaseParticipant(newGrant), /AUTHORITY_UNCERTAIN/);
    f.clock.enabled = true; assert.equal(await authorization.authorizeCaseParticipant(oldGrant), false);
    assert.equal(await authorization.authorizeCaseParticipant(newGrant), true);
    assert.equal(await authorization.authorize('case.manage', newGrant, { guildId: GUILD, type: 'staff-contact', openerId: OTHER }), false);
    for (const table of ['case_reservations', 'case_provisions', 'outbox']) assert.equal((await read(table)).length, 0);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });
  await run('S35 pending invitations and retained removals survive restart behind current authorization and audience reconciliation', async () => {
    const f = participantServices(await intakeDeliveryWorkflow({ ...cluster, adminPool: admin, corePool: core }));
    f.discord.state.members.set(PARTICIPANT, [CREW]); const original = await f.openTicket(); await f.changeParticipant(original);
    const saved = await read('case_participants'), audits = await read('case_participant_actions');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('case_participants'), saved); assert.deepEqual(await read('case_participant_actions'), audits);
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
    const channels = createCaseChannels({ transport: f.discord.transport, roles: f.discord.roles, mapping, policy: casePolicy,
      clock: () => f.clock.now, authorizeCaseParticipant: authorization.authorizeCaseParticipant });
    const restored = createCoreStore({ pool: core, clock: () => f.clock.now, authorize: authorization.authorize,
      authorizeRecorded: authorization.authorizeRecorded, resolveCaseParticipant: authorization.resolveCaseParticipant,
      authorizeCaseParticipant: authorization.authorizeCaseParticipant, casePolicy, caseVerification: channels.verification });
    const worker = createCaseDispatcher({ outbox: createOutbox({ pool: core }), store: restored, roles: f.discord.roles, channels, enabled: () => f.clock.enabled });
    f.clock.enabled = false; const calls = f.discord.state.calls.length; assert.equal((await worker.runOnce('restart-invitation')).status, 'disabled');
    assert.equal(f.discord.state.calls.length, calls); f.clock.enabled = true; await f.drain(worker);
    assert.equal((await read('case_participants'))[0].status, 'active');
    const current = (await read('case_reservations'))[0];
    const actor = await authorization.resolveActor(f.verified(f.payload({ member: { user: { id: OTHER } } })));
    await restored.changeCaseParticipant({ actor, observation: await f.discord.roles.observe(USER), id: original.id, expectedVersion: current.version,
      interactionId: f.nextId(), action: 'remove', userId: PARTICIPANT, reason: 'no-longer-needed', confirmed: true });
    await f.drain(worker); assert.equal((await read('case_participants'))[0].status, 'removed');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.equal((await read('case_participants'))[0].status, 'removed'); assert.equal((await read('case_participant_actions')).length, 2);
    assert.equal(f.discord.state.channels.get(current.channel_id).permission_overwrites.some(value => value.id === PARTICIPANT), false);
  });
  await run('S36 selected contact forms and pending initial invitations survive restart under fresh authority and delivery gates', async () => {
    const f = await contactWorkflow({ ...cluster, adminPool: admin, corePool: core }); await f.publish(syntheticCaseForm('staff-contact'));
    const selected = await f.selectContact(), oldActor = await f.actor(OTHER), slots = await read('case_form_slots');
    const recover = () => {
      const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy,
        authorityStore: createActorAuthorityStore({ pool: core, clock: () => f.clock.now }), clock: () => f.clock.now,
        isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.discord.roles.readContinuity });
      const channels = createCaseChannels({ transport: f.discord.transport, roles: f.discord.roles, mapping, policy: casePolicy,
        clock: () => f.clock.now, authorizeCaseParticipant: authorization.authorizeCaseParticipant });
      const store = createCoreStore({ pool: core, clock: () => f.clock.now, authorize: authorization.authorize,
        authorizeRecorded: authorization.authorizeRecorded, resolveCaseParticipant: authorization.resolveCaseParticipant,
        authorizeCaseParticipant: authorization.authorizeCaseParticipant, casePolicy, caseVerification: channels.verification });
      const outbox = createOutbox({ pool: core });
      const worker = createCaseDispatcher({ outbox, store, roles: f.discord.roles, channels, enabled: () => f.clock.enabled });
      const intake = caseIntakeServices({ ...f, pool: core, admin, authorization, discord: { ...f.discord, channels } });
      return { ...intake, worker, outbox };
    };
    ({ adminPool: admin, corePool: core } = await cluster.restart()); assert.deepEqual(await read('case_form_slots'), slots);
    let recovered = recover();
    await assert.rejects(recovered.intakeStore.confirmStaffContact({ actor: oldActor, observation: await f.discord.roles.observe(OTHER), formToken: selected.token }), /OPERATION_DENIED/);
    const confirm = f.verified(contactControlPayload(f, 'confirm', selected.token));
    assert.equal((await recovered.intake.prepare(confirm, { isCurrent: () => true })).status, 'modal');
    const request = intakeSubmitPayload(f, selected.token, undefined, { member: { user: { id: OTHER } } });
    assert.equal(await recovered.executeIntake(request), 'ticket_recorded'); await recovered.outbox.pauseDiscordDelivery();
    const intakes = await read('case_intakes'), invitations = await read('case_participants'), audits = await read('case_participant_actions');
    ({ adminPool: admin, corePool: core } = await cluster.restart()); recovered = recover();
    assert.deepEqual(await read('case_intakes'), intakes); assert.deepEqual(await read('case_participants'), invitations); assert.deepEqual(await read('case_participant_actions'), audits);
    assert.equal(await recovered.executeIntake(request), 'ticket_recorded'); assert.equal((await read('case_intakes')).length, 1);
    const calls = f.discord.state.calls.length; assert.equal((await recovered.worker.runOnce('contact-restart-paused')).status, 'idle'); assert.equal(f.discord.state.calls.length, calls);
    await admin.query("UPDATE sophie_core.discord_backoff SET paused = false, until_at = '-infinity'"); await f.drain(recovered.worker);
    assert.equal((await read('case_intakes'))[0].contact_status, 'confirmed'); assert.equal((await read('case_participants'))[0].status, 'active');
    const token = (await read('case_provisions'))[0].operation_token;
    assert.equal((await recovered.contacts.view(f.verified(contactControlPayload(f, 'destination', token, PARTICIPANT)))).state, 'ready');
  });
  await run('S37 captured conversation revisions, gaps and resume cursor survive restart without erasing history or unpausing delivery', async () => {
    const f = await conversationWorkflow({ ...cluster, adminPool: admin, corePool: core });
    const data = syntheticConversation(f.opened.channel_id); await f.send('MESSAGE_CREATE', data);
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id, content: 'Synthetic edit before restart' });
    await f.observer.pause(f.connection()); await createOutbox({ pool: core }).pauseDiscordDelivery();
    const oldProof = f.capture.prepare(gatewayEvent(5, 'MESSAGE_CREATE', data));
    const observations = await read('case_message_observations'), gaps = await read('case_capture_gaps'), channels = await read('case_capture_channels');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('case_message_observations'), observations); assert.deepEqual(await read('case_capture_gaps'), gaps);
    assert.deepEqual(await read('case_capture_channels'), channels);
    const capture = createCaseMessageCapture({ guildId: GUILD, clock: () => f.clock.now });
    assert.throws(() => capture.inspect(oldProof), /UNTRUSTED_CASE_CAPTURE/);
    await admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = '-infinity'");
    const journal = createGatewayJournal({ pool: core, mapping, clock: () => f.clock.now, caseCapture: capture });
    const observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: () => f.clock.now });
    assert.deepEqual(await observer.acquire('conversation-restored'), { resumable: true });
    const { connection, resume } = await observer.beginResume(); assert.equal(resume.sequence, 4);
    assert.deepEqual(await observer.accept(connection, gatewayEvent(3, 'MESSAGE_CREATE', data)), { duplicate: true });
    await observer.accept(connection, gatewayEvent(5, 'MESSAGE_DELETE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id }));
    await observer.accept(connection, gatewayEvent(6, 'RESUMED', {}));
    const retained = await read('case_message_observations'); assert.equal(retained.length, 3);
    assert.deepEqual(retained.filter(row => row.kind !== 'delete'), observations);
    assert.ok((await read('case_capture_gaps')).some(row => row.channel_id === null && row.recovered_by === 'resumed'));
    assert.equal(await createOutbox({ pool: core }).claim('capture-restart-paused'), null);
    await observer.pause(connection);
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('case_message_observations'), retained);
    assert.equal((await read('gateway_lifecycle'))[0].sequence, '6');
    assert.ok((await read('case_capture_gaps')).some(row => row.channel_id === null && row.closed_at_ms === null));
  });
  await run('S38 retained attachments and interrupted file-to-database commits recover across two restarts without another download', async () => {
    const f = await attachmentWorkflow({ ...cluster, adminPool: admin, corePool: core });
    await f.addFile(); assert.deepEqual(await f.attachmentWorker.runOnce('attachment-restart'), { status: 'retained' });
    await f.addFile(); const claim = await f.attachmentStore.claim('attachment-interrupted'), prepared = await f.attachmentStore.prepare(claim);
    const slot = await f.attachmentStore.reserve(claim, prepared), oldProof = await f.vault.write(slot, prepared.reference, Readable.from([syntheticFileBytes]));
    await f.attachmentStore.defer(86400000);
    const jobs = await read('case_attachment_jobs'), attempts = await read('case_attachment_attempts'), capacity = await read('case_attachment_capacity');
    await createOutbox({ pool: core }).pauseDiscordDelivery();
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('case_attachment_jobs'), jobs); assert.deepEqual(await read('case_attachment_attempts'), attempts);
    assert.deepEqual(await read('case_attachment_capacity'), capacity);
    let vault = await createAttachmentVault({ root: f.vaultRoot, clock: () => f.clock.now });
    assert.throws(() => vault.inspect(oldProof), /UNTRUSTED_ATTACHMENT_FILE/);
    await admin.query("UPDATE sophie_core.case_attachment_jobs SET lease_until = '-infinity' WHERE status = 'leased'");
    const services = attachmentServices({ ...f, pool: core }, vault, f.fileState), calls = f.fileState.requests.length;
    assert.deepEqual(await services.attachmentWorker.runOnce('attachment-still-deferred'), { status: 'idle' });
    assert.equal(f.fileState.requests.length, calls);
    await admin.query("UPDATE sophie_core.case_attachment_capacity SET until_at = '-infinity'");
    const recoveredCapacity = await read('case_attachment_capacity');
    assert.deepEqual(await services.attachmentWorker.runOnce('attachment-restored'), { status: 'retained' });
    assert.equal(f.fileState.requests.length, calls); assert.equal(await createOutbox({ pool: core }).claim('attachment-discord-paused'), null);
    const retained = await read('case_attachment_jobs'); assert.equal(retained.every(row => row.status === 'retained'), true);
    assert.deepEqual(await read('case_attachment_capacity'), recoveredCapacity);
    await services.attachmentStore.pause(); const pausedCapacity = await read('case_attachment_capacity');
    ({ adminPool: admin, corePool: core } = await cluster.restart());
    assert.deepEqual(await read('case_attachment_jobs'), retained);
    vault = await createAttachmentVault({ root: f.vaultRoot, clock: () => f.clock.now });
    for (const row of retained) {
      const proof = await vault.recover(row.retained_slot, { size: Number(row.retained_bytes), type: 'text/plain' });
      assert.equal(vault.inspect(proof).sha256, row.retained_sha256);
    }
    assert.deepEqual(await read('case_attachment_attempts'), attempts); assert.deepEqual(await read('case_attachment_capacity'), pausedCapacity);
    assert.equal((await read('case_attachment_capacity'))[0].paused, true);
  });
}
