import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { readRuntimeJson } from './files.js';
import { newStagingBootstrapReceipt, validateStagingSeed } from './staging-bootstrap.js';

/** One local setup owner. Fsynced receipts precede creates; no claim of atomicity with Discord. */
export async function openBootstrapJournal(directory, seed) {
  validateStagingSeed(seed); await mkdir(directory, { recursive: true });
  const path = resolve(directory, `staging-bootstrap.${seed.guildId}.json`), lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx'); } catch (error) { requireCondition(error.code !== 'EEXIST', 'STAGING_BOOTSTRAP_LOCKED'); throw error; }
  async function save(value) {
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const file = await open(temporary, 'wx');
      try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function close() { await lock.close(); await unlink(lockPath); }
  try {
    try { await readRuntimeJson(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await save(newStagingBootstrapReceipt(seed, randomBytes(8).toString('hex'))); }
    return Object.freeze({ path, read: () => readRuntimeJson(path), save, close,
      async writeConfiguration(configuration) {
        const output = resolve(directory, `staging.${seed.guildId}.json`); let file;
        try { file = await open(output, 'wx'); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          requireCondition(JSON.stringify(await readRuntimeJson(output)) === JSON.stringify(configuration), 'STAGING_CONFIGURATION_EXISTS'); return output;
        }
        try { await file.writeFile(`${JSON.stringify(configuration, null, 2)}\n`, 'utf8'); await file.sync(); } finally { await file.close(); }
        return output;
      } });
  } catch (error) { await close(); throw error; }
}
