import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { migrateCore, verifyCoreMigrations } from '../../apps/core/storage/migrate.js';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { createOnboardingChannelClosure } from '../../apps/core/discord/onboarding-channel-lifecycle.js';
import { GUILD, USER, OTHER } from '../../tests/fixtures/domain.js';
import { WHITELIST } from '../../tests/fixtures/discord.js';

export async function runOnboardingChannelLifecycleSuite(cluster, run) {
  const scenario = (name, work, options) => run(name, async () => work(await onboardingWorkflow(cluster, options)));
  const bound = async f => (await f.rows('case_reservations')).find(row => row.onboarding_retirement === null);
  const cleanup = async (f, id) => f.store.scheduleOnboardingCleanup({ id, observation: await f.discord.roles.observe(USER) });
  const closure = f => createOnboardingChannelClosure({ authorization: f.authorization, roles: f.discord.roles, channels: f.discord.channels, store: f.store, enabled: () => f.clock.enabled });
  const close = async (f, channelId, userId = OTHER, confirmed = true) => closure(f).execute(f.verified(f.payload({ member: { user: { id: userId } },
    data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'close', options: [{ type: 5, name: 'confirm', value: confirmed }, { type: 7, name: 'channel', value: channelId }] }] } })));

  await scenario('OC01 confirmed channel deletion recreates the destination with pinned progress and inert old controls', async f => {
    await f.open(); await f.click('advance'); await f.drain(f.screens);
    const before = await f.session(), screen = await f.current(), old = await bound(f);
    f.discord.state.channels.delete(old.channel_id); f.clock.now += 1_001;
    await f.open();
    assert.deepEqual(await f.session(), before);
    const replacement = await bound(f); assert.notEqual(replacement.id, old.id); assert.notEqual(replacement.channel_id, old.channel_id);
    assert.equal((await f.rows('case_reservations')).find(row => row.id === old.id).onboarding_retirement, 'removed');
    assert.deepEqual((await f.rows('shuttle_cases'))[0].previous_case_ids, [old.id]);
    assert.notEqual(await f.execute(f.control(screen, 'advance')), 'shuttle_progress_recorded');
    assert.equal((await f.rows('outbox')).some(row => row.kind === 'whitelist.grant'), false);
  });
  await scenario('OC02 permission denial never certifies a channel as missing or replaces a run', async f => {
    await f.open(); const old = await bound(f);
    f.discord.state.before = call => call.path.endsWith('/channels/' + old.channel_id) ? Response.json({ code: 50001 }, { status: 403 }) : undefined;
    assert.equal(await f.execute(f.payload()), 'unavailable');
    assert.equal((await bound(f)).id, old.id); assert.equal((await f.rows('case_reservations')).length, 1);
  });
  await scenario('OC03 missing-channel recovery preserves a help pause and its existing Staff resolution', async f => {
    await f.open(); await f.click('help'); await f.drain(f.screens);
    const old = await bound(f), before = await f.session();
    f.discord.state.channels.delete(old.channel_id); f.clock.now += 1_001; await f.open();
    assert.deepEqual(await f.session(), before); assert.equal((await f.session()).helpPaused, true);
    const help = (await f.rows('shuttle_help_requests')).find(row => row.status === 'open');
    assert.equal(await f.resolve(help), 'shuttle_help_resumed');
    assert.equal((await f.session()).helpPaused, false);
  }, { helpPauses: true });
  await scenario('OC04 confirmed Staff closure deletes only the selected Onboarding channel and allows resume', async f => {
    await f.open(); const old = await bound(f), session = await f.session();
    assert.equal(await close(f, old.channel_id, USER), 'denied');
    assert.equal(await close(f, old.channel_id, OTHER, false), 'denied');
    assert.equal(await close(f, old.channel_id), 'shuttle_closed');
    await f.drain(f.cases); await f.drain(f.screens);
    assert.equal(f.discord.state.channels.has(old.channel_id), false);
    assert.equal((await f.rows('sessions')).length, 1);
    f.clock.now += 1_001; await f.open(); assert.deepEqual(await f.session(), session);
    assert.equal((await f.rows('case_reservations')).length, 2);
  });
  await scenario('OC05 active channels expire at three days, with page activity resetting the deadline', async f => {
    await f.open(); const old = await bound(f);
    f.clock.now += 72 * 3_600_000 - 1; assert.equal(await cleanup(f, old.id), false);
    await f.click('advance'); await f.drain(f.screens);
    f.clock.now += 1; assert.equal(await cleanup(f, old.id), false);
    f.clock.now += 72 * 3_600_000; assert.equal(await cleanup(f, old.id), true);
    await f.drain(f.cases); assert.equal(f.discord.state.channels.has(old.channel_id), false);
  });
  await scenario('OC06 completed channels expire at one hour and repeating never regrants Whitelist', async f => {
    await f.pending(); await f.drain(f.grants); await f.drain(f.screens);
    const old = await bound(f); assert.ok(f.discord.state.members.get(USER).includes(WHITELIST));
    f.clock.now += 3_600_000 - 1; assert.equal(await cleanup(f, old.id), false);
    f.clock.now += 1; assert.equal(await cleanup(f, old.id), true);
    await f.drain(f.cases); await f.drain(f.screens); await f.open();
    assert.equal((await f.session()).mode, 'refresh'); assert.equal((await f.session()).stepIndex, 0);
    assert.ok(f.discord.state.members.get(USER).includes(WHITELIST));
  });
  await scenario('OC07 unresolved help and pending grants block automatic retirement', async f => {
    await f.open(); await f.click('help'); const old = await bound(f);
    f.clock.now += 73 * 3_600_000; assert.equal(await cleanup(f, old.id), false);
    assert.deepEqual(await f.store.nextOnboardingCleanup(), []);
  }, { helpPauses: true });
  await scenario('OC08 manual closure cancels a pending grant and requires fresh final acknowledgement after resume', async f => {
    await f.pending(); const old = await bound(f);
    assert.equal(await close(f, old.channel_id), 'shuttle_closed');
    await f.drain(f.cases); await f.drain(f.grants); await f.drain(f.screens);
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
    f.clock.now += 1_001; await f.open(); assert.equal((await f.session()).status, 'active');
    assert.equal(f.discord.state.members.get(USER).includes(WHITELIST), false);
  });
  await scenario('OC09 revoked Staff authority prevents a queued manual deletion', async f => {
    await f.open(); const old = await bound(f); await close(f, old.channel_id);
    f.discord.state.members.set(OTHER, []);
    const result = await f.cases.runOnce('revoked-closer');
    assert.equal(result.status, 'operator_required'); assert.equal(f.discord.state.channels.has(old.channel_id), true);
  });
  await scenario('OC10 a missing proof is bound to its exact channel and cannot delete another case', async f => {
    await f.open(); const old = await bound(f);
    const descriptor = await f.store.describeOnboardingEntryChannel({ actor: await f.actor(), observation: await f.discord.roles.observe(USER) });
    const proof = await f.discord.channels.inspectPresence(descriptor.plan, old.channel_id);
    await assert.rejects(f.store.recoverMissingOnboardingChannel({ actor: await f.actor(), observation: await f.discord.roles.observe(USER), id: old.id, proof }), /CASE_CHANNEL_NOT_MISSING/);
    await assert.rejects(f.store.recoverMissingOnboardingChannel({ actor: await f.actor(), observation: await f.discord.roles.observe(USER), id: old.id, proof: { missing: true } }), /CASE_OBSERVATION_UNTRUSTED/);
    assert.equal((await bound(f)).onboarding_retirement, null);
  });
  await scenario('OC11 a lost delete response is reconciled by absence without a second delete', async f => {
    await f.open(); const old = await bound(f); await close(f, old.channel_id);
    f.discord.state.afterWrite = call => { if (call.method === 'DELETE' && call.path.endsWith('/channels/' + old.channel_id)) throw Error('synthetic lost response'); };
    assert.equal((await f.cases.runOnce('lost-delete')).status, 'retry_scheduled');
    assert.equal(f.discord.state.channels.has(old.channel_id), false);
    f.discord.state.afterWrite = null;
    await f.admin.query("UPDATE sophie_core.outbox SET available_at=clock_timestamp() WHERE kind='case.provision' AND status='ready'");
    await f.drain(f.cases);
    assert.equal(f.discord.state.calls.filter(call => call.method === 'DELETE' && call.path.endsWith('/channels/' + old.channel_id)).length, 1);
    assert.equal((await f.rows('case_reservations')).find(row => row.id === old.id).onboarding_retirement, 'removed');
  });
  await scenario('OC12 pending grants stay outside automatic cleanup', async f => {
    await f.pending(); const old = await bound(f); f.clock.now += 73 * 3_600_000;
    assert.equal(await cleanup(f, old.id), false); assert.deepEqual(await f.store.nextOnboardingCleanup(), []);
  });
  await scenario('OC13 schema053 upgrade preserves old fields and gives existing channels a full grace period', async f => {
    await f.open(); const historical = await cluster.recovery.createHistoricalSource(), db = historical.pool;
    await db.query('CREATE SCHEMA sophie_migrations; CREATE TABLE sophie_migrations.applied (id text PRIMARY KEY,sha256 text NOT NULL)');
    const directory = new URL('../../apps/core/storage/migrations/', import.meta.url);
    for (const id of (await readdir(directory)).filter(name => /^0\d\d-.*\.sql$/.test(name)).sort().slice(0,53)) {
      const sql = await readFile(new URL(id,directory),'utf8'); await db.query(sql);
      await db.query('INSERT INTO sophie_migrations.applied VALUES ($1,$2)',[id,createHash('sha256').update(sql).digest('hex')]);
    }
    const before = new Map();
    for (const table of ['members','definitions','sessions','case_policies','case_reservations','case_provisions','shuttle_cases','shuttle_screens']) {
      const columns = (await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='sophie_core' AND table_name=$1 ORDER BY ordinal_position",[table])).rows;
      for (const row of await f.rows(table)) {
        const values = columns.map(c => c.data_type === 'jsonb' ? JSON.stringify(row[c.column_name]) : row[c.column_name]);
        await db.query('INSERT INTO sophie_core.'+table+' ('+columns.map(c=>c.column_name).join(',')+') VALUES ('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',values);
      }
      before.set(table,{columns:columns.map(c=>c.column_name),rows:(await db.query('SELECT * FROM sophie_core.'+table)).rows});
    }
    assert.deepEqual(await migrateCore(db),{migrations:54}); assert.deepEqual(await verifyCoreMigrations(db),{migrations:54});
    for (const [table, saved] of before) assert.deepEqual((await db.query('SELECT '+saved.columns.join(',')+' FROM sophie_core.'+table)).rows,saved.rows);
    const row = (await db.query("SELECT onboarding_retirement,onboarding_activity_ms FROM sophie_core.case_reservations WHERE type='shuttle'")).rows[0];
    assert.equal(row.onboarding_retirement,null); assert.ok(Number(row.onboarding_activity_ms) > 0);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM sophie_core.outbox')).rows[0].total,0);
  });

}
