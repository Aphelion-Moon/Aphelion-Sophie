import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { SYSTEM_MESSAGES, canonicalSystemWording, createSystemText } from '../../../contracts/system-messages.js';
import { inTransaction } from './transaction.js';

const hash = value => createHash('sha256').update(JSON.stringify(value, (_key, part) => part && typeof part === 'object' && !Array.isArray(part) ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part)).digest('hex');
export async function readSystemWording(client, guildId, revision = null) {
  if (revision === 0) return { revision: 0, text: createSystemText() };
  const row = (await client.query(`SELECT revision, wording, sha256 FROM sophie_core.system_wording
    WHERE guild_id=$1 AND ($2::integer IS NULL OR revision=$2) ORDER BY revision DESC LIMIT 1`, [guildId, revision])).rows[0];
  requireCondition(row || revision === null, 'SYSTEM_WORDING_CORRUPT');
  if (!row) return { revision: 0, text: createSystemText() };
  requireCondition(hash(row.wording) === row.sha256, 'SYSTEM_WORDING_CORRUPT');
  return { revision: row.revision, text: createSystemText(row.wording) };
}
export function createSystemWordingReader({ pool, guildId }) {
  requireId(guildId);
  return async (client = pool) => (await readSystemWording(client, guildId)).text;
}

/** Uses the existing guidance-publisher grant. No case data or access settings. */
export function createSystemWordingStore({ pool, authorize, guildId, definitionId }) {
  requireId(guildId);
  const access = async actor => {
    requireCondition(await authorize('shuttle.publish', actor, { guildId, definitionId }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  };
  const latest = async client => (await client.query('SELECT revision, wording, sha256 FROM sophie_core.system_wording WHERE guild_id=$1 ORDER BY revision DESC LIMIT 1', [guildId])).rows[0] ?? { revision: 0, wording: {} };
  return Object.freeze({
    async read({ actor }) {
      await access(actor); const row = await latest(pool); await access(actor);
      if (row.revision) requireCondition(hash(row.wording) === row.sha256, 'SYSTEM_WORDING_CORRUPT');
      return { revision: row.revision, wording: canonicalSystemWording(row.wording), catalogue: SYSTEM_MESSAGES };
    },
    async save({ actor, ...input }) {
      requireKeys(input, ['requestId', 'expectedRevision', 'wording']);
      requireCondition(/^[a-f0-9]{64}$/.test(input.requestId), 'SYSTEM_WORDING_INVALID');
      requireInteger(input.expectedRevision, 0, 2_147_483_646);
      const wording = canonicalSystemWording(input.wording), requestHash = hash({ expectedRevision: input.expectedRevision, wording });
      return inTransaction(pool, async client => {
        const grant = await access(actor);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 52))', [guildId]);
        const prior = (await client.query('SELECT revision, request_sha256 FROM sophie_core.system_wording WHERE guild_id=$1 AND request_id=$2', [guildId, input.requestId])).rows[0];
        if (prior) {
          requireCondition(prior.request_sha256 === requestHash, 'SYSTEM_WORDING_CONFLICT'); await access(actor);
          return { revision: prior.revision };
        }
        const current = await latest(client);
        requireCondition(current.revision === input.expectedRevision, 'SYSTEM_WORDING_CONFLICT');
        const revision = current.revision + 1;
        await client.query(`INSERT INTO sophie_core.system_wording (guild_id,revision,wording,sha256,request_id,request_sha256,operator_grant)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [guildId, revision, wording, hash(wording), input.requestId, requestHash, grant]);
        await access(actor); return { revision };
      });
    },
  });
}
