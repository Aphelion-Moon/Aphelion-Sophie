import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { canonicalResponsePreferences, PREFERENCE_LIFETIME_MS } from '../../../modules/assistant/preferences.js';

/** Shared authenticated self-service operations. Settings never enter inference until a separate disclosure gate exists. */
export function createAiPreferences({ guildId, transaction, memberPresence, journal = null, clock = Date.now }) {
  requireCondition(journal === null || ['read','advance'].every(name=>typeof journal[name] === 'function'),'TRUSTED_ADAPTERS_REQUIRED');
  const expire = (client,userId) => client.query('UPDATE sophie_ai.response_preferences SET settings=NULL WHERE guild_id=$1 AND user_id=$2 AND settings IS NOT NULL AND expires_at<=clock_timestamp()',[guildId,userId]);
  async function read(client,actor) {
    await expire(client,actor.userId);
    const row=(await client.query('SELECT * FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2',[guildId,actor.userId])).rows[0];
    const watermark=await journal.read(guildId,actor.userId);requireInteger(watermark);
    const saved=Number(row?.epoch ?? 0);requireInteger(saved);const quarantined=saved!==watermark;
    const result={available:true,epoch:Math.max(saved,watermark),quarantined,settings:!quarantined && row?.settings && row.expires_at.getTime()>clock() ? canonicalResponsePreferences(row.settings):null,
      expiresAt:!quarantined && row?.settings ? row.expires_at.getTime():null,remoteUse:false,provenance:'member-saved',scope:'self'};
    return {row,watermark,result};
  }
  async function change({actor,expectedEpoch,settings,confirmed},deleting) {
    requireInteger(expectedEpoch);requireCondition(confirmed === true,'AI_CONFIRMATION_REQUIRED');
    requireCondition(journal !== null,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
    const canonical = deleting ? null : canonicalResponsePreferences(settings);
    return transaction(actor,'ai.self',async client=>{
      const {watermark,result}=await read(client,actor);
      requireCondition(result.epoch===expectedEpoch,'AI_PREFERENCE_STALE');
      requireCondition(deleting || !result.quarantined,'AI_PREFERENCE_RESTORE_QUARANTINED');
      const presence=await memberPresence(actor);requireInteger(presence);
      const epoch=expectedEpoch+1;requireInteger(epoch);
      await journal.advance(guildId,actor.userId,watermark,epoch);
      const expiresAt=canonical===null ? null : clock()+PREFERENCE_LIFETIME_MS;
      await client.query(`INSERT INTO sophie_ai.response_preferences(guild_id,user_id,epoch,presence_epoch,settings,expires_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(guild_id,user_id) DO UPDATE SET epoch=$3,presence_epoch=$4,settings=$5,expires_at=$6,updated_at=clock_timestamp()`,
      [guildId,actor.userId,epoch,presence,canonical,expiresAt===null ? null:new Date(expiresAt)]);
      return {available:true,epoch,quarantined:false,settings:canonical,expiresAt,remoteUse:false,provenance:'member-saved',scope:'self'};
    },{userId:actor.userId},true);
  }
  return Object.freeze({
    ownPreferences: ({actor})=>transaction(actor,'ai.self',async client=>journal===null
      ? {available:false,epoch:null,quarantined:true,settings:null,expiresAt:null,remoteUse:false,provenance:'member-saved',scope:'self'}
      : (await read(client,actor)).result,{userId:actor.userId}),
    savePreferences: input=>change(input,false),
    deletePreferences: input=>change(input,true),
  });
}
