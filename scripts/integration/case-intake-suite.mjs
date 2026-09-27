import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { intakeWorkflow, caseIntakeServices, syntheticCaseForm, syntheticCaseValues, intakeBeginPayload, intakeSubmitPayload } from '../../tests/fixtures/case-intake.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { createMemberOperation } from '../../apps/core/storage/members.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { CREW, MUZZLED } from '../../tests/fixtures/discord.js';

/** Authored synthetic fixtures only; never connects to a real Discord guild or a case-content AI path. */
export async function runCaseIntakeSuite(cluster, run) {
  const scenario = (name, work, options) => run(name, async () => work(await intakeWorkflow(cluster, options)));
  const observe = f => f.discord.roles.observe(USER);
  const ageSlots = f => f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '4 seconds'");
  const token = async (f, type = 'admin-help', overrides = {}) => {
    const prepared = await f.prepare(type, overrides); assert.equal(prepared.result.status, 'modal'); return prepared.result.modal.token;
  };
  const withdraw = async (f, published, type = 'admin-help') => f.forms.withdrawCaseForm({ actor: await f.actor(OTHER),
    caseType: type, version: published.version, expectedHash: published.sha256, confirm: true });
  const writes = f => f.discord.state.calls.filter(call => call.method !== 'GET');
  const statusPayload = (f, caseToken, userId = USER) => f.payload({ type: 3, member: { user: { id: userId } }, message: { id: OTHER },
    data: { component_type: 2, custom_id: `sophie:ticket:v1:status:${caseToken}` } });

  await scenario('B01 Quick Help atomically records a formless case and one provisioning intent; exact retries do not create another', async f => {
    const payload = intakeBeginPayload(f, 'quick-help');
    assert.equal(await f.executeIntake(payload), 'ticket_recorded'); assert.equal(await f.executeIntake(payload), 'ticket_recorded');
    const rows = await f.rows('case_intakes'); assert.equal(rows.length, 1); assert.deepEqual(rows[0].answers, []); assert.equal(rows[0].form_version, null);
    for (const table of ['case_reservations', 'case_provisions', 'receipts']) assert.equal((await f.rows(table)).length, 1);
    assert.deepEqual((await f.rows('outbox')).map(row => row.kind).sort(), ['case.intake', 'case.provision']);
    assert.equal((await f.rows('case_forms')).length, 0); assert.equal(writes(f).length, 0);
    await f.drain(f.cases); assert.equal((await f.rows('case_reservations'))[0].state, 'open');
    assert.equal((await f.intake.destination(f.verified(payload))).state, 'ready');
  });

  await scenario('B02 opening a form creates no case; submitted values retain their pinned version through a later publication', async f => {
    await f.publish(); const prepared = await f.prepare(); assert.equal(prepared.result.status, 'modal');
    assert.equal((await f.rows('case_intakes')).length, 0); assert.equal((await f.rows('outbox')).length, 0);
    await f.publish({ ...syntheticCaseForm(), title: 'New synthetic revision' }, 2);
    const repeated = await f.intake.prepare(f.verified(prepared.payload), { isCurrent: () => true });
    assert.equal(repeated.modal.version, 1); assert.equal(repeated.modal.token, prepared.result.modal.token);
    assert.equal(await f.submit(prepared.result.modal.token), 'ticket_recorded');
    const retained = (await f.rows('case_intakes'))[0]; assert.equal(retained.form_version, 1); assert.deepEqual(retained.answers, syntheticCaseValues());
    await f.drain(f.cases); const row = (await f.rows('case_reservations'))[0];
    const audience = f.discord.state.channels.get(row.channel_id).permission_overwrites;
    assert.equal(audience.some(entry => entry.id === STAFF && BigInt(entry.allow) !== 0n), true);
    assert.equal(audience.some(entry => entry.id === LEAD && BigInt(entry.allow) !== 0n), true);
  });

  await scenario('B03 the latest withdrawn form has no implicit fallback while an older published pin remains valid', async f => {
    await f.publish(); const held = await token(f), second = await f.publish({ ...syntheticCaseForm(), title: 'Second synthetic revision' }, 2);
    await withdraw(f, second); await ageSlots(f);
    assert.equal((await f.prepare()).result.status, 'ticket_form_unavailable');
    assert.equal(await f.submit(held), 'ticket_recorded'); assert.equal((await f.rows('case_intakes'))[0].form_version, 1);
  });

  await scenario('B04 withdrawal blocks unsubmitted pins but retains an exact committed replay without republishing', async f => {
    const publication = await f.publish(), held = await token(f); await withdraw(f, publication);
    assert.equal(await f.submit(held), 'ticket_form_unavailable'); assert.equal((await f.rows('case_intakes')).length, 0);
    assert.equal((await f.publish()).status, 'withdrawn');
    const second = await f.publish(syntheticCaseForm(), 2); await ageSlots(f); const next = await token(f);
    const request = intakeSubmitPayload(f, next); assert.equal(await f.executeIntake(request), 'ticket_recorded'); await withdraw(f, second);
    assert.equal(await f.executeIntake(request), 'ticket_recorded'); assert.equal(await f.submit(next), 'ticket_recorded');
    const changed = syntheticCaseValues(); changed[0].value = 'Different synthetic input.';
    assert.equal(await f.submit(next, changed), 'ticket_form_unavailable'); assert.equal((await f.rows('case_intakes')).length, 1);
  });

  await scenario('B05 concurrent equivalent submissions consume a form once and changed interaction bodies cannot overwrite it', async f => {
    await f.publish(); const held = await token(f), actor = await f.actor(), observation = await observe(f);
    const request = { actor, observation, formToken: held, values: syntheticCaseValues(), interactionId: f.nextId() };
    const values = await Promise.all([f.intakeStore.submitCaseForm(request), f.intakeStore.submitCaseForm({ ...request, interactionId: f.nextId() })]);
    assert.equal(values[0].caseId, values[1].caseId); assert.deepEqual(values.map(value => value.duplicate).sort(), [false, true]);
    const changed = syntheticCaseValues(); changed[0].value = 'Changed synthetic request.';
    await assert.rejects(f.intakeStore.submitCaseForm({ ...request, values: changed }), /INTERACTION_ID_COLLISION/);
    assert.equal((await f.rows('case_intakes')).length, 1); assert.deepEqual((await f.rows('outbox')).map(row => row.kind).sort(), ['case.intake', 'case.provision']);
  });

  await scenario('B06 field errors roll back consumption, receipts and case work; corrected values can still use the valid form', async f => {
    await f.publish(); const held = await token(f);
    const invalid = syntheticCaseValues(); invalid[1].value = ['unknown'];
    assert.equal(await f.submit(held, invalid), 'ticket_form_invalid');
    assert.equal(await f.submit(held, syntheticCaseValues().slice(1)), 'ticket_form_invalid');
    assert.equal((await f.rows('case_form_slots'))[0].consumed_case_id, null);
    for (const table of ['case_intakes', 'case_reservations', 'outbox', 'receipts']) assert.equal((await f.rows(table)).length, 0);
    assert.equal(await f.submit(held), 'ticket_recorded');
  });

  await scenario('B07 form owner, current membership, presence epoch and current case policy are all required', async f => {
    await f.publish(); const held = await token(f), actor = await f.actor(), observation = await observe(f);
    assert.equal(await f.submit(held, syntheticCaseValues(), { member: { user: { id: OTHER } } }), 'denied');
    await assert.rejects(f.intakeStore.submitCaseForm({ actor: { ...actor }, observation, interactionId: f.nextId(), formToken: held, values: syntheticCaseValues() }), /OPERATION_DENIED/);
    f.discord.state.members.delete(USER); assert.equal(await f.submit(held), 'denied');
    await createMemberOperation({ pool: f.pool, clock: () => f.clock.now })(await observe(f), async () => {});
    f.discord.state.members.set(USER, [CREW]); assert.equal(await f.submit(held), 'ticket_form_unavailable');
    await ageSlots(f); const next = await token(f);
    const changed = caseIntakeServices(f, { policy: { ...casePolicy, version: 2 } });
    assert.equal(await changed.submit(next), 'ticket_form_unavailable'); assert.equal((await f.rows('case_intakes')).length, 0);
  });

  await scenario('B08 member form cadence and four-slot bound include consumed handles until their expiry', async f => {
    await f.publish(); const held = await token(f); assert.equal((await f.prepare()).result.status, 'ticket_busy');
    for (let index = 0; index < 3; index++) { await ageSlots(f); await token(f); }
    await ageSlots(f); assert.equal((await f.prepare()).result.status, 'ticket_busy');
    assert.equal(await f.submit(held), 'ticket_recorded'); f.clock.now += 1_001;
    assert.equal((await f.prepare()).result.status, 'ticket_busy'); assert.equal((await f.rows('case_form_slots')).length, 4);
    await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 second'");
    assert.equal(await f.submit(held), 'ticket_form_unavailable'); await token(f);
    assert.equal((await f.rows('case_form_slots')).length, 4); assert.equal((await f.rows('case_intakes')).length, 1);
  });

  await scenario('B09 a guild cannot exceed 128 unexpired form slots and an expired slot can be reused without deleting case content', async f => {
    await f.publish();
    await f.admin.query(`INSERT INTO sophie_core.case_form_slots (guild_id, slot, token, user_id, interaction_id, case_type, form_version,
      case_policy_version, presence_epoch, issued_at, expires_at) SELECT $1, n, lpad(to_hex(n), 48, '0'), (900000000000000000 + n)::text,
      (910000000000000000 + n)::text, 'admin-help', 1, 1, 0, clock_timestamp() - interval '4 seconds', clock_timestamp() + interval '10 minutes'
      FROM generate_series(1, 128) n`, [GUILD]);
    assert.equal((await f.prepare()).result.status, 'ticket_busy'); assert.equal((await f.rows('case_form_slots')).length, 128);
    await f.admin.query("UPDATE sophie_core.case_form_slots SET issued_at = clock_timestamp() - interval '11 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE slot = 17");
    const held = await token(f); assert.equal((await f.rows('case_form_slots')).find(row => row.token === held).slot, 17);
    assert.equal((await f.rows('case_form_slots')).length, 128);
  });

  await scenario('B10 case insertion, intake retention, form consumption, receipt and provisioning intent roll back together', async f => {
    await f.publish(); const held = await token(f);
    for (const table of ['case_intakes', 'outbox', 'receipts']) {
      await f.admin.query(`REVOKE INSERT ON sophie_core.${table} FROM sophie_test_core`);
      try { assert.equal(await f.submit(held), 'unavailable'); }
      finally { await f.admin.query(`GRANT INSERT ON sophie_core.${table} TO sophie_test_core`); }
      for (const retained of ['case_reservations', 'case_intakes', 'outbox', 'receipts']) assert.equal((await f.rows(retained)).length, 0);
      assert.equal((await f.rows('case_form_slots'))[0].consumed_case_id, null);
    }
    assert.equal(await f.submit(held), 'ticket_recorded');
  });

  await scenario('B11 lost current authority at the final check rolls back both publication and intake', async f => {
    let checks = 0;
    const service = caseIntakeServices(f, { authorize: async (...args) => ++checks < 2 && f.authorization.authorize(...args) });
    await assert.rejects(service.publish(), /OPERATION_DENIED/); assert.equal((await f.rows('case_forms')).length, 0);
    await f.publish(); const held = await token(f); checks = 0;
    assert.equal(await service.submit(held), 'denied'); assert.equal((await f.rows('case_intakes')).length, 0);
    assert.equal((await f.rows('case_form_slots'))[0].consumed_case_id, null);
  });

  await scenario('B12 published forms require explicit current authority, immutable versions and atomic retained audit', async f => {
    f.discord.state.members.set(OTHER, [STAFF]); await assert.rejects(f.publish(), /OPERATION_DENIED/);
    f.discord.state.members.set(OTHER, [LEAD]);
    await f.admin.query('REVOKE INSERT ON sophie_core.case_form_actions FROM sophie_test_core');
    try { await assert.rejects(f.publish(), { code: '42501' }); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_form_actions TO sophie_test_core'); }
    assert.equal((await f.rows('case_forms')).length, 0); const publication = await f.publish(); assert.equal((await f.publish()).duplicate, true);
    await assert.rejects(f.publish({ ...syntheticCaseForm(), title: 'Conflicting revision' }), /CASE_FORM_IMMUTABLE/);
    await assert.rejects(f.publish(syntheticCaseForm(), 3), /CASE_FORM_VERSION_STALE/);
    await f.admin.query('REVOKE INSERT ON sophie_core.case_form_actions FROM sophie_test_core');
    try { await assert.rejects(withdraw(f, publication), { code: '42501' }); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_form_actions TO sophie_test_core'); }
    assert.equal((await f.rows('case_forms'))[0].status, 'published'); await withdraw(f, publication); assert.equal((await withdraw(f, publication)).duplicate, true);
    for (const table of ['case_forms', 'case_form_actions', 'case_form_slots', 'case_intakes']) {
      await assert.rejects(cluster.knowledgePool.query(`SELECT * FROM sophie_core.${table}`), { code: '42501' });
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`), { code: '42501' });
    }
    assert.equal((await f.rows('case_form_actions')).length, 2);
  });

  await scenario('B13 Head Admin tickets exclude ordinary Staff and Muzzled members can request ordinary help without earning roles', async f => {
    await f.publish(syntheticCaseForm('head-admin-contact')); f.discord.state.members.set(USER, [MUZZLED]);
    const held = await token(f, 'head-admin-contact'); assert.equal(await f.submit(held), 'ticket_recorded'); await f.drain(f.cases);
    const row = (await f.rows('case_reservations'))[0], channel = f.discord.state.channels.get(row.channel_id);
    assert.equal(channel.permission_overwrites.some(entry => entry.id === STAFF && BigInt(entry.allow) !== 0n), false);
    assert.equal(channel.permission_overwrites.some(entry => entry.id === LEAD && BigInt(entry.allow) !== 0n), true);
    f.discord.state.members.set(OTHER, [STAFF]);
    assert.equal(await f.execute(ticketPayload(f, 'close', row, { member: { user: { id: OTHER } } })), 'denied');
    assert.equal(writes(f).some(call => call.path.includes('/roles/')), false); assert.equal((await f.rows('sessions')).length, 0);
  });

  await scenario('B14 ticket navigation checks current ownership and channel permissions and never grants access from a token', async f => {
    const request = intakeBeginPayload(f, 'quick-help'); assert.equal(await f.executeIntake(request), 'ticket_recorded');
    const initial = await f.intake.destination(f.verified(request)); assert.equal(initial.state, 'preparing');
    const control = statusPayload(f, initial.caseToken); assert.equal((await f.intake.destination(f.verified(statusPayload(f, initial.caseToken, OTHER)))).state, 'unavailable');
    await f.drain(f.cases); assert.equal((await f.intake.destination(f.verified(control))).state, 'ready');
    const row = (await f.rows('case_reservations'))[0], channel = f.discord.state.channels.get(row.channel_id), saved = structuredClone(channel.permission_overwrites);
    channel.permission_overwrites = []; assert.equal((await f.intake.destination(f.verified(control))).state, 'unavailable'); channel.permission_overwrites = saved;
    await assert.rejects(f.intakeStore.confirmTicketDestination({ actor: await f.actor(), observation: await observe(f), caseToken: initial.caseToken, proof: {} }));
    assert.equal(await f.execute(ticketPayload(f, 'close', row, { member: { user: { id: OTHER } } })), 'case_change_recorded');
    assert.equal((await f.intake.destination(f.verified(control))).state, 'closed');
    f.discord.state.members.delete(USER); assert.equal((await f.intake.destination(f.verified(control))).state, 'denied');
  });

  await scenario('B15 tickets and Shuttle share current case capacity; failing admission leaves no form, intake or extra outbox job', async f => {
    await f.publish(); const quick = () => f.executeIntake(intakeBeginPayload(f, 'quick-help'));
    assert.equal(await quick(), 'ticket_recorded'); assert.equal(await quick(), 'ticket_busy'); f.clock.now += 1_001;
    assert.equal(await quick(), 'ticket_recorded'); f.clock.now += 1_001;
    assert.equal((await f.prepare()).result.status, 'ticket_busy'); assert.equal(await f.execute(f.payload()), 'shuttle_busy');
    assert.equal((await f.rows('case_form_slots')).length, 0); assert.equal((await f.rows('case_intakes')).length, 2);
    assert.deepEqual((await f.rows('outbox')).map(row => row.kind).sort(), ['case.intake', 'case.intake', 'case.provision', 'case.provision']);
  });

  await scenario('B16 private answers stay out of routing, receipts, outbox, navigation and wire errors', async f => {
    await f.publish(); const held = await token(f), values = syntheticCaseValues(), canary = randomBytes(48).toString('hex'); values[0].value = canary;
    const request = intakeSubmitPayload(f, held, values), envelope = f.verified(request);
    assert.equal(JSON.stringify(envelope).includes(canary), false); assert.equal(await f.commands.execute(envelope), 'ticket_recorded');
    assert.equal((await f.rows('case_intakes'))[0].answers[0].value === canary, true);
    for (const table of ['receipts', 'outbox', 'case_form_slots', 'case_form_actions']) assert.equal(JSON.stringify(await f.rows(table)).includes(canary), false);
    assert.equal(JSON.stringify(await f.intake.destination(f.verified(request))).includes(canary), false);
    assert.equal(JSON.stringify(f.discord.state.calls).includes(canary), false);
  });

  async function withHttp(f, work, options = {}) {
    const replies = [], faults = [], responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION,
      clock: () => f.clock.now, enabled: () => f.clock.enabled, caseIntake: f.intake,
      fetch: async (url, request) => { assert.equal(new URL(url).hostname, 'discord.com'); replies.push(JSON.parse(request.body)); return new Response('{}', { status: 200 }); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.commands, caseIntake: f.intake,
      respond: responder.respond, enabled: () => f.clock.enabled, onFault: code => faults.push(code), ...options });
    try {
      const address = await server.listen();
      const post = async (payload, headers = {}) => {
        const signed = f.identities.signed(payload), response = await fetch(`http://${address.host}:${address.port}/discord/interactions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature,
            'X-Signature-Timestamp': signed.timestamp, ...headers }, body: signed.body, signal: AbortSignal.timeout(5_000) });
        return { status: response.status, body: await response.json() };
      };
      await work({ post, server, replies, faults });
    } finally { await server.close(); }
  }

  await scenario('B17 signed loopback ingress opens a modal as its initial response and submission defers before private navigation', async f => {
    await f.publish(); await withHttp(f, async ({ post, server, replies, faults }) => {
      const opened = await post(intakeBeginPayload(f)); assert.equal(opened.status, 200); assert.equal(opened.body.type, 9); assert.equal(replies.length, 0);
      const held = opened.body.data.custom_id.split(':').at(-1), submitted = await post(intakeSubmitPayload(f, held));
      assert.deepEqual(submitted.body, { type: 5, data: { flags: 64 } }); await server.drain();
      assert.equal(replies.length, 1); assert.match(replies[0].content, /recorded/); assert.deepEqual(replies[0].allowed_mentions.parse, []);
      assert.equal(replies[0].components[0].components[0].custom_id.startsWith('sophie:ticket:v1:status:'), true);
      assert.equal((await post(intakeBeginPayload(f), { 'X-Signature-Ed25519': '00'.repeat(64) })).status, 401);
      const malformed = intakeSubmitPayload(f, held); malformed.data.resolved = {}; assert.equal((await post(malformed)).status, 400);
      assert.equal((await f.rows('case_intakes')).length, 1); assert.deepEqual(faults, []);
    });
  });

  await scenario('B18 a modal deadline returns a bounded failure while late work holds capacity and cannot create a case or follow-up', async f => {
    await f.publish(); let release, entered;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    await withHttp(f, async ({ post, server, replies }) => {
      try {
        const pending = post(intakeBeginPayload(f)); await started;
        const result = await pending; assert.equal(result.body.type, 4); assert.match(result.body.data.content, /could not be opened/);
        const busy = await post(intakeBeginPayload(f, 'quick-help')); assert.match(busy.body.data.content, /busy/);
        release(); await server.drain(); assert.equal(replies.length, 0);
        for (const table of ['case_form_slots', 'case_intakes', 'outbox']) assert.equal((await f.rows(table)).length, 0);
      } finally { release(); }
    }, { initialBudgetMs: 150, caseIntake: { prepare: async (...args) => { entered(); await gate; return f.intake.prepare(...args); } } });
  });

  await scenario('B19 disabled, missing and faulting modal adapters fail privately without executing the deferred command path', async f => {
    await f.publish();
    f.clock.enabled = false;
    await withHttp(f, async ({ post, replies }) => { const result = await post(intakeBeginPayload(f)); assert.match(result.body.data.content, /disabled/); assert.equal(replies.length, 0); });
    f.clock.enabled = true;
    await withHttp(f, async ({ post, replies }) => { const result = await post(intakeBeginPayload(f)); assert.equal(result.body.type, 4); assert.equal(replies.length, 0); }, { caseIntake: null });
    const canary = randomBytes(48).toString('hex');
    await withHttp(f, async ({ post, replies, faults }) => {
      const result = await post(intakeBeginPayload(f)); assert.equal(result.body.type, 4);
      assert.equal(JSON.stringify({ result, replies, faults }).includes(canary), false); assert.deepEqual(faults, ['INTERACTION_MODAL_UNAVAILABLE']);
    }, { caseIntake: { prepare: async () => { throw new Error(canary); } } });
    assert.equal((await f.rows('case_intakes')).length, 0); assert.equal((await f.rows('case_form_slots')).length, 0);
  });

  await scenario('B20 a slow availability gate is bounded by the modal deadline and cannot start preparation after timing out', async f => {
    await f.publish(); let release, entered, preparations = 0;
    const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
    await withHttp(f, async ({ post, server, replies }) => {
      try {
        const pending = post(intakeBeginPayload(f)); await started;
        const result = await pending; assert.equal(result.body.type, 4); assert.match(result.body.data.content, /could not be opened/);
        assert.match((await post(intakeBeginPayload(f))).body.data.content, /busy/);
        release(); await server.drain(); assert.equal(preparations, 0); assert.equal(replies.length, 0);
        assert.equal((await f.rows('case_form_slots')).length, 0); assert.equal((await f.rows('case_intakes')).length, 0);
      } finally { release(); }
    }, { initialBudgetMs: 150, enabled: async () => { entered(); await gate; return true; },
      caseIntake: { prepare: (...args) => { preparations++; return f.intake.prepare(...args); } } });
  });

  await scenario('B21 an applied commit with a lost acknowledgement resolves by the original receipt without repeating case creation', async f => {
    await f.publish(); const held = await token(f), request = intakeSubmitPayload(f, held); let loseCommit = true;
    const pool = { connect: async () => {
      const client = await f.pool.connect(); return { release: discard => client.release(discard), query: async (...args) => {
        const result = await client.query(...args);
        if (args[0] === 'COMMIT' && loseCommit) { loseCommit = false; throw new Error('SYNTHETIC_COMMIT_ACK_LOST'); }
        return result;
      } };
    } };
    const uncertain = caseIntakeServices({ ...f, pool });
    assert.equal(await uncertain.executeIntake(request), 'unavailable');
    for (const table of ['case_intakes', 'case_reservations', 'case_provisions', 'receipts']) assert.equal((await f.rows(table)).length, 1);
    assert.deepEqual((await f.rows('outbox')).map(row => row.kind).sort(), ['case.intake', 'case.provision']);
    assert.equal(await f.executeIntake(request), 'ticket_recorded');
    for (const table of ['case_intakes', 'case_reservations', 'case_provisions', 'receipts']) assert.equal((await f.rows(table)).length, 1);
    assert.deepEqual((await f.rows('outbox')).map(row => row.kind).sort(), ['case.intake', 'case.provision']);
    assert.equal(writes(f).length, 0);
  });
}
