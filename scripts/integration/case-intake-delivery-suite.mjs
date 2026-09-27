import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { intakeDeliveryWorkflow, intakeDeliveryServices } from '../../tests/fixtures/case-intake-delivery.js';
import { syntheticCaseForm, syntheticCaseValues } from '../../tests/fixtures/case-intake.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { createCaseIntakeDispatcher } from '../../apps/core/discord/case-intake-dispatcher.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { CREW, MUZZLED } from '../../tests/fixtures/discord.js';

export async function runCaseIntakeDeliverySuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await intakeDeliveryWorkflow(cluster)));
  const pages = async f => (await f.rows('case_intake_messages')).sort((a, b) => a.ordinal - b.ordinal);
  const posts = f => f.discord.state.calls.filter(call => call.method === 'POST' && /\/messages$/.test(call.path));
  const messages = f => [...f.discord.state.messages.values()];
  const jobs = async f => (await f.rows('outbox')).filter(row => row.kind === 'case.intake');
  const due = async f => { await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'"); await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity'"); };
  // Synthetic operator intervention only; a production recovery route remains a separate use case.
  const recheck = async f => { await f.admin.query("UPDATE sophie_core.outbox SET status = 'ready', available_at = '-infinity', attempts = 0 WHERE kind = 'case.intake' AND status = 'parked'"); };
  // These upgrade scenarios reconstruct pre-022 state, before DM/reply jobs and schema existed.
  const rewindDirectNotices = async f => {
    await f.admin.query(`DROP TABLE sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns;
      ALTER TABLE sophie_core.gateway_lifecycle DROP COLUMN automation_enabled;
      DELETE FROM sophie_migrations.applied WHERE id IN ('042-automation-admission.sql','043-automation-delivery.sql','044-automation-recovery.sql');`);
    await f.admin.query("DELETE FROM sophie_core.outbox WHERE kind = 'case.reply'; DROP TABLE sophie_core.case_answer_reviews, sophie_core.case_reply_events, sophie_core.case_replies");
    await f.admin.query("DELETE FROM sophie_migrations.applied WHERE id IN ('036-case-replies.sql', '037-case-reply-issues.sql', '039-case-reply-answers.sql', '040-case-answer-reviews.sql')");
    await f.admin.query("DELETE FROM sophie_core.outbox WHERE kind = 'case.dm'; DROP TABLE sophie_core.case_direct_notices");
    await f.admin.query("DELETE FROM sophie_migrations.applied WHERE id = '032-case-direct-notices.sql'");
  };

  await scenario('X01 each answer is confirmed before the responder notice, with one POST per part and no duplicate on replay', async f => {
    await f.openTicket(); assert.equal((await pages(f)).length, 3); assert.equal((await jobs(f)).length, 1);
    assert.equal((await f.intakeWorker.runOnce('answer-one')).status, 'progressed'); assert.equal(posts(f).length, 1); assert.deepEqual(messages(f)[0].mention_roles, []);
    assert.equal((await f.intakeWorker.runOnce('answer-two')).status, 'progressed'); assert.equal(posts(f).length, 2);
    assert.equal((await f.intakeWorker.runOnce('responder-notice')).status, 'settled'); assert.deepEqual(messages(f).at(-1).mention_roles, [STAFF]);
    assert.equal((await pages(f)).every(row => row.state === 'confirmed'), true); assert.equal((await jobs(f))[0].status, 'done');
    assert.equal((await f.intakeWorker.runOnce('completed-replay')).status, 'idle'); assert.equal(posts(f).length, 3);
  });

  await scenario('X02 Quick Help has only a Staff notice and Head Admin intake mentions lead ops without ordinary Staff', async f => {
    f.discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) {
      for (const embed of messages(f).at(-1).embeds) embed.content_scan_version = 3;
    } };
    await f.openTicket('quick-help'); await f.drain(f.intakeWorker); assert.equal(posts(f).length, 1); assert.deepEqual(messages(f)[0].mention_roles, [STAFF]);
    f.clock.now += 1_001; f.discord.state.roles.find(role => role.id === LEAD).mentionable = true;
    await f.openTicket('head-admin-contact'); await f.drain(f.intakeWorker);
    assert.deepEqual(messages(f).at(-1).mention_roles, [LEAD]); assert.equal(messages(f).slice(1).some(message => message.mention_roles.includes(STAFF)), false);
    const head = (await f.rows('case_reservations')).find(row => row.type === 'head-admin-contact');
    assert.equal(f.discord.state.channels.get(head.channel_id).permission_overwrites.some(entry => entry.id === STAFF && BigInt(entry.allow) !== 0n), false);
  });

  await scenario('X03 maximum escaped form size is split without truncation into fifteen answer parts followed by one bounded notice', async f => {
    const form = syntheticCaseForm(); form.fields = Array.from({ length: 5 }, (_, index) => ({ ...form.fields[0], id: `field${index}`, maxLength: 4_000 }));
    const values = form.fields.map(field => ({ id: field.id, kind: 'text', value: '*'.repeat(4_000) }));
    await f.openTicket(form.caseType, values, form); await f.drain(f.intakeWorker);
    assert.equal(posts(f).length, 16); assert.equal(messages(f).filter(message => message.mention_roles.length).length, 1);
    assert.equal(messages(f).every(message => message.embeds[0].description.length <= 4_096), true);
    assert.equal((await pages(f)).every(row => row.state === 'confirmed'), true);
  });

  await scenario('X04 widened permissions block answers and queue reconciliation before an explicit retry can deliver', async f => {
    const row = await f.openTicket(); f.discord.state.channels.get(row.channel_id).permission_overwrites = [];
    const result = await f.intakeWorker.runOnce('bad-audience'); assert.equal(result.status, 'operator_required'); assert.equal(posts(f).length, 0);
    assert.equal((await pages(f))[0].create_started, false); await f.drain(f.cases); await recheck(f); await f.drain(f.intakeWorker);
    assert.equal(posts(f).length, 3); assert.equal((await jobs(f))[0].status, 'done');
  });

  await scenario('X05 departure blocks unsent content, seals the case, and rejoining cannot revive its old intake', async f => {
    await f.openTicket(); f.discord.state.members.delete(USER);
    assert.equal((await f.intakeWorker.runOnce('member-departed')).code, 'CASE_INTAKE_UNAVAILABLE'); assert.equal(posts(f).length, 0); await f.drain(f.cases);
    f.discord.state.members.set(USER, [CREW]); await recheck(f);
    assert.equal((await f.intakeWorker.runOnce('member-returned')).code, 'CASE_INTAKE_UNAVAILABLE'); assert.equal(posts(f).length, 0);
    assert.equal((await f.rows('case_intakes')).length, 1);
  });

  await scenario('X06 departure during a POST retains the observed ID, prevents a notice and durably requests sealing', async f => {
    await f.openTicket(); f.discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) { f.discord.state.afterWrite = null; f.discord.state.members.delete(USER); } };
    assert.equal((await f.intakeWorker.runOnce('departure-during-post')).status, 'operator_required');
    const first = (await pages(f))[0]; assert.notEqual(first.message_id, null); assert.equal(first.state, 'pending'); assert.equal(posts(f).length, 1);
    await f.drain(f.cases); assert.equal(messages(f).every(message => message.mention_roles.length === 0), true);
    assert.equal((await f.rows('case_reservations'))[0].state, 'failed');
  });

  await scenario('X07 closure during delivery stops further answers while retaining the case, intake and late message reference', async f => {
    const row = await f.openTicket();
    f.discord.state.afterWrite = async call => { if (/\/messages$/.test(call.path)) {
      f.discord.state.afterWrite = null; assert.equal(await f.execute(ticketPayload(f, 'close', row, { member: { user: { id: OTHER } } })), 'case_change_recorded');
    } };
    assert.equal((await f.intakeWorker.runOnce('close-during-answer')).code, 'CASE_INTAKE_UNAVAILABLE'); await f.drain(f.cases);
    assert.equal((await f.rows('case_reservations'))[0].state, 'closed'); assert.notEqual((await pages(f))[0].message_id, null);
    assert.equal(posts(f).length, 1); assert.equal((await f.rows('case_intakes')).length, 1);
  });

  await scenario('X08 a lost POST response parks the unidentified part without scanning history or blindly sending it again', async f => {
    await f.openTicket(); f.discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) { f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_RESPONSE'); } };
    assert.equal((await f.intakeWorker.runOnce('unknown-answer')).status, 'retry_scheduled'); await due(f);
    assert.equal((await f.intakeWorker.runOnce('unknown-retry')).code, 'CASE_INTAKE_UNCERTAIN');
    assert.equal(posts(f).length, 1); assert.equal((await pages(f))[0].message_id, null); assert.equal((await pages(f))[0].create_started, true);
    assert.equal(f.discord.state.calls.some(call => call.method === 'GET' && /\/messages$/.test(call.path)), false);
  });

  await scenario('X09 a late authentic response survives a superseded lease and resumes through inspection with no duplicate answer or notice', async f => {
    await f.openTicket(); const fresh = intakeDeliveryServices(f);
    f.discord.state.afterWrite = async call => { if (/\/messages$/.test(call.path)) {
      f.discord.state.afterWrite = null;
      await f.admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = 'case.intake' AND status = 'leased'");
      assert.equal((await fresh.intakeWorker.runOnce('replacement-worker')).code, 'CASE_INTAKE_UNCERTAIN');
    } };
    assert.equal((await f.intakeWorker.runOnce('expired-worker')).status, 'lease_lost'); assert.notEqual((await pages(f))[0].message_id, null);
    await f.drain(f.cases); await f.drain(fresh.intakeWorker);
    assert.equal(posts(f).length, 3); assert.equal((await pages(f)).every(row => row.state === 'confirmed'), true);
    assert.equal((await jobs(f)).every(row => row.status === 'done'), true);
  });

  await scenario('X10 definite rate-limit refusal clears only the unsent attempt and persists the shared delivery barrier', async f => {
    await f.openTicket(); f.discord.state.before = call => { if (call.method === 'POST' && /\/messages$/.test(call.path)) {
      f.discord.state.before = null; return new Response(JSON.stringify({ retry_after: 2 }), { status: 429, headers: { 'retry-after': '2' } });
    } };
    assert.equal((await f.intakeWorker.runOnce('limited')).code, 'RATE_LIMITED'); assert.equal((await pages(f))[0].create_started, false);
    assert.equal((await f.intakeWorker.runOnce('limited-again')).status, 'idle'); assert.equal(messages(f).length, 0);
    f.clock.now += 2_001; await due(f); await f.drain(f.cases); await f.drain(f.intakeWorker); assert.equal(messages(f).length, 3);
  });

  await scenario('X11 private descriptors and forged proofs cannot expose answers or begin a message for another member', async f => {
    const values = syntheticCaseValues(), canary = randomBytes(40).toString('hex'); values[0].value = canary; await f.openTicket('admin-help', values);
    const { claim } = await f.outbox.claim('descriptor-check', 30_000, ['case.intake']);
    const state = await f.intakeDeliveryStore.inspectCaseIntake({ claim, observation: await f.discord.roles.observe(USER) });
    assert.equal(JSON.stringify(state).includes(canary), false); assert.equal(Object.hasOwn(state, 'payload'), false);
    await assert.rejects(f.intakeDeliveryStore.beginCaseIntakeMessage({ claim, observation: await f.discord.roles.observe(USER), recordId: state.recordId, proof: {} }));
    await assert.rejects(f.intakeDeliveryStore.inspectCaseIntake({ claim, observation: await f.discord.roles.observe(OTHER) }), /WRONG_JOB_KIND/);
    for (const table of ['outbox', 'receipts', 'case_intake_messages']) assert.equal(JSON.stringify(await f.rows(table)).includes(canary), false);
    assert.equal((await pages(f))[0].create_started, false); assert.equal(posts(f).length, 0);
  });

  await scenario('X12 changed message content or mention metadata cannot confirm an answer or advance to the notification', async f => {
    await f.openTicket(); f.discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) {
      f.discord.state.afterWrite = null; messages(f).at(-1).mention_roles = [STAFF];
    } };
    assert.equal((await f.intakeWorker.runOnce('changed-message')).code, 'CASE_INTAKE_MESSAGE_CHANGED');
    assert.equal((await pages(f))[0].state, 'pending'); assert.equal(posts(f).length, 1);
    await recheck(f); assert.equal((await f.intakeWorker.runOnce('changed-retry')).code, 'CASE_INTAKE_MESSAGE_CHANGED'); assert.equal(posts(f).length, 1);
  });

  await scenario('X13 a deleted known answer remains recorded and is not recreated or presented as fully delivered', async f => {
    await f.openTicket(); f.discord.state.before = call => { if (call.method === 'GET' && /\/messages\/\d+$/.test(call.path)) {
      f.discord.state.before = null; f.discord.state.messages.delete(call.path.split('/').at(-1));
    } };
    assert.equal((await f.intakeWorker.runOnce('missing-answer')).code, 'CASE_INTAKE_MESSAGE_MISSING');
    assert.notEqual((await pages(f))[0].message_id, null); assert.equal((await pages(f))[0].state, 'pending');
    await recheck(f); assert.equal((await f.intakeWorker.runOnce('missing-retry')).code, 'CASE_INTAKE_MESSAGE_MISSING'); assert.equal(posts(f).length, 1);
  });

  await scenario('X14 audience drift during message inspection prevents confirmation and schedules case repair', async f => {
    const row = await f.openTicket(); f.discord.state.before = call => { if (call.method === 'GET' && /\/messages\/\d+$/.test(call.path)) {
      f.discord.state.before = null; f.discord.state.channels.get(row.channel_id).permission_overwrites = [];
    } };
    assert.equal((await f.intakeWorker.runOnce('drift-during-read')).status, 'operator_required'); assert.equal((await pages(f))[0].state, 'pending');
    await f.drain(f.cases); await recheck(f); await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3);
  });

  await scenario('X15 Muzzled members retain ordinary support delivery without any Crew, Whitelist or membership mutation', async f => {
    f.discord.state.members.set(USER, [MUZZLED]); await f.openTicket(); await f.drain(f.intakeWorker);
    assert.equal(messages(f).length, 3); assert.deepEqual(f.discord.state.members.get(USER), [MUZZLED]);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET' && call.path.includes('/roles/')), false);
    assert.equal((await f.rows('sessions')).length, 0);
  });

  await scenario('X16 intake plan insertion is atomic with the original submission and knowledge cannot read or delete retained messages', async f => {
    await f.publish(); const held = (await f.prepare()).result.modal.token;
    await f.admin.query('REVOKE INSERT ON sophie_core.case_intake_messages FROM sophie_test_core');
    try { assert.equal(await f.submit(held), 'unavailable'); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.case_intake_messages, sophie_core.case_direct_notices TO sophie_test_core'); }
    for (const table of ['case_intakes', 'case_reservations', 'receipts', 'outbox', 'case_intake_messages']) assert.equal((await f.rows(table)).length, 0);
    assert.equal(await f.submit(held), 'ticket_recorded');
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_intake_messages'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_intake_messages'), { code: '42501' });
  });

  await scenario('X17 confirmation failure preserves the known ID and a retry inspects that message instead of posting again', async f => {
    await f.openTicket();
    await f.admin.query(`CREATE FUNCTION sophie_core.test_intake_confirm_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.state = 'confirmed' THEN RAISE EXCEPTION 'synthetic confirmation fault'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_intake_confirm BEFORE UPDATE ON sophie_core.case_intake_messages FOR EACH ROW EXECUTE FUNCTION sophie_core.test_intake_confirm_failure()`);
    try { assert.equal((await f.intakeWorker.runOnce('confirmation-fault')).status, 'retry_scheduled'); }
    finally { await f.admin.query('DROP TRIGGER test_intake_confirm ON sophie_core.case_intake_messages; DROP FUNCTION sophie_core.test_intake_confirm_failure()'); }
    assert.notEqual((await pages(f))[0].message_id, null); assert.equal((await pages(f))[0].state, 'pending');
    await due(f); await f.drain(f.cases); await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3);
  });

  await scenario('X18 a pause after arming but before POST releases the definitely unsent part while preserving the delivery barrier', async f => {
    await f.openTicket(); const store = { ...f.intakeDeliveryStore, beginCaseIntakeMessage: async request => {
      const result = await f.intakeDeliveryStore.beginCaseIntakeMessage(request); await f.outbox.pauseDiscordDelivery(); return result;
    } };
    const worker = createCaseIntakeDispatcher({ outbox: f.outbox, store, roles: f.intakeRoles, messages: f.intakeMessages, enabled: () => true });
    assert.equal((await worker.runOnce('paused-before-post')).status, 'retry_scheduled'); assert.equal(posts(f).length, 0);
    assert.equal((await pages(f))[0].create_started, false); assert.equal((await f.intakeWorker.runOnce('paused-worker')).status, 'idle');
    await f.admin.query('UPDATE sophie_core.discord_backoff SET paused = false'); await due(f); await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3);
  });

  await scenario('X19 changed retained source or form hashes block delivery without rewriting submitted records', async f => {
    await f.openTicket(); const intake = (await f.rows('case_intakes'))[0];
    await f.admin.query("UPDATE sophie_core.case_intakes SET answers_sha256 = repeat('0', 64)");
    assert.equal((await f.intakeWorker.runOnce('intake-corrupt')).code, 'CASE_INTAKE_CORRUPT'); assert.equal(posts(f).length, 0);
    await f.admin.query('UPDATE sophie_core.case_intakes SET answers_sha256 = $1', [intake.answers_sha256]);
    await f.admin.query("UPDATE sophie_core.case_forms SET sha256 = repeat('0', 64)"); await recheck(f);
    assert.equal((await f.intakeWorker.runOnce('form-corrupt')).code, 'CASE_FORM_CORRUPT'); assert.equal(posts(f).length, 0);
    assert.deepEqual((await f.rows('case_intakes'))[0].answers, intake.answers);
  });

  await scenario('X20 committed answers keep their pinned questions after publication withdrawal and newer form publication', async f => {
    await f.openTicket(); const original = (await f.rows('case_forms'))[0];
    await f.forms.withdrawCaseForm({ actor: await f.actor(OTHER), caseType: 'admin-help', version: 1, expectedHash: original.sha256, confirm: true });
    const changed = syntheticCaseForm(); changed.fields[0].label = 'A different synthetic question'; await f.publish(changed, 2);
    await f.drain(f.intakeWorker); assert.equal(messages(f)[0].embeds[0].title.includes('Synthetic details'), true);
    assert.equal(messages(f).at(-1).embeds[0].description.includes('version 1'), true); assert.equal((await f.rows('case_intakes'))[0].form_version, 1);
  });

  await scenario('X21 inability to mention responders does not block answer delivery or turn a notification into a silent success', async f => {
    await f.openTicket(); f.discord.state.roles.find(role => role.id === STAFF).mentionable = false;
    assert.equal((await f.intakeWorker.runOnce('unmentionable-answer-one')).status, 'progressed');
    assert.equal((await f.intakeWorker.runOnce('unmentionable-answer-two')).status, 'progressed');
    assert.equal((await f.intakeWorker.runOnce('unmentionable-notice')).code, 'STAFF_MENTION_UNAVAILABLE');
    assert.equal(posts(f).length, 2); assert.equal((await pages(f)).at(-1).create_started, false);
    f.discord.state.roles.find(role => role.id === STAFF).mentionable = true; await recheck(f); await f.drain(f.intakeWorker);
    assert.equal(posts(f).length, 3); assert.equal(messages(f).filter(message => message.mention_roles.length).length, 1);
  });

  await scenario('X22 migration queues previously retained intake without inventing delivered pages and preserves withdrawn versions', async f => {
    await f.openTicket(); const saved = (await f.rows('case_intakes'))[0];
    await rewindDirectNotices(f);
    const published = (await f.rows('case_forms'))[0];
    await f.forms.withdrawCaseForm({ actor: await f.actor(OTHER), caseType: 'admin-help', version: 1, expectedHash: published.sha256, confirm: true });
    await f.admin.query("DELETE FROM sophie_core.outbox WHERE kind = 'case.intake'; DROP TABLE sophie_core.case_intake_messages; ALTER TABLE sophie_core.case_intakes DROP COLUMN delivery_format");
    await f.admin.query("DELETE FROM sophie_migrations.applied WHERE id = '022-case-intake-delivery.sql'");
    await migrateCore(f.admin); await f.admin.query('GRANT SELECT, INSERT, UPDATE ON sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.case_intake_messages, sophie_core.case_direct_notices, sophie_core.case_replies, sophie_core.case_reply_events, sophie_core.case_answer_reviews TO sophie_test_core');
    assert.equal((await pages(f)).length, 0); assert.equal((await jobs(f)).length, 1);
    assert.deepEqual((await f.rows('case_intakes'))[0], saved); await f.drain(f.intakeWorker);
    assert.equal((await pages(f)).every(row => row.state === 'confirmed'), true); assert.equal(posts(f).length, 3);
  });

  await scenario('X23 migration refuses a conflicting retained operation and rolls back its schema without losing intake or the prior job', async f => {
    await f.openTicket(); const saved = (await f.rows('case_intakes'))[0], delivery = (await jobs(f))[0];
    await rewindDirectNotices(f);
    await f.admin.query("DELETE FROM sophie_core.outbox WHERE kind = 'case.intake'; DROP TABLE sophie_core.case_intake_messages; ALTER TABLE sophie_core.case_intakes DROP COLUMN delivery_format");
    await f.admin.query("DELETE FROM sophie_migrations.applied WHERE id = '022-case-intake-delivery.sql'");
    const effect = { ...delivery.effect, kind: 'case.provision', type: saved.case_type };
    await f.admin.query("INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect) VALUES ($1, $2, $3, 'case.provision', $4::jsonb)",
      [GUILD, delivery.operation_id, USER, JSON.stringify(effect)]);
    const previous = (await f.rows('outbox')).find(row => row.operation_id === delivery.operation_id);
    await assert.rejects(migrateCore(f.admin), { code: '23514', message: 'CASE_INTAKE_MIGRATION_COLLISION' });
    assert.equal((await f.admin.query("SELECT to_regclass('sophie_core.case_intake_messages') AS name")).rows[0].name, null);
    assert.equal((await f.admin.query("SELECT 1 FROM sophie_migrations.applied WHERE id = '022-case-intake-delivery.sql'")).rowCount, 0);
    const { delivery_format: _, ...priorIntake } = saved;
    assert.deepEqual((await f.rows('case_intakes'))[0], priorIntake);
    assert.deepEqual((await f.rows('outbox')).find(row => row.operation_id === delivery.operation_id), previous);
    assert.equal(posts(f).length, 0);
    // Repair only this synthetic collision so later scenarios can use the upgraded schema.
    await f.admin.query('DELETE FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2', [GUILD, delivery.operation_id]);
    await migrateCore(f.admin); await f.admin.query('GRANT SELECT, INSERT, UPDATE ON sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.case_intake_messages, sophie_core.case_direct_notices, sophie_core.case_replies, sophie_core.case_reply_events, sophie_core.case_answer_reviews TO sophie_test_core');
    assert.equal((await jobs(f)).length, 1); assert.equal((await pages(f)).length, 0);
    await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3);
  });
}
