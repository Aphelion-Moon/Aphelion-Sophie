import { closeTestCase } from '../../tests/fixtures/case-lifecycle.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { GUILD, USER, OTHER, STAFF, LEAD, definition } from '../../tests/fixtures/domain.js';
import { CREW, BYOND_ROLE, WHITELIST, MUZZLED, mapping } from '../../tests/fixtures/discord.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { enqueue } from '../../apps/core/storage/outbox.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';

export async function runOnboardingDeliveryIssueSuite(cluster, run) {
  const scenario = (name, work, options = {}) => run(name, async () => work(await onboardingWorkflow(cluster, options)));
  const issues = f => f.rows('shuttle_delivery_issues');
  const audits = f => f.rows('shuttle_delivery_rechecks');
  const writes = f => f.discord.state.calls.filter(call => ['PUT', 'DELETE', 'POST', 'PATCH'].includes(call.method)).length;
  const queue = (f, userId = OTHER, after = null) => f.verified(f.payload({ member: { user: { id: userId } },
    ...(after === null ? { data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'issues' }] } } :
      { type: 3, message: { id: OTHER }, data: { component_type: 2, custom_id: `sophie:shuttle-issue:v1:queue:${after}` } }) }));
  const payload = (f, issue, overrides = {}) => f.payload({ type: 3, member: { user: { id: OTHER } }, message: { id: OTHER },
    data: { component_type: 2, custom_id: `sophie:shuttle-issue:v1:recheck:${issue.id}:${issue.revision}` }, ...overrides });
  const recheck = (f, issue, overrides) => f.execute(payload(f, issue, overrides));
  const source = async (f, issue) => (await f.rows('outbox')).find(row => row.operation_id === issue.operation_id);
  async function parked(f) {
    await f.pending(); f.discord.state.roles.find(role => role.id === WHITELIST).position = 20;
    assert.equal((await f.grants.runOnce('blocked-grant')).code, 'ROLE_HIERARCHY_BLOCKED');
    f.discord.state.roles.find(role => role.id === WHITELIST).position = 2;
    return (await issues(f))[0];
  }
  async function operation(f, issue) {
    const actor = await f.actor(OTHER);
    const description = await f.store.describeOnboardingDeliveryIssue({ actor, guildId: GUILD, issueId: issue.id });
    const proof = description.kind === 'whitelist.grant' ? await f.discord.channels.inspect(description.plan, description.channelId) : null;
    return { actor, interactionId: f.nextId(), issueId: issue.id, expectedRevision: issue.revision,
      observation: await f.discord.roles.observe(issue.user_id), proof };
  }

  await scenario('R01 Staff recheck records an audit without changing progress and only the worker confirms delivery', async f => {
    const issue = await parked(f), before = await f.session(), job = await source(f, issue), count = writes(f);
    assert.equal(await f.commands.execute(queue(f)), 'shuttle_issue_queue');
    const page = await f.deliveryIssues.queue(queue(f)); assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0].issueId, issue.id); assert.equal(page.entries[0].reason, 'roles');
    assert.equal(await recheck(f, issue), 'shuttle_issue_recorded');
    assert.deepEqual(await f.session(), before); assert.equal(writes(f), count);
    const next = await source(f, issue); assert.equal(next.status, 'ready'); assert.equal(next.attempts, 0);
    assert.deepEqual(next.effect, job.effect); assert.equal(next.dispatch_started, job.dispatch_started); assert.ok(next.fence > job.fence);
    const [audit] = await audits(f); assert.equal(audit.operator_grant.userId, OTHER); assert.equal(audit.parked_fence, job.fence);
    assert.equal(audit.error_code, job.last_error_code); assert.equal(audit.attempts, job.attempts);
    assert.equal((await f.deliveryIssues.queue(queue(f))).entries.length, 0);
    await f.drain(f.grants); assert.equal((await f.rows('sessions'))[0].state.status, 'complete');
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true); assert.equal((await issues(f)).length, 1);
    assert.equal(f.discord.state.members.get(USER).includes(BYOND_ROLE), true);
  });

  await scenario('R02 duplicate and competing rechecks commit only once and a new failure invalidates old controls', async f => {
    const issue = await parked(f), request = await operation(f, issue);
    const results = await Promise.all([f.store.recheckOnboardingDeliveryIssue(request), f.store.recheckOnboardingDeliveryIssue(request)]);
    assert.deepEqual(results.map(row => row.duplicate).sort(), [false, true]); assert.equal((await audits(f)).length, 1);
    f.discord.state.roles.find(role => role.id === WHITELIST).position = 20;
    // A retained compensation may be inspected before the requeued original grant.
    let blocked;
    for (let count = 0; count < 3; count++) {
      blocked = await f.grants.runOnce('still-blocked'); if (blocked.status === 'operator_required') break;
      assert.equal(blocked.status, 'settled');
    }
    assert.equal(blocked.status, 'operator_required');
    f.discord.state.roles.find(role => role.id === WHITELIST).position = 2;
    const current = (await issues(f))[0]; assert.equal(current.id, issue.id); assert.ok(current.revision > issue.revision);
    assert.equal(await recheck(f, issue), 'shuttle_issue_stale');
    const competing = await operation(f, current);
    const outcomes = await Promise.allSettled([f.store.recheckOnboardingDeliveryIssue(competing),
      f.store.recheckOnboardingDeliveryIssue({ ...competing, interactionId: f.nextId() })]);
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(row => row.status === 'rejected').reason.code, 'STALE_SHUTTLE_ISSUE'); assert.equal((await audits(f)).length, 2);
  });

  await scenario('R03 requester roles, Administrator, Muzzled Staff and forged actors cannot use delivery review', async f => {
    const issue = await parked(f), request = await operation(f, issue);
    assert.equal(await recheck(f, issue, { member: { user: { id: USER }, roles: [STAFF], permissions: '8' } }), 'denied');
    assert.deepEqual(await f.deliveryIssues.queue(queue(f, USER)), { state: 'denied' });
    await assert.rejects(f.store.recheckOnboardingDeliveryIssue({ ...request, actor: { ...request.actor } }), /OPERATION_DENIED/);
    await assert.rejects(f.store.recheckOnboardingDeliveryIssue({ ...request, observation: await f.discord.roles.observe(OTHER) }), /MEMBER_MISMATCH/);
    f.discord.state.roles.find(role => role.id === CREW).permissions = '8'; f.discord.state.members.set(OTHER, [CREW]);
    assert.equal(await recheck(f, issue), 'denied');
    f.discord.state.members.set(OTHER, [STAFF, MUZZLED]); assert.equal(await recheck(f, issue), 'denied');
    assert.equal((await audits(f)).length, 0); assert.equal((await source(f, issue)).status, 'parked');
    f.discord.state.members.set(OTHER, [STAFF]); const accepted = payload(f, issue);
    assert.equal(await f.execute(accepted), 'shuttle_issue_recorded'); f.discord.state.members.set(OTHER, []);
    assert.equal(await f.execute(accepted), 'denied'); assert.equal((await audits(f)).length, 1);
  });

  await scenario('R04 authority is rechecked before commit and before sending private queue metadata', async f => {
    const issue = await parked(f), request = await operation(f, issue), receiptCount = (await f.rows('receipts')).length;
    let checks = 0;
    const store = createCoreStore({ pool: f.pool, clock: () => f.clock.now, casePolicy, caseVerification: f.discord.channels.verification,
      authorize: async (...args) => ++checks === 2 ? false : f.authorization.authorize(...args) });
    await assert.rejects(store.recheckOnboardingDeliveryIssue(request), /OPERATION_DENIED/);
    assert.equal((await audits(f)).length, 0); assert.equal((await source(f, issue)).status, 'parked');
    assert.equal((await f.rows('receipts')).length, receiptCount);
    const envelope = queue(f), status = await f.commands.execute(envelope), replies = [];
    f.discord.state.members.set(OTHER, []);
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION,
      clock: () => f.clock.now, enabled: () => true, onboardingDeliveryIssues: f.deliveryIssues,
      fetch: async (_, options) => { replies.push(JSON.parse(options.body)); return Response.json({}); } });
    await responder.respond(envelope, status);
    assert.match(replies[0].content, /requires current Staff/); assert.deepEqual(replies[0].embeds, []);
    assert.equal(JSON.stringify(replies).includes(USER), false); assert.equal(JSON.stringify(replies).includes(issue.id), false);
  });

  await scenario('R05 rechecking while Muzzled cancels the old grant and does not unmute or advance', async f => {
    const issue = await parked(f); f.discord.state.members.get(USER).push(MUZZLED);
    const before = (await f.rows('sessions'))[0].state;
    assert.equal(await recheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.grants);
    assert.equal((await source(f, issue)).status, 'cancelled'); assert.deepEqual((await f.rows('sessions'))[0].state, before);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false); assert.equal(f.discord.state.members.get(USER).includes(MUZZLED), true);
    assert.equal(f.discord.state.calls.some(call => call.method === 'PUT'), false);
    f.discord.state.members.set(USER, [CREW, BYOND_ROLE]); await f.store.recordObservation(await f.discord.roles.observe(USER));
    assert.equal(await recheck(f, (await issues(f))[0]), 'shuttle_issue_stale');
  });

  await scenario('R06 lost Whitelist or membership cannot be restored by rechecking a retained old issue', async f => {
    const issue = await parked(f);
    f.discord.state.members.get(USER).push(WHITELIST); await f.store.recordObservation(await f.discord.roles.observe(USER));
    f.discord.state.members.delete(USER); await f.store.recordObservation(await f.discord.roles.observe(USER));
    f.discord.state.members.set(USER, [CREW, BYOND_ROLE]); f.clock.now += 1_001; await f.open();
    const latest = await f.session(); assert.equal(latest.stepIndex, 0); assert.notEqual(latest.id, issue.session_id);
    assert.equal(await recheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.grants);
    assert.equal((await source(f, issue)).status, 'cancelled'); assert.deepEqual(await f.session(), latest);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('R07 withdrawn publication and paused progress remain binding during Staff rechecks', async f => {
    const issue = await parked(f); assert.equal(await f.click('help'), 'shuttle_help_paused');
    const paused = await f.session(); assert.equal(await recheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.grants);
    assert.equal((await source(f, issue)).status, 'cancelled'); assert.deepEqual(await f.session(), paused);
    await f.resolve((await f.rows('shuttle_help_requests'))[0]); await f.drain(f.screens);
    assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.screens);
    const job = await f.outbox.claim('withdrawn', 30_000, ['whitelist.grant']); await f.outbox.park(job.claim, 'BOT_PERMISSION_MISSING');
    const second = (await issues(f)).find(row => row.id !== issue.id);
    f.discord.state.members.set(OTHER, [LEAD]); await f.store.withdrawDefinition({ actor: await f.actor(OTHER), id: definition.id, version: 1 });
    assert.equal(await recheck(f, second), 'shuttle_issue_recorded'); await f.drain(f.grants);
    assert.equal((await source(f, second)).status, 'cancelled'); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
  }, { helpPauses: true });

  await scenario('R08 unknown role responses retain possible-effect evidence and rechecking observes before writing', async f => {
    await f.pending(); f.discord.state.afterWrite = call => { if (call.method === 'PUT') {
      f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_ROLE_RESPONSE');
    } };
    assert.equal((await f.grants.runOnce('lost-response')).status, 'retry_scheduled');
    await f.admin.query("UPDATE sophie_core.outbox SET attempts = 10, available_at = clock_timestamp() WHERE kind = 'whitelist.grant'");
    assert.equal((await f.outbox.claim('attempt-budget', 30_000, ['whitelist.grant'])).parked, true);
    const issue = (await issues(f))[0], before = writes(f); assert.equal((await source(f, issue)).dispatch_started, true);
    assert.equal(await recheck(f, issue), 'shuttle_issue_recorded'); assert.equal((await source(f, issue)).dispatch_started, true);
    assert.equal((await audits(f))[0].dispatch_started, true); await f.drain(f.grants);
    assert.equal(writes(f), before); assert.equal((await f.rows('sessions'))[0].state.status, 'complete');
  });

  await scenario('R09 late-role reconciliation can recover after case closure without reviving grant authority', async f => {
    await f.pending(); const original = await f.outbox.claim('possible-grant', 30_000, ['whitelist.grant']);
    await f.store.inspectGrant({ claim: original.claim, observation: await f.discord.roles.observe(USER) });
    await f.store.noteUncertainGrant(original.claim); await f.outbox.park(original.claim, 'BOT_PERMISSION_MISSING');
    const cleanup = await f.outbox.claim('cleanup', 30_000, ['whitelist.reconcile']); await f.outbox.park(cleanup.claim, 'BOT_PERMISSION_MISSING');
    const issue = (await issues(f)).find(row => row.operation_id === cleanup.claim.operationId);
    await closeTestCase({ store: f.store, actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER), interactionId: f.nextId(), id: (await f.rows('shuttle_cases'))[0].case_id, worker: f.cases });
    f.discord.state.members.set(USER, [BYOND_ROLE, MUZZLED, WHITELIST]);
    const page = await f.deliveryIssues.queue(queue(f));
    assert.equal(page.entries.some(row => row.kind === 'grant'), false);
    assert.equal((await f.rows('outbox')).find(row => row.operation_id === original.claim.operationId).status, 'cancelled');
    assert.equal(page.entries.find(row => row.kind === 'reconcile').recheckable, true);
    assert.equal(await recheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.grants);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false); assert.equal(f.discord.state.members.get(USER).includes(MUZZLED), true);
    assert.equal((await f.rows('case_reservations'))[0].state, 'closed'); assert.equal((await source(f, issue)).status, 'done');
    assert.equal(f.discord.state.calls.some(call => call.method === 'PUT'), false);
  });

  await scenario('R10 rechecking a reconciliation preserves already earned current Whitelist', async f => {
    await f.pending(); const original = await f.outbox.claim('possible-grant', 30_000, ['whitelist.grant']);
    await f.store.inspectGrant({ claim: original.claim, observation: await f.discord.roles.observe(USER) });
    await f.store.noteUncertainGrant(original.claim);
    f.discord.state.members.get(USER).push(WHITELIST);
    await f.store.inspectGrant({ claim: original.claim, observation: await f.discord.roles.observe(USER), confirm: true });
    const cleanup = await f.outbox.claim('cleanup', 30_000, ['whitelist.reconcile']); await f.outbox.park(cleanup.claim, 'BOT_PERMISSION_MISSING');
    const issue = (await issues(f))[0]; assert.equal(await recheck(f, issue), 'shuttle_issue_recorded'); await f.drain(f.grants);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
    assert.equal(f.discord.state.calls.some(call => call.method === 'DELETE'), false);
  });

  await scenario('R11 stale channel proofs, changed audiences and closed cases cannot requeue a grant', async f => {
    const issue = await parked(f), request = await operation(f, issue), before = writes(f);
    await assert.rejects(f.store.recheckOnboardingDeliveryIssue({ ...request, proof: {} }), /CASE_OBSERVATION_UNTRUSTED/);
    const channel = f.discord.state.channels.get((await f.rows('case_reservations'))[0].channel_id);
    const overwrites = structuredClone(channel.permission_overwrites); channel.permission_overwrites = [];
    assert.equal(await recheck(f, issue), 'shuttle_issue_review'); channel.permission_overwrites = overwrites;
    f.clock.now += 15_001; await assert.rejects(f.store.recheckOnboardingDeliveryIssue({ ...request,
      actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER) }));
    await closeTestCase({ store: f.store, actor: await f.actor(OTHER), observation: await f.discord.roles.observe(USER), interactionId: f.nextId(), id: (await f.rows('shuttle_cases'))[0].case_id, worker: f.cases });
    assert.equal(await recheck(f, issue), 'shuttle_issue_stale'); assert.equal((await audits(f)).length, 0);
    assert.equal((await source(f, issue)).status, 'cancelled'); assert.equal(writes(f), before + 1); // Only read-only channel permissions changed.
  });

  await scenario('R12 delivery barriers and live leases survive rechecks without allowing old workers to finish', async f => {
    const issue = await parked(f), old = await source(f, issue);
    await f.admin.query('UPDATE sophie_core.discord_backoff SET paused = true');
    assert.equal(await recheck(f, issue), 'shuttle_issue_recorded'); assert.equal((await f.grants.runOnce('paused')).status, 'idle');
    await f.admin.query("UPDATE sophie_core.discord_backoff SET paused = false, until_at = clock_timestamp() + interval '1 minute'");
    assert.equal((await f.grants.runOnce('backoff')).status, 'idle');
    await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity'");
    const current = await f.outbox.claim('new-worker', 30_000, ['whitelist.grant']); assert.ok(current.claim.fence > old.fence);
    assert.equal(await recheck(f, (await issues(f))[0]), 'shuttle_issue_stale');
    await assert.rejects(f.store.inspectGrant({ claim: { ...current.claim, fence: old.fence, owner: 'blocked-grant' },
      observation: await f.discord.roles.observe(USER) }), /OUTBOX_LEASE_LOST/);
    await f.outbox.park(current.claim, 'BOT_PERMISSION_MISSING');
    const journal = createGatewayJournal({ pool: f.pool, mapping, clock: () => f.clock.now }); await journal.acquire('gateway-not-current');
    assert.equal(await recheck(f, (await issues(f))[0]), 'shuttle_issue_recorded');
    assert.equal((await f.grants.runOnce('gateway-gated')).status, 'idle');
  });

  await scenario('R13 issue registration and audit persistence fail atomically with the associated state change', async f => {
    await f.pending(); const job = await f.outbox.claim('park-transaction', 30_000, ['whitelist.grant']);
    await f.admin.query('ALTER TABLE sophie_core.shuttle_delivery_issues ADD CONSTRAINT synthetic_issue_failure CHECK (false) NOT VALID');
    try { await assert.rejects(f.outbox.park(job.claim, 'BOT_PERMISSION_MISSING'), { code: '23514' }); }
    finally { await f.admin.query('ALTER TABLE sophie_core.shuttle_delivery_issues DROP CONSTRAINT synthetic_issue_failure'); }
    assert.equal((await f.rows('outbox')).find(row => row.operation_id === job.claim.operationId).status, 'leased');
    assert.equal((await issues(f)).length, 0); assert.equal((await f.rows('shuttle_alerts')).length, 0);
    await f.outbox.park(job.claim, 'BOT_PERMISSION_MISSING'); const issue = (await issues(f))[0], receipts = (await f.rows('receipts')).length;
    await f.admin.query('ALTER TABLE sophie_core.shuttle_delivery_rechecks ADD CONSTRAINT synthetic_audit_failure CHECK (false) NOT VALID');
    try { assert.equal(await recheck(f, issue), 'unavailable'); }
    finally { await f.admin.query('ALTER TABLE sophie_core.shuttle_delivery_rechecks DROP CONSTRAINT synthetic_audit_failure'); }
    assert.equal((await source(f, issue)).status, 'parked'); assert.equal((await issues(f))[0].revision, issue.revision);
    assert.equal((await audits(f)).length, 0); assert.equal((await f.rows('receipts')).length, receipts);
  });

  await scenario('R14 retained cursors paginate distinct role issues after an earlier item is requeued', async f => {
    await f.pending(); const original = await f.outbox.claim('source', 30_000, ['whitelist.grant']);
    const plan = await f.store.inspectGrant({ claim: original.claim, observation: await f.discord.roles.observe(USER) }); assert.equal(plan.deliver, true);
    await f.outbox.park(original.claim, 'BOT_PERMISSION_MISSING');
    for (let index = 0; index < 6; index++) {
      await enqueue(f.pool, { kind: 'whitelist.reconcile', operationId: `${original.claim.operationId}.synthetic.${index}`,
        guildId: GUILD, userId: USER, sourceOperation: original.claim.operationId, accessEpoch: 0, eligibilityEpoch: 0 });
      const job = await f.outbox.claim('pagination', 30_000, ['whitelist.reconcile']); await f.outbox.park(job.claim, 'BOT_PERMISSION_MISSING');
    }
    const first = await f.deliveryIssues.queue(queue(f)); assert.equal(first.entries.length, 5);
    assert.equal(first.next, first.entries.at(-1).issueId);
    const removed = (await issues(f)).find(row => row.id === first.next); assert.equal(await recheck(f, removed), 'shuttle_issue_recorded');
    const second = await f.deliveryIssues.queue(queue(f, OTHER, first.next)); assert.equal(second.entries.length, 2); assert.equal(second.next, null);
    assert.equal(new Set([...first.entries, ...second.entries].map(row => row.issueId)).size, 7);
  });

  await scenario('R15 case binding, unknown identities and database privileges exclude unrelated work', async f => {
    const issue = await parked(f);
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.shuttle_delivery_issues'), { code: '42501' });
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.shuttle_delivery_rechecks'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.shuttle_delivery_rechecks'), { code: '42501' });
    assert.equal(await recheck(f, { ...issue, id: '0'.repeat(32) }), 'shuttle_issue_stale');
    await f.admin.query("UPDATE sophie_core.case_reservations SET type = 'head-admin-contact'");
    assert.equal((await f.deliveryIssues.queue(queue(f))).entries.length, 0);
    assert.equal(await recheck(f, issue), 'shuttle_issue_stale'); assert.equal((await audits(f)).length, 0);
  });

  await scenario('R16 signed loopback interactions acknowledge privately and return bounded mention-suppressed review controls', async f => {
    const issue = await parked(f), replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION,
      clock: () => f.clock.now, enabled: () => true, onboardingDeliveryIssues: f.deliveryIssues,
      fetch: async (_, options) => { replies.push(JSON.parse(options.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.commands,
      respond: responder.respond, enabled: () => true, onFault: code => faults.push(code) });
    const address = await server.listen();
    async function send(value) {
      const signed = f.identities.signed(value);
      const response = await fetch(`http://127.0.0.1:${address.port}/discord/interactions`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature-ed25519': signed.signature, 'x-signature-timestamp': signed.timestamp }, body: signed.body });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
    }
    try {
      await send(f.payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'issues' }] } }));
      assert.equal(replies[0].embeds.length, 1); assert.match(replies[0].components[0].components[0].custom_id, new RegExp(issue.id));
      assert.deepEqual(replies[0].allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
      await send(payload(f, issue)); assert.match(replies[1].content, /recheck recorded/); assert.equal((await audits(f)).length, 1);
      assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false); assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });

  await scenario('R17 migration backfills bound parked role jobs without replaying them or altering their evidence', async f => {
    const issue = await parked(f), before = await source(f, issue), client = await f.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('DROP TABLE sophie_core.shuttle_delivery_rechecks, sophie_core.shuttle_delivery_issues');
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/013-shuttle-delivery-issues.sql', import.meta.url), 'utf8'));
      const rows = (await client.query('SELECT * FROM sophie_core.shuttle_delivery_issues')).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].operation_id, before.operation_id); assert.equal(rows[0].revision, 0);
      assert.equal(rows[0].parked_fence, before.fence); assert.match(rows[0].id, /^[a-f0-9]{32}$/);
      const job = (await client.query('SELECT * FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2', [GUILD, before.operation_id])).rows[0];
      assert.deepEqual(job, before); assert.equal((await client.query('SELECT count(*) FROM sophie_core.shuttle_delivery_rechecks')).rows[0].count, '0');
    } finally { await client.query('ROLLBACK'); client.release(); }
    assert.equal((await issues(f))[0].id, issue.id);
  });
}
