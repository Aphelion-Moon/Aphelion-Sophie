import assert from 'node:assert/strict';
import { intakeDeliveryWorkflow } from '../../tests/fixtures/case-intake-delivery.js';
import { removeContactMigration } from '../../tests/fixtures/case-contacts.js';
import { caseIntakeServices, playerReportPayload, intakeSubmitPayload, syntheticCaseForm, syntheticCaseValues } from '../../tests/fixtures/case-intake.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { CREW, MUZZLED } from '../../tests/fixtures/discord.js';

const SUBJECT = '100000000000000099';
/** Synthetic authored forms, identities and responses only; no live Discord or case-content connector. */
export async function runPlayerReportSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await intakeDeliveryWorkflow(cluster)));
  const prepare = async (f, subjectId = SUBJECT, overrides = {}) => {
    const payload = playerReportPayload(f, subjectId, overrides), envelope = f.verified(payload);
    const result = await f.intake.prepare(envelope, { isCurrent: () => true }); assert.equal(result.status, 'modal');
    return { payload, token: result.modal.token };
  };
  const publish = f => f.publish(syntheticCaseForm('player-report'));
  const posts = f => f.discord.state.calls.filter(call => call.method === 'POST' && /\/messages$/.test(call.path));

  await scenario('PR01 a report retains its subject without inviting or notifying them through provisioning, delivery and closure', async f => {
    f.discord.state.members.set(SUBJECT, [CREW]); await publish(f); const held = await prepare(f);
    assert.equal(await f.submit(held.token), 'ticket_recorded');
    const intake = (await f.rows('case_intakes'))[0]; assert.equal(intake.subject_id, SUBJECT); assert.equal(intake.user_id, USER);
    assert.equal((await f.rows('case_form_slots'))[0].subject_id, SUBJECT);
    await f.drain(f.cases); await f.drain(f.intakeWorker);
    const row = (await f.rows('case_reservations'))[0], channel = f.discord.state.channels.get(row.channel_id);
    assert.equal(channel.permission_overwrites.some(entry => entry.id === SUBJECT), false);
    assert.equal(channel.name.includes(SUBJECT), false); assert.equal(channel.topic.includes(SUBJECT), false);
    const messages = [...f.discord.state.messages.values()]; assert.equal(messages.length, 3);
    assert.match(messages.at(-1).embeds[0].description, new RegExp(SUBJECT)); assert.deepEqual(messages.at(-1).mention_roles, [STAFF]);
    assert.equal(JSON.stringify(messages).includes(`<@${SUBJECT}>`), false);
    for (const table of ['receipts', 'outbox', 'case_provisions']) assert.equal(JSON.stringify(await f.rows(table)).includes(SUBJECT), false);
    assert.equal(await f.execute(ticketPayload(f, 'close', row, { member: { user: { id: OTHER } } })), 'case_change_recorded');
    await f.drain(f.cases); assert.equal((await f.rows('case_reservations'))[0].state, 'closed');
    assert.equal(f.discord.state.channels.get(row.channel_id).permission_overwrites.some(entry => entry.id === SUBJECT), false);
    assert.equal((await f.rows('case_intakes'))[0].subject_id, SUBJECT);
  });

  await scenario('PR02 reporting needs no subject membership lookup and remains available to a Muzzled requester', async f => {
    f.discord.state.members.set(USER, [MUZZLED]); await publish(f); const held = await prepare(f);
    assert.equal(await f.submit(held.token), 'ticket_recorded'); await f.drain(f.cases); await f.drain(f.intakeWorker);
    assert.equal(f.discord.state.calls.some(call => call.path.includes(`/members/${SUBJECT}`)), false);
    assert.equal((await f.rows('case_reservations'))[0].user_id, USER);
    f.clock.now += 1_001; await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '4 seconds'");
    const unnamed = await prepare(f, null); assert.equal(await f.submit(unnamed.token), 'ticket_recorded');
    assert.equal((await f.rows('case_intakes')).filter(row => row.subject_id === null).length, 1);
    assert.equal((await f.rows('sessions')).length, 0); assert.equal(f.discord.state.calls.some(call => call.path.includes('/roles/') && call.method !== 'GET'), false);
  });

  await scenario('PR03 the first signed subject is pinned and expired slot reuse clears it for another form category', async f => {
    await publish(f); const held = await prepare(f);
    const request = { actor: await f.actor(), observation: await f.discord.roles.observe(USER), interactionId: held.payload.id, caseType: 'player-report', subjectId: SUBJECT };
    assert.equal((await f.intakeStore.beginCaseForm(request)).token, held.token);
    for (const subjectId of [null, OTHER]) await assert.rejects(f.intakeStore.beginCaseForm({ ...request, subjectId }), /INTERACTION_ID_COLLISION/);
    assert.equal((await f.rows('case_form_slots'))[0].subject_id, SUBJECT);
    await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 second'");
    await f.publish(); const next = await f.prepare(); assert.equal(next.result.status, 'modal');
    assert.equal((await f.rows('case_form_slots'))[0].subject_id, null); assert.equal(await f.submit(held.token), 'denied');
    assert.equal(await f.submit(next.result.modal.token), 'ticket_recorded'); assert.equal((await f.rows('case_intakes'))[0].subject_id, null);
  });

  await scenario('PR04 duplicate report submissions share one retained subject and a current-authority replay after a lost commit acknowledgement', async f => {
    await publish(f); const held = await prepare(f), request = intakeSubmitPayload(f, held.token); let loseCommit = true;
    const pool = { connect: async () => { const client = await f.pool.connect(); return { release: discard => client.release(discard), query: async (...args) => {
      const result = await client.query(...args); if (args[0] === 'COMMIT' && loseCommit) { loseCommit = false; throw new Error('SYNTHETIC_COMMIT_ACK_LOST'); } return result;
    } }; } };
    assert.equal(await caseIntakeServices({ ...f, pool }).executeIntake(request), 'unavailable');
    assert.deepEqual(await Promise.all([f.executeIntake(request), f.submit(held.token)]), ['ticket_recorded', 'ticket_recorded']);
    assert.equal((await f.rows('case_intakes')).length, 1); assert.equal((await f.rows('case_reservations')).length, 1);
    assert.equal((await f.rows('case_intakes'))[0].subject_id, SUBJECT); assert.equal((await f.rows('outbox')).length, 2);
    f.discord.state.members.delete(USER); assert.equal(await f.executeIntake(request), 'denied');
    assert.equal((await f.rows('case_intakes')).length, 1);
  });

  await scenario('PR05 a reported member cannot submit the reporter form, obtain its destination or manage the case', async f => {
    f.discord.state.members.set(SUBJECT, [CREW]); await publish(f); const held = await prepare(f);
    assert.equal(await f.submit(held.token, syntheticCaseValues(), { member: { user: { id: SUBJECT } } }), 'denied');
    assert.equal((await f.rows('case_intakes')).length, 0); assert.equal(await f.submit(held.token), 'ticket_recorded'); await f.drain(f.cases);
    const provision = (await f.rows('case_provisions'))[0], row = (await f.rows('case_reservations'))[0];
    const payload = f.payload({ type: 3, member: { user: { id: SUBJECT } }, message: { id: OTHER },
      data: { component_type: 2, custom_id: `sophie:ticket:v1:status:${provision.operation_token}` } });
    assert.equal((await f.intake.destination(f.verified(payload))).state, 'unavailable');
    assert.equal(await f.execute(ticketPayload(f, 'close', row, { member: { user: { id: SUBJECT } } })), 'denied');
    assert.equal((await f.rows('case_reservations'))[0].state, 'open');
  });

  await scenario('PR06 report context, answers, receipts and delivery plans roll back together and stay inaccessible to knowledge', async f => {
    await publish(f); const held = await prepare(f);
    await f.admin.query('REVOKE INSERT ON sophie_core.case_intake_messages FROM sophie_test_core');
    try { assert.equal(await f.submit(held.token), 'unavailable'); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_intake_messages TO sophie_test_core'); }
    for (const table of ['case_intakes', 'case_reservations', 'case_provisions', 'receipts', 'outbox']) assert.equal((await f.rows(table)).length, 0);
    assert.equal((await f.rows('case_form_slots'))[0].consumed_case_id, null); assert.equal(await f.submit(held.token), 'ticket_recorded');
    await assert.rejects(cluster.knowledgePool.query('SELECT subject_id FROM sophie_core.case_intakes'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_intakes'), { code: '42501' });
    let checks = 0; const service = caseIntakeServices(f, { authorize: async (...args) => ++checks < 2 && f.authorization.authorize(...args) });
    assert.equal(await service.submit(held.token), 'denied'); assert.equal((await f.rows('case_intakes')).length, 1);
  });

  await scenario('PR07 form updates preserve the pinned report and withdrawal never changes its retained subject or answers', async f => {
    const first = await publish(f), held = await prepare(f), second = await f.publish({ ...syntheticCaseForm('player-report'), title: 'Synthetic revised report' }, 2);
    assert.equal(await f.submit(held.token), 'ticket_recorded');
    await f.forms.withdrawCaseForm({ actor: await f.actor(OTHER), caseType: 'player-report', version: 1, expectedHash: first.sha256, confirm: true });
    assert.equal(await f.submit(held.token), 'ticket_recorded'); const row = (await f.rows('case_intakes'))[0];
    assert.equal(row.form_version, 1); assert.equal(row.subject_id, SUBJECT); assert.deepEqual(row.answers, syntheticCaseValues());
    await f.forms.withdrawCaseForm({ actor: await f.actor(OTHER), caseType: 'player-report', version: 2, expectedHash: second.sha256, confirm: true });
    const result = await f.intake.prepare(f.verified(playerReportPayload(f)), { isCurrent: () => true }); assert.equal(result.status, 'ticket_form_unavailable');
    await f.drain(f.cases); await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3);
  });

  await scenario('PR08 signed loopback report entry binds the subject and acknowledges submission privately without exposing answers', async f => {
    await publish(f); const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION, clock: () => f.clock.now,
      enabled: () => f.clock.enabled, caseIntake: f.intake, fetch: async (_url, request) => { replies.push(JSON.parse(request.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.commands, caseIntake: f.intake,
      respond: responder.respond, enabled: () => f.clock.enabled, onFault: code => faults.push(code) });
    try {
      const address = await server.listen(), post = async (payload, signature = null) => {
        const signed = f.identities.signed(payload), result = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signature ?? signed.signature, 'X-Signature-Timestamp': signed.timestamp },
          body: signed.body, signal: AbortSignal.timeout(5_000) }); return { status: result.status, body: await result.json() };
      };
      const opened = await post(playerReportPayload(f, SUBJECT)); assert.equal(opened.body.type, 9);
      const token = opened.body.data.custom_id.split(':').at(-1), request = intakeSubmitPayload(f, token), result = await post(request);
      assert.deepEqual(result.body, { type: 5, data: { flags: 64 } }); await server.drain(); assert.equal(replies.length, 1);
      assert.equal(JSON.stringify(replies).includes(syntheticCaseValues()[0].value), false); assert.equal(JSON.stringify(replies).includes(SUBJECT), false);
      assert.equal((await f.rows('case_intakes'))[0].subject_id, SUBJECT); assert.equal((await post(request, '00'.repeat(64))).status, 401); assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });

  await scenario('PR09 a changed retained report subject fails the committed delivery hash before any message is posted', async f => {
    await publish(f); const held = await prepare(f); assert.equal(await f.submit(held.token), 'ticket_recorded'); await f.drain(f.cases);
    await f.admin.query('UPDATE sophie_core.case_intakes SET subject_id = $1', [OTHER]);
    const result = await f.intakeWorker.runOnce('corrupt-report'); assert.equal(result.status, 'operator_required'); assert.equal(result.code, 'CASE_INTAKE_CORRUPT');
    assert.equal(posts(f).length, 0); assert.equal((await f.rows('case_intakes')).length, 1);
  });

  await scenario('PR10 upgrading existing intake preserves definitions, answers and delivery identities with no invented subject', async f => {
    await f.openTicket(); const forms = await f.rows('case_forms'), intakes = await f.rows('case_intakes'), messages = await f.rows('case_intake_messages');
    await removeContactMigration(f.admin);
    for (const table of ['case_forms', 'case_form_drafts', 'case_form_editor_actions']) await f.admin.query(`ALTER TABLE sophie_core.${table} DROP CONSTRAINT ${table}_case_type_check;
      ALTER TABLE sophie_core.${table} ADD CONSTRAINT ${table}_case_type_check CHECK (case_type IN ('admin-help', 'staff-report', 'tech-support', 'database-support', 'head-admin-contact'))`);
    await f.admin.query("ALTER TABLE sophie_core.case_form_slots DROP COLUMN subject_id; ALTER TABLE sophie_core.case_intakes DROP COLUMN subject_id; DELETE FROM sophie_migrations.applied WHERE id = '025-player-reports.sql'");
    assert.deepEqual(await migrateCore(f.admin), { migrations: 56 }); assert.deepEqual(await f.rows('case_forms'), forms);
    assert.deepEqual(await f.rows('case_intakes'), intakes); assert.deepEqual(await f.rows('case_intake_messages'), messages);
    await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3); assert.equal((await f.rows('case_intakes'))[0].subject_id, null);
  });
}
