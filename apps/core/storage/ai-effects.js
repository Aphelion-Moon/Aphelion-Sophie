import { randomUUID } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { aiDigest } from './ai-controls.js';
import { inTransaction } from './transaction.js';

const hash = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'AI_EFFECT_INVALID');
function dependencies(request, history) {
  const result = new Map();
  for (const item of [request, ...history]) for (const source of item.kind === 'assistant' ? item.dependencies : [item]) {
    const { guildId, channelId, userId, messageId, receivedAt } = source;
    [guildId, channelId, userId, messageId].forEach(requireId); requireInteger(receivedAt);
    requireCondition(guildId === request.guildId && channelId === request.channelId, 'AI_EFFECT_INVALID');
    const value = { guildId, channelId, userId, messageId, receivedAt, bindingHash: aiDigest(source.binding) };
    const prior = result.get(messageId); requireCondition(!prior || aiDigest(prior) === aiDigest(value), 'AI_EFFECT_INVALID');
    result.set(messageId, value);
  }
  requireCondition(result.size <= 13, 'AI_EFFECT_INVALID'); return [...result.values()];
}
function references(sources, history) {
  const result = new Map();
  for (const source of [...sources, ...history.flatMap(item => item.knowledge ?? [])]) {
    requireCondition(typeof source.id === 'string' && /^[a-z][a-z0-9-]{0,47}\.r[1-9][0-9]*\.s[0-9]+$/.test(source.id), 'AI_EFFECT_INVALID');
    hash(source.publicationHash); requireInteger(source.epoch, 1);
    const value = { id: source.id, publicationHash: source.publicationHash, epoch: source.epoch }, prior = result.get(source.id);
    requireCondition(!prior || aiDigest(prior) === aiDigest(value), 'AI_EFFECT_INVALID'); result.set(source.id, value);
  }
  requireCondition(result.size <= 24, 'AI_EFFECT_INVALID'); return [...result.values()];
}

