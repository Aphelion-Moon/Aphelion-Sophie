import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { open, lstat, realpath, unlink, link } from 'node:fs/promises';
import { ContractError, requireCondition, requireInteger } from '../../../contracts/validation.js';

const magic = Buffer.from('SOPHIEB1');
const overhead = magic.length + 12 + 16;
const hash = () => createHash('sha256');
function parameters(key, label, maxBytes) {
  requireCondition(Buffer.isBuffer(key) && key.length === 32 && typeof label === 'string' && label.length <= 160, 'BACKUP_KEY_INVALID');
  requireInteger(maxBytes, 1);
}
async function regularFile(path) {
  const stat = await lstat(path);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && await realpath(path) === path, 'BACKUP_FILE_INVALID');
  return stat;
}

/** The envelope contains only nonce/ciphertext/tag. Paths and record metadata stay in the encrypted manifest. */
export async function sealFile({ chunks, path, key, label, maxBytes, expected = null }) {
  parameters(key, label, maxBytes);
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce), digest = hash();
  cipher.setAAD(Buffer.from(label));
  let file, created = false, complete = false, bytes = 0;
  try {
    file = await open(path, 'wx', 0o600); created = true;
    await file.writeFile(Buffer.concat([magic, nonce]));
    for await (const chunk of chunks) {
      bytes += chunk.length; requireCondition(bytes <= maxBytes, 'BACKUP_SIZE_LIMIT'); digest.update(chunk);
      await file.writeFile(cipher.update(chunk));
    }
    const result = { bytes, sha256: digest.digest('hex') };
    requireCondition(!expected || expected.bytes === bytes && expected.sha256 === result.sha256, 'BACKUP_FILE_MISMATCH');
    await file.writeFile(cipher.final()); await file.writeFile(cipher.getAuthTag()); await file.sync(); complete = true;
    return result;
  } finally { await file?.close(); if (created && !complete) await unlink(path); }
}

/** Never give unauthenticated plaintext to pg_restore. Failed partial output is removed before returning. */
export async function unsealFile({ path, destination = null, key, label, maxBytes, expected = null }) {
  parameters(key, label, maxBytes);
  requireCondition(destination !== null || maxBytes <= 8 * 1024 * 1024, 'BACKUP_MEMORY_LIMIT');
  let file, output, temporary, created = false, complete = false;
  try {
    const stat = await regularFile(path);
    requireCondition(stat.size >= overhead && stat.size <= maxBytes + overhead, 'BACKUP_SIZE_LIMIT');
    file = await open(path, 'r');
    const header = Buffer.alloc(magic.length + 12), tag = Buffer.alloc(16);
    requireCondition((await file.read(header, 0, header.length, 0)).bytesRead === header.length &&
      (await file.read(tag, 0, 16, stat.size - 16)).bytesRead === 16 && header.subarray(0, magic.length).equals(magic), 'BACKUP_FILE_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length));
    decipher.setAAD(Buffer.from(label)); decipher.setAuthTag(tag);
    if (destination !== null) { temporary = `${destination}.part`; output = await open(temporary, 'wx', 0o600); created = true; }
    let bytes = 0; const digest = hash(), memory = [];
    const consume = async chunk => {
      bytes += chunk.length; requireCondition(bytes <= maxBytes, 'BACKUP_SIZE_LIMIT'); digest.update(chunk);
      if (output) await output.writeFile(chunk); else memory.push(chunk);
    };
    if (stat.size > overhead) {
      for await (const chunk of file.createReadStream({ start: header.length, end: stat.size - 17, autoClose: false })) await consume(decipher.update(chunk));
    }
    let final;
    try { final = decipher.final(); } catch { throw new ContractError('BACKUP_AUTHENTICATION_FAILED'); }
    await consume(final);
    const result = { bytes, sha256: digest.digest('hex') };
    requireCondition(!expected || expected.bytes === bytes && expected.sha256 === result.sha256, 'BACKUP_FILE_MISMATCH');
    if (output) {
      await output.sync(); await output.close(); output = null;
      await link(temporary, destination); await unlink(temporary); created = false;
    }
    complete = true; return destination === null ? Buffer.concat(memory) : result;
  } finally {
    await file?.close(); await output?.close();
    if (created && !complete) await unlink(temporary);
  }
}

export async function openBackupSource(path, expectedBytes) {
  const stat = await regularFile(path);
  requireCondition(stat.size === expectedBytes, 'BACKUP_FILE_MISMATCH');
  return open(path, 'r');
}
