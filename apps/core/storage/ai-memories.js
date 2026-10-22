import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { canonicalEditedMemory, MEMORY_LIFETIME_MS, renderMemory, validateStoredMemory } from '../../../modules/assistant/memories.js';
import { inTransaction } from './transaction.js';

export const MEMORY_MEMBER_CAP = 40;
export const MEMORY_CHANNEL_CAP = 60;
const PROMPT_MEMBER = 8, PROMPT_CHANNEL = 4;
const MEMORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const requireMemoryId = id => requireCondition(typeof id === 'string' && MEMORY_ID.test(id), 'AI_MEMORY_INVALID');
const row = value => ({ id: value.id, channelId: value.channel_id, scope: value.scope, restricted: value.restricted === true, subjects: [...value.subject_ids],
  epochs: value.subject_epochs.map(Number), text: value.text, edited: value.edited,
  createdAt: value.created_at.getTime(), usedAt: value.used_at.getTime(), expiresAt: value.expires_at.getTime() });

/** Re-stamps a member's memories with their new preference epoch, inside the transaction that advanced it. */
export async function restampAiMemories(client, guildId, userId, epoch) {
  requireId(userId); requireInteger(epoch, 1);
  await client.query(`UPDATE sophie_ai.memories m SET subject_epochs=(SELECT array_agg(CASE WHEN s=$2 THEN $3::bigint ELSE e END ORDER BY i)
    FROM unnest(m.subject_ids,m.subject_epochs) WITH ORDINALITY AS u(s,e,i)) WHERE guild_id=$1 AND $2=ANY(subject_ids)`, [guildId, userId, epoch]);
}

