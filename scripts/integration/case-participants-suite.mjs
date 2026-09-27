import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { intakeDeliveryWorkflow } from '../../tests/fixtures/case-intake-delivery.js';
import { participantServices, participantPayload, PARTICIPANT, SECOND_PARTICIPANT } from '../../tests/fixtures/case-participants.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { BOT, CREW, mapping } from '../../tests/fixtures/discord.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { createCaseParticipantStore } from '../../apps/core/storage/case-participants.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCaseInspectionStore } from '../../apps/core/storage/case-inspections.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createAdministrationCommands } from '../../apps/core/discord/onboarding-commands.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { PERMISSIONS } from '../../platform/authorization/discord-permissions.js';

export async function runCaseParticipantsSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = participantServices(await intakeDeliveryWorkflow(cluster));
    f.discord.state.members.set(PARTICIPANT, [CREW]); f.discord.state.members.set(SECOND_PARTICIPANT, [CREW]); await work(f);
  });
  const row = async (f, id) => (await f.rows('case_reservations')).find(value => value.id === id);
  const invites = f => f.rows('case_participants');
  const writes = f => f.discord.state.calls.filter(call => call.method !== 'GET');
  const acl = (f, record) => f.discord.state.channels.get(record.channel_id).permission_overwrites;
  async function change(f, record, options) { return f.changeParticipant(await row(f, record.id), options); }
  async function periodic(f) {
    await f.admin.query("UPDATE sophie_core.case_inspection_sweeps SET not_before = '-infinity'");
    await f.admin.query("UPDATE sophie_core.case_provisions SET next_inspection_at = '-infinity'");
    return createCaseInspectionStore({ pool: f.pool, policy: casePolicy }).queueCaseInspections();
  }
  async function settle(f) {
    for (let i = 0; i < 30; i++) {
      await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
      const result = await f.cases.runOnce('participant-reconcile'); if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed', 'retry_scheduled'].includes(result.status), JSON.stringify(result));
    }
    assert.fail('Participant reconciliation did not settle');
  }

  await scenario('CP01 explicit selection records invitation, version, audit and intent before verified Discord access', async f => {
    const initial = await f.openTicket(), before = writes(f).length;
    assert.equal(await f.executeParticipant(participantPayload(f, initial)), 'case_participant_recorded');
    assert.equal(writes(f).length, before); assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false);
    const invitation = (await invites(f))[0]; assert.equal(invitation.user_id, PARTICIPANT); assert.equal(invitation.status, 'pending');
    assert.equal(invitation.operator_grant.userId, OTHER); assert.equal((await row(f, initial.id)).user_id, USER);
    assert.equal((await f.rows('case_participant_actions'))[0].reason, 'case-context');
    assert.equal((await f.rows('outbox')).filter(value => value.operation_id.startsWith('case.audience.')).every(value => value.user_id === USER), true);
    await settle(f); assert.equal((await invites(f))[0].status, 'active');
    const description = await f.describe(initial.id); assert.equal(description.state, 'open'); assert.equal(description.plan.audience.participants[0].userId, PARTICIPANT);
    await f.discord.channels.verification.channel(await f.discord.channels.inspect(description.plan, description.channelId), description.plan, 'open');
    assert.equal((await f.rows('case_intakes'))[0].subject_id, null);
  });

  await scenario('CP02 duplicate invitation requests replay once and collisions or stale resource versions cannot mutate the audience', async f => {
    const initial = await f.openTicket(), interactionId = f.nextId();
    await f.changeParticipant(initial, { interactionId }); await settle(f);
    assert.equal((await f.changeParticipant(initial, { interactionId })).duplicate, true);
    await assert.rejects(f.changeParticipant(initial, { interactionId, userId: SECOND_PARTICIPANT }), /INTERACTION_ID_COLLISION/);
    await assert.rejects(f.changeParticipant(initial, { userId: SECOND_PARTICIPANT }), /STALE_CASE_VERSION/);
    assert.equal((await invites(f)).length, 1); assert.equal((await f.rows('case_participant_actions')).length, 1);
  });

  await scenario('CP03 concurrent assignment and participant changes share the actual case version', async f => {
    const initial = await f.openTicket(), actor = await f.actor(OTHER);
    const results = await Promise.allSettled([f.changeParticipant(initial), f.store.changeCaseAssignment({ actor, guildId: GUILD,
      id: initial.id, interactionId: f.nextId(), expectedVersion: initial.version, action: 'claim' })]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.match(results.find(value => value.status === 'rejected').reason.message, /STALE_CASE_VERSION/);
    assert.equal((await invites(f)).length + (await f.rows('case_staff_actions')).length, 1);
  });

  await scenario('CP04 current Staff authority is mandatory and explicit participants cannot manage or invite others', async f => {
    const initial = await f.openTicket(); assert.equal(await f.executeParticipant(participantPayload(f, initial, { actorId: USER })), 'denied');
    await change(f, initial); await settle(f);
    assert.equal(await f.executeParticipant(participantPayload(f, await row(f, initial.id), { actorId: PARTICIPANT, userId: SECOND_PARTICIPANT })), 'denied');
    const actor = await f.actor(OTHER); const before = await invites(f);
    await assert.rejects(f.store.changeCaseParticipant({ actor: { ...actor }, observation: await f.discord.roles.observe(USER), interactionId: f.nextId(),
      id: initial.id, expectedVersion: (await row(f, initial.id)).version, action: 'remove', userId: PARTICIPANT, reason: 'added-in-error', confirmed: true }), /OPERATION_DENIED/);
    assert.deepEqual(await invites(f), before);
  });

  await scenario('CP05 absent identities, bots, implicit opener selection and missing confirmation never create an invitation', async f => {
    const initial = await f.openTicket();
    for (const userId of [BOT, USER, '100000000000000039']) await assert.rejects(f.changeParticipant(initial, { userId }), /CASE_PARTICIPANT_DENIED/);
    await assert.rejects(f.changeParticipant(initial, { confirmed: false }), /CASE_PARTICIPANT_CONFIRMATION_REQUIRED/);
    assert.equal((await invites(f)).length, 0); assert.equal((await f.rows('case_participant_actions')).length, 0);
    assert.equal((await row(f, initial.id)).version, initial.version);
  });

  await scenario('CP06 Head Admin audience changes require leadership and retain ordinary Staff exclusion', async f => {
    const initial = await f.openTicket('head-admin-contact'); f.discord.state.members.set(OTHER, [STAFF]);
    assert.equal(await f.executeParticipant(participantPayload(f, initial)), 'denied');
    f.discord.state.members.set(OTHER, [LEAD]); await change(f, initial); await settle(f);
    assert.equal(acl(f, initial).some(value => value.id === STAFF), false); assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), true);
  });

  await scenario('CP07 removal retains both invitation and audit while closure keeps only remaining audience read-only', async f => {
    const initial = await f.openTicket(); await change(f, initial); await settle(f); await f.drain(f.intakeWorker);
    const before = await f.rows('case_intakes'), current = await row(f, initial.id);
    await f.store.closeCase({ actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER), interactionId: f.nextId(),
      id: initial.id, expectedVersion: current.version, reason: 'resolved' }); await settle(f);
    assert.ok((BigInt(acl(f, initial).find(value => value.id === PARTICIPANT).deny) & PERMISSIONS.sendMessages) !== 0n);
    await change(f, initial, { action: 'remove' }); await settle(f);
    assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false); assert.equal((await invites(f))[0].status, 'removed');
    assert.equal((await row(f, initial.id)).state, 'closed'); assert.deepEqual(await f.rows('case_intakes'), before);
    assert.deepEqual((await f.rows('case_participant_actions')).map(value => value.action).sort(), ['add', 'remove']);
  });

  await scenario('CP08 observed departure and return revoke the old invitation and a new explicit action creates a fresh binding', async f => {
    const initial = await f.openTicket(); await change(f, initial); await settle(f); const old = (await invites(f))[0];
    f.discord.state.members.delete(PARTICIPANT); await periodic(f); await settle(f);
    assert.equal((await invites(f))[0].status, 'revoked'); assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false);
    f.discord.state.members.set(PARTICIPANT, [CREW]); await periodic(f); await settle(f);
    assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false);
    await change(f, initial); await settle(f);
    const current = (await invites(f)).find(value => value.status === 'active'); assert.ok(Number(current.presence_epoch) > Number(old.presence_epoch));
    assert.equal((await invites(f)).length, 2);
  });

  await scenario('CP09 losing the inviting Staff authority before delivery revokes the pending invitation', async f => {
    const initial = await f.openTicket(); await change(f, initial); f.discord.state.members.set(OTHER, []); await settle(f);
    assert.equal((await invites(f))[0].status, 'revoked'); assert.equal((await invites(f))[0].settled_reason, 'authority-revoked');
    assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false); assert.equal((await row(f, initial.id)).state, 'open');
  });

  await scenario('CP10 confirmed invitations survive unrelated role changes and removing an invitation never removes independent Staff access', async f => {
    const initial = await f.openTicket(); await change(f, initial); await settle(f); f.discord.state.members.set(OTHER, [STAFF]);
    f.discord.state.members.set(PARTICIPANT, [STAFF]); await periodic(f); await settle(f); assert.equal((await invites(f))[0].status, 'active');
    await change(f, initial, { action: 'remove' }); await settle(f);
    assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false); assert.equal(acl(f, initial).some(value => value.id === STAFF), true);
    assert.equal(await f.authorization.authorize('case.manage', await f.actor(PARTICIPANT), { guildId: GUILD, type: initial.type, openerId: USER }), true);
  });

  await scenario('CP11 an audience removal racing a late Discord PATCH is durably reconciled without reviving the invitation', async f => {
    const initial = await f.openTicket(); await change(f, initial); let removed = false;
    // A separate authenticated HTTP client models a concurrent command, not reentry into the worker's transport.
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.intakeRoles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: f.pool, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.intakeRoles.readContinuity });
    const actor = await authorization.resolveActor(f.verified(f.payload({ member: { user: { id: OTHER } } })));
    const store = createCaseParticipantStore({ pool: f.pool, clock: () => f.clock.now, authorize: authorization.authorize,
      resolveCaseParticipant: authorization.resolveCaseParticipant, authorizeCaseParticipant: authorization.authorizeCaseParticipant, policy: casePolicy });
    f.discord.state.afterWrite = async call => { if (!removed && call.method === 'PATCH' && call.path.endsWith(`/${initial.channel_id}`)) {
      removed = true; f.discord.state.afterWrite = null;
      await store.changeCaseParticipant({ actor, observation: await f.intakeRoles.observe(USER), interactionId: f.nextId(), id: initial.id,
        expectedVersion: (await row(f, initial.id)).version, action: 'remove', userId: PARTICIPANT, reason: 'no-longer-needed', confirmed: true });
    } };
    assert.equal((await f.cases.runOnce('participant-race')).status, 'retry_scheduled'); await settle(f);
    assert.equal(removed, true); assert.equal((await invites(f))[0].status, 'removed');
    assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false); assert.equal((await row(f, initial.id)).state, 'open');
    assert.ok((await f.rows('outbox')).some(value => value.operation_id.startsWith('case.recheck.')));
  });

  await scenario('CP12 a participant lost after Discord write is revoked and removed before the operation can be confirmed', async f => {
    const initial = await f.openTicket(); await change(f, initial);
    f.discord.state.afterWrite = call => { if (call.method === 'PATCH') { f.discord.state.afterWrite = null; f.discord.state.members.delete(PARTICIPANT); } };
    assert.equal((await f.cases.runOnce('participant-left-late')).status, 'retry_scheduled'); await settle(f);
    assert.equal((await invites(f))[0].status, 'revoked'); assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false);
  });

  await scenario('CP13 Gateway removal schedules the invited case even though its opener is a different current member', async f => {
    const journal = createGatewayJournal({ pool: f.pool, mapping, clock: () => f.clock.now }); const { lease } = await journal.acquire('invitation-gateway');
    await journal.identify(lease); const sessionId = 'synthetic-invitation-session'; await journal.ready(lease, { sessionId, resumeUrl: 'wss://gateway.discord.gg/', sequence: 1 });
    await journal.dispatch(lease, { sessionId, sequence: 2, change: { kind: 'guild', available: true } });
    const initial = await f.openTicket(); await change(f, initial); await settle(f);
    const before = (await f.rows('outbox')).filter(value => value.operation_id.startsWith('case.gateway.')).length;
    f.discord.state.members.delete(PARTICIPANT);
    await journal.dispatch(lease, { sessionId, sequence: 3, change: { kind: 'member', userId: PARTICIPANT, present: false, roleIds: [], timedOut: false, bot: false } });
    const jobs = (await f.rows('outbox')).filter(value => value.operation_id.startsWith('case.gateway.')); assert.equal(jobs.length, before + 1);
    assert.equal(jobs.at(-1).user_id, USER); f.discord.state.members.set(PARTICIPANT, [CREW]); await settle(f);
    assert.equal((await invites(f))[0].status, 'revoked'); assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false);
  });

  await scenario('CP14 a failed audit insert rolls back invitation, case version, receipt and audience intent together', async f => {
    const initial = await f.openTicket(), before = await f.rows('outbox');
    const brokenPool = { connect: async () => { const client = await f.pool.connect(); return { release: () => client.release(),
      query: (sql, args) => { if (sql.includes('INSERT INTO sophie_core.case_participant_actions')) throw new Error('SYNTHETIC_AUDIT_FAILURE'); return client.query(sql, args); } }; } };
    const store = createCaseParticipantStore({ pool: brokenPool, clock: () => f.clock.now, authorize: f.authorization.authorize,
      resolveCaseParticipant: f.authorization.resolveCaseParticipant, authorizeCaseParticipant: f.authorization.authorizeCaseParticipant, policy: casePolicy });
    await assert.rejects(store.changeCaseParticipant({ actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER), interactionId: f.nextId(),
      id: initial.id, expectedVersion: initial.version, action: 'add', userId: PARTICIPANT, reason: 'case-context', confirmed: true }), /SYNTHETIC_AUDIT_FAILURE/);
    assert.equal((await invites(f)).length, 0); assert.equal((await f.rows('case_participant_actions')).length, 0);
    assert.equal((await row(f, initial.id)).version, initial.version); assert.deepEqual(await f.rows('outbox'), before);
  });

  await scenario('CP15 answer delivery and requester navigation wait for the retained audience and reject revoked membership', async f => {
    const initial = await f.openTicket(), old = await f.describe(initial.id); await change(f, initial);
    assert.equal((await f.intakeWorker.runOnce('participant-intake-wait')).status, 'retry_scheduled');
    const envelope = f.verified(f.payload({ type: 3, message: { id: OTHER }, data: { component_type: 2, custom_id: `sophie:ticket:v1:status:${old.plan.token}` } }));
    assert.equal((await f.intake.destination(envelope)).state, 'preparing'); await settle(f);
    await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
    f.discord.state.members.delete(PARTICIPANT); const before = writes(f).length;
    assert.equal((await f.intakeWorker.runOnce('participant-intake-revoked')).status, 'retry_scheduled'); assert.equal(writes(f).length, before);
    await periodic(f); await settle(f); await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'"); await f.drain(f.intakeWorker);
    assert.equal((await f.rows('case_intake_messages')).every(value => value.state === 'confirmed'), true);
    assert.equal((await f.intake.destination(envelope)).state, 'ready');
  });

  await scenario('CP16 Shuttle shares participant-aware plans without conferring progress controls or Whitelist ownership', async f => {
    await f.open(); const initial = (await f.rows('case_reservations')).find(value => value.type === 'shuttle');
    await change(f, initial); await settle(f); assert.equal((await invites(f))[0].status, 'active');
    assert.equal(await f.execute(f.control(await f.current(), 'advance', { member: { user: { id: PARTICIPANT } } })), 'shuttle_stale');
    assert.equal((await f.session()).stepIndex, 0);
    assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.screens);
    assert.equal((await f.session()).stepIndex, 1); assert.equal((await f.rows('sessions')).length, 1);
  });

  await scenario('CP17 signed HTTP participant changes acknowledge privately with no case excerpts or mentions', async f => {
    const initial = await f.openTicket(), replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION, clock: () => f.clock.now,
      enabled: () => f.clock.enabled, fetch: async (_, options) => { replies.push(JSON.parse(options.body)); return Response.json({}); } });
    const commands = createAdministrationCommands({ caseParticipants: f.participantController });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands, respond: responder.respond,
      enabled: () => f.clock.enabled, onFault: code => faults.push(code) }); const address = await server.listen();
    try {
      const signed = f.identities.signed(participantPayload(f, initial)), response = await fetch(`http://${address.host}:${address.port}/discord/interactions`,
        { method: 'POST', body: signed.body, headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
      assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
      assert.match(replies[0].content, /Participant change recorded/); assert.deepEqual(replies[0].allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
      assert.deepEqual(faults, []); assert.equal((await invites(f)).length, 1);
    } finally { await server.close(); }
  });

  await scenario('CP18 migration preserves prior cases without invitations and core retention or knowledge isolation cannot be bypassed', async f => {
    const initial = await f.openTicket(), client = await f.admin.connect();
    try {
      await client.query('BEGIN'); await client.query('DROP TABLE sophie_core.case_participant_actions, sophie_core.case_participants');
      await client.query('ALTER TABLE sophie_core.case_provisions DROP COLUMN audience_version');
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/027-case-participants.sql', import.meta.url), 'utf8'));
      assert.equal((await client.query('SELECT * FROM sophie_core.case_participants')).rowCount, 0);
      assert.deepEqual((await client.query('SELECT * FROM sophie_core.case_reservations WHERE id = $1', [initial.id])).rows[0], initial);
    } finally { await client.query('ROLLBACK'); client.release(); }
    await change(f, initial);
    for (const table of ['case_participants', 'case_participant_actions']) {
      await assert.rejects(cluster.knowledgePool.query(`SELECT * FROM sophie_core.${table}`), { code: '42501' });
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`), { code: '42501' });
    }
  });
  await scenario('CP19 a late answer identity survives audience removal and is confirmed under the new plan without another POST', async f => {
    const initial = await f.openTicket(); await change(f, initial); await settle(f); let removed = false;
    f.discord.state.afterWrite = async call => { if (!removed && call.method === 'POST' && call.path.endsWith('/messages')) {
      removed = true; f.discord.state.afterWrite = null; await change(f, initial, { action: 'remove' });
    } };
    assert.equal((await f.intakeWorker.runOnce('late-participant-answer')).status, 'retry_scheduled');
    const first = (await f.rows('case_intake_messages')).find(value => value.ordinal === 1); assert.ok(first.message_id);
    assert.equal(first.state, 'pending'); assert.equal((await invites(f))[0].status, 'removed');
    await settle(f); await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
    await f.drain(f.intakeWorker);
    const records = await f.rows('case_intake_messages'); assert.equal(records.every(value => value.state === 'confirmed'), true);
    assert.equal(records.find(value => value.ordinal === 1).message_id, first.message_id);
    assert.equal(f.discord.state.calls.filter(call => call.method === 'POST' && call.path.endsWith('/messages')).length, records.length);
    assert.equal(acl(f, initial).some(value => value.id === PARTICIPANT), false);
  });
}
