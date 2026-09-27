import assert from 'node:assert/strict';
import { conversationWorkflow, syntheticConversation } from '../../tests/fixtures/case-conversations.js';
import { GUILD, USER } from '../../tests/fixtures/domain.js';
import { WHITELIST } from '../../tests/fixtures/discord.js';
import { migrateCore, verifyCoreMigrations } from '../../apps/core/storage/migrate.js';
import { snapshotRecoveryControls } from '../../apps/core/storage/recovery-controls.js';

/** Authored fixtures only. The operator ledger has no content-serving or activation route. */
export async function runRecoveryControlsSuite(cluster, run) {
  const f = await conversationWorkflow(cluster), admin = cluster.adminPool;
  const history = async source => (await admin.query('SELECT * FROM sophie_control.events WHERE source = $1 ORDER BY id', [source])).rows;
  const count = async () => (await admin.query('SELECT count(*)::int AS count FROM sophie_control.events')).rows[0].count;
  await run('RC01 migration baselines existing authority metadata without changing source state and is repeatable', async () => {
    const member = await f.rows('members'), cases = await f.rows('case_reservations');
    await admin.query('DROP SCHEMA sophie_control CASCADE');
    await admin.query("DELETE FROM sophie_migrations.applied WHERE id = '033-recovery-controls.sql'");
    assert.deepEqual(await migrateCore(admin), { migrations: 58 });
    const recorded = await count(); assert.ok(recorded > 0);
    assert.equal((await history('members')).every(row => row.operation === 'baseline'), true);
    assert.deepEqual(await f.rows('members'), member); assert.deepEqual(await f.rows('case_reservations'), cases);
    await migrateCore(admin); assert.equal(await count(), recorded);
  });
  await run('RC02 real membership saves record a Whitelist-loss epoch atomically and skip observation-only refreshes', async () => {
    // Resolve the trusted observation before handing it to the store.
    const save = async () => f.store.recordObservation(await f.discord.roles.observe(USER));
    const before = (await history('members')).length; await save(); await save(); assert.equal((await history('members')).length, before);
    f.discord.state.members.get(USER).push(WHITELIST); await save();
    f.discord.state.members.set(USER, f.discord.state.members.get(USER).filter(role => role !== WHITELIST)); await save();
    const event = (await history('members')).at(-1);
    assert.equal(event.operation, 'update'); assert.equal(event.after_state.eligibilityEpoch, event.before_state.eligibilityEpoch + 1);
    assert.equal(Object.hasOwn(event.after_state, 'observation'), false);
  });
  await run('RC03 rolled-back authority writes leave neither a changed epoch nor a committed control event', async () => {
    const before = await count(), members = await f.rows('members'), client = await f.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE sophie_core.members SET state = jsonb_set(state, '{accessEpoch}', to_jsonb((state->>'accessEpoch')::bigint + 1)) WHERE guild_id = $1 AND user_id = $2", [GUILD, USER]);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    assert.equal(await count(), before); assert.deepEqual(await f.rows('members'), members);
  });
  await run('RC04 case content never enters the control projection and withdrawal retains only immutable identifiers and hashes', async () => {
    const sentinel = 'SYNTHETIC-NO-CONTROL-CONTENT-9dd7';
    await f.send('MESSAGE_CREATE', syntheticConversation(f.opened.channel_id, { content: sentinel }));
    await admin.query("UPDATE sophie_core.definitions SET definition = jsonb_set(definition, '{status}', '\"withdrawn\"')");
    await admin.query("UPDATE sophie_core.case_forms SET status = 'withdrawn'");
    assert.equal((await history('definitions')).at(-1).after_state.status, 'withdrawn');
    assert.equal((await history('case_forms')).at(-1).after_state.status, 'withdrawn');
    const events = (await admin.query('SELECT control_key, before_state, after_state FROM sophie_control.events')).rows;
    assert.equal(JSON.stringify(events).includes(sentinel), false);
    assert.equal((await admin.query("SELECT count(*)::int AS total FROM sophie_control.events WHERE source NOT IN ('members', 'actor_authority', 'case_reservations', 'case_provisions', 'case_participants', 'case_exclusions', 'definitions', 'case_forms', 'capability_policies', 'case_policies', 'dashboard_auth_policies')")).rows[0].total, 0);
  });
  await run('RC05 core can cause legitimate trigger writes but cannot inspect, forge, alter or erase the ledger', async () => {
    for (const pool of [f.pool, cluster.knowledgePool]) for (const sql of [
      'SELECT * FROM sophie_control.events', 'UPDATE sophie_control.events SET operation = operation',
      'DELETE FROM sophie_control.events', 'TRUNCATE sophie_control.events',
      "INSERT INTO sophie_control.events (source, operation, control_key, after_state) VALUES ('members','insert','[]','{}')",
      "SELECT sophie_control.project('members','{}')",
    ]) await assert.rejects(pool.query(sql), { code: '42501' });
    await assert.rejects(f.pool.query('ALTER TABLE sophie_core.members DISABLE TRIGGER recovery_control_change'), { code: '42501' });
  });
  await run('RC06 a retained exclusion deletion is a tombstone event and a case close keeps before and after access metadata', async () => {
    await admin.query("INSERT INTO sophie_core.case_exclusions (guild_id, channel_id) VALUES ($1, '999999999999')", [GUILD]);
    await admin.query("DELETE FROM sophie_core.case_exclusions WHERE guild_id = $1 AND channel_id = '999999999999'", [GUILD]);
    const removed = (await history('case_exclusions')).at(-1); assert.equal(removed.operation, 'delete'); assert.equal(removed.after_state, null);
    await admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed', version = version + 1 WHERE id = $1", [f.opened.id]);
    const closed = (await history('case_reservations')).at(-1); assert.equal(closed.before_state.state, 'open'); assert.equal(closed.after_state.desiredAccess, 'closed');
  });
  await run('RC07 snapshots require stable isolation and retain late lower-ID commits instead of treating allocation order as freshness', async () => {
    await assert.rejects(snapshotRecoveryControls(admin), /RECOVERY_SNAPSHOT_REQUIRED/);
    const first = await f.pool.connect(), second = await f.pool.connect(), snapshot = await admin.connect();
    try {
      await first.query('BEGIN');
      await first.query("INSERT INTO sophie_core.case_exclusions (guild_id, channel_id) VALUES ($1, '999999999991')", [GUILD]);
      await second.query("INSERT INTO sophie_core.case_exclusions (guild_id, channel_id) VALUES ($1, '999999999992')", [GUILD]);
      await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const before = await snapshotRecoveryControls(snapshot);
      await first.query('COMMIT'); assert.deepEqual(await snapshotRecoveryControls(snapshot), before); await snapshot.query('COMMIT');
      await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const after = await snapshotRecoveryControls(snapshot);
      assert.equal(after.count, before.count + 1); assert.notEqual(after.sha256, before.sha256); await snapshot.query('COMMIT');
    } finally { await first.query('ROLLBACK'); await snapshot.query('ROLLBACK'); first.release(); second.release(); snapshot.release(); }
  });
  await run('RC08 a disabled capture trigger blocks startup verification even when migration checksums still match', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN'); await client.query('ALTER TABLE sophie_core.members DISABLE TRIGGER recovery_control_change');
      await assert.rejects(verifyCoreMigrations(client), /RECOVERY_CONTROL_CAPTURE_INCOMPLETE/);
    } finally { await client.query('ROLLBACK'); client.release(); }
    await verifyCoreMigrations(admin);
  });
  await run('RC09 capability loss and removed invitation metadata are retained without copying operator grants or policy bodies', async () => {
    await admin.query('UPDATE sophie_core.actor_authority SET capability_epoch = capability_epoch + 1');
    assert.ok((await history('actor_authority')).some(row => row.operation === 'update' && row.after_state.capabilityEpoch === row.before_state.capabilityEpoch + 1));
    await admin.query(`INSERT INTO sophie_core.case_participants (guild_id, case_id, version, user_id, presence_epoch, operator_grant, status)
      VALUES ($1, $2, 1, '999999999989', 1, $3, 'pending')`, [GUILD, f.opened.id, { guildId: GUILD, userId: USER, capabilityEpoch: 1, policyVersion: 1 }]);
    await admin.query("UPDATE sophie_core.case_participants SET status = 'removed', settled_reason = 'staff-removed', settled_at = clock_timestamp()");
    const removed = (await history('case_participants')).at(-1);
    assert.equal(removed.after_state.status, 'removed'); assert.equal(Object.hasOwn(removed.after_state, 'operator_grant'), false);
    const policies = await history('capability_policies'); assert.ok(policies.length > 0);
    assert.deepEqual(Object.keys(policies.at(-1).after_state), ['policySha256']);
  });
}
