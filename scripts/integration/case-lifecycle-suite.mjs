import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { GUILD, USER, OTHER, STAFF, LEAD } from '../../tests/fixtures/domain.js';
import { CREW, MUZZLED, WHITELIST, BYOND_ROLE, mapping } from '../../tests/fixtures/discord.js';
import { casePolicy } from '../../tests/fixtures/cases.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { caseChannelPayload } from '../../modules/tickets/channel-policy.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createCaseChannels } from '../../apps/core/discord/case-channels.js';
import { createDiscordRoles } from '../../apps/core/discord/roles.js';
import { createDiscordTransport } from '../../apps/core/discord/transport.js';
import { createInteractionResponder } from '../../apps/core/discord/interaction-response.js';
import { createInteractionHttpServer } from '../../apps/core/discord/interaction-http.js';

/** Synthetic lifecycle metadata and fixed bot controls only; never human case content. */
export async function runCaseLifecycleSuite(cluster, run) {
  const scenario = (name, work, options = {}) => run(name, async () => work(await onboardingWorkflow(cluster, options)));
  const state = async f => { const rows = await f.rows('case_reservations'); return rows.find(row => row.type === 'shuttle') ?? rows[0]; };
  const actions = f => f.rows('case_lifecycle_actions');
  const payload = (f, action, row, overrides) => ticketPayload(f, action, row, { member: { user: { id: OTHER } }, ...overrides });
  const act = async (f, action, row, overrides) => f.execute(payload(f, action, row ?? await state(f), overrides));
  const due = f => f.admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second' WHERE status = 'ready'");
  const writes = f => f.discord.state.calls.filter(call => call.method !== 'GET');
  async function exact(f, mode) {
    const row = await state(f), p = (await f.rows('case_provisions'))[0];
    const plan = { id: row.id, guildId: GUILD, openerId: row.user_id, type: row.type, policyVersion: p.policy_version,
      token: p.operation_token, presenceEpoch: Number(p.presence_epoch) };
    await f.discord.channels.verification.channel(await f.discord.channels.inspect(plan, row.channel_id), plan, mode);
  }
  async function closed(f) { await f.open(); assert.equal(await act(f, 'close'), 'case_change_recorded'); await f.drain(f.cases); f.clock.now += 1_000; }
  function independentWorker(f) {
    const clock = () => f.clock.now, enabled = () => f.clock.enabled;
    const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-test-token-not-a-secret', fetch: f.discord.fetch, clock, enabled });
    const roles = createDiscordRoles({ transport, mapping, clock, readContinuity: f.discord.roles.readContinuity });
    const channels = createCaseChannels({ transport, roles, mapping, policy: casePolicy, clock });
    const store = createCoreStore({ pool: f.pool, clock, authorize: f.authorization.authorize,
      authorizeRecorded: f.authorization.authorizeRecorded, casePolicy, caseVerification: channels.verification });
    return createCaseDispatcher({ outbox: f.outbox, store, roles, channels, enabled });
  }

  await scenario('J01 close intent is audited and pending until verified read-only permissions; records and exclusions remain', async f => {
    const screen = await f.open(), before = await state(f), count = writes(f).length;
    assert.equal(await act(f, 'close'), 'case_change_recorded'); const pending = await state(f);
    assert.equal(pending.state, 'closing'); assert.equal(pending.version, before.version + 1); assert.equal(writes(f).length, count);
    const audit = (await actions(f))[0]; assert.equal(audit.reason, 'resolved'); assert.equal(audit.operator_grant.userId, OTHER); assert.equal(audit.status, 'pending');
    assert.equal(await f.current(), undefined); assert.equal(await f.execute(f.control(screen, 'advance')), 'shuttle_review');
    await f.drain(f.cases); await exact(f, 'closed'); assert.equal((await state(f)).state, 'closed'); assert.equal((await actions(f))[0].status, 'confirmed');
    await f.drain(f.screens); assert.deepEqual(f.discord.state.messages.get(screen.message_id).components, []);
    for (const table of ['case_reservations', 'case_channels', 'case_exclusions', 'sessions', 'shuttle_cases']) assert.equal((await f.rows(table)).length, 1);
    assert.equal(writes(f).some(call => call.method === 'DELETE'), false);
  });

  await scenario('J02 duplicate requests are idempotent while competing versions and receipt collisions cannot add actions', async f => {
    await f.open(); const request = payload(f, 'close', await state(f));
    const results = await Promise.all([f.execute(request), f.execute(request)]); assert.deepEqual(results, ['case_change_recorded', 'case_change_recorded']);
    assert.equal((await actions(f)).length, 1);
    assert.equal(await f.execute({ ...request, id: f.nextId() }), 'case_stale');
    const conflict = structuredClone(request); conflict.data.options[0].options[1].value = 'duplicate';
    assert.equal(await f.execute(conflict), 'unavailable'); assert.equal((await actions(f)).length, 1);
    await f.drain(f.cases); assert.equal(await f.execute(request), 'case_change_recorded'); assert.equal((await state(f)).state, 'closed');
  });

  await scenario('J03 close and reopen require fresh responder authority and Head Admin contact excludes ordinary Staff', async f => {
    await f.store.reserveCase({ actor: await f.actor(USER), interactionId: f.nextId(), id: 'head-case', type: 'head-admin-contact',
      observation: await f.discord.roles.observe(USER), limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 } }); await f.drain(f.cases);
    assert.equal(await act(f, 'close'), 'denied'); assert.deepEqual(await f.caseLifecycle.status(f.verified(payload(f, 'status', await state(f)))), { state: 'denied' });
    f.discord.state.members.set(OTHER, [LEAD]); assert.equal(await act(f, 'close'), 'case_change_recorded'); await f.drain(f.cases); await exact(f, 'closed');
    f.clock.now += 1_000; f.discord.state.members.set(OTHER, [STAFF]); assert.equal(await act(f, 'reopen'), 'denied');
    f.discord.state.members.set(OTHER, [LEAD, MUZZLED]); assert.equal(await act(f, 'reopen'), 'denied');
    assert.equal((await actions(f)).length, 1);
  });

  await scenario('J04 audit or outbox failure rolls back closure, screen retirement and the interaction receipt together', async f => {
    await f.open(); const before = await state(f), screen = await f.current(), receiptCount = (await f.rows('receipts')).length;
    for (const table of ['case_lifecycle_actions', 'outbox']) {
      await f.admin.query(`REVOKE INSERT ON sophie_core.${table} FROM sophie_test_core`);
      try { assert.equal(await act(f, 'close'), 'unavailable'); }
      finally { await f.admin.query(`GRANT INSERT ON sophie_core.${table} TO sophie_test_core`); }
      assert.deepEqual(await state(f), before); assert.deepEqual(await f.current(), screen); assert.equal((await actions(f)).length, 0);
      assert.equal((await f.rows('receipts')).length, receiptCount);
    }
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_lifecycle_actions'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_lifecycle_actions'), { code: '42501' });
  });

  await scenario('J05 reopening is explicit, audited, quota-bound and does not restore retired controls or progress automatically', async f => {
    await closed(f); const session = await f.session(), posts = writes(f).filter(call => call.method === 'POST').length;
    assert.equal(await act(f, 'reopen'), 'case_change_recorded'); assert.equal((await state(f)).state, 'pending'); await f.drain(f.cases);
    assert.equal((await state(f)).state, 'open'); await exact(f, 'open'); assert.deepEqual(await f.session(), session); assert.equal(await f.current(), undefined);
    assert.equal(writes(f).filter(call => call.method === 'POST').length, posts);
    assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); await f.drain(f.screens); assert.equal((await f.current()).ready, true);
    assert.equal((await actions(f)).find(row => row.action === 'reopen').status, 'confirmed');
  });

  await scenario('J06 lost operator authority before or after a reopening write is compensated and never restored from old authority', async f => {
    await closed(f); assert.equal(await act(f, 'reopen'), 'case_change_recorded'); f.discord.state.members.set(OTHER, []);
    await f.drain(f.cases); await exact(f, 'closed'); assert.equal((await actions(f)).find(row => row.action === 'reopen').status, 'revoked');
    f.discord.state.members.set(OTHER, [STAFF]); assert.equal((await f.cases.runOnce('no-auto-reopen')).status, 'idle');
    f.clock.now += 1_000; assert.equal(await act(f, 'reopen'), 'case_change_recorded');
    f.discord.state.afterWrite = call => { if (call.method === 'PATCH' && /channels\/\d+$/.test(call.path)) { f.discord.state.afterWrite = null; f.discord.state.members.set(OTHER, []); } };
    assert.equal((await f.cases.runOnce('revoked-after-write')).status, 'progressed'); await f.drain(f.cases);
    await exact(f, 'closed'); assert.equal((await actions(f)).filter(row => row.action === 'reopen').every(row => row.status === 'revoked'), true);
  });

  await scenario('J07 leaving during reopening seals the case and rejoining requires a new request and fresh Shuttle', async f => {
    await closed(f); const oldSession = await f.session(); assert.equal(await act(f, 'reopen'), 'case_change_recorded');
    f.discord.state.members.delete(USER); await f.drain(f.cases); await exact(f, 'sealed');
    assert.equal((await actions(f)).find(row => row.action === 'reopen').status, 'ineligible'); assert.equal(await f.session(), undefined);
    f.discord.state.members.set(USER, [CREW, BYOND_ROLE]); f.clock.now += 1_000;
    assert.equal(await act(f, 'reopen'), 'case_change_recorded'); await f.drain(f.cases); await exact(f, 'open');
    assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); await f.drain(f.screens);
    assert.notEqual((await f.session()).id, oldSession.id); assert.equal((await f.session()).stepIndex, 0);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('J08 closure cancels pending grants; reopening requires a new final acknowledgement and preserves earned Whitelist', async f => {
    const pending = await f.pending(), oldScreen = await f.current(); assert.equal(await act(f, 'close'), 'case_change_recorded');
    assert.equal((await f.session()).status, 'active'); assert.ok((await f.session()).version > pending.version);
    assert.equal((await f.rows('outbox')).find(row => row.kind === 'whitelist.grant').status, 'cancelled');
    await f.drain(f.cases); f.clock.now += 1_000; assert.equal(await act(f, 'reopen'), 'case_change_recorded'); await f.drain(f.cases);
    assert.equal(await f.execute(f.control(oldScreen, 'advance')), 'shuttle_stale'); assert.equal((await f.grants.runOnce('no-old-grant')).status, 'idle');
    assert.equal(await f.execute(f.payload()), 'shuttle_recorded'); await f.drain(f.screens);
    assert.equal(await f.click('advance'), 'shuttle_progress_recorded'); await f.drain(f.grants);
    assert.equal((await f.rows('sessions')).find(row => row.id === pending.id).state.status, 'complete');
    assert.equal(await act(f, 'close'), 'case_change_recorded'); await f.drain(f.cases);
    assert.equal((await f.rows('sessions')).find(row => row.id === pending.id).state.status, 'complete'); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), true);
  });

  await scenario('J09 pending possible grants are compensated after closure, and help pauses and Muzzled remain binding', async f => {
    await f.pending(); const job = await f.outbox.claim('possible-grant', 30_000, ['whitelist.grant']);
    await f.store.inspectGrant({ claim: job.claim, observation: await f.discord.roles.observe(USER) });
    assert.equal(await act(f, 'close'), 'case_change_recorded'); f.discord.state.members.get(USER).push(WHITELIST);
    assert.equal((await f.store.inspectGrant({ claim: job.claim, observation: await f.discord.roles.observe(USER), confirm: true })).reason, 'GRANT_MISMATCH');
    await f.drain(f.grants); assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
    const paused = await onboardingWorkflow(cluster, { helpPauses: true }); await paused.open(); assert.equal(await paused.click('help'), 'shuttle_help_paused');
    assert.equal(await act(paused, 'close'), 'case_change_recorded'); await paused.drain(paused.cases); paused.clock.now += 1_000;
    assert.equal(await act(paused, 'reopen'), 'case_change_recorded'); await paused.drain(paused.cases); assert.equal((await paused.session()).helpPaused, true);
    paused.discord.state.members.set(USER, [MUZZLED, BYOND_ROLE]); assert.equal(await paused.execute(paused.payload()), 'denied');
    assert.equal(paused.discord.state.members.get(USER).includes(WHITELIST), false);
  });

  await scenario('J10 reopening respects member limits, closing capacity and cooldown while retries do not reserve twice', async f => {
    await closed(f); const closedCase = await state(f), limits = { memberOpen: 2, guildPending: 3, cooldownMs: 1_000 };
    for (let index = 0; index < 2; index++) {
      await f.store.reserveCase({ actor: await f.actor(USER), interactionId: f.nextId(), id: `other-${index}`, type: 'admin-help',
        observation: await f.discord.roles.observe(USER), limits }); await f.drain(f.cases); f.clock.now += 1_000;
    }
    const another = (await f.rows('case_reservations')).find(row => row.id === 'other-0');
    assert.equal(await act(f, 'close', another), 'case_change_recorded');
    assert.equal(await act(f, 'reopen', closedCase), 'case_capacity'); await f.drain(f.cases);
    const request = payload(f, 'reopen', closedCase); assert.equal(await f.execute(request), 'case_change_recorded'); assert.equal(await f.execute(request), 'case_change_recorded');
    await f.drain(f.cases); assert.equal(await act(f, 'close'), 'case_change_recorded'); await f.drain(f.cases);
    assert.equal(await act(f, 'reopen'), 'case_capacity'); assert.equal((await actions(f)).filter(row => row.action === 'reopen').length, 1);
  });

  await scenario('J11 delivery pause, lost responses and restartable work do not falsely confirm or create another channel', async f => {
    await f.open(); f.clock.enabled = false; assert.equal(await act(f, 'close'), 'disabled'); f.clock.enabled = true;
    await f.admin.query('UPDATE sophie_core.discord_backoff SET paused = true'); assert.equal(await act(f, 'close'), 'case_change_recorded');
    assert.equal((await f.cases.runOnce('paused-close')).status, 'idle'); assert.equal((await state(f)).state, 'closing');
    await f.admin.query('UPDATE sophie_core.discord_backoff SET paused = false');
    f.discord.state.afterWrite = call => { if (call.method === 'PATCH') { f.discord.state.afterWrite = null; throw new Error('SYNTHETIC_LOST_RESPONSE'); } };
    assert.equal((await f.cases.runOnce('lost-close-response')).status, 'retry_scheduled'); assert.equal((await state(f)).state, 'closing');
    const count = writes(f).length; await due(f); await f.drain(f.cases); assert.equal(writes(f).length, count); await exact(f, 'closed');
    assert.equal((await f.rows('case_channels')).length, 1);
  });

  await scenario('J12 a late reopening write after a newer closure is retained and compensated under current intent', async f => {
    await closed(f); assert.equal(await act(f, 'reopen'), 'case_change_recorded'); const worker = independentWorker(f);
    f.discord.state.before = async call => {
      if (call.method !== 'PATCH' || !/channels\/\d+$/.test(call.path)) return; f.discord.state.before = null;
      assert.equal(await act(f, 'close'), 'case_change_recorded');
      await f.admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE status = 'leased'");
      await f.drain(f.cases); assert.equal((await state(f)).state, 'closed');
    };
    assert.equal((await worker.runOnce('late-reopen')).status, 'lease_lost'); await exact(f, 'open');
    await f.drain(f.cases); await exact(f, 'closed'); assert.equal((await state(f)).state, 'closed');
    assert.equal((await actions(f)).find(row => row.action === 'reopen').status, 'superseded');
  });

  await scenario('J13 a late closure write after confirmed reopening is repaired without undoing the newer authorised request', async f => {
    await f.open(); assert.equal(await act(f, 'close'), 'case_change_recorded'); const worker = independentWorker(f);
    f.discord.state.before = async call => {
      if (call.method !== 'PATCH' || !/channels\/\d+$/.test(call.path)) return; f.discord.state.before = null;
      await f.admin.query("UPDATE sophie_core.outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE status = 'leased'");
      await f.drain(f.cases); f.clock.now += 1_000; assert.equal(await act(f, 'reopen'), 'case_change_recorded'); await f.drain(f.cases);
    };
    assert.equal((await worker.runOnce('late-close')).status, 'lease_lost'); await exact(f, 'closed');
    f.discord.state.members.set(OTHER, []); await f.drain(f.cases); await exact(f, 'open'); assert.equal((await state(f)).state, 'open');
  });

  await scenario('J14 migration preserves legacy sealed cases and records no invented approval or role changes', async f => {
    await f.open(); const client = await f.admin.connect();
    try {
      await client.query('BEGIN'); await client.query('DROP TABLE sophie_core.case_lifecycle_actions');
      await client.query('ALTER TABLE sophie_core.case_reservations DROP COLUMN version, DROP COLUMN desired_access');
      await client.query("UPDATE sophie_core.case_reservations SET state = 'closed'");
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/016-case-lifecycle.sql', import.meta.url), 'utf8'));
      const row = (await client.query('SELECT * FROM sophie_core.case_reservations')).rows[0]; assert.equal(row.desired_access, 'sealed'); assert.equal(row.version, 0);
      assert.equal((await client.query('SELECT * FROM sophie_core.case_lifecycle_actions')).rowCount, 0);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  await scenario('J15 signed loopback status and lifecycle commands reply privately, suppress mentions and reauthorize before delivery', async f => {
    await f.open(); const replies = [], faults = [];
    const responder = createInteractionResponder({ verifier: f.identities.verifier, applicationId: APPLICATION, clock: () => f.clock.now,
      enabled: () => f.clock.enabled, caseLifecycle: f.caseLifecycle, fetch: async (_, value) => { replies.push(JSON.parse(value.body)); return Response.json({}); } });
    const server = createInteractionHttpServer({ verifier: f.identities.verifier, commands: f.commands, respond: responder.respond,
      enabled: () => f.clock.enabled, onFault: code => faults.push(code) }); const address = await server.listen();
    async function send(value) {
      const signed = f.identities.signed(value), response = await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST', body: signed.body,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': signed.signature, 'X-Signature-Timestamp': signed.timestamp } });
      assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } }); await server.drain();
    }
    try {
      const row = await state(f); await send(payload(f, 'status', null, { channel_id: row.channel_id })); assert.match(replies[0].embeds[0].description, /State: Open/);
      await send(payload(f, 'close', row)); assert.match(replies[1].embeds[0].description, /Closing · permissions not yet confirmed/);
      await f.drain(f.cases); await send(payload(f, 'status', await state(f))); assert.match(replies[2].embeds[0].description, /State: Closed/);
      const envelope = f.verified(payload(f, 'status', await state(f))); assert.equal(await f.commands.execute(envelope), 'case_status');
      f.discord.state.members.set(OTHER, []); await responder.respond(envelope, 'case_status'); assert.deepEqual(replies.at(-1).embeds, []);
      for (const reply of replies) assert.deepEqual(reply.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false }); assert.deepEqual(faults, []);
    } finally { await server.close(); }
  });

  await scenario('J16 closed and sealed cases still reconcile role changes and every registered candidate channel', async f => {
    const journal = createGatewayJournal({ pool: f.pool, mapping, clock: () => f.clock.now });
    const { lease } = await journal.acquire('closed-case-gateway'); await journal.identify(lease);
    await journal.ready(lease, { sessionId: 'synthetic-closed-case-session', resumeUrl: 'wss://gateway.discord.gg/', sequence: 1 });
    await journal.dispatch(lease, { sessionId: 'synthetic-closed-case-session', sequence: 2, change: { kind: 'guild', available: true } });
    await closed(f); const row = await state(f), canonical = f.discord.state.channels.get(row.channel_id);
    canonical.permission_overwrites = [];
    await journal.dispatch(lease, { sessionId: 'synthetic-closed-case-session', sequence: 3, change: { kind: 'role', roleId: STAFF, deleted: false } });
    await f.drain(f.cases); await exact(f, 'closed');
    const duplicate = { ...structuredClone(canonical), id: f.nextId(), permission_overwrites: [] };
    f.discord.state.channels.set(duplicate.id, duplicate);
    await f.admin.query('INSERT INTO sophie_core.case_channels (guild_id, channel_id, case_id) VALUES ($1, $2, $3)', [GUILD, duplicate.id, row.id]);
    await journal.dispatch(lease, { sessionId: 'synthetic-closed-case-session', sequence: 4,
      change: { kind: 'channel', channelId: duplicate.id, parentId: duplicate.parent_id } });
    assert.equal((await f.rows('outbox')).some(job => job.kind === 'case.provision' && job.status === 'ready'), true);
    assert.equal((await f.cases.runOnce('seal-canonical-ambiguity')).status, 'progressed');
    assert.equal((await f.cases.runOnce('seal-registered-duplicate')).status, 'progressed');
    assert.equal((await f.cases.runOnce('review-closed-ambiguity')).code, 'CASE_CHANNEL_DUPLICATE');
  });

  await scenario('J17 cancelling a pending reopening of a legacy sealed case cannot grant historical read access', async f => {
    await closed(f); const row = await f.store.describeCase({ actor: await f.actor(OTHER), guildId: GUILD, id: (await state(f)).id });
    await f.admin.query("UPDATE sophie_core.case_reservations SET desired_access = 'sealed' WHERE id = $1", [row.id]);
    f.discord.state.channels.get(row.channelId).permission_overwrites = caseChannelPayload(row.plan, casePolicy, 'sealed').permission_overwrites;
    assert.equal(await act(f, 'reopen'), 'case_change_recorded'); assert.equal(await act(f, 'close'), 'case_change_recorded');
    await f.drain(f.cases); await exact(f, 'sealed'); assert.equal((await state(f)).state, 'closed');
    assert.equal((await state(f)).desired_access, 'sealed'); assert.equal((await actions(f)).find(row => row.action === 'reopen').status, 'superseded');
  });
}