/** Erasure on departure: every memory that names the member, and their opt-out. */
export async function eraseAiMemories(client, guildId, userId) {
  requireId(userId);
  await client.query('DELETE FROM sophie_ai.memories WHERE guild_id=$1 AND $2=ANY(subject_ids)', [guildId, userId]);
  await client.query('DELETE FROM sophie_ai.memory_optouts WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
}

/**
 * Sophie's own memories (owner decision, 20 October 2026). Core-only: the worker never reads or writes them. A memory is
 * usable only while every subject has said Yes, has memory on, has no departure pending and still holds the preference epoch the
 * memory was written under, so a restored backup cannot bring back what a member deleted.
 */
export function createAiMemories({ pool, guildId, journal, privacyCurrent, clock = Date.now }) {
  requireId(guildId);
  requireCondition(pool && typeof pool.query === 'function' && typeof journal?.read === 'function' && typeof journal.advance === 'function' &&
    typeof privacyCurrent === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  // held: the caller holds the AI control lock in this transaction, so the privacy check runs on it rather than waiting.
  async function subjectState(client, userIds, held = false) {
    const states = new Map();
    if (!userIds.length) return states;
    const epochs = new Map((await client.query('SELECT user_id,epoch FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=ANY($2::text[])',
      [guildId, userIds])).rows.map(item => [item.user_id, Number(item.epoch)]));
    const out = new Set((await client.query('SELECT user_id FROM sophie_ai.memory_optouts WHERE guild_id=$1 AND user_id=ANY($2::text[])',
      [guildId, userIds])).rows.map(item => item.user_id));
    // A memory follows its subject's server-wide Yes (owner decision, 23 October 2026): saying No hides it, Yes again restores it.
    const agreed = new Set((await client.query('SELECT user_id FROM sophie_ai.member_consents WHERE guild_id=$1 AND user_id=ANY($2::text[]) AND enabled',
      [guildId, userIds])).rows.map(item => item.user_id));
    for (const userId of userIds) {
      // privacyCurrent checks the independent journal watermark and pending departures; a mismatch starts erasure.
      const usable = agreed.has(userId) && !out.has(userId) && await (held ? privacyCurrent(userId, client) : privacyCurrent(userId)) === true;
      states.set(userId, { usable, epoch: epochs.get(userId) ?? 0 });
    }
    return states;
  }
  const usable = (memory, states) => memory.subjects.every((id, index) => states.get(id)?.usable === true && states.get(id).epoch === memory.epochs[index]);
  async function valid(client, rows) {
    const memories = rows.map(row).filter(memory => { try { validateStoredMemory(memory); return memory.expiresAt > clock(); } catch { return false; } });
    const states = await subjectState(client, [...new Set(memories.flatMap(memory => memory.subjects))]);
    return memories.filter(memory => usable(memory, states));
  }
  const view = memory => Object.freeze({ id: memory.id, scope: memory.scope, subjects: Object.freeze([...memory.subjects]), text: memory.text });
  /** Advances the member's preference epoch (journal first, then database) and re-stamps their memories. */
  async function fence(client, userId, presenceEpoch) {
    const watermark = await journal.read(guildId, userId); requireInteger(watermark);
    const saved = (await client.query('SELECT epoch FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2 FOR UPDATE', [guildId, userId])).rows[0];
    requireCondition(Number(saved?.epoch ?? 0) === watermark, 'AI_PREFERENCE_RESTORE_QUARANTINED');
    const epoch = watermark + 1; requireInteger(epoch);
    await journal.advance(guildId, userId, watermark, epoch);
    await client.query(`INSERT INTO sophie_ai.response_preferences(guild_id,user_id,epoch,presence_epoch,settings,expires_at)
      VALUES($1,$2,$3,$4,NULL,NULL) ON CONFLICT(guild_id,user_id) DO UPDATE SET epoch=$3,updated_at=clock_timestamp()`, [guildId, userId, epoch, presenceEpoch]);
    await restampAiMemories(client, guildId, userId, epoch);
    return epoch;
  }
  return Object.freeze({
    /** What a turn may see: memories about the members in it, then this channel's most recently used memories. */
    async forPrompt({ channelId, userIds, restricted = false }) {
      requireId(channelId); userIds.forEach(requireId); requireCondition(typeof restricted === 'boolean', 'AI_MEMORY_INVALID');
      // A public turn never sees a memory written in a staff channel; a staff turn may see both.
      const rows = (await pool.query(`(SELECT * FROM sophie_ai.memories WHERE guild_id=$1 AND scope='member' AND subject_ids && $3::text[]
        AND expires_at>clock_timestamp() AND (NOT restricted OR $4) ORDER BY used_at DESC LIMIT 24)
        UNION ALL (SELECT * FROM sophie_ai.memories WHERE guild_id=$1 AND scope='channel' AND channel_id=$2 AND expires_at>clock_timestamp()
        AND (NOT restricted OR $4) ORDER BY used_at DESC LIMIT 12)`, [guildId, channelId, userIds, restricted])).rows;
      const memories = await valid(pool, rows);
      return Object.freeze([...memories.filter(item => item.scope === 'member').slice(0, PROMPT_MEMBER),
        ...memories.filter(item => item.scope === 'channel').slice(0, PROMPT_CHANNEL)].map(view));
    },
    /** True while every memory a prepared turn saw still exists unchanged and is still usable. */
    async current(memories) {
      if (!memories.length) return true;
      const rows = (await pool.query('SELECT * FROM sophie_ai.memories WHERE guild_id=$1 AND id=ANY($2::uuid[])', [guildId, memories.map(item => item.id)])).rows;
      const still = await valid(pool, rows);
      return memories.every(item => still.some(memory => memory.id === item.id && memory.text === item.text));
    },
    /** Memories in use stay for another 90 days. */
    async touch(memories) {
      if (!memories.length) return;
      await pool.query(`UPDATE sophie_ai.memories SET used_at=clock_timestamp(),expires_at=$3 WHERE guild_id=$1 AND id=ANY($2::uuid[])`,
        [guildId, memories.map(item => item.id), new Date(clock() + MEMORY_LIFETIME_MS)]);
    },
    /** Stores what Sophie chose to remember. A subject with memory off, a pending departure or a quarantined record drops it. */
    async record({ channelId, memories, restricted = false }) {
      requireId(channelId); requireCondition(typeof restricted === 'boolean', 'AI_MEMORY_INVALID');
      if (!memories.length) return 0;
      return inTransaction(pool, async client => {
        // The same lock as erasure and self-service, so a memory is never written under an epoch being replaced.
        await client.query('SELECT pg_advisory_xact_lock(182745,56)');
        const states = await subjectState(client, [...new Set(memories.flatMap(memory => memory.subjects))], true);
        let saved = 0;
        for (const memory of memories) {
          try { validateStoredMemory(memory); } catch { continue; }
          if (!memory.subjects.every(id => states.get(id)?.usable === true)) continue;
          const epochs = memory.subjects.map(id => states.get(id).epoch);
          // The same note again only refreshes the one already kept.
          const same = await client.query(`UPDATE sophie_ai.memories SET used_at=clock_timestamp(),expires_at=$6 WHERE guild_id=$1 AND scope=$2
            AND subject_ids=$3::text[] AND lower(text)=lower($4) AND (scope='member' OR channel_id=$5) AND restricted=$7`,
          [guildId, memory.scope, memory.subjects, memory.text, channelId, new Date(clock() + MEMORY_LIFETIME_MS), restricted]);
          if (same.rowCount) continue;
          await client.query(`INSERT INTO sophie_ai.memories(guild_id,channel_id,scope,subject_ids,subject_epochs,text,expires_at,restricted)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [guildId, channelId, memory.scope, memory.subjects, epochs, memory.text, new Date(clock() + MEMORY_LIFETIME_MS), restricted]);
          saved++;
          // Bounded: the least recently used memories go first.
          if (memory.scope === 'member') await client.query(`DELETE FROM sophie_ai.memories WHERE guild_id=$1 AND id IN (SELECT id FROM sophie_ai.memories
            WHERE guild_id=$1 AND scope='member' AND subject_ids=$2::text[] ORDER BY used_at DESC OFFSET $3)`, [guildId, memory.subjects, MEMORY_MEMBER_CAP]);
          else await client.query(`DELETE FROM sophie_ai.memories WHERE guild_id=$1 AND id IN (SELECT id FROM sophie_ai.memories
            WHERE guild_id=$1 AND scope='channel' AND channel_id=$2 ORDER BY used_at DESC OFFSET $3)`, [guildId, channelId, MEMORY_CHANNEL_CAP]);
        }
        return saved;
      });
    },
    async expire() {
      await pool.query(`DELETE FROM sophie_ai.memories WHERE guild_id=$1 AND id IN (SELECT id FROM sophie_ai.memories
        WHERE guild_id=$1 AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 500)`, [guildId]);
    },
    /** Self-service, run inside the controls transaction for 'ai.self'. */
    self: Object.freeze({
      async list(client, userId) {
        requireId(userId);
        const remembering = (await client.query('SELECT 1 FROM sophie_ai.memory_optouts WHERE guild_id=$1 AND user_id=$2', [guildId, userId])).rowCount === 0;
        const rows = (await client.query(`SELECT * FROM sophie_ai.memories WHERE guild_id=$1 AND $2=ANY(subject_ids) AND expires_at>clock_timestamp()
          ORDER BY used_at DESC LIMIT 200`, [guildId, userId])).rows.map(row);
        // A member sees everything that names them, including memories not usable right now; other members read as "a member".
        return { remembering, memories: rows.map(memory => ({ id: memory.id, scope: memory.scope, channelId: memory.channelId, edited: memory.edited, staff: memory.restricted,
          text: renderMemory(memory, id => id === userId ? 'you' : null), editable: memory.scope === 'member',
          others: memory.subjects.filter(id => id !== userId).length, createdAt: memory.createdAt, expiresAt: memory.expiresAt })) };
      },
      async forget(client, userId, id, presenceEpoch) {
        requireId(userId); requireMemoryId(id);
        const found = await client.query('DELETE FROM sophie_ai.memories WHERE guild_id=$1 AND id=$2 AND $3=ANY(subject_ids)', [guildId, id, userId]);
        requireCondition(found.rowCount === 1, 'AI_MEMORY_STALE');
        await fence(client, userId, presenceEpoch);
      },
      async edit(client, userId, id, text, presenceEpoch) {
        requireId(userId); requireMemoryId(id); const value = canonicalEditedMemory(text);
        const found = await client.query(`UPDATE sophie_ai.memories SET text=$4,edited=true WHERE guild_id=$1 AND id=$2 AND scope='member'
          AND subject_ids=ARRAY[$3]::text[]`, [guildId, id, userId, value]);
        requireCondition(found.rowCount === 1, 'AI_MEMORY_STALE');
        await fence(client, userId, presenceEpoch);
      },
      async forgetAll(client, userId, presenceEpoch) {
        requireId(userId);
        await client.query('DELETE FROM sophie_ai.memories WHERE guild_id=$1 AND $2=ANY(subject_ids)', [guildId, userId]);
        await fence(client, userId, presenceEpoch);
      },
      async remembering(client, userId, enabled) {
        requireId(userId); requireCondition(typeof enabled === 'boolean', 'AI_MEMORY_INVALID');
        if (enabled) await client.query('DELETE FROM sophie_ai.memory_optouts WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
        else await client.query('INSERT INTO sophie_ai.memory_optouts(guild_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [guildId, userId]);
      },
    }),
    /** Owner audit (ai.memory.audit): every memory, newest first, with subject IDs; deletion of any memory. */
    audit: Object.freeze({
      async list(client, before = null) {
        if (before !== null) requireMemoryId(before);
        const rows = (await client.query(`SELECT * FROM sophie_ai.memories WHERE guild_id=$1 AND ($2::uuid IS NULL OR
          (created_at,id)<(SELECT created_at,id FROM sophie_ai.memories WHERE guild_id=$1 AND id=$2)) ORDER BY created_at DESC,id DESC LIMIT 51`, [guildId, before])).rows.map(row);
        return { memories: rows.slice(0, 50).map(memory => ({ id: memory.id, scope: memory.scope, channelId: memory.channelId, subjects: memory.subjects,
          text: renderMemory(memory, id => `<@${id}>`), edited: memory.edited, createdAt: memory.createdAt, usedAt: memory.usedAt, expiresAt: memory.expiresAt })),
        nextBefore: rows.length > 50 ? rows[49].id : null };
      },
      async remove(client, id) {
        requireMemoryId(id);
        requireCondition((await client.query('DELETE FROM sophie_ai.memories WHERE guild_id=$1 AND id=$2', [guildId, id])).rowCount === 1, 'AI_MEMORY_STALE');
      },
    }),
  });
}
