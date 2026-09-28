import assert from 'node:assert/strict';
import { contactWorkflow, contactEntryPayload, contactSelectionPayload, contactControlPayload, removeContactMigration } from '../../tests/fixtures/case-contacts.js';
import { caseIntakeServices, intakeSubmitPayload, syntheticCaseForm, syntheticCaseValues } from '../../tests/fixtures/case-intake.js';
import { participantServices, PARTICIPANT, SECOND_PARTICIPANT } from '../../tests/fixtures/case-participants.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCaseParticipantStore } from '../../apps/core/storage/case-participants.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { BOT, CREW, MUZZLED } from '../../tests/fixtures/discord.js';

/** Authored synthetic forms only. All Discord effects use the in-process fixture. */
export async function runCaseContactsSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await contactWorkflow(cluster)));
  const publish = f => f.publish(syntheticCaseForm('staff-contact'));
  const pending = async (f, ids = [PARTICIPANT]) => {
    await publish(f); const selected = await f.selectContact(ids); assert.equal((await f.confirmContact(selected.token)).status, 'modal');
    assert.equal(await f.submitContact(selected.token), 'ticket_recorded'); return selected;
  };
  const provision = async f => (await f.rows('case_provisions'))[0];
  const writes = f => f.discord.state.calls.filter(call => call.method !== 'GET');
  const settle = async f => {
    for (let index = 0; index < 30; index++) {
      await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
      const result = await f.cases.runOnce('contact-reconciliation'); if (result.status === 'idle') return;
      assert.ok(['settled', 'progressed', 'retry_scheduled'].includes(result.status), JSON.stringify(result));
    }
    assert.fail('Contact reconciliation did not settle');
  };

  await scenario('SC01 explicit initial selection retains answers, invitations and audits atomically before verified contact access', async f => {
    const selected = await pending(f, [SECOND_PARTICIPANT, PARTICIPANT]); assert.equal(writes(f).length, 0);
    assert.deepEqual(selected.review.recipientIds, [PARTICIPANT, SECOND_PARTICIPANT]);
    const intake = (await f.rows('case_intakes'))[0], invitations = await f.rows('case_participants'), actions = await f.rows('case_participant_actions');
    assert.equal(intake.user_id, OTHER); assert.equal(intake.case_type, 'staff-contact'); assert.equal(intake.contact_status, 'pending');
    assert.deepEqual(intake.answers, syntheticCaseValues()); assert.equal(intake.subject_id, null); assert.equal(invitations.length, 2);
    assert.equal(actions.length, 2); assert.equal(new Set(actions.map(value => value.interaction_id)).size, 1);
    assert.equal((await f.rows('case_reservations'))[0].version, 2); assert.equal((await provision(f)).audience_version, 1);
    assert.equal((await f.rows('outbox')).length, 2);
    for (const table of ['receipts', 'outbox', 'case_participants', 'case_participant_actions']) assert.equal(JSON.stringify(await f.rows(table)).includes(syntheticCaseValues()[0].value), false);
    await f.drain(f.cases); await f.drain(f.intakeWorker);
    const row = (await f.rows('case_reservations'))[0], channel = f.discord.state.channels.get(row.channel_id);
    for (const id of [OTHER, PARTICIPANT, SECOND_PARTICIPANT]) assert.equal(channel.permission_overwrites.some(value => value.id === id), true);
    assert.equal(channel.permission_overwrites.some(value => value.id === USER), false);
    assert.equal((await f.rows('case_intakes'))[0].contact_status, 'confirmed'); assert.ok((await f.rows('case_participants')).every(value => value.status === 'active'));
    assert.equal([...f.discord.state.messages.values()].length, 3);
    assert.equal(JSON.stringify([...f.discord.state.messages.values()]).includes(`<@${PARTICIPANT}>`), false);
  });

  await scenario('SC02 unconfirmed, cancelled and another actors form handles cannot create a contact', async f => {
    await publish(f); const selected = await f.selectContact();
    assert.equal(await f.submitContact(selected.token), 'ticket_form_unavailable');
    assert.equal((await f.confirmContact(selected.token, PARTICIPANT)).status, 'denied');
    const cancel = contactControlPayload(f, 'cancel', selected.token);
    assert.equal(await f.executeIntake(cancel), 'case_contact_cancelled'); assert.equal(await f.executeIntake(cancel), 'case_contact_cancelled');
    assert.equal((await f.confirmContact(selected.token)).status, 'ticket_form_unavailable');
    assert.equal(await f.submitContact(selected.token), 'ticket_form_unavailable');
    for (const table of ['case_intakes', 'case_participants', 'case_participant_actions', 'case_reservations', 'outbox']) assert.equal((await f.rows(table)).length, 0);
    assert.equal((await f.rows('case_form_slots'))[0].contact_cancelled, true);
  });

  await scenario('SC03 contact creation requires actual Staff authority and present human recipients without accepting roles or the creator', async f => {
    await publish(f);
    assert.equal(await f.executeIntake(contactEntryPayload(f, 'contact', USER)), 'denied');
    assert.equal(await f.executeIntake(contactSelectionPayload(f, [PARTICIPANT], USER)), 'denied');
    for (const id of [OTHER, STAFF, BOT, '100000000000000098']) assert.equal(await f.executeIntake(contactSelectionPayload(f, [id])), 'case_participant_denied');
    f.discord.state.before = call => call.method === 'GET' && call.path.endsWith(`/members/${PARTICIPANT}`) ?
      Response.json({ user: { id: PARTICIPANT, bot: true }, roles: [CREW], communication_disabled_until: null }) : undefined;
    assert.equal(await f.executeIntake(contactSelectionPayload(f)), 'case_participant_denied'); f.discord.state.before = null;
    await assert.rejects(f.intakeStore.beginCaseForm({ actor: await f.actor(OTHER), observation: await f.discord.roles.observe(OTHER),
      interactionId: f.nextId(), caseType: 'staff-contact' }), /INVALID_CASE_FORM_TYPE/);
    f.discord.state.members.set(OTHER, [STAFF, MUZZLED]); assert.equal(await f.executeIntake(contactSelectionPayload(f)), 'denied');
    assert.equal((await f.rows('case_form_slots')).length, 0); assert.equal((await f.rows('case_reservations')).length, 0);
  });

  await scenario('SC04 losing and regaining Staff authority invalidates an earlier selected and confirmed contact', async f => {
    await publish(f); const selected = await f.selectContact(); assert.equal((await f.confirmContact(selected.token)).status, 'modal');
    f.discord.state.members.set(OTHER, [CREW]); assert.equal(await f.submitContact(selected.token), 'denied');
    f.discord.state.members.set(OTHER, [STAFF]); assert.equal(await f.submitContact(selected.token), 'denied');
    assert.equal((await f.rows('case_intakes')).length, 0); assert.equal((await f.confirmContact(selected.token)).status, 'denied');
  });

  await scenario('SC05 departed and rejoined recipients must be selected again instead of reusing old membership', async f => {
    await publish(f); const selected = await f.selectContact(); assert.equal((await f.confirmContact(selected.token)).status, 'modal');
    const binding = (await f.rows('case_form_slots'))[0].contact_grants[0]; f.discord.state.members.delete(PARTICIPANT);
    assert.equal(await f.authorization.authorizeCaseParticipant(binding), false); f.discord.state.members.set(PARTICIPANT, [CREW]);
    assert.equal(await f.submitContact(selected.token), 'case_participant_denied'); assert.equal((await f.rows('case_intakes')).length, 0);
    assert.equal((await f.contacts.view(selected.envelope)).state, 'unavailable');
  });

  await scenario('SC06 lost initiating Staff authority cancels first creation while preserving answers and revoked invitations', async f => {
    await pending(f); f.discord.state.members.set(OTHER, [CREW]); await settle(f);
    assert.equal(writes(f).length, 0); assert.equal((await f.rows('case_reservations'))[0].state, 'failed');
    assert.equal((await f.rows('case_intakes'))[0].contact_status, 'revoked'); assert.deepEqual((await f.rows('case_intakes'))[0].answers, syntheticCaseValues());
    assert.equal((await f.rows('case_participants'))[0].status, 'revoked');
    f.discord.state.members.set(OTHER, [STAFF]); await settle(f); assert.equal(writes(f).length, 0);
  });

  await scenario('SC07 late initial audience writes after Staff revocation are sealed and never confirm contact delivery', async f => {
    await pending(f); let changed = false;
    f.discord.state.afterWrite = call => { if (!changed && call.method === 'PATCH' && /\/channels\/\d+$/.test(call.path)) {
      changed = true; f.discord.state.members.set(OTHER, [CREW]);
    } };
    await settle(f); assert.equal(changed, true);
    assert.equal((await f.rows('case_intakes'))[0].contact_status, 'revoked');
    const row = (await f.rows('case_reservations'))[0]; assert.equal(row.state, 'failed');
    const acl = f.discord.state.channels.get(row.channel_id).permission_overwrites;
    assert.equal(acl.some(value => value.id === PARTICIPANT), false); assert.equal(acl.some(value => value.id === OTHER), false);
    assert.equal((await f.contactView('destination', (await provision(f)).operation_token)).state, 'denied');
  });

  await scenario('SC08 duplicate submissions and a lost commit acknowledgement retain only one contact and initial audience', async f => {
    await publish(f); const selected = await f.selectContact([PARTICIPANT, SECOND_PARTICIPANT]); await f.confirmContact(selected.token);
    const request = intakeSubmitPayload(f, selected.token, syntheticCaseValues(), { member: { user: { id: OTHER } } }); let lost = false;
    const pool = { connect: async () => { const client = await f.pool.connect(); return { release: discard => client.release(discard), query: async (...args) => {
      const result = await client.query(...args); if (args[0] === 'COMMIT' && !lost) { lost = true; throw new Error('SYNTHETIC_COMMIT_ACK_LOST'); } return result;
    } }; } };
    assert.equal(await caseIntakeServices({ ...f, pool }).executeIntake(request), 'unavailable');
    assert.deepEqual(await Promise.all([f.executeIntake(request), f.submitContact(selected.token)]), ['ticket_recorded', 'ticket_recorded']);
    assert.equal((await f.rows('case_intakes')).length, 1); assert.equal((await f.rows('case_participant_actions')).length, 2);
    assert.equal((await f.rows('case_reservations')).length, 1); assert.equal((await f.rows('outbox')).length, 2);
    const changed = syntheticCaseValues(); changed[0].value = 'Different synthetic submission'; assert.equal(await f.submitContact(selected.token, changed), 'ticket_form_unavailable');
    await f.drain(f.cases); assert.equal((await f.rows('case_intakes'))[0].contact_status, 'confirmed');
  });

  await scenario('SC09 answer, case, invitation, action, receipt and delivery intent failures roll back together', async f => {
    await publish(f); const selected = await f.selectContact(); await f.confirmContact(selected.token);
    await f.admin.query('REVOKE INSERT ON sophie_core.case_participant_actions FROM sophie_test_core');
    try { assert.equal(await f.submitContact(selected.token), 'unavailable'); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_participant_actions TO sophie_test_core'); }
    for (const table of ['case_intakes', 'case_participants', 'case_participant_actions', 'case_reservations', 'case_provisions', 'case_intake_messages', 'receipts', 'outbox']) assert.equal((await f.rows(table)).length, 0);
    assert.equal((await f.rows('case_form_slots'))[0].consumed_case_id, null); assert.equal(await f.submitContact(selected.token), 'ticket_recorded');
    await assert.rejects(cluster.knowledgePool.query('SELECT contact_grants FROM sophie_core.case_form_slots'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_intakes'), { code: '42501' });
  });

  await scenario('SC10 selected form versions remain pinned and withdrawn or expired selection cannot submit', async f => {
    const first = await publish(f), selected = await f.selectContact();
    await f.publish({ ...syntheticCaseForm('staff-contact'), title: 'Synthetic changed questions' }, 2);
    const modal = await f.confirmContact(selected.token); assert.equal(modal.modal.version, 1); assert.equal(modal.modal.form.title, 'Synthetic support form');
    await f.forms.withdrawCaseForm({ actor: await f.actor(OTHER), caseType: 'staff-contact', version: 1, expectedHash: first.sha256, confirm: true });
    assert.equal(await f.submitContact(selected.token), 'ticket_form_unavailable');
    await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 second'");
    const next = await f.selectContact(); assert.notEqual(next.token, selected.token); assert.equal((await f.rows('case_form_slots')).length, 1);
    assert.equal((await f.confirmContact(selected.token)).status, 'denied'); assert.equal((await f.confirmContact(next.token)).modal.version, 2);
    assert.equal(await f.submitContact(next.token), 'ticket_recorded');
  });

  await scenario('SC11 recipient navigation requires its current invitation and exact open or closed channel permissions', async f => {
    const opened = await f.openContact(), token = (await provision(f)).operation_token;
    assert.equal((await f.contactView('destination', token)).state, 'ready');
    assert.equal((await f.contactView('destination', token, USER)).state, 'denied');
    f.discord.state.members.set(PARTICIPANT, [MUZZLED]); assert.equal((await f.contactView('destination', token)).state, 'ready');
    const queue = await f.contacts.view(f.verified(contactEntryPayload(f, 'contacts', PARTICIPANT))); assert.equal(queue.state, 'queue'); assert.equal(queue.items.length, 1);
    assert.equal(await f.execute(ticketPayload(f, 'close', opened.row, { member: { user: { id: OTHER } } })), 'case_change_recorded'); await f.drain(f.cases);
    const closed = await f.contactView('destination', token); assert.equal(closed.state, 'ready'); assert.equal(closed.access, 'closed');
    const channel = f.discord.state.channels.get(opened.row.channel_id); channel.permission_overwrites.push({ id: USER, type: 1, allow: '1024', deny: '0' });
    assert.equal((await f.contactView('destination', token)).state, 'unavailable');
  });

  await scenario('SC12 explicit removal and departure revoke old recipient navigation without deleting retained contact history', async f => {
    const opened = await f.openContact([PARTICIPANT, SECOND_PARTICIPANT]), token = (await provision(f)).operation_token;
    const p = participantServices(f); await p.changeParticipant(opened.row, { action: 'remove' });
    assert.equal((await f.contactView('destination', token)).state, 'denied'); await f.drain(f.cases);
    f.discord.state.members.delete(SECOND_PARTICIPANT); assert.equal((await f.contactView('destination', token, SECOND_PARTICIPANT)).state, 'denied');
    f.discord.state.members.set(SECOND_PARTICIPANT, [CREW]); assert.equal((await f.contactView('destination', token, SECOND_PARTICIPANT)).state, 'denied');
    assert.equal((await f.rows('case_intakes')).length, 1); assert.equal((await f.rows('case_participants')).length, 2);
  });

  await scenario('SC13 private recipient pages are bounded, stable and filtered by retained invitation rather than Staff roles', async f => {
    const service = caseIntakeServices(f, { limits: { memberOpen: 20, guildPending: 3, cooldownMs: 1_000 } }); await publish(f);
    for (let index = 0; index < 6; index++) {
      f.clock.now += 1_001; await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '4 seconds', expires_at = clock_timestamp() - interval '1 second'");
      const envelope = f.verified(contactSelectionPayload(f)); assert.equal(await service.commands.execute(envelope), 'case_contact');
      const review = await service.contacts.view(envelope), confirm = f.verified(contactControlPayload(f, 'confirm', review.token));
      assert.equal((await service.intake.prepare(confirm, { isCurrent: () => true })).status, 'modal');
      assert.equal(await service.submit(review.token, syntheticCaseValues(), { member: { user: { id: OTHER } } }), 'ticket_recorded'); await f.drain(f.cases);
    }
    const first = await f.contacts.view(f.verified(contactEntryPayload(f, 'contacts', PARTICIPANT)));
    assert.equal(first.state, 'queue'); assert.equal(first.items.length, 5); assert.ok(first.next);
    const second = await f.contactView('queue', first.next); assert.equal(second.items.length, 1); assert.equal(second.next, null);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.token)).size, 6);
    assert.ok(first.items.every(item => item.openerId === OTHER && item.access === 'open'));
    const stranger = await f.contacts.view(f.verified(contactEntryPayload(f, 'contacts', USER))); assert.deepEqual(stranger.items, []);
    assert.equal((await f.contactView('queue', first.next, USER)).state, 'denied');
    assert.equal((await f.contacts.view(f.verified(contactEntryPayload(f, 'contacts', OTHER)))).items.length, 0);
  });

  await scenario('SC14 all selected recipients lost before first delivery cancels the contact without a Staff-only substitute', async f => {
    await pending(f, [PARTICIPANT, SECOND_PARTICIPANT]);
    f.discord.state.members.delete(PARTICIPANT); f.discord.state.members.delete(SECOND_PARTICIPANT); await settle(f);
    assert.equal(writes(f).length, 0); assert.equal((await f.rows('case_intakes'))[0].contact_status, 'revoked');
    assert.ok((await f.rows('case_participants')).every(row => row.status === 'revoked'));
    assert.deepEqual((await f.rows('case_intakes'))[0].answers, syntheticCaseValues());
  });

  await scenario('SC15 current recipients keep access after completed Staff role changes while departed recipients stay revoked', async f => {
    await pending(f, [PARTICIPANT, SECOND_PARTICIPANT]); f.discord.state.members.delete(SECOND_PARTICIPANT); await settle(f);
    const row = (await f.rows('case_reservations'))[0], token = (await provision(f)).operation_token;
    assert.equal(row.state, 'open'); assert.equal((await f.rows('case_intakes'))[0].contact_status, 'confirmed');
    const invitations = await f.rows('case_participants'); assert.equal(invitations.find(value => value.user_id === SECOND_PARTICIPANT).status, 'revoked');
    f.discord.state.members.set(OTHER, [CREW]); assert.equal((await f.contactView('destination', token)).state, 'ready');
    f.discord.state.members.set(SECOND_PARTICIPANT, [CREW]); assert.equal((await f.contactView('destination', token, SECOND_PARTICIPANT)).state, 'denied');
    f.discord.state.members.delete(OTHER); assert.equal((await f.contactView('destination', token)).state, 'denied');
    f.discord.state.members.set(OTHER, [STAFF]); assert.equal((await f.contactView('destination', token)).state, 'denied');
  });

  await scenario('SC16 the existing twenty-participant bound applies to initial multi-recipient selection and retained actions', async f => {
    const ids = Array.from({ length: 20 }, (_, index) => String(100000000000000100n + BigInt(index)));
    for (const id of ids) f.discord.state.members.set(id, [CREW]);
    const selected = await pending(f, ids); assert.equal(selected.review.recipientIds.length, 20); await f.drain(f.cases);
    assert.equal((await f.rows('case_participants')).length, 20); assert.equal((await f.rows('case_participant_actions')).length, 20);
    const acl = f.discord.state.channels.get((await f.rows('case_reservations'))[0].channel_id).permission_overwrites;
    assert.ok(ids.every(id => acl.some(value => value.id === id))); assert.equal(new Set(acl.map(value => value.id)).size, acl.length);
  });

  await scenario('SC17 real signed HTTP selects, confirms, submits and navigates privately without leaking submitted answers', async f => {
    await publish(f); const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION, clock: () => f.clock.now,
      enabled: () => f.clock.enabled, caseIntake: f.intake, caseContacts: f.contacts,
      fetch: async (_url, request) => { replies.push(JSON.parse(request.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.commands, caseIntake: f.intake,
      respond: responder.respond, enabled: () => f.clock.enabled, onFault: code => faults.push(code) });
    try {
      const address = await server.listen(), post = async (payload, signature = null) => {
        const signed = f.identities.signed(payload), result = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signature ?? signed.signature, 'X-Signature-Timestamp': signed.timestamp },
          body: signed.body, signal: AbortSignal.timeout(5_000) }); return { status: result.status, body: await result.json() };
      };
      assert.deepEqual((await post(contactEntryPayload(f))).body, { type: 5, data: { flags: 64 } }); await server.drain();
      assert.equal(replies.at(-1).components[0].components[0].type, 5);
      assert.equal((await post(contactSelectionPayload(f))).body.type, 5); await server.drain();
      const token = replies.at(-1).components[0].components[0].custom_id.split(':').at(-1);
      const confirmed = await post(contactControlPayload(f, 'confirm', token)); assert.equal(confirmed.body.type, 9);
      assert.equal(confirmed.body.data.custom_id, `sophie:ticket-form:v1:${token}`);
      const request = intakeSubmitPayload(f, token, syntheticCaseValues(), { member: { user: { id: OTHER } } });
      assert.equal((await post(request)).body.type, 5); await server.drain(); await f.drain(f.cases); await f.drain(f.intakeWorker);
      assert.equal((await post(contactEntryPayload(f, 'contacts', PARTICIPANT))).body.type, 5); await server.drain();
      const caseToken = replies.at(-1).components[0].components[0].custom_id.split(':').at(-1);
      assert.equal((await post(contactControlPayload(f, 'destination', caseToken, PARTICIPANT))).body.type, 5); await server.drain();
      assert.match(replies.at(-1).components[0].components[0].url, /^https:\/\/discord.com\/channels\//);
      for (const reply of replies) { assert.deepEqual(reply.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false }); assert.equal(JSON.stringify(reply).includes(syntheticCaseValues()[0].value), false); }
      assert.equal((await post(contactSelectionPayload(f), '00'.repeat(64))).status, 401); assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });

  await scenario('SC18 upgrading the ordinary schema preserves forms and retained content without manufacturing contact authority', async f => {
    await f.openTicket(); const before = await f.rows('case_intakes'), forms = await f.rows('case_forms'), slots = await f.rows('case_form_slots');
    await removeContactMigration(f.admin);
    for (const table of ['case_forms', 'case_form_drafts', 'case_form_editor_actions']) await f.admin.query(`ALTER TABLE sophie_core.${table} DROP CONSTRAINT ${table}_case_type_check;
      ALTER TABLE sophie_core.${table} ADD CONSTRAINT ${table}_case_type_check CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact', 'player-report'))`);
    assert.deepEqual(await migrateCore(f.admin), { migrations: 61 }); assert.deepEqual(await f.rows('case_forms'), forms);
    assert.deepEqual(await f.rows('case_intakes'), before); assert.deepEqual(await f.rows('case_form_slots'), slots);
    await assert.rejects(f.admin.query("UPDATE sophie_core.case_intakes SET contact_status = 'confirmed'"), { code: '23514' });
    await publish(f); assert.equal((await f.selectContact()).review.state, 'review');
  });

  await scenario('SC19 expired contact slot reuse clears selection and confirmation from a later ordinary form', async f => {
    await publish(f); const selected = await f.selectContact(); await f.confirmContact(selected.token);
    await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 second'");
    await f.publish(); const result = await f.prepare('admin-help', { member: { user: { id: OTHER } } }); assert.equal(result.result.status, 'modal');
    const slot = (await f.rows('case_form_slots'))[0];
    assert.equal(slot.contact_grants, null); assert.equal(slot.contact_operator_grant, null); assert.equal(slot.contact_confirmed, false); assert.equal(slot.contact_cancelled, false);
    assert.equal(await f.submit(result.result.modal.token, syntheticCaseValues(), { member: { user: { id: OTHER } } }), 'ticket_recorded');
    assert.equal((await f.rows('case_intakes'))[0].contact_status, null); assert.equal((await f.rows('case_participants')).length, 0);
  });

  await scenario('SC20 confirmation respects its initial deadline and selection replies reauthorize the Staff actor', async f => {
    await publish(f); const selected = await f.selectContact();
    assert.equal((await f.confirmContact(selected.token, OTHER, () => false)).status, 'disabled');
    assert.equal((await f.rows('case_form_slots'))[0].contact_confirmed, false);
    f.discord.state.members.set(OTHER, [CREW]); assert.equal((await f.contacts.view(selected.envelope)).state, 'denied');
    assert.equal((await f.confirmContact(selected.token)).status, 'denied'); assert.equal((await f.rows('case_reservations')).length, 0);
  });

  await scenario('SC21 replayed or concurrently confirmed selection keeps the original audience and one bounded handle', async f => {
    await publish(f); const selected = await f.selectContact([SECOND_PARTICIPANT, PARTICIPANT]);
    assert.equal(await f.executeIntake(selected.payload), 'case_contact');
    assert.equal((await f.contacts.view(f.verified(selected.payload))).token, selected.token);
    const sameOrder = structuredClone(selected.payload); sameOrder.data.values.reverse(); assert.equal(await f.executeIntake(sameOrder), 'case_contact');
    const changed = structuredClone(selected.payload); changed.data.values = [USER]; assert.equal(await f.executeIntake(changed), 'unavailable');
    assert.equal((await f.rows('case_form_slots')).length, 1);
    const request = { actor: await f.actor(OTHER), observation: await f.discord.roles.observe(OTHER), formToken: selected.token };
    const results = await Promise.all([f.intakeStore.confirmStaffContact(request), f.intakeStore.confirmStaffContact(request)]);
    assert.ok(results.every(result => result.token === selected.token));
    assert.equal(await f.submitContact(selected.token), 'ticket_recorded'); assert.equal((await f.rows('case_participants')).length, 2);
    assert.equal(await f.executeIntake(contactControlPayload(f, 'cancel', selected.token)), 'ticket_form_unavailable');
    assert.equal((await f.rows('case_form_slots'))[0].contact_cancelled, false);
  });

  await scenario('SC22 an invitation removed during channel inspection cannot authorize a recipient destination', async f => {
    const opened = await f.openContact(), token = (await provision(f)).operation_token;
    const authorization = createCoreAuthorization({ principals: f.identities.verifier, discord: f.intakeRoles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: f.pool, clock: () => f.clock.now }), clock: () => f.clock.now,
      isAuthorityCurrent: () => f.clock.enabled, readContinuity: f.intakeRoles.readContinuity });
    const actor = await authorization.resolveActor(f.verified(contactEntryPayload(f))), store = createCaseParticipantStore({ pool: f.pool, clock: () => f.clock.now,
      authorize: authorization.authorize, resolveCaseParticipant: authorization.resolveCaseParticipant, authorizeCaseParticipant: authorization.authorizeCaseParticipant, policy: casePolicy });
    let removed = false;
    f.discord.state.before = async call => { if (!removed && call.method === 'GET' && call.path.endsWith(`/channels/${opened.row.channel_id}`)) {
      removed = true; f.discord.state.before = null;
      await store.changeCaseParticipant({ actor, observation: await f.intakeRoles.observe(OTHER), interactionId: f.nextId(), id: opened.row.id,
        expectedVersion: opened.row.version, action: 'remove', userId: PARTICIPANT, reason: 'no-longer-needed', confirmed: true });
    } };
    assert.equal((await f.contactView('destination', token)).state, 'denied'); assert.equal(removed, true);
    assert.equal((await f.rows('case_participants'))[0].status, 'removed');
  });

  await scenario('SC23 explicit reopening of a revoked contact keeps original audits and does not revive old recipients', async f => {
    await pending(f); f.discord.state.afterWrite = call => { if (call.method === 'PATCH') { f.discord.state.afterWrite = null; f.discord.state.members.set(OTHER, [CREW]); } };
    await settle(f); let row = (await f.rows('case_reservations'))[0]; assert.equal(row.state, 'failed');
    const token = (await provision(f)).operation_token, initial = (await f.rows('case_participant_actions'))[0]; f.discord.state.members.set(USER, [STAFF]);
    f.clock.now += 1_000;
    assert.equal(await f.execute(ticketPayload(f, 'reopen', row, { member: { user: { id: USER } } })), 'case_change_recorded'); await settle(f);
    assert.equal((await f.rows('case_intakes'))[0].contact_status, 'superseded'); assert.equal((await f.contactView('destination', token)).state, 'denied');
    row = (await f.rows('case_reservations'))[0]; assert.equal(row.state, 'open');
    await participantServices(f).changeParticipant(row, { actorId: USER }); await settle(f);
    assert.equal((await f.contactView('destination', token)).state, 'ready');
    assert.deepEqual((await f.rows('case_participant_actions')).find(value => value.version === initial.version), initial);
    assert.equal((await f.rows('case_participants')).filter(value => value.status === 'revoked').length, 1);
  });
}
