import assert from 'node:assert/strict';
import { conversationWorkflow, syntheticConversation } from '../../tests/fixtures/case-conversations.js';
import { gatewayEvent, guildEvent, readyEvent } from '../../tests/fixtures/gateway.js';
import { createCaseMessageCapture } from '../../apps/core/discord/case-message-capture.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createGatewayObserver } from '../../apps/core/discord/gateway-observer.js';
import { registerCaseCaptureChannel } from '../../apps/core/storage/case-capture-coverage.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { GUILD, USER, STAFF } from '../../tests/fixtures/domain.js';
import { mapping, BOT } from '../../tests/fixtures/discord.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { createGatewaySupervisor } from '../../apps/core/discord/gateway-supervisor.js';
import { createLoopbackGateway, waitForGateway } from '../../tests/fixtures/gateway-server.js';
import { discoveryResponse, SYNTHETIC_GATEWAY_TOKEN } from '../../tests/fixtures/gateway-supervisor.js';

/** Only authored synthetic conversation fixtures. No Discord history or real case data is read. */
export async function runCaseConversationsSuite(cluster, run) {
  const scenario = (name, work, options) => run(name, async () => work(await conversationWorkflow(cluster, options)));
  const message = (f, overrides) => syntheticConversation(f.opened.channel_id, overrides);
  const lifecycle = async f => (await f.admin.query('SELECT * FROM sophie_core.gateway_lifecycle')).rows[0];

  await scenario('CC01 case create, partial edits and deletion retain every observation with the cursor', async f => {
    const data = message(f); await f.send('MESSAGE_CREATE', data);
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id, content: 'Synthetic edited conversation', edited_timestamp: '2026-09-19T12:01:00Z' });
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id, embeds: [{ description: 'Synthetic delayed embed' }] });
    await f.send('MESSAGE_DELETE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id });
    const rows = await f.observations(); assert.deepEqual(rows.map(row => row.kind), ['create', 'update', 'update', 'delete']);
    assert.equal(rows[0].patch.content, data.content); assert.equal(rows[1].patch.content, 'Synthetic edited conversation');
    assert.equal(Object.hasOwn(rows[2].patch, 'content'), false); assert.deepEqual(rows[3].patch, {});
    assert.equal(Number((await lifecycle(f)).sequence), 6); assert.equal(rows.every(row => row.issues.length === 0), true);
  });
  await scenario('CC02 public, foreign-guild and ephemeral bodies are not copied into retained case storage', async f => {
    const data = message(f, { channel_id: '719999999999999999' });
    Object.defineProperty(data, 'content', { get() { throw new Error('UNREGISTERED_BODY_READ'); } });
    await f.send('MESSAGE_CREATE', data);
    await f.send('MESSAGE_CREATE', message(f, { guild_id: '99' }));
    await f.send('MESSAGE_CREATE', message(f, { flags: 64 }));
    assert.equal((await f.observations()).length, 0); assert.equal(Number((await lifecycle(f)).sequence), 5);
  });
  await scenario('CC03 unknown-message edits and bulk deletions preserve uncertainty without inventing prior content', async f => {
    const data = message(f); await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id, content: '' });
    await f.send('MESSAGE_DELETE_BULK', { guild_id: GUILD, channel_id: data.channel_id, ids: [data.id, '730000000000000002'] });
    const rows = await f.observations(); assert.deepEqual(rows.map(row => row.kind), ['update', 'delete', 'delete']);
    assert.deepEqual(rows[0].patch, { content: '' }); assert.equal(rows.some(row => Object.hasOwn(row.patch, 'author')), false);
    assert.equal(new Set(rows.map(row => row.sequence)).size, 2);
  });
  await scenario('CC04 duplicate and older sequences never reread or duplicate case content', async f => {
    const data = message(f); await f.send('MESSAGE_CREATE', data);
    const duplicate = message(f); Object.defineProperty(duplicate, 'content', { get() { throw new Error('DUPLICATE_BODY_READ'); } });
    assert.deepEqual(await f.observer.accept(f.connection(), gatewayEvent(3, 'MESSAGE_CREATE', duplicate)), { duplicate: true });
    assert.deepEqual(await f.observer.accept(f.connection(), gatewayEvent(2, 'MESSAGE_DELETE', data)), { duplicate: true });
    assert.equal((await f.observations()).length, 1);
  });
  await scenario('CC05 oversized or unsupported content creates explicit loss evidence while valid fields survive', async f => {
    await f.send('MESSAGE_CREATE', message(f, { content: 'x'.repeat(16385), embeds: [{ description: 'Synthetic retained embed' }],
      message_snapshots: [{ message: { content: 'Synthetic uncopied forward' } }] }));
    const row = (await f.observations())[0]; assert.equal(Object.hasOwn(row.patch, 'content'), false);
    assert.equal(row.patch.embeds[0].description, 'Synthetic retained embed');
    assert.deepEqual(row.issues, ['unavailable:content', 'incomplete-create', 'forwarded-snapshot-not-captured']);
    assert.ok((await f.gaps()).some(gap => gap.reasons.includes('payload-rejected') && gap.closed_at_ms !== null));
    await f.send('MESSAGE_DELETE_BULK', { guild_id: GUILD, channel_id: f.opened.channel_id, ids: Array.from({ length: 101 }, (_, i) => String(i + 1)) });
    assert.equal((await f.observations()).length, 1); assert.equal(Number((await lifecycle(f)).sequence), 4);
  });
  await scenario('CC06 attachment references are retained as inert metadata without acquiring or executing files', async f => {
    const calls = f.discord.state.calls.length;
    const attachments = [{ id: '74', filename: '<script>.html', size: 12, url: 'http://127.0.0.1/private', content_type: 'text/html',
      ignored_secret: 'Synthetic extra metadata' }];
    await f.send('MESSAGE_CREATE', message(f, { attachments }));
    const saved = (await f.observations())[0].patch.attachments[0]; assert.equal(saved.url, attachments[0].url);
    assert.equal(saved.filename, attachments[0].filename); assert.equal(Object.hasOwn(saved, 'ignored_secret'), false);
    assert.equal(f.discord.state.calls.length, calls);
  });
  await scenario('CC07 content-write failure rolls back the cursor and replay after resume retains one observation', async f => {
    const data = message(f); await f.admin.query('REVOKE INSERT ON sophie_core.case_message_observations FROM sophie_test_core');
    try { await assert.rejects(f.send('MESSAGE_CREATE', data), /GATEWAY_PROCESSING_FAILED/); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_message_observations TO sophie_test_core'); }
    assert.equal((await f.observations()).length, 0); assert.equal(Number((await lifecycle(f)).sequence), 2);
    assert.equal((await lifecycle(f)).status, 'offline');
    await f.resume([gatewayEvent(3, 'MESSAGE_CREATE', data)]); assert.equal((await f.observations()).length, 1);
    assert.ok((await f.gaps()).some(row => row.channel_id === null && row.reasons.includes('gateway-disconnected') && row.recovered_by === 'resumed'));
  });
  await scenario('CC08 cursor-write failure cannot leave a conversation observation committed by itself', async f => {
    await f.admin.query('REVOKE UPDATE ON sophie_core.gateway_lifecycle FROM sophie_test_core');
    try { await assert.rejects(f.send('MESSAGE_CREATE', message(f)), /GATEWAY_PROCESSING_FAILED/); }
    finally { await f.admin.query('GRANT UPDATE ON sophie_core.gateway_lifecycle TO sophie_test_core'); }
    assert.equal((await f.observations()).length, 0); assert.equal(Number((await lifecycle(f)).sequence), 2);
    assert.equal(await f.observer.isCurrent(), false);
  });
  await scenario('CC09 pause and successful replay keep the original interruption interval visible', async f => {
    await f.send('MESSAGE_CREATE', message(f)); f.clock.now += 1000;
    await f.observer.pause(f.connection()); await f.observer.pause(f.connection());
    assert.equal((await f.gaps()).filter(row => row.channel_id === null && row.closed_at_ms === null).length, 1);
    f.clock.now += 1000; await f.resume();
    const gap = (await f.gaps()).find(row => row.reasons.includes('gateway-disconnected') && row.recovered_by === 'resumed');
    assert.ok(gap); assert.ok(Number(gap.closed_at_ms) > Number(gap.started_at_ms));
    assert.equal((await f.observations()).length, 1);
  });
  await scenario('CC10 skipped sequences retain a bounded gap record and the actually observed message only', async f => {
    f.clock.now += 1000; await f.send('MESSAGE_CREATE', message(f), 3);
    assert.equal((await f.observations()).length, 1);
    const gap = (await f.gaps()).find(row => row.reasons.includes('gateway-sequence-gap'));
    assert.ok(gap); assert.equal(gap.recovered_by, 'observed'); assert.equal(Number((await lifecycle(f)).sequence), 5);
  });
  await scenario('CC11 a new Identify records unavailable history and accepts a new epoch without erasing the old one', async f => {
    await f.send('MESSAGE_CREATE', message(f)); await f.observer.pause(f.connection());
    const { connection } = await f.observer.beginIdentify();
    await f.observer.accept(connection, readyEvent(1, 'synthetic-new-conversation-session')); await f.observer.accept(connection, guildEvent());
    await f.observer.accept(connection, gatewayEvent(3, 'MESSAGE_UPDATE', message(f, { content: 'Synthetic after new Identify' })));
    const rows = await f.observations(); assert.equal(rows.length, 2); assert.notEqual(rows[0].continuity_epoch, rows[1].continuity_epoch);
    assert.ok((await f.gaps()).some(row => row.reasons.includes('gateway-session-reset') && row.recovered_by === 'identified'));
  });
  await scenario('CC12 guild unavailability retains its own gap while membership revocation and cursor remain atomic', async f => {
    await f.send('GUILD_DELETE', { id: GUILD, unavailable: true });
    assert.equal((await lifecycle(f)).guild_available, false);
    assert.ok((await f.gaps()).some(row => row.reasons.includes('guild-unavailable') && row.closed_at_ms === null));
    f.clock.now += 1000; await f.send('GUILD_CREATE', guildEvent().d);
    assert.equal((await lifecycle(f)).guild_available, true);
    assert.ok((await f.gaps()).some(row => row.reasons.includes('guild-unavailable') && row.closed_at_ms !== null));
  });
  await scenario('CC13 a discovered child is bound to its retained case and remains excluded after moving', async f => {
    const child = '710000000000000091';
    await f.send('THREAD_CREATE', { guild_id: GUILD, id: child, parent_id: f.opened.channel_id });
    await f.send('MESSAGE_CREATE', message(f, { channel_id: child }));
    await f.send('THREAD_UPDATE', { guild_id: GUILD, id: child, parent_id: '719999999999999999' });
    await f.send('MESSAGE_UPDATE', message(f, { channel_id: child, content: 'Synthetic moved thread' }));
    const row = (await f.admin.query('SELECT * FROM sophie_core.case_capture_channels WHERE channel_id = $1', [child])).rows[0];
    assert.equal(row.case_id, f.opened.id); assert.equal(row.root_channel_id, f.opened.channel_id);
    assert.equal((await f.observations()).length, 2); assert.equal((await f.admin.query('SELECT 1 FROM sophie_core.case_exclusions WHERE channel_id = $1', [child])).rowCount, 1);
    assert.ok((await f.gaps()).some(gap => gap.channel_id === child && gap.closed_at_ms === null));
  });
  await scenario('CC14 thread-list snapshots register only known case descendants and never an unrelated category', async f => {
    const child = '710000000000000092', unrelated = '710000000000000093';
    await f.send('THREAD_LIST_SYNC', { guild_id: GUILD, threads: [{ id: child, parent_id: f.opened.channel_id }, { id: unrelated, parent_id: '99' }] });
    await f.send('MESSAGE_CREATE', message(f, { channel_id: child })); await f.send('MESSAGE_CREATE', message(f, { channel_id: unrelated }));
    assert.equal((await f.observations()).length, 1);
    assert.equal((await f.admin.query('SELECT 1 FROM sophie_core.case_capture_channels WHERE channel_id = $1', [unrelated])).rowCount, 0);
  });
  await scenario('CC15 channel deletion leaves retained content and a persistent coverage gap', async f => {
    await f.send('MESSAGE_CREATE', message(f));
    await f.send('CHANNEL_DELETE', { guild_id: GUILD, id: f.opened.channel_id, parent_id: null });
    assert.equal((await f.observations()).length, 1);
    assert.ok((await f.gaps()).some(row => row.channel_id === f.opened.channel_id && row.reasons.includes('channel-deleted') && row.closed_at_ms === null));
    assert.notEqual((await f.admin.query('SELECT deleted_at_ms FROM sophie_core.case_capture_channels WHERE channel_id = $1', [f.opened.channel_id])).rows[0].deleted_at_ms, null);
  });
  await scenario('CC16 known case provenance cannot be rebound and initial history is explicitly unavailable', async f => {
    const rows = await f.gaps(); assert.ok(rows.some(row => row.channel_id === f.opened.channel_id && row.reasons.includes('before-capture') && row.started_at_ms === null));
    const previous = (await f.admin.query('SELECT * FROM sophie_core.case_capture_channels')).rows;
    await assert.rejects(registerCaseCaptureChannel(f.pool, { guildId: GUILD, channelId: f.opened.channel_id, caseId: f.opened.id,
      rootChannelId: '99', at: f.clock.now }), /CASE_CAPTURE_CHANNEL_COLLISION/);
    assert.deepEqual((await f.admin.query('SELECT * FROM sophie_core.case_capture_channels')).rows, previous);
  });
  await scenario('CC17 capture-disabled observers retain a gap and never request or read message bodies', async f => {
    assert.equal(f.observer.intents, 3);
    const event = gatewayEvent(3, 'MESSAGE_CREATE'); Object.defineProperty(event, 'd', { get() { throw new Error('DISABLED_BODY_READ'); } });
    await f.observer.accept(f.connection(), event);
    assert.equal((await f.observations()).length, 0);
    assert.ok((await f.gaps()).some(row => row.channel_id === null && row.reasons.includes('capture-disabled') && row.closed_at_ms === null));
  }, { capture: false });
  await scenario('CC18 enabling content capture forces Identify instead of resuming a metadata-only session', async f => {
    await f.observer.pause(f.connection()); await f.admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = '-infinity'");
    const time = () => f.clock.now, capture = createCaseMessageCapture({ guildId: GUILD, clock: time });
    const journal = createGatewayJournal({ pool: f.pool, mapping, clock: time, caseCapture: capture });
    const observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: time });
    assert.deepEqual(await observer.acquire('conversation-enabled'), { resumable: false }); assert.equal(observer.intents, 33283);
    await assert.rejects(observer.beginResume(), /GATEWAY_STATE_CONFLICT/);
    const { connection } = await observer.beginIdentify(); await observer.accept(connection, readyEvent(1, 'synthetic-enabled-capture'));
    await observer.accept(connection, guildEvent()); await observer.accept(connection, gatewayEvent(3, 'MESSAGE_CREATE', message(f)));
    assert.equal((await f.observations()).length, 1);
  }, { capture: false });
  await scenario('CC19 case content remains absent from metadata stores and inaccessible to knowledge or deletion privileges', async f => {
    const data = message(f); await f.send('MESSAGE_CREATE', data);
    for (const table of ['gateway_lifecycle', 'gateway_members', 'case_capture_channels', 'case_capture_gaps', 'outbox', 'receipts', 'actor_authority']) {
      assert.equal(JSON.stringify((await f.admin.query(`SELECT * FROM sophie_core.${table}`)).rows).includes(data.content), false);
    }
    for (const table of ['case_message_observations', 'case_capture_channels', 'case_capture_gaps']) {
      await assert.rejects(cluster.knowledgePool.query(`SELECT * FROM sophie_core.${table}`), { code: '42501' });
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`), { code: '42501' });
    }
  });
  await scenario('CC20 permission and bot-membership changes record uncertainty until a separate channel proof is verified', async f => {
    await f.send('GUILD_ROLE_UPDATE', { guild_id: GUILD, role: { id: STAFF } });
    assert.ok((await f.gaps()).some(row => row.channel_id === f.opened.channel_id && row.reasons.includes('permission-change') && row.closed_at_ms === null));
    await f.send('MESSAGE_CREATE', message(f));
    assert.ok((await f.gaps()).some(row => row.channel_id === f.opened.channel_id && row.closed_at_ms === null));
    await f.drain(f.cases);
    assert.equal((await f.gaps()).some(row => row.channel_id === f.opened.channel_id && row.closed_at_ms === null), false);
    await f.send('GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: BOT, bot: true }, roles: [] });
    assert.ok((await f.gaps()).some(row => row.channel_id === f.opened.channel_id && row.closed_at_ms === null));
  });
  await scenario('CC21 a lost commit acknowledgement is resolved by the durable cursor without a second retained revision', async f => {
    let armed = true;
    const uncertainPool = { async connect() {
      const client = await f.pool.connect(); return { release: value => client.release(value), async query(...args) {
        const result = await client.query(...args);
        if (armed && args[0] === 'COMMIT') { armed = false; throw new Error('SYNTHETIC_COMMIT_ACK_LOST'); }
        return result;
      } };
    } };
    const journal = createGatewayJournal({ pool: uncertainPool, mapping, clock: () => f.clock.now, caseCapture: f.capture });
    const state = await lifecycle(f), lease = { guildId: GUILD, owner: state.lease_owner, fence: state.fence };
    const event = gatewayEvent(3, 'MESSAGE_CREATE', message(f));
    const dispatch = () => journal.dispatch(lease, { sessionId: state.session_id, sequence: 3, change: { kind: 'ignored' }, caseMessage: f.capture.prepare(event) });
    await assert.rejects(dispatch(), /SYNTHETIC_COMMIT_ACK_LOST/); assert.equal((await f.observations()).length, 1);
    assert.equal(Number((await lifecycle(f)).sequence), 3); assert.deepEqual(await dispatch(), { duplicate: true });
    assert.equal((await f.observations()).length, 1);
  });
  await scenario('CC22 closed and old cases retain message history indefinitely without accepting ephemeral content', async f => {
    const data = message(f); await f.send('MESSAGE_CREATE', data); const original = await f.observations();
    await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed' WHERE id = $1", [f.opened.id]);
    f.clock.now += 10 * 365 * 86400000;
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id, content: 'Synthetic later observation' });
    await f.send('MESSAGE_CREATE', message(f, { id: '730000000000000099', flags: 64 }));
    const rows = await f.observations(); assert.equal(rows.length, 2); assert.deepEqual(rows[0], original[0]);
    assert.equal(rows[1].patch.content, 'Synthetic later observation'); assert.equal((await f.rows('case_reservations'))[0].state, 'closed');
  });
  await scenario('CC23 upgrading existing channels marks unavailable history without inventing messages or changing intake', async f => {
    const cases = await f.rows('case_reservations'), intake = await f.rows('case_intakes');
    await f.admin.query(`DROP TABLE sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity,
      sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels;
      ALTER TABLE sophie_core.gateway_lifecycle DROP COLUMN capture_enabled, DROP COLUMN capture_observed_at_ms;
      DELETE FROM sophie_migrations.applied WHERE id IN ('029-case-conversations.sql', '030-case-attachments.sql')`);
    assert.deepEqual(await migrateCore(f.admin), { migrations: 63 });
    await f.admin.query('GRANT SELECT, INSERT, UPDATE ON sophie_core.case_message_observations, sophie_core.case_capture_gaps, sophie_core.case_capture_channels, sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity TO sophie_test_core');
    assert.deepEqual(await f.rows('case_reservations'), cases); assert.deepEqual(await f.rows('case_intakes'), intake);
    assert.equal((await f.observations()).length, 0);
    const gap = (await f.gaps())[0]; assert.equal(gap.started_at_ms, null); assert.equal(gap.closed_at_ms, null);
    assert.deepEqual(gap.reasons, ['before-capture', 'capture-not-verified']);
    assert.equal((await lifecycle(f)).capture_enabled, false);
  });
  await scenario('CC24 native loopback Gateway requests case-content intents and durably retains create, edit and delete events', async f => {
    await f.observer.pause(f.connection()); const reset = await f.observer.beginIdentify(); await f.observer.pause(reset.connection);
    await f.admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until = '-infinity'");
    const capture = createCaseMessageCapture({ guildId: GUILD, clock: Date.now });
    const journal = createGatewayJournal({ pool: f.pool, mapping, clock: Date.now, caseCapture: capture });
    const observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: Date.now });
    const data = message(f), server = await createLoopbackGateway({ onPacket(packet, peer) {
      if (packet.op === 2) {
        peer.send(readyEvent(1, 'synthetic-native-conversation')); peer.send(guildEvent());
        peer.send(gatewayEvent(3, 'MESSAGE_CREATE', data));
        peer.send(gatewayEvent(4, 'MESSAGE_UPDATE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id, content: 'Synthetic wire edit' }));
        peer.send(gatewayEvent(5, 'MESSAGE_DELETE', { guild_id: GUILD, channel_id: data.channel_id, id: data.id }));
      }
    } });
    const supervisor = createGatewaySupervisor({ observer, transport: { getGatewayBot: async () => discoveryResponse() }, connect: server.connect,
      token: SYNTHETIC_GATEWAY_TOKEN, clock: Date.now, random: () => 0.25, enabled: () => true });
    const finished = supervisor.start('conversation-native');
    try {
      await waitForGateway(async () => (await lifecycle(f)).sequence === '5' && await observer.isCurrent());
      assert.equal(server.connections[0].received[0].intents, 33283);
      const rows = await f.observations(); assert.deepEqual(rows.map(row => row.kind), ['create', 'update', 'delete']);
      assert.equal(rows[1].patch.content, 'Synthetic wire edit'); assert.deepEqual(server.errors, []);
    } finally { await supervisor.stop(); await finished; await server.stop(); }
    assert.equal((await lifecycle(f)).status, 'offline');
    assert.ok((await f.gaps()).some(row => row.channel_id === null && row.closed_at_ms === null));
  });
}