/** Durable fixed-target ownership. Unknown network outcomes are parked, never replayed or discovered through history. */
export function createAiEffects({ pool, guildId, clock }) {
  requireId(guildId);
  const proof = value => {
    requireId(value.messageId); requireCondition(typeof value.owner === 'string' && /^[a-f0-9-]{36}$/.test(value.owner), 'AI_EFFECT_UNTRUSTED');
    return [guildId, value.messageId, value.owner];
  };
  return Object.freeze({
    async claim(request, kind, emoji, history = [], sources = []) {
      requireCondition(request.guildId === guildId && ['reply','react'].includes(kind), 'AI_EFFECT_INVALID');
      requireId(request.channelId); requireId(request.messageId); requireInteger(request.deadline);
      let selected = null;
      if (kind === 'react') {
        requireCondition(request.config.emojis.some(item => aiDigest(item) === aiDigest(emoji)), 'AI_EFFECT_INVALID');
        selected = { key: emoji.key, id: emoji.id, name: emoji.name };
      }
      const owner = randomUUID(), parents = dependencies(request, history), refs = references(sources, history);
      return inTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(182745,56)');
        // A fixed capacity preserves unresolved ownership rather than silently evicting it.
        const count = (await client.query("SELECT count(*)::int AS count FROM sophie_ai.effects WHERE guild_id=$1 AND state<>'removed'", [guildId])).rows[0].count;
        requireCondition(count < 10000 && clock() < request.deadline, 'AI_EFFECT_CAPACITY');
        const inserted = await client.query(`INSERT INTO sophie_ai.effects(guild_id,message_id,owner,channel_id,kind,emoji,dependencies,sources,state,deadline)
          SELECT guild_id,message_id,$3,channel_id,$4,$5,$6,$7,'prepared',deadline FROM sophie_ai.request_receipts
          WHERE guild_id=$1 AND message_id=$2 AND state='sending' AND input_revision=$8 AND deadline>clock_timestamp()
          ON CONFLICT DO NOTHING RETURNING message_id`,
        [guildId,request.messageId,owner,kind,selected,JSON.stringify(parents),JSON.stringify(refs),request.inputRevision]);
        requireCondition(inserted.rowCount === 1, 'AI_EFFECT_UNTRUSTED'); return { messageId: request.messageId, owner };
      });
    },
    async begin(value) {
      requireCondition((await pool.query(`UPDATE sophie_ai.effects SET state='attempted',updated_at=clock_timestamp()
        WHERE guild_id=$1 AND message_id=$2 AND owner=$3 AND state='prepared' AND deadline>clock_timestamp() RETURNING message_id`, proof(value))).rowCount === 1, 'AI_EFFECT_REVOKED');
    },
    async note(value, id) {
      requireCondition(typeof id === 'string' && /^[a-zA-Z0-9._-]{1,96}$/.test(id), 'AI_EFFECT_INVALID');
      // A late positive receipt remains useful even after revocation or local expiry.
      requireCondition((await pool.query(`UPDATE sophie_ai.effects SET receipt_id=$4,
        state=CASE WHEN state='cleanup' OR deadline<=clock_timestamp() THEN 'cleanup' ELSE 'confirmed' END,updated_at=clock_timestamp()
        WHERE guild_id=$1 AND message_id=$2 AND owner=$3 AND state IN ('attempted','confirmed','cleanup')
          AND (receipt_id IS NULL OR receipt_id=$4) AND ((kind='reply' AND $4 ~ '^[1-9][0-9]{0,19}$') OR (kind='react' AND emoji->>'key'=$4)) RETURNING message_id`, [...proof(value),id])).rowCount === 1, 'AI_EFFECT_UNTRUSTED');
      return { ...value, id };
    },
    async cleanup(value) {
      const row = (await pool.query(`UPDATE sophie_ai.effects SET state='cleanup',updated_at=clock_timestamp()
        WHERE guild_id=$1 AND message_id=$2 AND owner=$3 AND state<>'removed' RETURNING *`, proof(value))).rows[0];
      requireCondition(row?.receipt_id && (value.id === undefined || value.id === row.receipt_id), 'AI_EFFECT_UNTRUSTED'); return row;
    },
    async removed(value) {
      requireCondition((await pool.query(`UPDATE sophie_ai.effects SET state='removed',dependencies='[]',sources='[]',updated_at=clock_timestamp()
        WHERE guild_id=$1 AND message_id=$2 AND owner=$3 AND state='cleanup' AND receipt_id IS NOT NULL RETURNING message_id`, proof(value))).rowCount === 1, 'AI_EFFECT_UNTRUSTED');
    },
    async invalidate({ channelId = null, userId = null, messageId = null } = {}) {
      [channelId,userId,messageId].filter(value => value !== null).forEach(requireId);
      await pool.query(`UPDATE sophie_ai.effects SET state='cleanup',updated_at=clock_timestamp() WHERE guild_id=$1 AND state NOT IN ('removed','cleanup')
        AND ($2::text IS NULL OR channel_id=$2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(dependencies) d WHERE d->>'userId'=$3))
        AND ($4::text IS NULL OR receipt_id=$4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(dependencies) d WHERE d->>'messageId'=$4))`, [guildId,channelId,userId,messageId]);
    },
    async recover() {
      await pool.query("UPDATE sophie_ai.effects SET state='cleanup',updated_at=clock_timestamp() WHERE guild_id=$1 AND state IN ('prepared','attempted')", [guildId]);
    },
    async pending() {
      return inTransaction(pool, async client => {
        // The request receipt still prevents resending after retired cleanup metadata is pruned.
        await client.query("DELETE FROM sophie_ai.effects WHERE guild_id=$1 AND state='removed' AND updated_at<clock_timestamp()-interval '7 days'", [guildId]);
        const rows = (await client.query(`SELECT * FROM sophie_ai.effects WHERE guild_id=$1 AND receipt_id IS NOT NULL AND state IN ('confirmed','cleanup')
          ORDER BY checked_at,message_id LIMIT 4 FOR UPDATE SKIP LOCKED`, [guildId])).rows;
        if (rows.length) await client.query('UPDATE sophie_ai.effects SET checked_at=clock_timestamp() WHERE guild_id=$1 AND message_id=ANY($2::text[])', [guildId,rows.map(row => row.message_id)]);
        return rows;
      });
    },
  });
}
