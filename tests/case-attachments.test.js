import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateAttachmentPolicy, attachmentUrl, attachmentReference } from '../contracts/case-attachment.js';
import { publicCdnLookup, createAttachmentSource } from '../apps/core/discord/attachment-source.js';
import { createAttachmentVault } from '../apps/core/storage/attachment-vault.js';
import { syntheticAttachmentPolicy, syntheticAttachment, syntheticFileRequest, syntheticFileBytes } from './fixtures/case-attachments.js';

test('attachment policy requires explicit bounded unscanned retention and rejects active formats', () => {
  validateAttachmentPolicy(syntheticAttachmentPolicy);
  for (const change of [{ retention: '30-days' }, { quarantine: 'scanned' }, { allowedTypes: ['text/html'] }, { maxFileBytes: 33554433 }, { maxPerMessage: 21 }])
    assert.throws(() => validateAttachmentPolicy({ ...syntheticAttachmentPolicy, ...change }));
  assert.throws(() => validateAttachmentPolicy({ ...syntheticAttachmentPolicy, execute: true }));
  assert.throws(() => attachmentReference({ channelId: '71', ordinal: 2, attachment: syntheticAttachment('71') }, syntheticAttachmentPolicy), /ATTACHMENT_COUNT_LIMIT/);
});
test('attachment URLs bind the CDN path to captured identities and reject alternate hosts, paths and query controls', () => {
  const base = syntheticAttachment('71').url, id = '740000000000000001';
  assert.equal(attachmentUrl(base, '71', id), base);
  assert.ok(attachmentUrl(`${base}?ex=1234&is=1233&hm=${'a'.repeat(64)}&`, '71', id));
  for (const url of [base.replace('https:', 'http:'), base.replace('cdn.discordapp.com', '127.0.0.1'), base.replace('cdn.discordapp.com', 'cdn.discordapp.com.evil.test'),
    base.replace('cdn.discordapp.com', 'user@cdn.discordapp.com'), base.replace('cdn.discordapp.com', 'cdn.discordapp.com:443'), base.replace('/71/', '/72/'),
    base.replace('synthetic.txt', '..'), base.replace('synthetic.txt', '%2e%2e%2fprivate'), `${base}?redirect=http://localhost/`, `${base}#ignored`,
    base.replace('/attachments/', '/private/../attachments/'), base.replace('synthetic.txt', '%00.txt')]) assert.throws(() => attachmentUrl(url, '71', id), /ATTACHMENT_REFERENCE_INVALID/);
});
test('CDN DNS pins a public IPv4 result and denies private, mixed and unknown destinations', async () => {
  const lookup = addresses => publicCdnLookup((host, options, done) => { assert.equal(host, 'cdn.discordapp.com'); assert.equal(options.family, 4); done(null, addresses); });
  const ask = (fn, host = 'cdn.discordapp.com') => new Promise((resolve, reject) => fn(host, { all: true }, (error, result) => error ? reject(error) : resolve(result)));
  assert.deepEqual(await ask(lookup([{ address: '104.16.1.2', family: 4 }])), [{ address: '104.16.1.2', family: 4 }]);
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.1.1.1', '::1', '192.0.2.1'])
    await assert.rejects(ask(lookup([{ address, family: 4 }])), /ATTACHMENT_NETWORK_UNAVAILABLE/);
  await assert.rejects(ask(lookup([{ address: '104.16.1.2', family: 4 }, { address: '10.0.0.1', family: 4 }])), /ATTACHMENT_NETWORK_UNAVAILABLE/);
  await assert.rejects(ask(lookup([]), 'localhost'), /ATTACHMENT_REFERENCE_INVALID/);
});
test('attachment source forbids redirects, encodings, wrong types and lengths without passing credentials', async () => {
  const reference = attachmentReference({ channelId: '71', ordinal: 0, attachment: syntheticAttachment('71') }, syntheticAttachmentPolicy);
  for (const override of [{ status: 302 }, { status: 429 }, { status: 429, headers: { 'retry-after': '86401' } },
    { headers: { 'content-encoding': 'gzip' } }, { headers: { 'content-type': 'text/html' } }, { headers: { 'content-length': '999' } }]) {
    const state = { bytes: syntheticFileBytes, requests: [], ...override }, source = createAttachmentSource({ request: syntheticFileRequest(state), lookup() {}, enabled: () => true });
    await assert.rejects(source.acquire(reference, 1000, () => { throw new Error('INVALID_BODY_CONSUMED'); }),
      { code: state.status === 429 ? 'ATTACHMENT_RATE_LIMIT_INVALID' : 'ATTACHMENT_RESPONSE_INVALID' });
    assert.equal(Object.hasOwn(state.requests[0].options.headers, 'Authorization'), false);
    assert.equal(Object.hasOwn(state.requests[0].options.headers, 'Cookie'), false);
  }
});
test('private file slots verify bytes and hashes, do not use filenames, and cannot overwrite prior captures', async () => {
  const base = resolve('.local/attachment-unit'); await mkdir(base, { recursive: true }); const root = await mkdtemp(resolve(base, 'run-'));
  let now = 100; const vault = await createAttachmentVault({ root, clock: () => now }), slot = 'a'.repeat(48);
  const reference = { size: syntheticFileBytes.length, type: 'text/plain' };
  const proof = await vault.write(slot, reference, Readable.from([syntheticFileBytes.subarray(0, 2), syntheticFileBytes.subarray(2)]));
  assert.deepEqual(proof, {}); assert.equal(vault.inspect(proof).sha256, createHash('sha256').update(syntheticFileBytes).digest('hex'));
  assert.deepEqual(await readdir(root), [`${slot}.blob`]); assert.ok(await vault.recover(slot, reference));
  const reader = await createAttachmentVault({ root, clock: () => now, readOnly: true });
  assert.equal(reader.vaultId, vault.vaultId); assert.equal(reader.inspect(await reader.recover(slot, reference)).sha256, vault.inspect(proof).sha256);
  await assert.rejects(reader.write('b'.repeat(48), reference, Readable.from([syntheticFileBytes])), /ATTACHMENT_VAULT_READ_ONLY/);
  await assert.rejects(createAttachmentVault({ root: resolve(root, 'absent'), clock: () => now, readOnly: true }), { code: 'ENOENT' });
  await assert.rejects(createAttachmentVault({ root: resolve(root, `${slot}.blob`), clock: () => now, readOnly: true }), /ATTACHMENT_VAULT_INVALID/);
  await assert.rejects(vault.write(slot, reference, Readable.from([syntheticFileBytes])), /ATTACHMENT_STORAGE_UNAVAILABLE/);
  assert.equal(await vault.recover('b'.repeat(48), reference), null);
  await assert.rejects(vault.write('../unsafe', reference, Readable.from([syntheticFileBytes])), /ATTACHMENT_TOKEN_INVALID/);
  assert.throws(() => vault.inspect({}), /UNTRUSTED_ATTACHMENT_FILE/); now += 60001; assert.throws(() => vault.inspect(proof), /UNTRUSTED_ATTACHMENT_FILE/);
  await writeFile(resolve(root, `${slot}.blob`), Buffer.alloc(reference.size));
  await assert.rejects(vault.recover(slot, reference), /ATTACHMENT_CONTENT_INVALID/);
});
test('file acquisition rejects truncated, oversized, invalid text and spoofed binary content without retaining a completed file', async () => {
  const base = resolve('.local/attachment-unit'); await mkdir(base, { recursive: true }); const root = await mkdtemp(resolve(base, 'run-'));
  const vault = await createAttachmentVault({ root, clock: () => 100 });
  const cases = [[Buffer.from('a'), 2, 'text/plain'], [Buffer.from('abc'), 2, 'text/plain'], [Buffer.from([0xff]), 1, 'text/plain'],
    [Buffer.from('MZ executable'), 13, 'image/png'], [Buffer.from([0]), 1, 'text/plain']];
  for (const [index, [body, size, type]] of cases.entries()) await assert.rejects(vault.write(index.toString(16).repeat(48), { size, type }, Readable.from([body])), /ATTACHMENT_(CONTENT_INVALID|SIZE_LIMIT)/);
  assert.deepEqual(await readdir(root), []);
});
