import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { attachmentWorkflow, attachmentServices, syntheticAttachment, syntheticFileBytes } from '../../tests/fixtures/case-attachments.js';
import { syntheticConversation } from '../../tests/fixtures/case-conversations.js';
import { gatewayEvent } from '../../tests/fixtures/gateway.js';
import { createAttachmentSource } from '../../apps/core/discord/attachment-source.js';
import { createAttachmentWorker } from '../../apps/core/discord/attachment-worker.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { GUILD } from '../../tests/fixtures/domain.js';

/** Actual synthetic PostgreSQL and local files. No Discord CDN, existing case history or credentials. */
export async function runCaseAttachmentsSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await attachmentWorkflow(cluster)));
  const execute = f => f.attachmentWorker.runOnce('attachment-test');
  const expire = f => f.admin.query("UPDATE sophie_core.case_attachment_jobs SET lease_until = '-infinity', available_at = '-infinity' WHERE status <> 'retained'");
  const retained = async f => { const row = (await f.jobs())[0]; assert.equal(row.status, 'retained'); return row; };
  const prepare = async f => { const claim = await f.attachmentStore.claim('attachment-prepared'); return { claim, prepared: await f.attachmentStore.prepare(claim) }; };

  await scenario('CA01 observed references commit acquisition intent with the cursor and retain exact private file bytes', async f => {
    await f.addFile(); assert.equal((await f.jobs())[0].status, 'pending'); assert.equal(f.fileState.requests.length, 0);
    assert.deepEqual(await execute(f), { status: 'retained' }); const row = await retained(f);
    assert.deepEqual(await readFile(resolve(f.vaultRoot, `${row.retained_slot}.blob`)), syntheticFileBytes);
    assert.equal(row.retained_sha256, createHash('sha256').update(syntheticFileBytes).digest('hex'));
    assert.equal(Number((await f.capacity())[0].reserved_bytes), syntheticFileBytes.length);
    assert.equal((await f.attempts())[0].policy.quarantine, 'unscanned'); assert.equal(await f.attachmentStore.result(row.token), 'retained');
    assert.deepEqual(await execute(f), { status: 'idle' });
  });
  await scenario('CA02 duplicate Gateway events, partial edits and message deletion never duplicate or erase acquisition intent', async f => {
    await f.addFile(); const original = (await f.jobs())[0], message = (await f.observations())[0];
    await f.observer.accept(f.connection(), gatewayEvent(3, 'MESSAGE_CREATE', syntheticConversation(f.opened.channel_id, { id: message.message_id, attachments: [syntheticAttachment(f.opened.channel_id)] })));
    await f.send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: message.message_id, content: 'Synthetic edited body' });
    await f.send('MESSAGE_DELETE', { guild_id: GUILD, channel_id: f.opened.channel_id, id: message.message_id });
    assert.equal((await f.jobs()).length, 1); assert.equal((await f.jobs())[0].token, original.token); await execute(f); await retained(f);
  });
  await scenario('CA03 unknown or ephemeral channels create no attachment jobs and cannot invoke acquisition', async f => {
    await f.send('MESSAGE_CREATE', syntheticConversation('719999999999999999', { attachments: [syntheticAttachment('719999999999999999')] }));
    await f.send('MESSAGE_CREATE', syntheticConversation(f.opened.channel_id, { flags: 64, attachments: [syntheticAttachment(f.opened.channel_id)] }));
    assert.deepEqual(await f.jobs(), []); assert.deepEqual(await execute(f), { status: 'idle' }); assert.equal(f.fileState.requests.length, 0);
  });
  await scenario('CA04 missing or disabled policy leaves references pending without reserving space or contacting a source', async f => {
    await f.addFile(); const policy = f.fileState.policy; f.fileState.policy = null;
    assert.deepEqual(await execute(f), { status: 'disabled' }); assert.equal((await f.jobs())[0].status, 'pending');
    f.fileState.policy = policy; f.fileState.enabled = false; assert.deepEqual(await execute(f), { status: 'disabled' });
    assert.deepEqual(await f.capacity(), []); assert.equal(f.fileState.requests.length, 0);
  });
  await scenario('CA05 arbitrary URLs, mismatched identities and active types retain explicit rejection without network I/O', async f => {
    for (const override of [{ url: 'http://127.0.0.1/private' }, { url: syntheticAttachment('99').url },
      { filename: 'run.html', content_type: 'text/html' }, { filename: '../synthetic.txt' }, { ephemeral: true }]) {
      await f.addFile(override); assert.equal((await execute(f)).status, 'unavailable');
    }
    assert.equal((await f.jobs()).length, 5); assert.equal(f.fileState.requests.length, 0); assert.deepEqual(await f.attempts(), []);
  });
  await scenario('CA06 count and declared-size limits are recorded per reference and never silently truncate captured metadata', async f => {
    f.fileState.policy.maxPerMessage = 1;
    await f.addFile({}, [syntheticAttachment(f.opened.channel_id), syntheticAttachment(f.opened.channel_id)]);
    const results = [await execute(f), await execute(f)]; assert.ok(results.some(row => row.code === 'ATTACHMENT_COUNT_LIMIT'));
    assert.equal((await f.jobs()).length, 2); assert.equal((await f.observations())[0].patch.attachments.length, 2);
    await f.addFile({ size: 1025 }); assert.equal((await execute(f)).code, 'ATTACHMENT_SIZE_LIMIT'); assert.equal(f.fileState.requests.length, 1);
  });
  await scenario('CA07 competing acquisitions cannot oversubscribe the retained-file capacity reservation', async f => {
    f.fileState.policy.maxFileBytes = syntheticFileBytes.length; f.fileState.policy.maxStoredBytes = syntheticFileBytes.length;
    await f.addFile(); await f.addFile();
    const other = attachmentServices(f, f.vault, f.fileState).attachmentWorker;
    const results = await Promise.all([execute(f), other.runOnce('attachment-second')]);
    assert.equal(results.filter(row => row.status === 'retained').length, 1);
    assert.equal(results.filter(row => row.code === 'ATTACHMENT_CAPACITY_LIMIT').length, 1);
    assert.equal(f.fileState.requests.length, 1); assert.equal(Number((await f.capacity())[0].reserved_bytes), syntheticFileBytes.length);
  });
  await scenario('CA08 excessive, truncated or disguised content remains unavailable and never produces a completed blob', async f => {
    for (const bytes of [Buffer.alloc(syntheticFileBytes.length + 1, 65), Buffer.from('short'), Buffer.alloc(syntheticFileBytes.length)]) {
      await f.addFile(); f.fileState.bytes = bytes; assert.equal((await execute(f)).status, 'unavailable');
    }
    assert.deepEqual(await readdir(f.vaultRoot), []); assert.equal((await f.attempts()).length, 3);
  });
  await scenario('CA09 redirects, expired references, encoding and MIME mismatches preserve truthful failure codes', async f => {
    for (const [status, headers, code] of [[302, {}, 'ATTACHMENT_RESPONSE_INVALID'], [403, {}, 'ATTACHMENT_SOURCE_UNAVAILABLE'],
      [200, { 'content-encoding': 'gzip' }, 'ATTACHMENT_RESPONSE_INVALID'], [200, { 'content-type': 'text/html' }, 'ATTACHMENT_RESPONSE_INVALID']]) {
      f.fileState.status = status; f.fileState.headers = headers; await f.addFile(); assert.equal((await execute(f)).code, code);
    }
    assert.equal((await f.jobs()).every(row => row.status === 'unavailable'), true); assert.deepEqual(await readdir(f.vaultRoot), []);
  });
  await scenario('CA10 transient failures have bounded retries and conservative reservations without erasing references', async f => {
    await f.addFile(); f.fileState.failure = true;
    for (let i = 0; i < 3; i++) { assert.equal((await execute(f)).status, 'pending'); await expire(f); }
    assert.equal((await execute(f)).code, 'ATTACHMENT_ATTEMPT_LIMIT'); assert.equal(f.fileState.requests.length, 3);
    assert.equal((await f.attempts()).length, 3); assert.equal(Number((await f.capacity())[0].reserved_bytes), syntheticFileBytes.length * 3);
  });
  await scenario('CA11 a completed file with missing database acknowledgement is recovered without another request or reservation', async f => {
    await f.addFile(); const { claim, prepared } = await prepare(f), slot = await f.attachmentStore.reserve(claim, prepared);
    await f.vault.write(slot, prepared.reference, Readable.from([syntheticFileBytes])); await expire(f);
    assert.deepEqual(await execute(f), { status: 'retained' }); assert.equal((await retained(f)).retained_slot, slot);
    assert.equal(f.fileState.requests.length, 0); assert.equal((await f.attempts()).length, 1);
  });
  await scenario('CA12 an expired writer cannot commit and a late complete slot remains recoverable without overwriting files', async f => {
    await f.addFile(); const old = await prepare(f), slot = await f.attachmentStore.reserve(old.claim, old.prepared); await expire(f);
    const next = await f.attachmentStore.claim('attachment-new-owner');
    const proof = await f.vault.write(slot, old.prepared.reference, Readable.from([syntheticFileBytes]));
    await assert.rejects(f.attachmentStore.complete(old.claim, old.prepared, proof), /ATTACHMENT_LEASE_LOST/);
    const current = await f.attachmentStore.prepare(next); await f.attachmentStore.complete(next, current, await f.vault.recover(slot, current.reference));
    assert.equal((await retained(f)).retained_slot, slot);
  });
  await scenario('CA13 policy changes during acquisition leave completed data quarantined without claiming authorized retention', async f => {
    await f.addFile(); f.fileState.beforeResponse = () => { f.fileState.policy.approvalRef = 'synthetic-revised-policy'; };
    assert.equal((await execute(f)).code, 'ATTACHMENT_POLICY_DISABLED');
    assert.equal((await f.jobs())[0].status, 'unavailable'); assert.equal((await readdir(f.vaultRoot)).filter(name => name.endsWith('.blob')).length, 1);
    assert.equal((await f.attempts())[0].policy.approvalRef, 'synthetic-test-only');
  });
  await scenario('CA14 forged or cross-job file proofs cannot mark an attachment retained', async f => {
    await f.addFile(); const first = await prepare(f); await assert.rejects(f.attachmentStore.complete(first.claim, first.prepared, {}), /UNTRUSTED_ATTACHMENT_FILE/);
    const slot = await f.attachmentStore.reserve(first.claim, first.prepared), proof = await f.vault.write(slot, first.prepared.reference, Readable.from([syntheticFileBytes]));
    await f.addFile(); const second = await prepare(f); await assert.rejects(f.attachmentStore.complete(second.claim, second.prepared, proof), /UNTRUSTED_ATTACHMENT_FILE/);
    assert.equal((await f.jobs()).some(row => row.status === 'retained'), false);
  });
  await scenario('CA15 acquisition-intent failure rolls back both conversation and Gateway cursor for safe replay', async f => {
    await f.admin.query('REVOKE INSERT ON sophie_core.case_attachment_jobs FROM sophie_test_core');
    const data = syntheticConversation(f.opened.channel_id, { attachments: [syntheticAttachment(f.opened.channel_id)] });
    try { await assert.rejects(f.send('MESSAGE_CREATE', data), /GATEWAY_PROCESSING_FAILED/); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_attachment_jobs TO sophie_test_core'); }
    assert.equal((await f.observations()).length, 0); assert.equal((await f.jobs()).length, 0);
    assert.equal((await f.rows('gateway_lifecycle'))[0].sequence, '2');
    await f.resume([gatewayEvent(3, 'MESSAGE_CREATE', data)]); assert.equal((await f.jobs()).length, 1);
  });
  await scenario('CA16 failed slot insertion rolls back reserved capacity and never begins external acquisition', async f => {
    await f.addFile(); const prepared = await prepare(f);
    await f.admin.query('REVOKE INSERT ON sophie_core.case_attachment_attempts FROM sophie_test_core');
    try { await assert.rejects(f.attachmentStore.reserve(prepared.claim, prepared.prepared), { code: '42501' }); }
    finally { await f.admin.query('GRANT INSERT ON sophie_core.case_attachment_attempts TO sophie_test_core'); }
    assert.equal((await f.capacity()).length, 0); assert.equal((await f.attempts()).length, 0); assert.equal(f.fileState.requests.length, 0);
  });
  await scenario('CA17 lost retention COMMIT acknowledgement returns the persisted result without duplicate writes', async f => {
    await f.addFile(); let armed = false;
    const pool = { query: (...args) => f.pool.query(...args), async connect() {
      const client = await f.pool.connect(); return { release: value => client.release(value), async query(...args) {
        const result = await client.query(...args);
        if (args[0].includes("SET status = 'retained'")) armed = true;
        if (armed && args[0] === 'COMMIT') { armed = false; throw new Error('SYNTHETIC_ACK_LOST'); } return result;
      } };
    } };
    const services = attachmentServices({ ...f, pool }, f.vault, f.fileState);
    assert.deepEqual(await services.attachmentWorker.runOnce('attachment-ack'), { status: 'retained' }); await retained(f);
    assert.equal(f.fileState.requests.length, 1); assert.equal((await f.attempts()).length, 1);
  });
  await scenario('CA18 core-only retention survives closure and age without knowledge access, deletion or metadata leakage', async f => {
    await f.addFile(); await execute(f); const row = await retained(f);
    await f.admin.query("UPDATE sophie_core.case_reservations SET state = 'closed', desired_access = 'closed' WHERE id = $1", [f.opened.id]);
    f.clock.now += 10 * 365 * 86400000; assert.equal((await f.jobs())[0].retained_slot, row.retained_slot);
    for (const table of ['case_attachment_jobs', 'case_attachment_attempts', 'case_attachment_capacity']) {
      await assert.rejects(cluster.knowledgePool.query(`SELECT * FROM sophie_core.${table}`), { code: '42501' });
      await assert.rejects(f.pool.query(`DELETE FROM sophie_core.${table}`), { code: '42501' });
    }
    const metadata = JSON.stringify([await f.rows('outbox'), await f.rows('receipts'), await f.rows('gateway_lifecycle')]);
    assert.equal(metadata.includes('synthetic.txt'), false); assert.equal(metadata.includes('cdn.discordapp.com'), false);
    assert.equal(metadata.includes(syntheticFileBytes.toString()), false);
  });
  await scenario('CA19 migration backfills retained references without fabricating file capture or altering message history', async f => {
    await f.addFile(); const observations = await f.observations();
    await f.admin.query(`DROP TABLE sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity;
      DELETE FROM sophie_migrations.applied WHERE id = '030-case-attachments.sql'`);
    assert.deepEqual(await migrateCore(f.admin), { migrations: 62 });
    await f.admin.query('GRANT SELECT, INSERT, UPDATE ON sophie_core.case_attachment_jobs, sophie_core.case_attachment_attempts, sophie_core.case_attachment_capacity TO sophie_test_core');
    assert.deepEqual(await f.observations(), observations); assert.equal((await f.jobs())[0].status, 'pending');
    assert.equal((await f.attempts()).length, 0); assert.equal(f.fileState.requests.length, 0); await execute(f); await retained(f);
  });
  await scenario('CA20 native loopback HTTP streams bounded bytes and aborts an unfinished response at the deadline', async f => {
    let hanging = false, received = 0;
    const server = createServer((request, response) => {
      received++; assert.equal(request.headers.authorization, undefined); response.writeHead(200, { 'Content-Type': 'text/plain' });
      if (hanging) response.write(syntheticFileBytes.subarray(0, 1)); else response.end(syntheticFileBytes);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const source = createAttachmentSource({ request: (url, options, callback) => request({ ...options, protocol: 'http:', hostname: '127.0.0.1',
      port: server.address().port, path: new URL(url).pathname, lookup: undefined }, callback), lookup() {}, enabled: () => true });
    const worker = createAttachmentWorker({ store: f.attachmentStore, vault: f.vault, source });
    try {
      await f.addFile(); assert.deepEqual(await worker.runOnce('attachment-http'), { status: 'retained' }); await retained(f);
      hanging = true; await f.addFile(); const start = Date.now(), result = await worker.runOnce('attachment-timeout');
      assert.equal(result.status, 'pending'); assert.ok(Date.now() - start >= 900 && Date.now() - start < 5000);
      assert.equal(received, 2); assert.equal((await readdir(f.vaultRoot)).filter(name => name.endsWith('.blob')).length, 1);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  await scenario('CA21 incomplete and corrupted slots cannot be silently treated as retained or overwritten', async f => {
    await f.addFile(); const p = await prepare(f), slot = await f.attachmentStore.reserve(p.claim, p.prepared);
    await writeFile(resolve(f.vaultRoot, `${slot}.part`), 'Synthetic unfinished write'); await expire(f);
    await execute(f); const row = await retained(f); assert.notEqual(row.retained_slot, slot);
    assert.equal((await f.attempts()).length, 2); assert.ok((await readdir(f.vaultRoot)).includes(`${slot}.part`));
    await f.addFile(); const q = await prepare(f), corrupt = await f.attachmentStore.reserve(q.claim, q.prepared);
    await writeFile(resolve(f.vaultRoot, `${corrupt}.blob`), Buffer.alloc(syntheticFileBytes.length)); await expire(f);
    assert.equal((await execute(f)).code, 'ATTACHMENT_CONTENT_INVALID');
    assert.deepEqual(await readFile(resolve(f.vaultRoot, `${corrupt}.blob`)), Buffer.alloc(syntheticFileBytes.length));
  });
  await scenario('CA22 CDN Retry-After durably pauses new and claimed requests even after the reporting lease expires', async f => {
    await f.addFile(); await f.addFile(); const held = await prepare(f);
    f.fileState.status = 429; f.fileState.headers = { 'retry-after': '120' };
    assert.equal((await execute(f)).code, 'ATTACHMENT_RATE_LIMITED');
    assert.ok((await f.admin.query("SELECT until_at > clock_timestamp() + interval '119 seconds' AS paused FROM sophie_core.case_attachment_capacity")).rows[0].paused);
    await assert.rejects(f.attachmentStore.check(held.claim, held.prepared.policyHash), /ATTACHMENT_RATE_LIMITED/);
    await f.attachmentStore.failed(held.claim, 'ATTACHMENT_RATE_LIMITED'); await expire(f);
    assert.equal(await f.attachmentStore.claim('attachment-cooldown'), null); assert.equal(f.fileState.requests.length, 1);
    await f.admin.query("UPDATE sophie_core.case_attachment_capacity SET until_at = '-infinity'");
    f.fileState.beforeResponse = () => expire(f);
    assert.equal((await execute(f)).status, 'uncertain');
    assert.ok((await f.admin.query("SELECT until_at > clock_timestamp() + interval '119 seconds' AS paused FROM sophie_core.case_attachment_capacity")).rows[0].paused);
    assert.equal(await f.attachmentStore.claim('attachment-late-cooldown'), null);
  });
  await scenario('CA23 unreadable CDN rate limits durably stop all vault workers and pause persistence failure suspends the reporter', async f => {
    await f.addFile(); await f.addFile(); await f.addFile(); const held = await prepare(f);
    f.fileState.status = 429;
    assert.equal((await execute(f)).code, 'ATTACHMENT_RATE_LIMIT_INVALID'); assert.equal((await f.capacity())[0].paused, true);
    await assert.rejects(f.attachmentStore.check(held.claim, held.prepared.policyHash), /ATTACHMENT_RATE_LIMITED/);
    const fresh = attachmentServices(f, f.vault, f.fileState).attachmentWorker;
    assert.deepEqual(await fresh.runOnce('attachment-invalid-rate'), { status: 'idle' }); assert.equal(f.fileState.requests.length, 1);
    await f.admin.query('UPDATE sophie_core.case_attachment_capacity SET paused = false');
    const broken = createAttachmentWorker({ store: { ...f.attachmentStore, async pause() { throw new Error('SYNTHETIC_PAUSE_WRITE_FAILED'); } },
      source: f.attachmentSource, vault: f.vault });
    assert.deepEqual(await broken.runOnce('attachment-pause-write'), { status: 'uncertain' });
    const calls = f.fileState.requests.length; assert.equal((await broken.runOnce('attachment-suspended')).status, 'unavailable');
    assert.equal(f.fileState.requests.length, calls);
  });
}
