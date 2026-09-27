import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { sealFile, unsealFile } from '../apps/core/recovery/sealed-files.js';

async function fixture() {
  const base = resolve('.local/recovery-file-tests'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(resolve(base, 'run-'));
  return { directory, path: resolve(directory, 'encrypted'), key: randomBytes(32), label: 'synthetic:database', maxBytes: 1024 };
}
test('sealed backup files round-trip chunked bytes without storing plaintext or replacing existing output', async () => {
  const f = await fixture(), bytes = Buffer.from('Synthetic recovery fixture.');
  const expected = await sealFile({ ...f, chunks: [bytes.subarray(0, 4), bytes.subarray(4)] });
  assert.equal(expected.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal((await readFile(f.path)).includes(bytes), false);
  assert.deepEqual(await unsealFile({ ...f, expected }), bytes);
  const destination = resolve(f.directory, 'restored'); await unsealFile({ ...f, destination, expected });
  assert.deepEqual(await readFile(destination), bytes);
  await assert.rejects(unsealFile({ ...f, destination, expected }));
  assert.deepEqual(await readFile(destination), bytes); assert.equal((await readdir(f.directory)).some(name => name.endsWith('.part')), false);
});
test('wrong key, swapped label, tampering and truncation never expose a restored file', async () => {
  const f = await fixture(); await sealFile({ ...f, chunks: [Buffer.from('Synthetic secret')] });
  const saved = await readFile(f.path), destination = resolve(f.directory, 'restored');
  for (const mutation of [() => ({ key: randomBytes(32) }), () => ({ label: 'another:database' }),
    async () => { const bytes = Buffer.from(saved); bytes[22] ^= 1; await writeFile(f.path, bytes); return {}; },
    async () => { await writeFile(f.path, saved.subarray(0, 12)); return {}; }]) {
    await writeFile(f.path, saved);
    await assert.rejects(unsealFile({ ...f, destination, ...await mutation() }));
    await assert.rejects(access(destination)); assert.equal((await readdir(f.directory)).some(name => name.endsWith('.part')), false);
  }
});
test('byte limits and authenticated-but-wrong expected hashes fail and remove incomplete output', async () => {
  const f = await fixture(); await assert.rejects(sealFile({ ...f, maxBytes: 1, chunks: [Buffer.from('too large')] }), /BACKUP_SIZE_LIMIT/);
  await assert.rejects(access(f.path));
  const expected = await sealFile({ ...f, chunks: [Buffer.from('fixture')] }), destination = resolve(f.directory, 'restored');
  await assert.rejects(unsealFile({ ...f, maxBytes: 1, destination }), /BACKUP_SIZE_LIMIT/);
  await assert.rejects(unsealFile({ ...f, destination, expected: { ...expected, sha256: '0'.repeat(64) } }), /BACKUP_FILE_MISMATCH/);
  await assert.rejects(access(destination)); assert.equal((await readdir(f.directory)).some(name => name.endsWith('.part')), false);
});
