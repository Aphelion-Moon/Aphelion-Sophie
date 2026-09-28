import { open, unlink } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { ContractError, requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';

const limit = 8 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
function identity(path,id) {
  requireCondition(typeof path === 'string' && isAbsolute(path) && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id),'AI_PREFERENCE_JOURNAL_INVALID');
}
/** Operator-only provisioning helper. Runtime never recreates a lost journal or clears an abandoned lock. */
export async function initializePreferenceJournal({ path, id }) {
  identity(path,id); const file = await open(path,'wx');
  try { await file.writeFile(JSON.stringify({schema:1,id})+'\n','utf8'); await file.sync(); } finally { await file.close(); }
}

/** Independent deletion/write watermark; its location, identity, ACL and restore exclusion require operator qualification. */
export function createPreferenceJournal({ path, id, qualified = async () => false }) {
  identity(path,id); requireCondition(typeof qualified === 'function','TRUSTED_ADAPTERS_REQUIRED');
  async function access(work) {
    requireCondition(await qualified() === true,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
    let lock;
    try {
      lock = await open(`${path}.lock`,'wx');
      const file = await open(path,'r+');
      try {
        const stat = await file.stat(); requireCondition(stat.isFile() && stat.size <= limit,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
        const text = await file.readFile('utf8'); requireCondition(text.endsWith('\n'),'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
        const lines = text.slice(0,-1).split('\n'), header = JSON.parse(lines.shift());
        requireCondition(JSON.stringify(header) === JSON.stringify({schema:1,id}),'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
        const epochs = new Map(); let previous = digest(JSON.stringify(header));
        for (const line of lines) {
          const row = JSON.parse(line), expected = {scope:row.scope,epoch:row.epoch,previous};
          requireCondition(typeof row.scope === 'string' && /^[a-f0-9]{64}$/.test(row.scope) && Number.isSafeInteger(row.epoch) && row.epoch > (epochs.get(row.scope) ?? 0) &&
            JSON.stringify(row) === JSON.stringify({...expected,hash:digest(JSON.stringify(expected))}),'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
          epochs.set(row.scope,row.epoch); previous=row.hash;
        }
        const result = await work({file,size:stat.size,epochs,previous});
        requireCondition(await qualified() === true,'AI_PREFERENCE_JOURNAL_UNAVAILABLE'); return result;
      } finally { await file.close(); }
    } catch (error) {
      if(error instanceof ContractError && error.code==='AI_PREFERENCE_STALE')throw error;
      requireCondition(false,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
    }
    finally {
      if (lock) {
        try { await lock.close(); await unlink(`${path}.lock`); }
        catch { requireCondition(false,'AI_PREFERENCE_JOURNAL_UNAVAILABLE'); }
      }
    }
  }
  function scope(guildId,userId) { requireId(guildId);requireId(userId);return digest(`sophie-response-preferences:${guildId}:${userId}`); }
  return Object.freeze({
    read: (guildId,userId) => access(({epochs})=>epochs.get(scope(guildId,userId)) ?? 0),
    advance(guildId,userId,expectedEpoch,nextEpoch) {
      requireInteger(expectedEpoch);requireInteger(nextEpoch,expectedEpoch+1);
      const key=scope(guildId,userId);
      return access(async ({file,size,epochs,previous})=>{
        requireCondition((epochs.get(key) ?? 0)===expectedEpoch,'AI_PREFERENCE_STALE');
        const record={scope:key,epoch:nextEpoch,previous},line=JSON.stringify({...record,hash:digest(JSON.stringify(record))})+'\n';
        requireCondition(size+Buffer.byteLength(line)<=limit,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
        // A crash after this sync but before the database commit quarantines old settings.
        await file.writeFile(line,'utf8');await file.sync();return nextEpoch;
      });
    },
  });
}
