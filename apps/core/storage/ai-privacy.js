import { createHash } from 'node:crypto';
import { requireId, requireInteger, requireCondition } from '../../../contracts/validation.js';
import { inTransaction } from './transaction.js';
import { eraseAiMemories } from './ai-memories.js';

export const aiReceiptHash = (guildId,messageId) => createHash('sha256').update(`sophie-ai-replay:${guildId}:${messageId}`).digest('hex');
const memberHash=(guildId,userId)=>createHash('sha256').update(`sophie-ai-erasure:${guildId}:${userId}`).digest('hex');

/** Core-owned erasure. External acknowledgements and accounting holds are never discarded as if settled. */
export function createAiPrivacy({pool,guildId,journal,departures,invalidate=()=>{},removeEffect=async()=>{},onFault=()=>{}}) {
  requireId(guildId);let cursor=null,departureCursor=null;
  const preference = async (client,userId) => (await client.query('SELECT * FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2',[guildId,userId])).rows[0];
  async function checkedCurrent(client,userId) {
    requireId(userId);
    if (!journal || await departures.pending(userId)) return false;
    const row=await preference(client,userId),watermark=await journal.read(guildId,userId);
    if (Number(row?.epoch??0)!==watermark) {await departures.request(userId);invalidate();return false;}
    return !await departures.pending(userId);
  }
  const current=(userId,client=null)=>client!==null?checkedCurrent(client,userId):inTransaction(pool,async held=>{
    // Do not mistake a journal fsync preceding a concurrent database commit for a restore.
    await held.query('SELECT pg_advisory_xact_lock(182745,56)');return checkedCurrent(held,userId);
  });
  async function erase(job) {
    invalidate();
    return inTransaction(pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(182745,56)');
      const row=await preference(client,job.userId);
      if(!row && !(await client.query(`SELECT 1 FROM sophie_ai.consents WHERE guild_id=$1 AND user_id=$2
        UNION ALL SELECT 1 FROM sophie_ai.request_receipts WHERE guild_id=$1 AND user_id=$2
        UNION ALL SELECT 1 FROM sophie_ai.memories WHERE guild_id=$1 AND $2=ANY(subject_ids)
        UNION ALL SELECT 1 FROM sophie_ai.effects WHERE guild_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(dependencies) d WHERE d->>'userId'=$2) LIMIT 1`,[guildId,job.userId])).rowCount)return true;
      requireCondition(journal!==null,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
      const watermark=await journal.read(guildId,job.userId);requireInteger(watermark);
      const trusted=Number(row?.epoch??0)===watermark;
      // A retention choice is authoritative only when its independent write watermark agrees.
      const retained=trusted && row?.retain_on_leave===true;
      await client.query('UPDATE sophie_ai.consents SET enabled=false,epoch=epoch+1 WHERE guild_id=$1 AND user_id=$2 AND enabled',[guildId,job.userId]);
      await client.query("UPDATE sophie_ai.request_receipts SET state='cancelled',updated_at=clock_timestamp() WHERE guild_id=$1 AND user_id=$2 AND state IN ('gathering','admitted','sending')",[guildId,job.userId]);
      if (retained) return true;
      // Leaving removes every memory Sophie kept that names the member (owner decision, 20 October 2026).
      await eraseAiMemories(client,guildId,job.userId);
      const member=memberHash(guildId,job.userId);
      await client.query(`INSERT INTO sophie_ai.effect_erasure(guild_id,member_hash,message_id)
        SELECT guild_id,$3,message_id FROM sophie_ai.effects WHERE guild_id=$1 AND
        (message_id IN (SELECT message_id FROM sophie_ai.request_receipts WHERE guild_id=$1 AND user_id=$2)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(dependencies) d WHERE d->>'userId'=$2)) ON CONFLICT DO NOTHING`,[guildId,job.userId,member]);
      await client.query(`UPDATE sophie_ai.effects SET state=CASE WHEN state IN ('prepared','removed') THEN 'removed' ELSE 'cleanup' END,
        dependencies='[]',sources='[]',updated_at=clock_timestamp() WHERE guild_id=$1 AND
        (message_id IN (SELECT message_id FROM sophie_ai.request_receipts WHERE guild_id=$1 AND user_id=$2)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(dependencies) d WHERE d->>'userId'=$2))`,[guildId,job.userId]);
      if (!trusted || Number(row?.departure_epoch??0)!==job.epoch) {
        const epoch=Math.max(Number(row?.epoch??0),watermark)+1;requireInteger(epoch);
        await journal.advance(guildId,job.userId,watermark,epoch);
        // Fsync precedes the database commit. Only a minimal restore fence remains.
        await client.query(`INSERT INTO sophie_ai.response_preferences(guild_id,user_id,epoch,presence_epoch,settings,expires_at,retain_on_leave,departure_epoch)
          VALUES($1,$2,$3,0,NULL,NULL,false,$4) ON CONFLICT(guild_id,user_id) DO UPDATE SET epoch=$3,settings=NULL,expires_at=NULL,
          retain_on_leave=false,departure_epoch=$4,updated_at=clock_timestamp()`,[guildId,job.userId,epoch,job.epoch]);
      }
      await client.query('DELETE FROM sophie_ai.consents WHERE guild_id=$1 AND user_id=$2',[guildId,job.userId]);
      // Never-dispatched reservations can be released; uncertain charges still need the existing resolution flow.
      const reserved=(await client.query(`SELECT p.* FROM sophie_ai.provider_attempts p JOIN sophie_ai.request_receipts r USING(guild_id,message_id)
        WHERE p.guild_id=$1 AND r.user_id=$2 AND p.state='reserved' FOR UPDATE OF p`,[guildId,job.userId])).rows;
      for(const attempt of reserved) {
        await client.query('UPDATE sophie_ai.budget_periods SET reserved_nanos=reserved_nanos-$3 WHERE guild_id=$1 AND period=ANY($2)',[guildId,[attempt.month_period,attempt.day_period],attempt.reserved_nanos]);
        await client.query("UPDATE sophie_ai.provider_attempts SET state='released' WHERE guild_id=$1 AND message_id=$2",[guildId,attempt.message_id]);
      }
      const disposable=(await client.query(`SELECT r.message_id FROM sophie_ai.request_receipts r WHERE r.guild_id=$1 AND r.user_id=$2
        AND NOT EXISTS(SELECT 1 FROM sophie_ai.effects e WHERE e.guild_id=r.guild_id AND e.message_id=r.message_id AND e.state<>'removed')
        AND NOT EXISTS(SELECT 1 FROM sophie_ai.provider_attempts p WHERE p.guild_id=r.guild_id AND p.message_id=r.message_id AND p.state NOT IN ('released','settled'))
        ORDER BY r.message_id LIMIT 500`,[guildId,job.userId])).rows;
      const ids=disposable.map(row=>row.message_id);
      if(ids.length) {
        await client.query('INSERT INTO sophie_ai.request_tombstones(guild_id,message_hash) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING',[guildId,ids.map(id=>aiReceiptHash(guildId,id))]);
        await client.query('DELETE FROM sophie_ai.effects WHERE guild_id=$1 AND message_id=ANY($2::text[])',[guildId,ids]);
        await client.query('DELETE FROM sophie_ai.effect_erasure WHERE guild_id=$1 AND message_id=ANY($2::text[])',[guildId,ids]);
        await client.query('DELETE FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND message_id=ANY($2::text[])',[guildId,ids]);
        await client.query('DELETE FROM sophie_ai.request_receipts WHERE guild_id=$1 AND message_id=ANY($2::text[])',[guildId,ids]);
      }
      await client.query(`DELETE FROM sophie_ai.effect_erasure pending WHERE guild_id=$1 AND member_hash=$2
        AND NOT EXISTS(SELECT 1 FROM sophie_ai.effects e WHERE e.guild_id=pending.guild_id AND e.message_id=pending.message_id AND e.state<>'removed')`,[guildId,member]);
      return (await client.query(`SELECT 1 FROM sophie_ai.request_receipts WHERE guild_id=$1 AND user_id=$2
        UNION ALL SELECT 1 FROM sophie_ai.effect_erasure WHERE guild_id=$1 AND member_hash=$3 LIMIT 1`,[guildId,job.userId,member])).rowCount===0;
    });
  }
  return Object.freeze({current,async maintain() {
    // Restore scans are bounded and advance across the membership set. They read AI metadata only.
    const users=(await pool.query(`SELECT user_id FROM (SELECT user_id FROM sophie_ai.response_preferences WHERE guild_id=$1
      UNION SELECT user_id FROM sophie_ai.consents WHERE guild_id=$1 UNION SELECT user_id FROM sophie_ai.request_receipts WHERE guild_id=$1) members
      WHERE ($2::text IS NULL OR user_id>$2) ORDER BY user_id LIMIT 50`,[guildId,cursor])).rows;
    cursor=users.length===50?users.at(-1).user_id:null;
    for(const {user_id:userId} of users) await current(userId);
    const jobs=await departures.list(departureCursor);departureCursor=jobs.length===50?jobs.at(-1).userId:null;
    for(const job of jobs) {
      try {if(await erase(job)) await departures.complete(job);else onFault('AI_DELETION_PENDING');}
      catch {onFault('AI_DELETION_UNAVAILABLE');}
    }
    const effects=(await pool.query(`UPDATE sophie_ai.effects e SET checked_at=clock_timestamp() FROM
      (SELECT message_id FROM sophie_ai.effects WHERE guild_id=$1 AND state='cleanup' AND receipt_id IS NOT NULL
        ORDER BY checked_at,message_id LIMIT 4 FOR UPDATE SKIP LOCKED) selected
      WHERE e.guild_id=$1 AND e.message_id=selected.message_id RETURNING e.*`,[guildId])).rows;
    for(const effect of effects) try {await removeEffect(effect);} catch {onFault('AI_DELETION_PENDING');}
  }});
}
