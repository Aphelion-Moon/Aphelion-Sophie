import assert from 'node:assert/strict';
import { writeFile, rename, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAttachmentVault } from '../../apps/core/storage/attachment-vault.js';
import { createAttachmentInventory } from '../../apps/core/storage/attachment-inventory.js';
import { attachmentWorkflow, syntheticFileBytes } from '../../tests/fixtures/case-attachments.js';
import { GUILD } from '../../tests/fixtures/domain.js';

export async function runAttachmentOperationsSuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => {
    const f = await attachmentWorkflow(cluster), client = await f.pool.connect();
    await client.query('SET default_transaction_read_only = on');
    const vault = await createAttachmentVault({ root: f.vaultRoot, clock: () => f.clock.now, readOnly: true });
    const inventory = createAttachmentInventory({ pool: client, guildId: GUILD, vault });
    try { await work({ ...f, inventory, readOnlyClient: client, readOnlyVault: vault }); }
    finally { await client.query('SET default_transaction_read_only = off'); client.release(); }
  });
  const retain = async f => { await f.addFile(); assert.equal((await f.attachmentWorker.runOnce('inventory-fixture')).status, 'retained'); return (await f.jobs()).at(-1); };
  await scenario('AO01 read-only inventory pages metadata without case content or filesystem inspection', async f => {
    await retain(f); for (let index = 0; index < 25; index++) await f.addFile();
    const jobsBefore = await f.jobs(), attemptsBefore = await f.attempts(), capacityBefore = await f.capacity();
    const first = await f.inventory.page(), last = await f.inventory.page(first.next);
    assert.equal(first.entries.length, 25); assert.equal(last.entries.length, 1); assert.equal(last.next, null);
    assert.equal(new Set([...first.entries, ...last.entries].map(row => row.token)).size, 26);
    assert.deepEqual(first.totals, { jobs: '26', pending: '25', unavailable: '0' });
    assert.equal(first.capacity.accountingMatches, true); assert.equal(first.capacity.reservedBytes, String(syntheticFileBytes.length));
    assert.equal(first.filesystemScanned, false); assert.ok(first.entries.every(row => row.integrity === 'not_checked' && !row.downloadable));
    const encoded = JSON.stringify(first);
    for (const forbidden of ['filename', 'https://', 'source_hash', 'policy_hash', 'Authored synthetic attachment', 'Synthetic conversation']) assert.equal(encoded.includes(forbidden), false);
    assert.deepEqual(await f.jobs(), jobsBefore); assert.deepEqual(await f.attempts(), attemptsBefore); assert.deepEqual(await f.capacity(), capacityBefore);
    await assert.rejects(f.inventory.page('../vault'), /ATTACHMENT_TOKEN_INVALID/);
  });
  await scenario('AO02 one retained file verifies against its pinned hash without granting downloads or changing files', async f => {
    const row = await retain(f), files = await readdir(f.vaultRoot), capacity = await f.capacity();
    const result = await f.inventory.verify(row.token);
    assert.equal(result.integrity, 'matches'); assert.equal(result.scanStatus, 'unscanned'); assert.equal(result.downloadable, false); assert.equal(result.repaired, false);
    assert.deepEqual(await readdir(f.vaultRoot), files); assert.deepEqual(await readFile(resolve(f.vaultRoot, `${row.retained_slot}.blob`)), syntheticFileBytes);
    assert.deepEqual(await f.capacity(), capacity); assert.equal(Object.hasOwn(result, 'body'), false);
  });
  await scenario('AO03 corruption and missing blobs remain retained records and reservations', async f => {
    const row = await retain(f), file = resolve(f.vaultRoot, `${row.retained_slot}.blob`), before = await f.capacity();
    await writeFile(file, Buffer.alloc(syntheticFileBytes.length, 65));
    assert.equal((await f.inventory.verify(row.token)).integrity, 'mismatch');
    await rename(file, resolve(f.vaultRoot, `${row.retained_slot}.held`));
    assert.equal((await f.inventory.verify(row.token)).integrity, 'missing');
    assert.deepEqual(await f.capacity(), before); assert.equal((await f.jobs())[0].status, 'retained');
  });
  await scenario('AO04 foreign guild vault and non-retained selections cannot hash a file', async f => {
    const row = await retain(f); await f.addFile();
    let reads = 0;
    const vault = { ...f.readOnlyVault, async recover() { reads++; throw Error('UNEXPECTED_FILE_READ'); } };
    const foreignGuild = createAttachmentInventory({ pool: f.readOnlyClient, guildId: '999', vault });
    assert.deepEqual((await foreignGuild.page()).entries, []); await assert.rejects(foreignGuild.verify(row.token), /ATTACHMENT_INVENTORY_SELECTION_INVALID/);
    const foreignVault = createAttachmentInventory({ pool: f.readOnlyClient, guildId: GUILD, vault: { ...vault, vaultId: 'a'.repeat(64) } });
    await assert.rejects(foreignVault.verify(row.token), /ATTACHMENT_INVENTORY_SELECTION_INVALID/);
    await assert.rejects(f.inventory.verify((await f.jobs()).at(-1).token), /ATTACHMENT_INVENTORY_SELECTION_INVALID/);
    assert.equal(reads, 0);
  });
  await scenario('AO05 changed selection and accounting discrepancies are reported without repairs or pause clearing', async f => {
    const row = await retain(f);
    const inventory = createAttachmentInventory({ pool: f.readOnlyClient, guildId: GUILD, vault: { ...f.readOnlyVault,
      async recover(...args) {
        const proof = await f.readOnlyVault.recover(...args);
        await f.admin.query('UPDATE sophie_core.case_attachment_jobs SET fence = fence + 1 WHERE token = $1', [row.token]); return proof;
      } } });
    assert.equal((await inventory.verify(row.token)).integrity, 'changed');
    await f.admin.query("UPDATE sophie_core.case_attachment_capacity SET reserved_bytes = reserved_bytes + 10, paused = true, until_at = clock_timestamp() + interval '1 hour'");
    await f.admin.query("UPDATE sophie_core.case_attachment_jobs SET last_error_code = 'synthetic-private-text'");
    const page = await inventory.page(); assert.equal(page.capacity.accountingMatches, false); assert.equal(page.capacity.paused, true); assert.equal(page.capacity.coolingDown, true);
    assert.equal(page.entries[0].last_error_code, 'UNRECOGNIZED_CODE'); assert.equal(JSON.stringify(page).includes('synthetic-private-text'), false);
    assert.equal((await f.capacity())[0].paused, true);
  });
}
