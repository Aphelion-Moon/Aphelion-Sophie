import assert from 'node:assert/strict';
import { replyWorkflow, replyServices, replyRecoveryServices } from '../../tests/fixtures/case-replies.js';
import { issuePayload, recheckPayload } from '../../tests/fixtures/case-delivery-issues.js';
import { caseIssueQueueReply } from '../../modules/tickets/delivery-issues.js';
import { enqueue } from '../../apps/core/storage/outbox.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { ContractError } from '../../contracts/validation.js';
import { createCaseReplyDispatcher } from '../../apps/core/discord/case-reply-dispatcher.js';
import { createCaseReplyCommands } from '../../apps/core/discord/case-reply-commands.js';
import { createCaseReplies } from '../../apps/core/storage/case-replies.js';
import { createCaseRepliesHttp } from '../../apps/core/http/case-replies.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { CREW } from '../../tests/fixtures/discord.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { createCuratedAnswers } from '../../apps/core/storage/curated-answers.js';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';
import { randomBytes } from 'node:crypto';

export async function runCaseRepliesSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await replyWorkflow(cluster)));
  const posts = f => f.discord.state.calls.filter(call => call.method === 'POST' && call.path.endsWith('/messages'));
  const deletes = f => f.discord.state.calls.filter(call => call.method === 'DELETE' && call.path.includes('/messages/'));
  const reply = async f => (await f.rows('case_replies'))[0];
  const jobs = async f => (await f.rows('outbox')).filter(row => row.kind === 'case.reply');
  async function publication(f, pool = f.pool) {
    const answers = createCuratedAnswers({ pool, authorize: f.authorization.authorize, guildId: GUILD }), actor = f.request().actor;
    let number = 0;
    const change = async (action = 'publish', expectedRevision = 0) => {
      const fields = { name: 'synthetic-help', expectedRevision, action, document: action === 'publish' ?
        { title: 'Synthetic approved help', text: 'Synthetic approved public reply @everyone', source: 'Synthetic public guide' } : null };
      const review = await answers.review({ actor, ...fields });
      return answers.change({ actor, ...fields, requestId: (++number).toString(16).padStart(64,'0'), reviewSha256: review.reviewSha256, confirmed: true, approvedPublic: true });
    };
    await change(); const entry = await answers.lookup({ actor, name: 'synthetic-help' });
    const reference = { name: entry.name, revision: entry.revision, sha256: entry.sha256 };
    return { answers, change, reference, request: f.request({ text: entry.document.text, answer: reference }) };
  }
  const reviewRequest = (f, changes = {}) => ({ actor: f.request().actor, channelId: f.opened.channel_id,
    expectedVersion: f.opened.version, name: 'synthetic-help', requestId: 'd'.repeat(64), ...changes });
  const arm = async f => {
    await f.replies.request(f.request()); const { claim } = await f.outbox.claim('reply-test', 30000, ['case.reply']);
    const state = await f.delivery.inspect({ claim, observation: await f.discord.roles.observe(USER) });
    const prepared = await f.messages.prepare(state.plan, state.channelId);
    const write = await f.delivery.begin({ claim, observation: prepared.observation, proof: prepared.proof });
    return { claim, state, prepared, write };
  };
  await scenario('CR01 a retained request atomically queues metadata-only work and exact retry returns one attributed reply', async f => {
    const saved = await f.replies.request(f.request()); assert.equal(saved.state, 'pending');
    assert.deepEqual(await f.replies.request(f.request()), { ...saved, duplicate: true });
    await assert.rejects(f.replies.request(f.request({ text: 'Different synthetic reply' })), /CASE_REPLY_REQUEST_COLLISION/);
    assert.equal((await f.rows('case_replies')).length, 1); assert.equal((await jobs(f)).length, 1);
    assert.equal(JSON.stringify(await jobs(f)).includes(f.request().text), false);
    const page = await f.replies.read({ actor: f.request().actor, channelId: f.opened.channel_id });
    assert.equal(page.entries[0].authorId, OTHER); assert.equal(page.entries[0].text, f.request().text); assert.equal(page.entries[0].delivery, 'pending');
    assert.deepEqual(await f.worker.runOnce('reply-worker'), { status: 'settled', confirmed: true });
    assert.equal((await reply(f)).state, 'confirmed'); assert.equal(posts(f).length, 1);
    const message = f.discord.state.messages.get((await reply(f)).message_id);
    assert.equal(message.embeds[0].title, `Staff reply · user ${OTHER}`); assert.equal(message.embeds[0].description, f.request().text);
    assert.deepEqual(message.mention_roles, []); assert.equal((await f.worker.runOnce('reply-worker')).status, 'idle');
    assert.deepEqual((await f.rows('case_reply_events')).map(row => row.event), ['requested','send-started','receipt','confirmed']);
  });
  await scenario('CR02 members and ordinary Staff on Head Admin contacts cannot read or request replies', async f => {
    const member = await f.actor(USER);
    await assert.rejects(f.replies.request(f.request({ actor: member })), /CASE_ACCESS_DENIED/);
    await assert.rejects(f.replies.read({ actor: member, channelId: f.opened.channel_id }), /CASE_ACCESS_DENIED/);
    f.discord.state.members.set(OTHER, [STAFF]); const staff = await f.actor(OTHER);
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact' WHERE id = $1", [f.opened.id]);
    await assert.rejects(f.replies.request(f.request({ actor: staff })), /CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_replies')).length, 0);
  });
  await scenario('CR03 authority loss at the final check rolls back text, audit and outbox together', async f => {
    let calls = 0;
    const service = replyServices(f, { authorize: async (...args) => { const allowed = await f.authorization.authorize(...args);
      if (++calls === 2) f.discord.state.members.set(OTHER, []); return allowed; } }).replies;
    await assert.rejects(service.request(f.request()), /CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_replies')).length, 0); assert.equal((await f.rows('case_reply_events')).length, 0); assert.equal((await jobs(f)).length, 0);
  });
  await scenario('CR04 stale reviewed versions and closed cases reject new sends while authorized closed history remains readable', async f => {
    await assert.rejects(f.replies.request(f.request({ expectedVersion: f.opened.version + 1 })), /STALE_CASE_VERSION/);
    const saved = await f.replies.request(f.request());
    await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed', version = version + 1 WHERE id = $1", [f.opened.id]);
    assert.deepEqual(await f.replies.request(f.request()), { ...saved, duplicate: true });
    await assert.rejects(f.replies.request(f.request({ requestId: 'b'.repeat(64) })), /CASE_ACCESS_DENIED/);
    assert.equal((await f.replies.read({ actor: f.request().actor, channelId: f.opened.channel_id })).canReply, false);
    await f.worker.runOnce('reply-worker'); assert.equal((await reply(f)).state, 'cancelled'); assert.equal(posts(f).length, 0);
  });
  await scenario('CR05 concurrent exact submissions serialize to one receipt; cadence and pending capacity remain bounded', async f => {
    const result = await Promise.all([f.replies.request(f.request()), f.replies.request(f.request())]);
    assert.equal(result[0].id, result[1].id); assert.equal(result.filter(row => row.duplicate).length, 1);
    await assert.rejects(f.replies.request(f.request({ requestId: 'b'.repeat(64) })), /CASE_REPLY_LIMIT/);
    for (let i = 2; i <= 5; i++) { f.clock.now += 3000; await f.replies.request(f.request({ requestId: String(i).padStart(64, '0') })); }
    f.clock.now += 3000; await assert.rejects(f.replies.request(f.request({ requestId: 'b'.repeat(64) })), /CASE_REPLY_LIMIT/);
    await f.worker.runOnce('reply-worker'); await f.replies.request(f.request({ requestId: 'b'.repeat(64) }));
    assert.equal((await f.rows('case_replies')).length, 6);
  });
  await scenario('CR06 losing Staff authority cancels an unsent request permanently, even after role restoration', async f => {
    await f.replies.request(f.request()); f.discord.state.members.set(OTHER, []);
    await f.worker.runOnce('reply-worker'); assert.equal((await reply(f)).state, 'cancelled');
    f.discord.state.members.set(OTHER, [LEAD]); const actor = await f.actor(OTHER);
    assert.equal((await f.replies.request(f.request({ actor }))).state, 'cancelled'); assert.equal(posts(f).length, 0);
  });
  await scenario('CR07 a late known send after Staff revocation is withdrawn while authored text and the audit remain retained', async f => {
    await f.replies.request(f.request());
    f.discord.state.afterWrite = async call => { if (call.method === 'POST' && call.path.endsWith('/messages')) f.discord.state.members.set(OTHER, []); };
    assert.deepEqual(await f.worker.runOnce('reply-worker'), { status: 'settled', withdrawn: true });
    const retained = await reply(f); assert.equal(retained.state, 'withdrawn'); assert.equal(retained.body, f.request().text);
    assert.equal(f.discord.state.messages.has(retained.message_id), false); assert.equal(deletes(f).length, 1);
    assert.deepEqual((await f.rows('case_reply_events')).map(row => row.event), ['requested','send-started','receipt','withdrawal-required','withdrawn']);
  });
  await scenario('CR08 closing during POST withdraws the known late reply without deleting the ticket or retained request', async f => {
    await f.replies.request(f.request());
    f.discord.state.afterWrite = async call => { if (call.method === 'POST' && call.path.endsWith('/messages'))
      await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed' WHERE id = $1", [f.opened.id]); };
    assert.equal((await f.worker.runOnce('reply-worker')).withdrawn, true); assert.equal((await reply(f)).withdrawal_reason, 'case-changed');
    assert.equal((await f.rows('case_reservations')).length, 1); assert.equal((await f.rows('case_replies')).length, 1);
  });
  await scenario('CR09 changed channel ACL blocks first send and cancels the retained request without a message POST', async f => {
    await f.replies.request(f.request()); f.discord.state.channels.get(f.opened.channel_id).permission_overwrites = [];
    assert.equal((await f.worker.runOnce('reply-worker')).withdrawing, true);
    await f.worker.runOnce('reply-worker'); assert.equal((await reply(f)).state, 'cancelled'); assert.equal(posts(f).length, 0);
  });
  await scenario('CR10 ACL drift during POST records compensation and removes only the known own reply on the next pass', async f => {
    await f.replies.request(f.request());
    const otherMessage = '800000000000000123'; f.discord.state.messages.set(otherMessage, { id: otherMessage, content: 'Unrelated synthetic message' });
    f.discord.state.afterWrite = async call => { if (call.method === 'POST' && call.path.endsWith('/messages')) f.discord.state.channels.get(f.opened.channel_id).permission_overwrites = []; };
    assert.equal((await f.worker.runOnce('reply-worker')).withdrawing, true);
    const restarted = replyServices(f, { authorizeRecorded() { throw new Error('Withdrawal must not require the original author grant'); } });
    assert.equal((await restarted.worker.runOnce('reply-restarted')).withdrawn, true); assert.equal(f.discord.state.messages.has(otherMessage), true);
    assert.equal(posts(f).length, 1); assert.equal(deletes(f).length, 1);
  });
  await scenario('CR11 confirmed historical replies are not retroactively withdrawn when their author loses Staff', async f => {
    const saved = await f.replies.request(f.request()); await f.worker.runOnce('reply-worker');
    f.discord.state.members.set(OTHER, []);
    await enqueue(f.pool, { kind: 'case.reply', operationId: `reply.recheck.${saved.id}`, guildId: GUILD, userId: USER, caseId: f.opened.id, replyId: saved.id });
    await f.worker.runOnce('reply-worker'); assert.equal((await reply(f)).state, 'confirmed'); assert.equal(deletes(f).length, 0); assert.equal(posts(f).length, 1);
  });
  await scenario('CR12 a lost POST response parks the possible send and a fresh worker never blindly repeats it', async f => {
    await f.replies.request(f.request()); f.discord.state.afterWrite = async call => { if (call.method === 'POST' && call.path.endsWith('/messages')) throw new Error('synthetic lost response'); };
    assert.equal((await f.worker.runOnce('reply-worker')).code, 'DELIVERY_UNCERTAIN'); await f.makeReady();
    f.discord.state.afterWrite = null;
    assert.equal((await replyServices(f).worker.runOnce('reply-restarted')).code, 'CASE_REPLY_UNCERTAIN');
    assert.equal((await jobs(f))[0].status, 'parked'); assert.equal(posts(f).length, 1);
    assert.equal((await f.replies.read({ actor: f.request().actor, channelId: f.opened.channel_id })).entries[0].delivery, 'uncertain');
  });
  await scenario('CR13 a known late receipt after lease takeover schedules current-policy compensation and cannot authorize confirmation', async f => {
    const held = await arm(f), proof = await f.messages.create(held.prepared, held.write);
    await f.admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = 'case.reply'");
    assert.equal((await f.worker.runOnce('reply-takeover')).code, 'CASE_REPLY_UNCERTAIN');
    f.discord.state.members.set(OTHER, []);
    await f.delivery.note({ claim: held.claim, proof });
    assert.equal((await f.worker.runOnce('reply-late')).withdrawn, true); assert.equal((await reply(f)).state, 'withdrawn'); assert.equal(posts(f).length, 1);
  });
  await scenario('CR14 fabricated receipts and channel proofs cannot arm or adopt a reply', async f => {
    const held = await arm(f), proof = await f.messages.create(held.prepared, held.write);
    await assert.rejects(f.delivery.note({ claim: held.claim, proof: { ...proof } }), /SHUTTLE_MESSAGE_UNTRUSTED/);
    assert.equal((await reply(f)).message_id, null);
    await f.delivery.note({ claim: held.claim, proof });
    const current = await f.messages.prepare(held.state.plan, held.state.channelId);
    await assert.rejects(f.delivery.confirm({ claim: held.claim, observation: current.observation, proof: { ...current.proof }, message: proof }), /CASE_OBSERVATION_UNTRUSTED/);
    assert.equal((await reply(f)).state, 'pending');
  });
  await scenario('CR15 a definite rate-limit refusal releases the unsent attempt and honors the shared Discord barrier', async f => {
    await f.replies.request(f.request()); f.discord.state.before = async call => call.method === 'POST' && call.path.endsWith('/messages') ?
      new Response(JSON.stringify({ retry_after: 1, global: true }), { status: 429 }) : null;
    assert.equal((await f.worker.runOnce('reply-worker')).code, 'RATE_LIMITED'); assert.equal((await reply(f)).create_started, false);
    assert.equal((await f.worker.runOnce('reply-worker')).status, 'idle');
    f.discord.state.before = null; f.clock.now += 2000;
    await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = clock_timestamp() - interval '1 second'"); await f.makeReady();
    assert.equal((await f.worker.runOnce('reply-worker')).confirmed, true); assert.equal(f.discord.state.messages.size, 1);
  });
  await scenario('CR16 lost withdrawal response recovers through absence without repeating DELETE or losing retained text', async f => {
    await f.replies.request(f.request());
    f.discord.state.afterWrite = async call => {
      if (call.method === 'POST' && call.path.endsWith('/messages')) f.discord.state.members.set(OTHER, []);
      if (call.method === 'DELETE' && call.path.includes('/messages/')) throw new Error('synthetic lost deletion response');
    };
    assert.equal((await f.worker.runOnce('reply-worker')).code, 'DELIVERY_UNCERTAIN'); await f.makeReady(); f.discord.state.afterWrite = null;
    assert.equal((await f.worker.runOnce('reply-worker')).withdrawn, true); assert.equal(deletes(f).length, 1); assert.equal((await reply(f)).body, f.request().text);
  });
  await scenario('CR17 an outbox insert failure rolls back the reply and its audit instead of leaving orphaned text', async f => {
    await f.admin.query("ALTER TABLE sophie_core.outbox ADD CONSTRAINT synthetic_reply_failure CHECK (kind <> 'case.reply')");
    try { await assert.rejects(f.replies.request(f.request()), { code: '23514' }); }
    finally { await f.admin.query('ALTER TABLE sophie_core.outbox DROP CONSTRAINT synthetic_reply_failure'); }
    assert.equal((await f.rows('case_replies')).length, 0); assert.equal((await f.rows('case_reply_events')).length, 0);
  });
  await scenario('CR18 pending replies are core-only; runtime deletion and knowledge reads are denied, control history excludes text', async f => {
    await f.replies.request(f.request());
    await assert.rejects(cluster.knowledgePool.query('SELECT body FROM sophie_core.case_replies'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_replies'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_reply_events'), { code: '42501' });
    const controls = (await f.admin.query('SELECT control_key, before_state, after_state FROM sophie_control.events')).rows;
    assert.equal(JSON.stringify(controls).includes(f.request().text), false);
  });
  await scenario('CR19 a missing known message parks without recreation while changed bot text requires withdrawal', async f => {
    const held = await arm(f), receipt = await f.messages.create(held.prepared, held.write); await f.delivery.note({ claim: held.claim, proof: receipt });
    f.discord.state.messages.get(receipt.messageId).embeds[0].description = 'Changed synthetic text';
    await f.outbox.continue(held.claim); assert.equal((await f.worker.runOnce('reply-worker')).withdrawn, true);
    assert.equal((await reply(f)).withdrawal_reason, 'message-changed'); assert.equal((await reply(f)).body, f.request().text);
    f.clock.now += 3000; await f.replies.request(f.request({ requestId: 'b'.repeat(64) }));
    const { claim } = await f.outbox.claim('reply-missing', 30000, ['case.reply']);
    const state = await f.delivery.inspect({ claim, observation: await f.discord.roles.observe(USER) }), prep = await f.messages.prepare(state.plan, state.channelId);
    const write = await f.delivery.begin({ claim, observation: prep.observation, proof: prep.proof }), proof = await f.messages.create(prep, write);
    await f.delivery.note({ claim, proof }); f.discord.state.messages.delete(proof.messageId); await f.outbox.continue(claim);
    assert.equal((await f.worker.runOnce('reply-worker')).code, 'CASE_REPLY_MESSAGE_MISSING'); assert.equal(posts(f).length, 2);
  });
  await scenario('CR20 opener departure cancels a pending reply and rejoining does not revive it', async f => {
    await f.replies.request(f.request()); f.discord.state.members.delete(USER); await f.worker.runOnce('reply-worker');
    assert.equal((await reply(f)).state, 'cancelled'); assert.equal((await reply(f)).withdrawal_reason, 'membership-revoked'); assert.equal(posts(f).length, 0);
    f.discord.state.members.set(USER, [CREW]); assert.equal((await f.replies.request(f.request())).state, 'cancelled');
  });
  await scenario('CR21 audience changes after review cancel a pending request even if the case remains open', async f => {
    await f.replies.request(f.request()); await f.admin.query('UPDATE sophie_core.case_provisions SET audience_version = audience_version + 1 WHERE case_id = $1', [f.opened.id]);
    await f.worker.runOnce('reply-worker'); assert.equal((await reply(f)).withdrawal_reason, 'audience-changed'); assert.equal(posts(f).length, 0);
  });
  await scenario('CR22 bounded reply history paginates without duplicates and a late Staff revocation suppresses its text', async f => {
    for (let i = 0; i < 26; i++) { f.clock.now += 3000;
      await f.replies.request(f.request({ requestId: i.toString(16).padStart(64, '0'), text: `Synthetic reply ${i}` })); await f.worker.runOnce('reply-worker'); }
    const page = await f.replies.read({ actor: f.request().actor, channelId: f.opened.channel_id }); assert.equal(page.entries.length, 25);
    const older = await f.replies.read({ actor: f.request().actor, channelId: f.opened.channel_id, before: page.next });
    assert.equal(older.entries.length, 1); assert.equal(older.entries[0].text, 'Synthetic reply 0'); assert.equal(older.next, null);
    let calls = 0; const service = replyServices(f, { authorize: async (...args) => { const allowed = await f.authorization.authorize(...args);
      if (++calls === 1) f.discord.state.members.set(OTHER, []); return allowed; } }).replies;
    await assert.rejects(service.read({ actor: f.request().actor, channelId: f.opened.channel_id }), /CASE_ACCESS_DENIED/);
  });
  await scenario('CR23 HTTP requires CSRF and explicit confirmation, binds attribution to OAuth, and preserves exact retry receipts', async f => {
    const dashboard = dashboardServices(f), authorization = dashboard.dashboardAuthorization, faults = [];
    const replies = createCaseReplies({ pool: f.pool, authorize: authorization.authorize, clock: () => f.clock.now });
    const server = createDashboardAuthHttpServer({ configuration: dashboardConfiguration, auth: dashboard.auth, authorization,
      replies: createCaseRepliesHttp({ auth: dashboard.auth, authorization, replies }), enabled: () => true, onFault: code => faults.push(code) });
    const address = await server.listen();
    try {
      const login = await dashboard.login(OTHER), session = await dashboard.auth.authenticate({ token: login.token });
      const headers = { Cookie: `${DASHBOARD_COOKIES.session}=${login.token}`, Origin: dashboardConfiguration.origin,
        'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' };
      const { actor: _, ...fields } = f.request(), data = { ...fields, confirmed: true };
      const post = (body = data, changedHeaders = {}) => dashboardHttp(address, '/api/cases/replies/request', {
        method: 'POST', headers: { ...headers, ...changedHeaders }, body: JSON.stringify(body) });
      assert.equal((await post(data, { 'X-CSRF-Token': '' })).status, 403);
      assert.equal((await post({ ...data, confirmed: false })).status, 400);
      assert.equal((await post({ ...data, authorId: USER })).status, 400);
      const first = await post(), duplicate = await post(); assert.equal(first.status, 200); assert.equal(first.body.state, 'pending');
      assert.equal(first.body.actorId, OTHER); assert.equal(duplicate.body.id, first.body.id); assert.equal(duplicate.body.duplicate, true);
      assert.equal((await post({ ...data, text: 'Changed synthetic draft' })).status, 409);
      assert.equal((await post({ ...data, requestId: 'b'.repeat(64) })).status, 429);
      const selected = await publication(f); f.clock.now += 3000;
      const { actor: ignored, ...selection } = selected.request;
      const selectedRequest = { ...selection, requestId: 'c'.repeat(64), confirmed: true };
      assert.equal((await post(selectedRequest)).status, 200);
      assert.equal((await post(selectedRequest)).body.duplicate, true);
      assert.equal((await post({ ...selectedRequest, answer: { ...selection.answer, url: 'https://example.invalid' } })).status, 400);
      const page = await dashboardHttp(address, `/api/cases/replies?channelId=${f.opened.channel_id}`, { headers });
      assert.equal(page.status, 200); assert.equal(page.headers['cache-control'], 'no-store'); assert.equal(page.body.entries[0].text, selection.text);
      assert.deepEqual(page.body.entries[0].answer, selection.answer); assert.equal(page.body.entries[1].text, data.text);
      assert.equal((await dashboardHttp(address, `/api/cases/replies?channelId=${f.opened.channel_id}&beforeId=${first.body.id}`, { headers })).status, 400);
      f.discord.state.members.set(OTHER, []);
      const revoked = await dashboardHttp(address, `/api/cases/replies?channelId=${f.opened.channel_id}`, { headers });
      assert.equal(revoked.status, 403); assert.equal(JSON.stringify(revoked.body).includes(data.text), false); assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });
  await scenario('CR24 migration 036 preserves earlier cases and intake without inventing reply requests or delivery', async f => {
    const reservations = await f.rows('case_reservations'), intakes = await f.rows('case_intakes');
    await f.admin.query(`DROP TABLE sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns;
      ALTER TABLE sophie_core.gateway_lifecycle DROP COLUMN automation_enabled;
      DELETE FROM sophie_migrations.applied WHERE id IN ('042-automation-admission.sql','043-automation-delivery.sql','044-automation-recovery.sql');
      DROP TABLE sophie_core.case_answer_reviews, sophie_core.case_reply_events, sophie_core.case_replies;
      DELETE FROM sophie_migrations.applied WHERE id IN ('036-case-replies.sql', '037-case-reply-issues.sql', '039-case-reply-answers.sql', '040-case-answer-reviews.sql');
      ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
      ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
        (kind IN ('whitelist.grant','whitelist.reconcile','member.reconcile','case.provision','shuttle.render','shuttle.alert','case.intake','case.dm'))`);
    assert.deepEqual(await migrateCore(f.admin), { migrations: 60 });
    await f.admin.query('GRANT SELECT, INSERT, UPDATE ON sophie_core.automation_recovery_actions, sophie_core.automation_delivery_events, sophie_core.automation_deliveries, sophie_core.automation_events, sophie_core.automation_cooldowns, sophie_core.case_replies, sophie_core.case_reply_events, sophie_core.case_answer_reviews TO sophie_test_core');
    assert.deepEqual(await f.rows('case_reservations'), reservations); assert.deepEqual(await f.rows('case_intakes'), intakes);
    assert.deepEqual(await f.rows('case_replies'), []); assert.deepEqual(await jobs(f), []);
    assert.deepEqual(await migrateCore(f.admin), { migrations: 60 });
  });
  await scenario('CR25 corrupt retained text cannot be sent or served as the original human reply', async f => {
    await f.replies.request(f.request()); await f.admin.query("UPDATE sophie_core.case_replies SET body = 'Altered synthetic retained text'");
    assert.equal((await f.worker.runOnce('reply-worker')).code, 'CASE_REPLY_CORRUPT'); assert.equal(posts(f).length, 0);
    assert.equal((await reply(f)).create_started, false);
    await assert.rejects(f.replies.read({ actor: f.request().actor, channelId: f.opened.channel_id }), /CASE_REPLY_CORRUPT/);
    await assert.rejects(f.replies.request(f.request()), /CASE_REPLY_CORRUPT/);
  });
  await scenario('CR26 delivery refuses a changed policy body under the same retained version', async f => {
    await f.replies.request(f.request());
    await f.admin.query("UPDATE sophie_core.case_policies SET policy = jsonb_set(policy, '{attachmentsAllowed}', 'true'::jsonb)");
    assert.equal((await f.worker.runOnce('reply-worker')).code, 'CASE_POLICY_IMMUTABLE'); assert.equal(posts(f).length, 0);
  });
  await scenario('CR27 repeated audience instability during withdrawal cannot reset the bounded attempt budget', async f => {
    const held = await arm(f), proof = await f.messages.create(held.prepared, held.write); await f.delivery.note({ claim: held.claim, proof });
    assert.equal(await f.delivery.invalidate(held.claim), true); await f.outbox.continue(held.claim);
    const worker = createCaseReplyDispatcher({ outbox: f.outbox, store: f.delivery, roles: f.discord.roles, enabled: () => true,
      messages: { ...f.messages, prepare() { throw new ContractError('CASE_AUDIENCE_CHANGED'); } } });
    for (let i = 0; i < 10; i++) { assert.equal((await worker.runOnce('reply-unstable')).status, 'retry_scheduled'); await f.makeReady(); }
    assert.equal((await worker.runOnce('reply-unstable')).code, 'ATTEMPT_LIMIT');
    assert.equal((await jobs(f))[0].status, 'parked'); assert.equal(posts(f).length, 1); assert.equal(deletes(f).length, 0);
    assert.equal((await f.rows('case_reply_events')).filter(row => row.event === 'withdrawal-required').length, 1);
  });
  const commandFixture = f => {
    const command = createCaseReplyCommands({ authorization: f.authorization, verifier: f.identities.verifier,
      store: f.store, replies: f.replies, guildId: GUILD, enabled: () => f.clock.enabled });
    const payload = ({ userId = OTHER, version = f.opened.version, confirmed = true } = {}) => f.payload({ member: { user: { id: userId } },
      data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'reply', options: [
        { type: 3, name: 'case', value: `${f.opened.id}@${version}` }, { type: 3, name: 'text', value: f.request().text }, { type: 5, name: 'confirm', value: confirmed },
      ] }] } });
    return { command, payload, execute: raw => command.execute(f.verified(raw)) };
  };
  await scenario('CR28 signed Discord replies share the durable browser service and deduplicate redelivery', async f => {
    const c = commandFixture(f), raw = c.payload();
    assert.equal(await c.execute(c.payload({ confirmed: false })), 'case_reply_confirmation'); assert.equal((await f.rows('case_replies')).length, 0);
    assert.equal(await c.execute(raw), 'case_reply_recorded'); assert.equal(await c.execute(raw), 'case_reply_recorded');
    assert.equal((await f.rows('case_replies')).length, 1); assert.equal((await jobs(f)).length, 1);
    const page = await f.replies.read({ actor: f.request().actor, channelId: f.opened.channel_id });
    assert.equal(page.entries[0].text, f.request().text); assert.equal(page.entries[0].authorId, OTHER);
    assert.equal(JSON.stringify(await f.rows('receipts')).includes(f.request().text), false);
    assert.equal((await f.worker.runOnce('reply-command')).confirmed, true);
    assert.equal(await c.execute(raw), 'case_reply_confirmed'); assert.equal(posts(f).length, 1);
  });
  await scenario('CR29 Discord reply command enforces member, Head Admin, stale, closed and revoked boundaries', async f => {
    const c = commandFixture(f);
    assert.equal(await c.execute(c.payload({ userId: USER })), 'denied');
    assert.equal(await c.execute(c.payload({ version: f.opened.version + 1 })), 'case_stale');
    f.discord.state.members.set(OTHER, [STAFF]);
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact' WHERE id = $1", [f.opened.id]);
    assert.equal(await c.execute(c.payload()), 'denied');
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'quick-help', state = 'closed', desired_access = 'closed' WHERE id = $1", [f.opened.id]);
    assert.equal(await c.execute(c.payload()), 'denied');
    await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'open', desired_access = 'open' WHERE id = $1", [f.opened.id]);
    const envelope = f.verified(c.payload()); f.discord.state.members.set(OTHER, []);
    assert.equal(await c.command.execute(envelope), 'denied'); assert.equal((await f.rows('case_replies')).length, 0); assert.equal((await jobs(f)).length, 0);
  });
  const parked = async (f, sent = false) => {
    const held = await arm(f); let messageId = null;
    if (sent) {
      const proof = await f.messages.create(held.prepared, held.write);
      messageId = f.messages.verification.receipt(proof, { recordId: held.state.recordId, plan: held.state.plan, channelId: held.state.channelId }).messageId;
    } else await f.delivery.releaseUnsent(held.claim);
    await f.outbox.park(held.claim, sent ? 'CASE_REPLY_UNCERTAIN' : 'BOT_PERMISSION_MISSING');
    const issue = (await f.rows('case_delivery_issues')).find(row => row.operation_id === held.claim.operationId);
    return { ...held, issue, messageId, ...replyRecoveryServices(f) };
  };
  await scenario('CR30 reply issue metadata reuses the signed queue and audited unsent recheck without copying authored text', async f => {
    const p = await parked(f), queue = await p.listIssues(), entry = queue.entries[0];
    assert.equal(entry.kind, 'reply'); assert.equal(entry.replyId, p.state.recordId); assert.equal(entry.needsMessageId, false); assert.equal(entry.recheckable, true);
    const rendered = caseIssueQueueReply(queue); assert.equal(JSON.stringify(rendered).includes(f.request().text), false);
    assert.ok(rendered.embeds[0].description.includes(`sophie:staff-reply:v1:${entry.replyId}`));
    const raw = recheckPayload(f, p.issue), execute = value => p.issueCommands.execute(f.verified(value));
    assert.equal(await execute(raw), 'case_issue_recorded'); assert.equal(await execute(raw), 'case_issue_recorded');
    assert.equal(await execute(recheckPayload(f, p.issue)), 'case_issue_stale');
    assert.equal((await f.rows('case_delivery_actions')).length, 1); assert.equal((await reply(f)).create_started, false);
    assert.equal((await f.worker.runOnce('rechecked-reply')).confirmed, true); assert.equal(posts(f).length, 1);
    assert.equal((await p.listIssues()).entries.length, 0);
  });
  await scenario('CR31 unknown reply sends require a verified own-message ID and never permit blind recheck or repost', async f => {
    const p = await parked(f, true), entry = (await p.listIssues()).entries[0]; assert.equal(entry.needsMessageId, true); assert.equal(entry.recheckable, false);
    const execute = raw => p.issueCommands.execute(f.verified(raw));
    assert.equal(await execute(recheckPayload(f, p.issue)), 'case_issue_message_needed');
    assert.equal(await execute(issuePayload(f, 'recover', p.issue, '999')), 'case_recovery_rejected');
    assert.equal((await reply(f)).message_id, null); assert.equal((await jobs(f))[0].status, 'parked');
    const raw = issuePayload(f, 'recover', p.issue, p.messageId);
    assert.equal(await execute(raw), 'case_recovery_recorded'); assert.equal(await execute(raw), 'case_recovery_recorded');
    const stored = await reply(f); assert.equal(stored.message_id, p.messageId); assert.equal(stored.create_started, true); assert.equal(stored.state, 'pending');
    const audit = (await f.rows('case_delivery_actions'))[0]; assert.equal(audit.action, 'adopt_message'); assert.equal(audit.record_id, stored.id);
    assert.equal(JSON.stringify(audit).includes(f.request().text), false);
    assert.equal((await f.worker.runOnce('adopted-reply')).confirmed, true); assert.equal(posts(f).length, 1);
  });
  await scenario('CR32 recovered altered replies are withdrawn by the worker while authored text and operator audit remain retained', async f => {
    const p = await parked(f, true); f.discord.state.messages.get(p.messageId).embeds[0].description = 'Changed synthetic Discord text';
    assert.equal(await p.issueCommands.execute(f.verified(issuePayload(f, 'recover', p.issue, p.messageId))), 'case_recovery_recorded');
    assert.equal((await reply(f)).state, 'pending');
    assert.equal((await f.worker.runOnce('changed-adopted-reply')).withdrawn, true);
    assert.equal((await reply(f)).body, f.request().text); assert.equal((await reply(f)).state, 'withdrawn');
    assert.equal(posts(f).length, 1); assert.equal(deletes(f).length, 1); assert.equal((await f.rows('case_delivery_actions')).length, 1);
  });
  await scenario('CR33 reply recovery enforces Head Admin isolation and rolls back an operator revoked at its final authorization check', async f => {
    const p = await parked(f); await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact' WHERE id = $1", [f.opened.id]);
    f.discord.state.members.set(OTHER, [STAFF]);
    assert.equal((await p.issues.listCaseDeliveryIssues({ actor: await f.actor(OTHER), guildId: GUILD })).entries.length, 0);
    assert.equal(await p.issueCommands.execute(f.verified(recheckPayload(f, p.issue))), 'denied');
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'quick-help' WHERE id = $1", [f.opened.id]);
    let checks = 0; const guarded = replyRecoveryServices(f, { authorize: async (...args) => {
      if (++checks === 2) f.discord.state.members.set(OTHER, []); return f.authorization.authorize(...args);
    } });
    const actor = await f.actor(OTHER), before = (await jobs(f))[0];
    await assert.rejects(guarded.issues.changeCaseDeliveryIssue({ actor, interactionId: f.nextId(), issueId: p.issue.id, expectedRevision: p.issue.revision,
      action: 'recheck', observation: await f.discord.roles.observe(USER) }), /OPERATION_DENIED/);
    const after = (await jobs(f))[0]; assert.equal(after.status, 'parked'); assert.equal(after.fence, before.fence);
    assert.equal((await f.rows('case_delivery_actions')).length, 0);
  });
  await scenario('CR34 migration 037 backfills only owned parked reply issues without resetting attempts or send state', async f => {
    const p = await parked(f, true), original = await reply(f), before = (await jobs(f))[0];
    await f.admin.query('DELETE FROM sophie_core.case_delivery_issues WHERE id = $1', [p.issue.id]);
    await f.admin.query("DELETE FROM sophie_migrations.applied WHERE id = '037-case-reply-issues.sql'");
    assert.deepEqual(await migrateCore(f.admin), { migrations: 60 });
    const row = (await f.rows('case_delivery_issues')).find(item => item.operation_id === before.operation_id);
    assert.equal(row.parked_fence, before.fence); assert.equal(row.case_id, original.case_id);
    assert.deepEqual(await reply(f), original); assert.deepEqual((await jobs(f))[0], before);
    assert.deepEqual(await migrateCore(f.admin), { migrations: 60 }); assert.equal((await f.rows('case_delivery_issues')).length, 1);
  });
  await scenario('CR35 competing operator rechecks have one audited winner and cannot revive an old revision', async f => {
    const p = await parked(f), actor = await f.actor(OTHER), observation = await f.discord.roles.observe(USER);
    const requests = [f.nextId(),f.nextId()].map(interactionId => ({ actor, interactionId, issueId: p.issue.id, expectedRevision: p.issue.revision, action: 'recheck', observation }));
    const results = await Promise.allSettled(requests.map(args => p.issues.changeCaseDeliveryIssue(args)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /STALE_CASE_ISSUE/);
    assert.equal((await f.rows('case_delivery_actions')).length, 1); assert.equal((await reply(f)).create_started, false);
  });
  await scenario('CR36 a current replacement operator can recover a revoked authors possible send only for withdrawal', async f => {
    const p = await parked(f, true), replacement = '100000000000000088';
    f.discord.state.members.set(OTHER, []); f.discord.state.members.set(replacement, [STAFF]);
    const raw = issuePayload(f, 'recover', p.issue, p.messageId, { member: { user: { id: replacement } } });
    assert.equal(await p.issueCommands.execute(f.verified(raw)), 'case_recovery_recorded');
    assert.equal((await f.worker.runOnce('revoked-author-recovered')).withdrawn, true);
    const retained = await reply(f); assert.equal(retained.author_id, OTHER); assert.equal(retained.body, f.request().text);
    assert.equal(posts(f).length, 1); assert.equal(deletes(f).length, 1);
    assert.equal((await f.rows('case_delivery_actions'))[0].operator_grant.userId, replacement);
  });
  await scenario('CR37 selected publication is retained with exact text and retry resolves after withdrawal without another send', async f => {
    const p = await publication(f), saved = await f.replies.request(p.request);
    await p.change('withdraw', 1);
    assert.deepEqual(await f.replies.request(p.request), { ...saved, duplicate: true });
    await assert.rejects(f.replies.request({ ...p.request, answer: null }), /CASE_REPLY_REQUEST_COLLISION/);
    await assert.rejects(f.replies.request({ ...p.request, answer: { ...p.reference, revision: 2 } }), /CASE_REPLY_REQUEST_COLLISION/);
    const record = await reply(f); assert.deepEqual(record.answer_reference, p.reference); assert.equal(record.body, p.request.text);
    assert.equal(JSON.stringify(await jobs(f)).includes(p.request.text), false);
    await f.worker.runOnce('selected-answer'); await f.worker.runOnce('selected-answer-again');
    assert.equal((await reply(f)).state, 'confirmed');
    assert.equal(posts(f).length, 1);
    assert.equal(f.discord.state.messages.get((await reply(f)).message_id).embeds[0].description, p.request.text);
    assert.deepEqual((await f.replies.read({ actor: p.request.actor, channelId: p.request.channelId })).entries[0].answer, p.reference);
  });
  await scenario('CR38 changed, withdrawn, mismatched or forged selections cannot create a new reply intent', async f => {
    const p = await publication(f);
    for (const change of [{ text: 'Edited public answer' }, { answer: { ...p.reference, sha256: 'b'.repeat(64) } },
      { answer: { ...p.reference, revision: 2 } }, { answer: { ...p.reference, name: 'unknown' } }]) {
      await assert.rejects(f.replies.request({ ...p.request, ...change }), /ANSWER_REVIEW_STALE/);
    }
    await assert.rejects(f.replies.request({ ...p.request, answer: { ...p.reference, extra: true } }), /ANSWER_INPUT_INVALID/);
    await p.change('publish', 1); await assert.rejects(f.replies.request(p.request), /ANSWER_REVIEW_STALE/);
    await p.change('withdraw', 2); await assert.rejects(f.replies.request(p.request), /ANSWER_REVIEW_STALE/);
    assert.equal((await f.rows('case_replies')).length, 0); assert.equal((await jobs(f)).length, 0);
  });
  await scenario('CR39 public library membership never grants case authority and late Staff revocation rolls back selection', async f => {
    const p = await publication(f), member = await f.actor(USER);
    assert.ok(await p.answers.lookup({ actor: member, name: p.reference.name }));
    await assert.rejects(f.replies.request({ ...p.request, actor: member }), /CASE_ACCESS_DENIED/);
    let checks = 0;
    const replies = replyServices(f, { authorize: async (...args) => {
      if (++checks === 3) f.discord.state.members.set(OTHER, []);
      return f.authorization.authorize(...args);
    } }).replies;
    await assert.rejects(replies.request(p.request), /CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_replies')).length, 0); assert.equal((await jobs(f)).length, 0);
  });
  await scenario('CR40 publication lock serializes withdrawal before reply admission and rejects the old reviewed revision', async f => {
    const p = await publication(f); let inserted, release, waiting;
    const insertedPromise = new Promise(resolve => { inserted = resolve; }), releasePromise = new Promise(resolve => { release = resolve; }), waitingPromise = new Promise(resolve => { waiting = resolve; });
    const wrap = intercept => ({ connect: async () => { const client = await f.pool.connect(); return {
      release: () => client.release(), query: async (...args) => intercept(client, ...args),
    }; } });
    const writer = createCuratedAnswers({ guildId: GUILD, authorize: f.authorization.authorize,
      pool: wrap(async (client, sql, values) => { const result = await client.query(sql, values);
        if (sql.includes('INSERT INTO sophie_core.curated_answers')) { inserted(); await releasePromise; } return result;
      }) });
    const fields = { name: p.reference.name, expectedRevision: 1, action: 'withdraw', document: null }, actor = p.request.actor;
    const reviewed = await writer.review({ actor, ...fields });
    const withdrawing = writer.change({ actor, ...fields, requestId: 'f'.repeat(64), reviewSha256: reviewed.reviewSha256, confirmed: true, approvedPublic: true });
    await insertedPromise;
    const replies = replyServices(f, { pool: wrap(async (client, sql, values) => {
      if (sql.includes('pg_advisory_xact_lock') && sql.includes('038')) waiting(); return client.query(sql, values);
    }) }).replies;
    const requesting = assert.rejects(replies.request(p.request), /ANSWER_REVIEW_STALE/);
    try { await Promise.race([waitingPromise, requesting.then(() => { throw new Error('Reply did not wait for publication'); })]); } finally { release(); }
    await Promise.all([withdrawing, requesting]); assert.equal((await f.rows('case_replies')).length, 0);
  });
  await scenario('CR41 migration 039 preserves existing manual reply hashes and replay leaves selected provenance unchanged', async f => {
    await f.replies.request(f.request()); const before = await reply(f);
    await f.admin.query("ALTER TABLE sophie_core.case_replies DROP COLUMN answer_reference; DELETE FROM sophie_migrations.applied WHERE id = '039-case-reply-answers.sql'");
    assert.deepEqual(await migrateCore(f.admin), { migrations: 60 }); assert.deepEqual(await reply(f), before);
    assert.equal((await f.replies.request(f.request())).duplicate, true);
    f.clock.now += 3000; const p = await publication(f); await f.replies.request({ ...p.request, requestId: 'b'.repeat(64) });
    const retained = await f.rows('case_replies'); await migrateCore(f.admin); assert.deepEqual(await f.rows('case_replies'), retained);
  });
  await scenario('CR42 corrupt selected provenance prevents delivery and cannot masquerade as the reviewed reply', async f => {
    const p = await publication(f); await f.replies.request(p.request);
    await f.admin.query("UPDATE sophie_core.case_replies SET answer_reference = jsonb_set(answer_reference, '{revision}', '2')");
    await assert.rejects(f.replies.read({ actor: p.request.actor, channelId: p.request.channelId }), /CASE_REPLY_CORRUPT/);
    assert.equal((await f.worker.runOnce('selected-corrupt')).code, 'CASE_REPLY_CORRUPT');
    assert.equal((await reply(f)).create_started, false);
    await assert.rejects(f.admin.query("UPDATE sophie_core.case_replies SET answer_reference = '{}'"), error => error.code === '23514');
  });
  await scenario('CR43 encrypted restore retains selected reply text, publication provenance and withdrawn source history', async f => {
    const p = await publication(f), review = await f.replies.prepareAnswerReview(reviewRequest(f));
    await f.replies.confirmAnswerReview({ actor: p.request.actor, token: review.token });
    const cancelled = await f.replies.prepareAnswerReview(reviewRequest(f, { requestId: 'e'.repeat(64) }));
    await f.replies.cancelAnswerReview({ actor: p.request.actor, token: cancelled.token });
    await f.replies.prepareAnswerReview(reviewRequest(f, { requestId: 'f'.repeat(64) }));
    await p.change('withdraw', 1);
    const configuration = stagingConfiguration('a'.repeat(64)); configuration.capabilityPolicy = f.policy;
    const { configuration: database, binaryRoot, directory: parent } = cluster.recovery;
    const tools = await reviewedRecoveryTools(binaryRoot), key = randomBytes(32), maxDatabaseBytes = 33554432;
    const backup = await createRecoveryBundle({ pool: f.admin, database, tools, configuration, buildId: 'a'.repeat(64), vaultRoots: [], parent, key, maxDatabaseBytes });
    const prepared = await prepareRecoveryBundle({ directory: backup.directory, parent, key, maxDatabaseBytes, confirmGuildId: GUILD, expectedManifestSha256: backup.manifestSha256 });
    const target = await cluster.recovery.createTarget();
    const restored = await restoreRecoveryBundle({ prepared, pool: target.pool, database: target.configuration, tools });
    assert.equal(restored.tableCountsVerified, true);
    for (const table of ['case_replies','case_reply_events','curated_answers','case_answer_reviews']) {
      assert.deepEqual((await target.pool.query(`SELECT * FROM sophie_core.${table}`)).rows, await f.rows(table));
    }
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
  });
  await scenario('CR44 review preparation retains bounded source metadata and exact command receipts without sending', async f => {
    const p = await publication(f), input = reviewRequest(f), prepared = await f.replies.prepareAnswerReview(input);
    assert.deepEqual(await f.replies.prepareAnswerReview(input), { ...prepared, duplicate: true });
    await assert.rejects(f.replies.prepareAnswerReview({ ...input, name: 'other-name' }), /CASE_REPLY_REQUEST_COLLISION/);
    const view = await f.replies.readAnswerReview({ actor: input.actor, requestId: input.requestId });
    assert.equal(view.state, 'review'); assert.equal(view.token, prepared.token); assert.equal(view.document.text, p.request.text);
    assert.equal(JSON.stringify(await f.rows('case_answer_reviews')).includes(p.request.text), false);
    assert.equal((await f.rows('case_replies')).length, 0); assert.equal((await jobs(f)).length, 0);
  });
  await scenario('CR45 submitted reviews resolve one reply after withdrawal and expiry and cannot be cancelled as unsent', async f => {
    const p = await publication(f), review = await f.replies.prepareAnswerReview(reviewRequest(f)), input = { actor: p.request.actor, token: review.token };
    const first = await f.replies.confirmAnswerReview(input); await p.change('withdraw',1); f.clock.now += 600001;
    const current = { ...input, actor: await f.actor(OTHER) };
    assert.deepEqual(await f.replies.confirmAnswerReview(current), { ...first, duplicate: true });
    assert.deepEqual(await f.replies.cancelAnswerReview(current), { state: 'submitted' });
    assert.equal((await f.rows('case_replies')).length,1); assert.equal((await jobs(f)).length,1);
    await f.worker.runOnce('review-retry'); assert.equal((await reply(f)).state,'confirmed'); assert.equal(posts(f).length,1);
  });
  await run('CR46 expiry, case version, audience and publication changes invalidate unconfirmed reviews', async () => {
    for (const changed of ['expiry','case','audience','publication']) {
      const f = await replyWorkflow(cluster), p = await publication(f), review = await f.replies.prepareAnswerReview(reviewRequest(f));
      if (changed === 'expiry') f.clock.now += 600000;
      else if (changed === 'case') await f.admin.query('UPDATE sophie_core.case_reservations SET version = version + 1 WHERE id = $1',[f.opened.id]);
      else if (changed === 'audience') await f.admin.query('UPDATE sophie_core.case_provisions SET audience_version = audience_version + 1 WHERE case_id = $1',[f.opened.id]);
      else await p.change('publish',1);
      await assert.rejects(f.replies.confirmAnswerReview({ actor: await f.actor(OTHER), token: review.token }), /CASE_ANSWER_REVIEW_STALE|ANSWER_REVIEW_STALE/);
      assert.equal((await f.rows('case_replies')).length,0); assert.equal((await jobs(f)).length,0);
    }
  });
  await scenario('CR47 review ownership, revocation epochs and Head Admin isolation remain authoritative', async f => {
    await publication(f); const review = await f.replies.prepareAnswerReview(reviewRequest(f)), other = '100000000000000088';
    f.discord.state.members.set(other,[STAFF]); const actor = await f.actor(other);
    for (const method of ['confirmAnswerReview','cancelAnswerReview']) await assert.rejects(f.replies[method]({ actor, token:review.token }),/CASE_ACCESS_DENIED/);
    f.discord.state.members.set(OTHER,[]); await f.actor(OTHER);
    f.discord.state.members.set(OTHER,[LEAD]); const restored = await f.actor(OTHER);
    await assert.rejects(f.replies.confirmAnswerReview({ actor:restored,token:review.token }),/CASE_ANSWER_REVIEW_STALE/);
    const newer = await f.replies.prepareAnswerReview(reviewRequest(f,{ actor:restored,requestId:'e'.repeat(64) }));
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact' WHERE id = $1",[f.opened.id]);
    f.discord.state.members.set(OTHER,[STAFF]); const staff = await f.actor(OTHER);
    await assert.rejects(f.replies.confirmAnswerReview({ actor:staff,token:newer.token }),/CASE_ACCESS_DENIED/);
    await assert.rejects(f.replies.readAnswerReview({ actor:staff,requestId:'e'.repeat(64) }),/CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_replies')).length,0);
  });
  await scenario('CR48 competing confirmation clicks and cancellation serialize without duplicate replies or false cancellation', async f => {
    await publication(f); const first = await f.replies.prepareAnswerReview(reviewRequest(f)), input = { actor:f.request().actor,token:first.token };
    const results = await Promise.all([f.replies.confirmAnswerReview(input),f.replies.confirmAnswerReview(input)]);
    assert.equal(results[0].id,results[1].id); assert.equal(results.filter(value => value.duplicate).length,1);
    f.clock.now += 3000; const second = await f.replies.prepareAnswerReview(reviewRequest(f,{ requestId:'e'.repeat(64) })), next = { ...input,token:second.token };
    const raced = await Promise.allSettled([f.replies.cancelAnswerReview(next),f.replies.confirmAnswerReview(next)]);
    const cancelled = raced[0].value; assert.equal(raced[0].status,'fulfilled');
    if (cancelled.state === 'cancelled') { assert.equal(raced[1].status,'rejected'); assert.match(raced[1].reason.message,/CASE_ANSWER_REVIEW_STALE/); }
    else assert.equal(raced[1].status,'fulfilled');
    assert.equal((await f.rows('case_replies')).length,cancelled.state === 'cancelled' ? 1 : 2);
  });
  await scenario('CR49 final authorization failure rolls back review consumption, reply, audit and outbox together', async f => {
    await publication(f); const review = await f.replies.prepareAnswerReview(reviewRequest(f)); let checks = 0;
    const service = replyServices(f,{ authorize: async (...args) => {
      if (++checks === 4) f.discord.state.members.set(OTHER,[]); return f.authorization.authorize(...args);
    } }).replies;
    await assert.rejects(service.confirmAnswerReview({ actor:f.request().actor,token:review.token }),/CASE_ACCESS_DENIED/);
    assert.equal((await f.rows('case_answer_reviews'))[0].state,'awaiting');
    assert.equal((await f.rows('case_replies')).length,0); assert.equal((await f.rows('case_reply_events')).length,0); assert.equal((await jobs(f)).length,0);
  });
  await scenario('CR50 lost commit response is resolved by a fresh service with the original confirmed review', async f => {
    const p = await publication(f), review = await f.replies.prepareAnswerReview(reviewRequest(f)); let lose = true;
    const pool = { connect: async () => { const client = await f.pool.connect(); return {
      release: discard => client.release(discard), query: async (...args) => { const result = await client.query(...args);
        if (args[0] === 'COMMIT' && lose) { lose = false; throw new Error('Synthetic lost commit response'); } return result;
      },
    }; } };
    await assert.rejects(replyServices(f,{pool}).replies.confirmAnswerReview({ actor:p.request.actor,token:review.token }),/Synthetic lost commit response/);
    assert.equal((await f.rows('case_answer_reviews'))[0].state,'submitted'); await p.change('withdraw',1);
    const retried = await replyServices(f).replies.confirmAnswerReview({ actor:p.request.actor,token:review.token });
    assert.equal(retried.duplicate,true); assert.equal((await f.rows('case_replies')).length,1); assert.equal((await jobs(f)).length,1);
  });
  await scenario('CR51 five active reviews bound admission while cancellation and expiry release capacity without deletion', async f => {
    await publication(f); const reviews = [];
    for (let index = 0; index < 5; index++) reviews.push(await f.replies.prepareAnswerReview(reviewRequest(f,{ requestId:String(index).padStart(64,'0') })));
    await assert.rejects(f.replies.prepareAnswerReview(reviewRequest(f)),/CASE_ANSWER_REVIEW_LIMIT/);
    const cancelled = { actor:f.request().actor,token:reviews[0].token };
    assert.deepEqual(await f.replies.cancelAnswerReview(cancelled),{state:'cancelled'});
    assert.deepEqual(await f.replies.cancelAnswerReview(cancelled),{state:'cancelled'});
    await assert.rejects(f.replies.confirmAnswerReview(cancelled),/CASE_ANSWER_REVIEW_STALE/);
    await f.replies.prepareAnswerReview(reviewRequest(f)); f.clock.now += 600001;
    await f.replies.prepareAnswerReview(reviewRequest(f,{ actor:await f.actor(OTHER),requestId:'e'.repeat(64) }));
    assert.equal((await f.rows('case_answer_reviews')).length,7); assert.equal((await jobs(f)).length,0);
  });
  await scenario('CR52 migration 040 preserves prior replies and retained review corruption cannot authorize a send', async f => {
    await f.replies.request(f.request()); const before = await f.rows('case_replies');
    await f.admin.query("DROP TABLE sophie_core.case_answer_reviews; DELETE FROM sophie_migrations.applied WHERE id = '040-case-answer-reviews.sql'");
    assert.deepEqual(await migrateCore(f.admin),{migrations: 60}); assert.deepEqual(await f.rows('case_replies'),before);
    await f.admin.query('GRANT SELECT,INSERT,UPDATE ON sophie_core.case_answer_reviews TO sophie_test_core');
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_answer_reviews'),error => error.code === '42501');
    await publication(f); const review = await f.replies.prepareAnswerReview(reviewRequest(f));
    const retained = await f.rows('case_answer_reviews'); await migrateCore(f.admin); assert.deepEqual(await f.rows('case_answer_reviews'),retained);
    await f.admin.query("UPDATE sophie_core.case_answer_reviews SET reviewed_version = reviewed_version + 1");
    await assert.rejects(f.replies.confirmAnswerReview({ actor:f.request().actor,token:review.token }),/CASE_ANSWER_REVIEW_CORRUPT/);
    assert.equal((await f.rows('case_replies')).length,1);
  });
}
