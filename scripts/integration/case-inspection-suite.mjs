import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCaseInspectionStore } from '../../apps/core/storage/case-inspections.js';
import { createCaseReconciler } from '../../apps/core/discord/case-reconciler.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { ticketPayload } from '../../tests/fixtures/case-lifecycle.js';
import { casePolicy, CATEGORY } from '../../tests/fixtures/cases.js';
import { caseChannelPayload } from '../../modules/tickets/channel-policy.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { mapping } from '../../tests/fixtures/discord.js';

/** Deliberately omit Gateway events to exercise the independent, synthetic inspection path. */
export async function runCaseInspectionSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await onboardingWorkflow(cluster); await work(f);
    assert.equal(f.discord.state.calls.some(call => call.method === 'DELETE'), false);
  });
  const scheduler = (f, options = {}) => createCaseReconciler({ enabled: () => f.clock.enabled,
    store: createCaseInspectionStore({ pool: f.pool, policy: casePolicy, ...options }) });
  const periodic = async f => (await f.rows('outbox')).filter(row => row.operation_id.startsWith('case.periodic.'));
  const forceTick = f => f.admin.query("UPDATE sophie_core.case_inspection_sweeps SET not_before = '-infinity'");
  async function forceDue(f) { await forceTick(f); await f.admin.query("UPDATE sophie_core.case_provisions SET next_inspection_at = '-infinity'"); }
  const writes = f => f.discord.state.calls.filter(call => call.method !== 'GET');
  async function record(f, id = null) {
    const row = (await f.rows('case_reservations')).find(item => id === null || item.id === id);
    const p = (await f.rows('case_provisions')).find(item => item.case_id === row.id);
    return { row, p, plan: { id: row.id, guildId: GUILD, openerId: row.user_id, type: row.type,
      policyVersion: p.policy_version, token: p.operation_token, presenceEpoch: Number(p.presence_epoch) } };
  }
  async function exact(f, mode, id = null) {
    const { row, plan } = await record(f, id);
    await f.discord.channels.verification.channel(await f.discord.channels.inspect(plan, row.channel_id), plan, mode);
  }
  async function reserve(f, type = 'admin-help') {
    f.clock.now += 1_000; const id = `inspection-${f.nextId()}`;
    await f.store.reserveCase({ actor: await f.actor(USER), interactionId: f.nextId(), id, type,
      observation: await f.discord.roles.observe(USER), limits: { memberOpen: 20, guildPending: 20, cooldownMs: 1_000 } }); return id;
  }
  async function close(f) {
    const { row } = await record(f);
    assert.equal(await f.execute(ticketPayload(f, 'close', row, { member: { user: { id: OTHER } } })), 'case_change_recorded');
    await f.drain(f.cases);
  }
  async function job(f, row, status) {
    const operationId = `case.test.${row.id}`, effect = { kind: 'case.provision', guildId: GUILD,
      operationId, userId: row.user_id, caseId: row.id, type: row.type };
    await f.admin.query(`INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect, status, attempts,
      lease_owner, lease_until, available_at) VALUES ($1, $2, $3, 'case.provision', $4, $5, 9,
      CASE WHEN $5 = 'leased' THEN 'held-test-worker' END, CASE WHEN $5 = 'leased' THEN clock_timestamp() + interval '1 minute' END,
      clock_timestamp() + interval '1 minute')`, [GUILD, operationId, row.user_id, effect, status]);
  }

  await scenario('I01 batches and cross-process cadence are bounded and atomic without external calls', async f => {
    for (let index = 0; index < 4; index++) await reserve(f); await f.drain(f.cases);
    const unopened = await reserve(f), calls = f.discord.state.calls.length;
    const [first, second] = await Promise.all([scheduler(f, { batchSize: 2 }).runOnce(), scheduler(f, { batchSize: 2 }).runOnce()]);
    assert.deepEqual([first.status, second.status].sort(), ['scheduled', 'waiting']);
    assert.equal((await periodic(f)).length, 2); assert.equal(f.discord.state.calls.length, calls);
    assert.equal((await record(f, unopened)).p.inspection_revision, 0);
    await forceTick(f); const next = await scheduler(f, { batchSize: 2 }).runOnce();
    assert.equal(next.queued, 2); assert.equal((await periodic(f)).length, 4);
    assert.equal(new Set((await periodic(f)).map(row => row.effect.caseId)).size, 4);
    assert.ok((await scheduler(f).runOnce()).waitMs > 0);
  });

  await scenario('I02 locked cases are skipped without losing their later inspection or blocking the batch', async f => {
    const first = await reserve(f), second = await reserve(f); await f.drain(f.cases); const client = await f.pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT case_id FROM sophie_core.case_provisions WHERE case_id = $1 FOR UPDATE', [first]);
      assert.equal((await scheduler(f, { batchSize: 1 }).runOnce()).queued, 1);
      assert.equal((await periodic(f))[0].effect.caseId, second);
    } finally { await client.query('ROLLBACK'); client.release(); }
    await forceTick(f); assert.equal((await scheduler(f, { batchSize: 1 }).runOnce()).queued, 1);
    assert.deepEqual(new Set((await periodic(f)).map(row => row.effect.caseId)), new Set([first, second]));
  });

  await scenario('I03 pending and parked jobs preserve their attempts and deadlines instead of receiving fresh retries', async f => {
    for (let index = 0; index < 3; index++) await reserve(f); await f.drain(f.cases);
    const rows = await f.rows('case_reservations');
    for (const [index, status] of ['ready', 'leased', 'parked'].entries()) await job(f, rows[index], status);
    const before = await f.rows('outbox'), result = await scheduler(f).runOnce();
    assert.deepEqual(result, { status: 'scheduled', considered: 3, queued: 0, pending: 2, review: 1, waitMs: 10_000 });
    assert.deepEqual(await f.rows('outbox'), before); assert.equal((await periodic(f)).length, 0);
    assert.ok((await f.rows('case_provisions')).every(row => row.inspection_revision === 0));
  });

  await scenario('I04 uncertain channel creation stays parked and an inspection never issues a replacement POST', async f => {
    await reserve(f); f.discord.state.before = call => { if (call.method === 'POST') throw new Error('SYNTHETIC_TIMEOUT'); };
    assert.equal((await f.cases.runOnce('uncertain-create')).status, 'retry_scheduled'); f.discord.state.before = null;
    await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
    assert.equal((await f.cases.runOnce('uncertain-review')).code, 'CASE_CREATION_UNCERTAIN');
    const count = writes(f).length, before = await f.rows('outbox');
    assert.equal((await scheduler(f).runOnce()).review, 1); await forceDue(f);
    assert.equal((await scheduler(f).runOnce()).review, 1); assert.deepEqual(await f.rows('outbox'), before);
    assert.equal((await f.cases.runOnce('no-new-attempt')).status, 'idle'); assert.equal(writes(f).length, count);
  });

  await scenario('I05 missed open-channel drift is repaired with current Head Admin permissions and no new channel', async f => {
    const id = await reserve(f, 'head-admin-contact'); await f.drain(f.cases);
    const { row } = await record(f, id), channel = f.discord.state.channels.get(row.channel_id), before = writes(f).length;
    channel.parent_id = OTHER; channel.permission_overwrites = [{ id: STAFF, type: 0, allow: '1024', deny: '0' }];
    assert.equal((await scheduler(f).runOnce()).queued, 1); assert.equal(writes(f).length, before);
    await f.drain(f.cases); await exact(f, 'open', id); assert.equal(channel.parent_id, CATEGORY);
    assert.equal(channel.permission_overwrites.some(overwrite => overwrite.id === STAFF), false);
    assert.deepEqual((await record(f, id)).row, row);
    assert.deepEqual(writes(f).slice(before).map(call => call.method), ['PATCH']);
    assert.equal(await f.store.hasCaseExclusion({ guildId: GUILD, lineage: [channel.id] }), true);
  });

  await scenario('I06 closed channels return to read-only without reopening, erasing history or restoring Shuttle controls', async f => {
    await f.open(); await close(f); const { row, plan } = await record(f), session = await f.session(), audit = await f.rows('case_lifecycle_actions');
    f.discord.state.channels.get(row.channel_id).permission_overwrites = caseChannelPayload(plan, casePolicy, false).permission_overwrites;
    const before = writes(f).length; assert.equal((await scheduler(f).runOnce()).queued, 1); await f.drain(f.cases); await exact(f, 'closed');
    assert.deepEqual((await record(f)).row, row); assert.deepEqual(await f.session(), session); assert.deepEqual(await f.rows('case_lifecycle_actions'), audit);
    assert.equal(await f.current(), undefined); assert.deepEqual(writes(f).slice(before).map(call => call.method), ['PATCH']);
  });

  await scenario('I07 a missed departure seals the case and returning membership cannot revive its old presence epoch', async f => {
    await f.open(); const roles = f.discord.state.members.get(USER), before = writes(f).length; f.discord.state.members.delete(USER);
    assert.equal((await scheduler(f).runOnce()).queued, 1); await f.drain(f.cases); await exact(f, 'sealed');
    assert.equal((await record(f)).row.state, 'failed'); f.discord.state.members.set(USER, roles); await forceDue(f);
    assert.equal((await scheduler(f).runOnce()).queued, 1); await f.drain(f.cases); await exact(f, 'sealed');
    assert.equal((await record(f)).row.state, 'failed');
    assert.ok((await f.rows('members')).find(row => row.user_id === USER).state.presenceEpoch > 0);
    assert.ok(writes(f).slice(before).every(call => call.method === 'PATCH' && /\/channels\//.test(call.path)));
  });

  await scenario('I08 an unannounced duplicate is retained and sealed with the original before human selection', async f => {
    await f.open(); const { row, plan } = await record(f), original = f.discord.state.channels.get(row.channel_id);
    const duplicate = { ...structuredClone(original), id: f.nextId() }; f.discord.state.channels.set(duplicate.id, duplicate);
    const before = writes(f).length; assert.equal((await scheduler(f).runOnce()).queued, 1);
    const results = [];
    for (let index = 0; index < 4; index++) { const result = await f.cases.runOnce('periodic-duplicate'); results.push(result); if (result.status === 'operator_required') break; }
    assert.equal(results.at(-1).code, 'CASE_CHANNEL_DUPLICATE');
    for (const channel of [original, duplicate]) await f.discord.channels.verification.channel(await f.discord.channels.inspect(plan, channel.id), plan, true);
    assert.equal((await f.rows('case_channels')).length, 2); assert.equal((await f.rows('case_exclusions')).length, 2);
    assert.equal((await record(f)).row.state, 'pending'); assert.ok(writes(f).slice(before).every(call => call.method === 'PATCH'));
    await forceDue(f); assert.equal((await scheduler(f).runOnce()).review, 1); assert.equal((await periodic(f)).length, 1);
  });

  await scenario('I09 failed outbox, schedule or provision writes roll back the whole batch and core history stays protected', async f => {
    await f.open(); const provisions = await f.rows('case_provisions'), outbox = await f.rows('outbox');
    for (const [permission, table] of [['INSERT', 'outbox'], ['UPDATE', 'case_provisions'], ['UPDATE', 'case_inspection_sweeps']]) {
      await f.admin.query(`REVOKE ${permission} ON sophie_core.${table} FROM sophie_test_core`);
      try { await assert.rejects(scheduler(f).runOnce(), { code: '42501' }); }
      finally { await f.admin.query(`GRANT ${permission} ON sophie_core.${table} TO sophie_test_core`); }
      assert.deepEqual(await f.rows('case_provisions'), provisions); assert.deepEqual(await f.rows('outbox'), outbox);
      assert.equal((await f.rows('case_inspection_sweeps')).length, 0);
    }
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.case_inspection_sweeps'), { code: '42501' });
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.case_inspection_sweeps'), { code: '42501' });
  });

  await scenario('I10 changed immutable policy cannot queue work and incompatible older cases require review', async f => {
    await f.open(); const before = await f.rows('case_provisions');
    await assert.rejects(scheduler(f, { policy: { ...casePolicy, attachmentsAllowed: true } }).runOnce(), /CASE_POLICY_IMMUTABLE/);
    assert.deepEqual(await f.rows('case_provisions'), before); assert.equal((await periodic(f)).length, 0);
    const newer = { ...casePolicy, version: 2 };
    await f.admin.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, 2, $2)', [GUILD, newer]);
    await assert.rejects(scheduler(f).runOnce(), /CASE_POLICY_CHANGED/); assert.deepEqual(await f.rows('case_provisions'), before);
    assert.equal((await scheduler(f, { policy: newer }).runOnce()).review, 1); assert.equal((await periodic(f)).length, 0);
  });

  await scenario('I11 disabled delivery, server backoff and lost Gateway continuity cannot schedule inspections', async f => {
    await f.open(); const before = await f.rows('case_provisions'); f.clock.enabled = false;
    assert.deepEqual(await scheduler(f).runOnce(), { status: 'disabled' }); assert.equal((await f.rows('case_inspection_sweeps')).length, 0); f.clock.enabled = true;
    await f.outbox.pauseDiscordDelivery(); assert.deepEqual(await scheduler(f).runOnce(), { status: 'paused' });
    await f.admin.query("UPDATE sophie_core.discord_backoff SET paused = false, until_at = clock_timestamp() + interval '1 minute'");
    assert.deepEqual(await scheduler(f).runOnce(), { status: 'paused' });
    await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity'");
    const journal = createGatewayJournal({ pool: f.pool, mapping, clock: () => f.clock.now }); await journal.acquire('offline-inspection-test');
    assert.deepEqual(await scheduler(f).runOnce(), { status: 'paused' });
    assert.deepEqual(await f.rows('case_provisions'), before); assert.equal((await periodic(f)).length, 0);
  });

  await scenario('I12 rate-limited inspection keeps its original job and suppresses new work until the barrier clears', async f => {
    await f.open(); assert.equal((await scheduler(f).runOnce()).queued, 1);
    f.discord.state.before = call => call.method === 'GET' ? Response.json({ retry_after: 1, global: true }, { status: 429 }) : undefined;
    assert.equal((await f.cases.runOnce('rate-limited-inspection')).code, 'RATE_LIMITED'); await forceDue(f);
    assert.deepEqual(await scheduler(f).runOnce(), { status: 'paused' });
    const pending = (await periodic(f))[0]; assert.equal(pending.status, 'ready'); assert.equal(pending.attempts, 1);
    await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity'");
    assert.equal((await scheduler(f).runOnce()).pending, 1); assert.equal((await periodic(f)).length, 1);
    f.discord.state.before = null; f.clock.now += 2_000; await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE status = 'ready'");
    await f.drain(f.cases); assert.equal((await periodic(f))[0].status, 'done');
  });

  await scenario('I13 a queued inspection follows later closure intent rather than replaying an open snapshot', async f => {
    await f.open(); assert.equal((await scheduler(f).runOnce()).queued, 1); await close(f); await exact(f, 'closed');
    assert.equal((await periodic(f))[0].status, 'done'); assert.equal((await record(f)).row.state, 'closed');
    assert.equal((await f.rows('case_lifecycle_actions'))[0].status, 'confirmed');
  });

  await scenario('I14 migration preserves existing cases and introduces due metadata without fabricated successful inspections', async f => {
    await f.open(); await close(f); const before = (await record(f)).row, jobs = await f.rows('outbox'), client = await f.admin.connect();
    try {
      await client.query('BEGIN'); await client.query('DROP TABLE sophie_core.case_inspection_sweeps');
      await client.query('ALTER TABLE sophie_core.case_provisions DROP COLUMN next_inspection_at, DROP COLUMN inspection_revision, DROP COLUMN last_inspection_operation_id');
      await client.query('DROP INDEX sophie_core.case_outstanding_inspections');
      await client.query(await readFile(new URL('../../apps/core/storage/migrations/018-case-inspections.sql', import.meta.url), 'utf8'));
      assert.deepEqual((await client.query('SELECT * FROM sophie_core.case_reservations')).rows[0], before);
      const p = (await client.query('SELECT *, next_inspection_at <= clock_timestamp() AS due FROM sophie_core.case_provisions')).rows[0];
      assert.equal(p.due, true); assert.equal(p.inspection_revision, 0); assert.equal(p.last_inspection_operation_id, null);
      assert.deepEqual((await client.query('SELECT * FROM sophie_core.outbox')).rows, jobs);
      assert.equal((await client.query('SELECT * FROM sophie_core.case_inspection_sweeps')).rowCount, 0);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
}
