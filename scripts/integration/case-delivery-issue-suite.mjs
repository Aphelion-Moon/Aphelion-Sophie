import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { caseIssueWorkflow, caseIssueServices, issuePayload, recheckPayload, parkIntake, duplicateOrdinaryCase, ordinaryCasePlan, retainOrdinaryCandidate } from '../../tests/fixtures/case-delivery-issues.js';
import { requireCaseChannel, caseChannelPayload } from '../../modules/tickets/channel-policy.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { intakeBeginPayload, syntheticCaseValues } from '../../tests/fixtures/case-intake.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { recordCaseDeliveryIssue } from '../../apps/core/storage/case-issue-records.js';
import { parkedOnboardingMessage } from '../../tests/fixtures/onboarding-recovery.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { CREW, MUZZLED } from '../../tests/fixtures/discord.js';
import { casePolicy } from '../../tests/fixtures/cases.js';

export async function runCaseDeliveryIssueSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await caseIssueWorkflow(cluster)));
  const posts = f => f.discord.state.calls.filter(call => call.method === 'POST' && /\/messages$/.test(call.path));

  await scenario('Y01 parked intake records one current issue and recovering the exact message permits worker confirmation without another first POST', async f => {
    const { issue, message } = await parkIntake(f), view = await f.issueQueue();
    assert.equal(view.entries.length, 1); assert.equal(view.entries[0].needsMessageId, true); assert.equal(view.entries[0].recheckable, false);
    assert.equal(await f.executeIssue(recheckPayload(f, issue)), 'case_issue_message_needed');
    const request = issuePayload(f, 'recover', issue, message.id);
    assert.equal(await f.executeIssue(request), 'case_recovery_recorded'); assert.equal(posts(f).length, 1);
    assert.equal((await f.rows('case_intake_messages')).filter(row => row.state === 'confirmed').length, 0);
    await f.drain(f.cases); await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3);
    assert.equal((await f.issueQueue()).entries.length, 0); assert.equal((await f.rows('case_delivery_actions')).length, 1);
    const reads = f.discord.state.calls.length; assert.equal(await f.executeIssue(request), 'case_recovery_recorded');
    assert.equal(f.discord.state.calls.slice(reads).some(call => call.path.includes('/messages/')), false);
    assert.equal((await f.rows('case_delivery_actions')).length, 1);
  });

  await scenario('Y02 ordinary Staff cannot list, describe, repair or use a Head Admin cursor, even when the requester is Staff', async f => {
    const { issue, message } = await parkIntake(f, 'head-admin-contact'); f.discord.state.members.set(OTHER, [STAFF]);
    assert.equal((await f.issueQueue()).entries.length, 0); assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'denied');
    const actor = await f.actor(OTHER); await assert.rejects(f.issueStore.listCaseDeliveryIssues({ actor, guildId: GUILD, after: issue.id }), /STALE_CASE_ISSUE_QUEUE/);
    f.discord.state.members.set(USER, [STAFF]); assert.equal(await f.executeIssue(recheckPayload(f, issue, { member: { user: { id: USER } } })), 'denied');
    f.discord.state.members.set(OTHER, [LEAD]); assert.equal((await f.issueQueue()).entries.length, 1);
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_recovery_recorded');
  });

  await scenario('Y03 requester status, copied principals and asserted Administrator permissions cannot grant delivery management', async f => {
    const { issue, message } = await parkIntake(f);
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id, { member: { user: { id: USER }, permissions: '8', roles: [LEAD] } })), 'denied');
    const envelope = f.verified(issuePayload(f)); assert.equal(await f.caseDeliveryIssues.execute({ ...envelope }), 'denied');
    f.discord.state.members.set(OTHER, [CREW]); assert.equal((await f.issueQueue()).state, 'denied');
    assert.equal((await f.rows('case_delivery_actions')).length, 0);
  });

  await scenario('Y04 concurrent duplicate repair commits once and competing stale references cannot requeue it twice', async f => {
    const { issue, message } = await parkIntake(f), request = issuePayload(f, 'recover', issue, message.id), envelope = f.verified(request);
    const actor = await f.actor(OTHER), source = await f.issueStore.describeCaseDeliveryIssue({ actor, guildId: GUILD, issueId: issue.id,
      interactionId: envelope.interactionId, expectedRevision: issue.revision, action: 'adopt_message', resultId: message.id });
    const proof = await f.discord.channels.inspect(source.plan, source.channelId);
    const observed = await f.intakeMessages.inspect({ ...source, messageId: message.id });
    const input = { actor, issueId: issue.id, expectedRevision: issue.revision, action: 'adopt_message', resultId: message.id,
      interactionId: envelope.interactionId, observation: await f.discord.roles.observe(USER), proof, message: observed };
    const results = await Promise.all([f.issueStore.changeCaseDeliveryIssue(input), f.issueStore.changeCaseDeliveryIssue(input)]);
    assert.equal(results.filter(result => result.duplicate).length, 1); assert.equal((await f.rows('case_delivery_actions')).length, 1);
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_issue_stale');
    assert.equal(await f.executeIssue({ ...request, data: { ...request.data, options: [{ type: 1, name: 'choose', options: [
      { type: 3, name: 'issue', value: `${issue.id}.${issue.revision}` }, { type: 3, name: 'channel', value: source.channelId }] }] } }), 'unavailable');
  });

  await scenario('Y05 loss of responder authority at the final check rolls back adoption, audit and requeue together', async f => {
    const { issue, message } = await parkIntake(f); let checks = 0;
    const service = caseIssueServices(f, { authorize: async (...args) => { if (++checks === 2) f.discord.state.members.set(OTHER, [CREW]); return f.authorization.authorize(...args); } });
    const actor = await f.actor(OTHER), request = { actor, guildId: GUILD, issueId: issue.id, interactionId: f.nextId(), expectedRevision: issue.revision, action: 'adopt_message', resultId: message.id };
    const source = await f.issueStore.describeCaseDeliveryIssue(request), proof = await f.discord.channels.inspect(source.plan, source.channelId);
    const observed = await f.intakeMessages.inspect({ ...source, messageId: message.id });
    await assert.rejects(service.issueStore.changeCaseDeliveryIssue({ ...request, observation: await f.discord.roles.observe(USER), proof, message: observed }), /OPERATION_DENIED/);
    assert.equal((await f.rows('case_intake_messages')).find(row => row.ordinal === 1).message_id, null);
    assert.equal((await f.rows('case_delivery_actions')).length, 0); assert.equal((await f.rows('outbox')).find(row => row.kind === 'case.intake').status, 'parked');
  });

  await scenario('Y06 forged, foreign, changed and missing message proofs cannot adopt content or erase an unknown attempt', async f => {
    const { issue, message } = await parkIntake(f), source = structuredClone(message);
    for (const mutate of [value => { value.author.id = USER; }, value => { value.embeds[0].description += ' changed'; },
      value => { value.mention_roles = [STAFF]; }, value => { value.channel_id = OTHER; }]) {
      Object.assign(message, structuredClone(source)); mutate(message);
      assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_recovery_rejected');
    }
    Object.assign(message, source); f.discord.state.messages.delete(message.id);
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_recovery_rejected');
    assert.equal((await f.rows('case_delivery_actions')).length, 0); assert.equal((await f.rows('case_intake_messages')).find(row => row.ordinal === 1).create_started, true);
  });

  await scenario('Y07 changed private permissions prevent message recovery and retain the issue for review', async f => {
    const { issue, message, row } = await parkIntake(f); f.discord.state.channels.get(row.channel_id).permission_overwrites = [];
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_issue_review');
    assert.equal((await f.rows('case_delivery_actions')).length, 0); assert.equal(posts(f).length, 1);
  });

  await scenario('Y08 departure and policy replacement prevent intake recovery while Muzzled alone does not', async f => {
    const { issue, message } = await parkIntake(f); const changed = caseIssueServices(f, { policy: { ...casePolicy, version: 2 } });
    assert.equal(await changed.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_issue_review');
    f.discord.state.members.set(USER, [MUZZLED]); assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_recovery_recorded');
    assert.deepEqual(f.discord.state.members.get(USER), [MUZZLED]);
    f.discord.state.members.delete(USER); await f.drain(f.cases);
    assert.equal((await f.intakeWorker.runOnce('departed-after-repair')).status, 'operator_required');
    const latest = (await f.rows('case_delivery_issues')).find(row => row.id === issue.id); f.discord.state.members.set(USER, [CREW]);
    assert.equal(await f.executeIssue(recheckPayload(f, latest)), 'case_issue_review');
  });

  await scenario('Y09 audit failure rolls back message identity, revision, receipt and worker intent', async f => {
    const { issue, message } = await parkIntake(f), payload = issuePayload(f, 'recover', issue, message.id);
    await f.admin.query('REVOKE INSERT ON sophie_core.case_delivery_actions FROM sophie_test_core');
    try { assert.equal(await f.executeIssue(payload), 'unavailable'); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_delivery_actions TO sophie_test_core'); }
    assert.equal((await f.rows('case_delivery_issues'))[0].revision, issue.revision);
    assert.equal((await f.rows('case_intake_messages')).find(row => row.ordinal === 1).message_id, null); assert.equal((await f.rows('receipts')).some(row => row.interaction_id === payload.id), false);
    assert.equal(await f.executeIssue(payload), 'case_recovery_recorded');
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_delivery_issues'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_delivery_actions'), { code: '42501' });
  });

  await scenario('Y10 an ordinary duplicate-channel choice records intent and only the worker opens it after sealing every other candidate', async f => {
    const { row, original, duplicate, issue } = await duplicateOrdinaryCase(f), plan = await ordinaryCasePlan(f, row);
    const view = await f.issueQueue(); assert.equal(view.entries[0].channelChoice.required, true);
    assert.equal(await f.executeIssue(recheckPayload(f, issue)), 'case_channel_rejected');
    const writes = f.discord.state.calls.filter(call => call.method !== 'GET').length;
    assert.equal(await f.executeIssue(issuePayload(f, 'choose', issue, duplicate.id)), 'case_channel_recorded');
    assert.equal(f.discord.state.calls.filter(call => call.method !== 'GET').length, writes);
    original.permission_overwrites = caseChannelPayload(plan, casePolicy, false).permission_overwrites;
    assert.equal((await f.cases.runOnce('seal-other-before-opening')).status, 'progressed');
    for (const id of [original.id, duplicate.id]) requireCaseChannel(await f.discord.channels.verification.channel(await f.discord.channels.inspect(plan, id), plan, true), plan, casePolicy, true);
    await f.drain(f.cases); assert.equal((await f.rows('case_reservations'))[0].channel_id, duplicate.id);
    requireCaseChannel(await f.discord.channels.verification.channel(await f.discord.channels.inspect(plan, duplicate.id), plan, false), plan, casePolicy, false);
    assert.deepEqual((await f.rows('case_delivery_actions'))[0].candidate_ids, [original.id, duplicate.id].sort());
    await f.drain(f.intakeWorker); assert.equal([...f.discord.state.messages.values()][0].channel_id, duplicate.id);
    assert.equal((await f.rows('case_channels')).length, 2); assert.equal((await f.rows('case_exclusions')).length, 2);
  });

  await scenario('Y11 a previously opened ordinary case keeps its destination and a newly discovered duplicate invalidates an older choice', async f => {
    const { row, original, duplicate, issue } = await duplicateOrdinaryCase(f, { opened: true });
    assert.equal(await f.executeIssue(issuePayload(f, 'choose', issue, duplicate.id)), 'case_channel_rejected');
    assert.equal(await f.executeIssue(issuePayload(f, 'choose', issue, original.id)), 'case_channel_recorded');
    const extra = { ...structuredClone(original), id: f.nextId() }; await retainOrdinaryCandidate(f, row, extra);
    assert.equal((await f.cases.runOnce('another-duplicate')).code, 'CASE_CHANNEL_DUPLICATE');
    assert.equal(await f.executeIssue(issuePayload(f, 'choose', issue, original.id)), 'case_issue_stale');
    const current = (await f.rows('case_delivery_issues')).find(item => item.id === issue.id);
    assert.equal(await f.executeIssue(issuePayload(f, 'choose', current, original.id)), 'case_channel_recorded'); await f.drain(f.cases);
    assert.equal((await f.rows('case_reservations'))[0].channel_id, original.id); assert.equal((await f.rows('case_channels')).length, 3);
  });

  await scenario('Y12 unregistered channels, forged proofs and expired observations cannot authorize ordinary candidate selection', async f => {
    const { row, duplicate, issue } = await duplicateOrdinaryCase(f), before = f.discord.state.calls.length;
    assert.equal(await f.executeIssue(issuePayload(f, 'choose', issue, OTHER)), 'case_channel_rejected');
    assert.equal(f.discord.state.calls.slice(before).some(call => call.path === `/api/v10/channels/${OTHER}`), false);
    const input = { actor: await f.actor(OTHER), interactionId: f.nextId(), issueId: issue.id, expectedRevision: issue.revision,
      action: 'select_channel', resultId: duplicate.id, observation: await f.discord.roles.observe(USER) };
    await assert.rejects(f.issueStore.changeCaseDeliveryIssue({ ...input, proof: { channelId: duplicate.id } }), /CASE_OBSERVATION_UNTRUSTED/);
    const proof = await f.discord.channels.inspect(await ordinaryCasePlan(f, row), duplicate.id); f.clock.now += 6_000;
    await assert.rejects(f.issueStore.changeCaseDeliveryIssue({ ...input, observation: await f.discord.roles.observe(USER), proof }), /MEMBERSHIP_STALE/);
    assert.equal((await f.rows('case_delivery_actions')).length, 0);
  });

  await scenario('Y13 a recheck resets only the parked job budget and preserves global pauses, cooldowns and possible effects', async f => {
    await f.openTicket('quick-help'); f.discord.state.roles.find(role => role.id === STAFF).mentionable = false;
    assert.equal((await f.intakeWorker.runOnce('blocked-notice')).code, 'STAFF_MENTION_UNAVAILABLE');
    const issue = (await f.rows('case_delivery_issues'))[0], before = (await f.rows('outbox')).find(row => row.kind === 'case.intake');
    await f.outbox.pauseDiscordDelivery(); await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = clock_timestamp() + interval '1 hour'");
    const barrier = (await f.rows('discord_backoff'))[0]; assert.equal(await f.executeIssue(recheckPayload(f, issue)), 'case_issue_recorded');
    const after = (await f.rows('outbox')).find(row => row.kind === 'case.intake');
    assert.deepEqual(after.effect, before.effect); assert.equal(after.dispatch_started, before.dispatch_started); assert.equal(after.fence, before.fence + 1); assert.equal(after.attempts, 0);
    assert.deepEqual((await f.rows('discord_backoff'))[0], barrier); assert.equal((await f.intakeWorker.runOnce('still-paused')).status, 'idle');
    f.discord.state.roles.find(role => role.id === STAFF).mentionable = true;
    await f.admin.query("UPDATE sophie_core.discord_backoff SET paused = false, until_at = '-infinity'"); await f.drain(f.intakeWorker);
    assert.equal(posts(f).length, 1);
  });

  await scenario('Y14 delivery review and audit carry references only and do not expose retained questions or answers', async f => {
    const values = syntheticCaseValues(), canary = randomBytes(32).toString('hex'); values[0].value = canary;
    await f.openTicket('admin-help', values); f.discord.state.roles.find(role => role.id === STAFF).mentionable = false;
    assert.equal((await f.intakeWorker.runOnce('canary-first')).status, 'progressed'); assert.equal((await f.intakeWorker.runOnce('canary-second')).status, 'progressed');
    assert.equal((await f.intakeWorker.runOnce('canary-notice')).status, 'operator_required');
    const issue = (await f.rows('case_delivery_issues'))[0], actor = await f.actor(OTHER);
    const source = await f.issueStore.describeCaseDeliveryIssue({ actor, guildId: GUILD, issueId: issue.id, interactionId: f.nextId(), expectedRevision: issue.revision, action: 'recheck' });
    assert.equal(JSON.stringify([source, await f.issueQueue()]).includes(canary), false);
    assert.equal(await f.executeIssue(recheckPayload(f, issue)), 'case_issue_recorded');
    for (const table of ['case_delivery_issues', 'case_delivery_actions', 'outbox', 'receipts']) assert.equal(JSON.stringify(await f.rows(table)).includes(canary), false);
    assert.equal((await f.rows('shuttle_delivery_issues')).length, 0); assert.equal((await f.rows('shuttle_alerts')).length, 0);
  });

  await scenario('Y15 queue pagination preserves PostgreSQL timestamp precision and excludes unauthorized Head Admin boundaries', async f => {
    await parkIntake(f); const reservation = (await f.rows('case_reservations'))[0];
    for (let index = 0; index < 7; index++) {
      const id = `synthetic-case-inspection-${index}`;
      await f.admin.query(`INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect, status, fence, attempts, last_error_code)
        VALUES ($1,$2,$3,'case.provision',$4,'parked',1,1,'ATTEMPT_LIMIT')`, [GUILD, id, USER,
      { kind: 'case.provision', guildId: GUILD, userId: USER, operationId: id, caseId: reservation.id, type: reservation.type }]);
      await f.admin.query(`INSERT INTO sophie_core.case_delivery_issues (id, guild_id, operation_id, user_id, case_id, parked_fence, created_at)
        VALUES ($1,$2,$3,$4,$5,1,'2026-01-01 00:00:00.123456+00'::timestamptz + $6 * interval '1 microsecond')`,
      [String(index).padStart(32, '0'), GUILD, id, USER, reservation.id, index]);
    }
    const actor = await f.actor(OTHER), first = await f.issueStore.listCaseDeliveryIssues({ actor, guildId: GUILD });
    const second = await f.issueStore.listCaseDeliveryIssues({ actor, guildId: GUILD, after: first.next });
    assert.equal(first.entries.length, 5); assert.equal(second.entries.length, 3); assert.equal(second.next, null);
    assert.equal(new Set([...first.entries, ...second.entries].map(row => row.issueId)).size, 8);
    await assert.rejects(f.issueStore.listCaseDeliveryIssues({ actor, guildId: GUILD, after: 'f'.repeat(32) }), /STALE_CASE_ISSUE_QUEUE/);
  });

  await scenario('Y16 signed loopback review and repair acknowledge privately and reauthorize each rendered queue response', async f => {
    const { issue, message } = await parkIntake(f), replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION, clock: () => f.clock.now,
      enabled: () => f.clock.enabled, caseDeliveryIssues: f.caseDeliveryIssues, fetch: async (_, value) => { replies.push(JSON.parse(value.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.issueCommands, respond: responder.respond,
      enabled: () => f.clock.enabled, onFault: code => faults.push(code) }); const address = await server.listen();
    async function send(payload) {
      const signed = f.identities.signed(payload), response = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST', body: signed.body,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
      assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
    }
    try {
      await send(issuePayload(f)); assert.equal(replies[0].embeds.length, 1); assert.equal(replies[0].components[0].components[0].disabled, true);
      await send(issuePayload(f, 'recover', issue, message.id)); assert.equal((await f.rows('case_delivery_actions')).length, 1);
      const envelope = f.verified(issuePayload(f)); assert.equal(await f.issueCommands.execute(envelope), 'case_issue_queue');
      f.discord.state.members.set(OTHER, [CREW]); await responder.respond(envelope, 'case_issue_queue'); assert.deepEqual(replies.at(-1).embeds, []);
      assert.equal(replies.at(-1).content.includes(issue.id), false); for (const reply of replies) assert.deepEqual(reply.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
      assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });

  await scenario('Y17 issue persistence failure rolls back parking instead of silently losing operator review', async f => {
    await f.openTicket('quick-help'); const claim = (await f.outbox.claim('issue-atomicity', 30_000, ['case.intake'])).claim;
    await f.admin.query('REVOKE INSERT ON sophie_core.case_delivery_issues FROM sophie_test_core');
    try { await assert.rejects(f.outbox.park(claim, 'STAFF_MENTION_UNAVAILABLE'), { code: '42501' }); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_delivery_issues TO sophie_test_core'); }
    assert.equal((await f.rows('outbox')).find(row => row.kind === 'case.intake').status, 'leased'); assert.equal((await f.rows('case_delivery_issues')).length, 0);
    await f.outbox.park(claim, 'STAFF_MENTION_UNAVAILABLE'); assert.equal((await f.rows('case_delivery_issues')).length, 1);
  });

  await scenario('Y18 migration backfills only retained ordinary parked sources without inventing actions or altering possible effects', async f => {
    const { issue } = await parkIntake(f), before = (await f.rows('outbox')).find(row => row.operation_id === issue.operation_id), client = await f.admin.connect();
    try {
      await client.query('BEGIN'); await client.query('DROP TABLE sophie_core.case_delivery_actions; DROP TABLE sophie_core.case_delivery_issues');
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/023-case-delivery-issues.sql', import.meta.url), 'utf8'));
      const issues = (await client.query('SELECT * FROM sophie_core.case_delivery_issues')).rows;
      assert.equal(issues.length, 1); assert.equal(issues[0].operation_id, issue.operation_id); assert.equal(issues[0].parked_fence, issue.parked_fence);
      assert.equal((await client.query('SELECT * FROM sophie_core.case_delivery_actions')).rowCount, 0);
      assert.deepEqual((await client.query('SELECT * FROM sophie_core.outbox WHERE operation_id = $1', [issue.operation_id])).rows[0], before);
    } finally { await client.query('ROLLBACK'); client.release(); }
    assert.equal((await f.rows('case_delivery_issues'))[0].id, issue.id);
  });

  await scenario('Y19 closure blocks pending answer recovery while preserving the original case and intake', async f => {
    const { issue, row, message } = await parkIntake(f);
    assert.equal(await f.caseLifecycle.execute(f.verified(ticketPayload(f, 'close', row, { member: { user: { id: OTHER } } }))), 'case_change_recorded');
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_issue_review');
    await f.drain(f.cases); assert.equal((await f.rows('case_reservations'))[0].state, 'closed');
    assert.equal((await f.issueQueue()).entries[0].recheckable, false); assert.equal((await f.rows('case_intakes')).length, 1); assert.equal(posts(f).length, 1);
  });

  await scenario('Y20 a recovered job that parks again advances its issue revision and rejects old controls while exact receipts still replay', async f => {
    const { issue, message } = await parkIntake(f), request = issuePayload(f, 'recover', issue, message.id);
    assert.equal(await f.executeIssue(request), 'case_recovery_recorded');
    assert.equal((await f.intakeWorker.runOnce('confirmed-recovered-part')).status, 'progressed');
    f.discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) { f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_SECOND_LOSS'); } };
    assert.equal((await f.intakeWorker.runOnce('lost-next-part')).status, 'retry_scheduled'); await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
    assert.equal((await f.intakeWorker.runOnce('park-next-part')).status, 'operator_required');
    const current = (await f.rows('case_delivery_issues')).find(row => row.id === issue.id); assert.ok(current.revision > issue.revision);
    assert.equal(await f.executeIssue(recheckPayload(f, issue)), 'case_issue_stale'); assert.equal(await f.executeIssue(request), 'case_recovery_recorded');
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', current, [...f.discord.state.messages.values()].at(-1).id)), 'case_recovery_recorded');
    await f.drain(f.cases); await f.drain(f.intakeWorker); assert.equal(posts(f).length, 3); assert.equal((await f.rows('case_delivery_actions')).length, 2);
  });

  await scenario('Y21 a lost commit acknowledgement resolves from its exact receipt without repeating recovery or inventing a new action', async f => {
    const { issue, message } = await parkIntake(f), payload = issuePayload(f, 'recover', issue, message.id); let armed = false, lost = false;
    const pool = { connect: async () => {
      const client = await f.pool.connect(); return { release: discard => client.release(discard), query: async (...args) => {
        const result = await client.query(...args); if (String(args[0]).includes('INSERT INTO sophie_core.case_delivery_actions')) armed = true;
        if (args[0] === 'COMMIT' && armed && !lost) { lost = true; throw new Error('SYNTHETIC_RECOVERY_COMMIT_ACK_LOST'); } return result;
      } };
    } };
    const uncertain = caseIssueServices({ ...f, pool }); assert.equal(await uncertain.executeIssue(payload), 'unavailable'); assert.equal(lost, true);
    assert.equal((await f.rows('case_delivery_actions')).length, 1); assert.equal((await f.rows('case_intake_messages')).find(row => row.ordinal === 1).message_id, message.id);
    assert.equal(await f.executeIssue(payload), 'case_recovery_recorded'); assert.equal((await f.rows('case_delivery_actions')).length, 1); assert.equal(posts(f).length, 1);
  });

  await scenario('Y22 requeue advances the fence and old workers or controls cannot mutate a currently leased repair', async f => {
    const { issue, message } = await parkIntake(f), stale = { guildId: GUILD, operationId: issue.operation_id, owner: 'uncertain-intake', fence: issue.parked_fence };
    assert.equal(await f.executeIssue(issuePayload(f, 'recover', issue, message.id)), 'case_recovery_recorded');
    const current = await f.outbox.claim('fresh-recovery-worker', 30_000, ['case.intake']); assert.ok(current.claim.fence > stale.fence);
    await assert.rejects(f.outbox.renew(stale), /OUTBOX_LEASE_LOST/);
    await assert.rejects(f.intakeDeliveryStore.inspectCaseIntake({ claim: stale, observation: await f.discord.roles.observe(USER) }), /OUTBOX_LEASE_LOST/);
    assert.equal(await f.executeIssue(recheckPayload(f, issue)), 'case_issue_stale'); assert.equal((await f.issueQueue()).entries.length, 0);
    assert.equal((await f.rows('outbox')).find(row => row.kind === 'case.intake').status, 'leased'); assert.equal(posts(f).length, 1);
  });

  await scenario('Y23 ordinary issue registration excludes Shuttle and unbound outbox jobs and cannot expose their handles', async f => {
    await parkIntake(f); f.clock.now += 1_001;
    await parkedOnboardingMessage(f); assert.equal((await f.rows('case_delivery_issues')).length, 1); assert.equal((await f.rows('shuttle_delivery_issues')).length, 1);
    const operationId = 'synthetic-unbound-intake', effect = { kind: 'case.intake', guildId: GUILD, userId: USER, operationId, caseId: 'synthetic-missing-case' };
    await f.admin.query(`INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect, status, fence, attempts, last_error_code)
      VALUES ($1,$2,$3,'case.intake',$4,'parked',1,1,'ATTEMPT_LIMIT')`, [GUILD, operationId, USER, effect]);
    await recordCaseDeliveryIssue(f.admin, { guildId: GUILD, operationId }); assert.equal((await f.rows('case_delivery_issues')).length, 1);
    assert.equal((await f.issueQueue()).entries.length, 1);
    assert.equal(await f.executeIssue(recheckPayload(f, (await f.rows('shuttle_delivery_issues'))[0])), 'denied');
  });
}
