import { createHash } from 'node:crypto';
import { open, mkdir, realpath, lstat, link, unlink } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { requireAttachmentToken, attachmentTypes } from '../../../contracts/case-attachment.js';
import { ContractError, requireCondition, requireInteger } from '../../../contracts/validation.js';

function inspection(size, type) {
  requireInteger(size, 1, 33554432); requireCondition(attachmentTypes.includes(type), 'ATTACHMENT_TYPE_DENIED');
  let bytes = 0, prefix = Buffer.alloc(0);
  const hash = createHash('sha256'), text = type === 'text/plain' ? new TextDecoder('utf-8', { fatal: true }) : null;
  const decode = (chunk, stream) => {
    if (!text) return;
    try { requireCondition(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text.decode(chunk, { stream })), 'ATTACHMENT_CONTENT_INVALID'); }
    catch { throw new ContractError('ATTACHMENT_CONTENT_INVALID'); }
  };
  return {
    add(chunk) {
      requireCondition(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array, 'ATTACHMENT_CONTENT_INVALID');
      bytes += chunk.length; requireCondition(bytes <= size, 'ATTACHMENT_SIZE_LIMIT'); hash.update(chunk);
      if (prefix.length < 8) prefix = Buffer.concat([prefix, chunk.subarray(0, 8 - prefix.length)]);
      decode(chunk, true);
    },
    finish() {
      requireCondition(bytes === size, 'ATTACHMENT_CONTENT_INVALID'); decode(undefined, false);
      requireCondition(type === 'text/plain' || (type === 'image/png' && prefix.toString('hex') === '89504e470d0a1a0a') ||
        (type === 'image/jpeg' && prefix.subarray(0, 3).toString('hex') === 'ffd8ff'), 'ATTACHMENT_CONTENT_INVALID');
      return { bytes, sha256: hash.digest('hex') };
    },
  };
}

/** Private core filesystem adapter; opaque slot names, no user paths and no download endpoint. */
export async function createAttachmentVault({ root, clock, readOnly = false }) {
  requireCondition(typeof root === 'string' && isAbsolute(root) && typeof clock === 'function', 'ATTACHMENT_VAULT_INVALID');
  requireCondition(typeof readOnly === 'boolean', 'ATTACHMENT_VAULT_INVALID');
  if (!readOnly) await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await realpath(root), proofs = new WeakMap();
  const directoryStat = await lstat(root);
  requireCondition(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'ATTACHMENT_VAULT_INVALID');
  const vaultId = createHash('sha256').update(process.platform === 'win32' ? directory.toLowerCase() : directory).digest('hex');
  async function path(slot, extension) {
    requireAttachmentToken(slot);
    requireCondition(await realpath(root) === directory && !(await lstat(root)).isSymbolicLink(), 'ATTACHMENT_VAULT_INVALID');
    return resolve(directory, `${slot}.${extension}`);
  }
  function proof(slot, result) {
    const token = Object.freeze({}); proofs.set(token, { ...result, slot, vaultId, at: clock() }); return token;
  }
  return Object.freeze({
    vaultId,
    async write(slot, reference, chunks) {
      requireCondition(!readOnly, 'ATTACHMENT_VAULT_READ_ONLY');
      let handle, temporary, created = false;
      try {
        temporary = await path(slot, 'part'); const destination = await path(slot, 'blob');
        const check = inspection(reference.size, reference.type);
        handle = await open(temporary, 'wx', 0o600); created = true;
        for await (const chunk of chunks) { check.add(chunk); await handle.writeFile(chunk); }
        const result = check.finish(); await handle.sync(); await handle.close(); handle = null;
        // link is exclusive: a late writer cannot overwrite a completed slot.
        await link(temporary, destination); await unlink(temporary); created = false;
        return proof(slot, result);
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw new ContractError('ATTACHMENT_STORAGE_UNAVAILABLE');
      } finally { await handle?.close().catch(() => {}); if (created) await unlink(temporary).catch(() => {}); }
    },
    async recover(slot, reference) {
      let handle;
      try {
        const file = await path(slot, 'blob');
        let stat;
        try { stat = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        requireCondition(stat.isFile() && !stat.isSymbolicLink() && await realpath(file) === file && stat.size === reference.size, 'ATTACHMENT_CONTENT_INVALID');
        handle = await open(file, 'r'); const check = inspection(reference.size, reference.type);
        for await (const chunk of handle.createReadStream({ autoClose: false })) check.add(chunk);
        return proof(slot, check.finish());
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw new ContractError('ATTACHMENT_STORAGE_UNAVAILABLE');
      } finally { await handle?.close().catch(() => {}); }
    },
    inspect(token) {
      const saved = proofs.get(token), now = clock(); requireInteger(now);
      requireCondition(saved !== undefined && now >= saved.at && now - saved.at <= 60000, 'UNTRUSTED_ATTACHMENT_FILE');
      return { ...saved };
    },
  });
}
