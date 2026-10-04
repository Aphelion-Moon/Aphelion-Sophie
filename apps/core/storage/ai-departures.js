import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';

/** Called in the same core transaction as a confirmed membership revocation. */
export async function recordAiDeparture(client,guildId,userId) {
  return client.query(`UPDATE sophie_core.actor_authority SET ai_departure_epoch=ai_departure_epoch+1
    WHERE guild_id=$1 AND user_id=$2`,[guildId,userId]);
}

/** Narrow metadata adapter. No case content or core pool reaches an AI identity. */
export function createAiDepartures({pool,guildId}) {
  requireId(guildId);
  return Object.freeze({
    async pending(userId) {
      requireId(userId);
      return (await pool.query(`SELECT 1 FROM sophie_core.actor_authority
        WHERE guild_id=$1 AND user_id=$2 AND ai_departure_epoch>ai_cleanup_epoch`,[guildId,userId])).rowCount>0;
    },
    async list(afterUserId=null) {
      if(afterUserId!==null)requireId(afterUserId);
      return (await pool.query(`SELECT user_id AS "userId",ai_departure_epoch AS epoch FROM sophie_core.actor_authority
        WHERE guild_id=$1 AND ai_departure_epoch>ai_cleanup_epoch AND ($2::text IS NULL OR user_id>$2) ORDER BY user_id LIMIT 50`,[guildId,afterUserId])).rows
        .map(row=>({...row,epoch:Number(row.epoch)}));
    },
    async request(userId) {requireId(userId);const result=await pool.query(`UPDATE sophie_core.actor_authority
      SET ai_departure_epoch=CASE WHEN ai_departure_epoch=ai_cleanup_epoch THEN ai_departure_epoch+1 ELSE ai_departure_epoch END
      WHERE guild_id=$1 AND user_id=$2`,[guildId,userId]);requireCondition(result.rowCount===1,'AI_DEPARTURE_AUTHORITY_MISSING');},
    async complete({userId,epoch}) {
      requireId(userId);requireInteger(epoch,1);
      await pool.query(`UPDATE sophie_core.actor_authority SET ai_cleanup_epoch=$3
        WHERE guild_id=$1 AND user_id=$2 AND ai_departure_epoch=$3`,[guildId,userId,epoch]);
    },
  });
}
