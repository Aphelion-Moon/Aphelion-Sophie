import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { canonicalResponsePreferences, PREFERENCE_LIFETIME_MS } from '../../../modules/assistant/preferences.js';

/** Shared authenticated self-service operations. Saved settings and notes reach inference only through the member's own sharing switch (ai-memory.js). */
export function createAiPreferences({ guildId, transaction, memberPresence, journal = null, clock = Date.now, privacyCurrent = null }) {
  requireCondition(journal === null || ['read','advance'].every(name=>typeof journal[name] === 'function'),'TRUSTED_ADAPTERS_REQUIRED');
  const expire = (client,userId) => client.query('UPDATE sophie_ai.response_preferences SET settings=NULL WHERE guild_id=$1 AND user_id=$2 AND settings IS NOT NULL AND expires_at<=clock_timestamp()',[guildId,userId]);
  async function read(client,actor) {
    await expire(client,actor.userId);
    const row=(await client.query('SELECT * FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2',[guildId,actor.userId])).rows[0];
    const watermark=await journal.read(guildId,actor.userId);requireInteger(watermark);
    const saved=Number(row?.epoch ?? 0);requireInteger(saved);const quarantined=saved!==watermark;
    const settings=!quarantined && row?.settings && row.expires_at.getTime()>clock() ? canonicalResponsePreferences(row.settings):null;
    // remoteUse reports the member's own sharing switch; channel consent and the processing notice still gate every turn.
    const result={available:true,epoch:Math.max(saved,watermark),quarantined,settings,
      expiresAt:!quarantined && row?.settings ? row.expires_at.getTime():null,retainOnLeave:!quarantined && row?.retain_on_leave===true,remoteUse:settings?.useWithAi===true,provenance:'member-saved',scope:'self'};
    return {row,watermark,result};
  }
  async function change({actor,expectedEpoch,settings,confirmed,retainOnLeave},deleting,retention=false) {
    requireInteger(expectedEpoch);requireCondition(confirmed === true,'AI_CONFIRMATION_REQUIRED');
    requireCondition(journal !== null,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
    if(retention)requireCondition(typeof retainOnLeave==='boolean','AI_PREFERENCE_INVALID');
    const canonical = deleting || retention ? null : canonicalResponsePreferences(settings);
    return transaction(actor,'ai.self',async client=>{
      requireCondition(privacyCurrent===null || await privacyCurrent(actor.userId,client),'AI_DELETION_PENDING');
      const {row,watermark,result}=await read(client,actor);
      requireCondition(result.epoch===expectedEpoch,'AI_PREFERENCE_STALE');
      requireCondition(deleting || !result.quarantined,'AI_PREFERENCE_RESTORE_QUARANTINED');
      const presence=await memberPresence(actor);requireInteger(presence);
      const epoch=expectedEpoch+1;requireInteger(epoch);
      await journal.advance(guildId,actor.userId,watermark,epoch);
      const selected=retention?result.settings:canonical,keep=retention?retainOnLeave:!deleting && row?.retain_on_leave===true;
      const expiresAt=retention?result.expiresAt:selected===null?null:clock()+PREFERENCE_LIFETIME_MS;
      await client.query(`INSERT INTO sophie_ai.response_preferences(guild_id,user_id,epoch,presence_epoch,settings,expires_at,retain_on_leave)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(guild_id,user_id) DO UPDATE SET epoch=$3,presence_epoch=$4,settings=$5,expires_at=$6,retain_on_leave=$7,updated_at=clock_timestamp()`,
      [guildId,actor.userId,epoch,presence,selected,expiresAt===null ? null:new Date(expiresAt),keep]);
      return {available:true,epoch,quarantined:false,settings:selected,expiresAt,retainOnLeave:keep,remoteUse:selected?.useWithAi===true,provenance:'member-saved',scope:'self'};
    },{userId:actor.userId},true);
  }
  return Object.freeze({
    ownPreferences: ({actor})=>transaction(actor,'ai.self',async client=>journal===null || privacyCurrent!==null && !await privacyCurrent(actor.userId,client)
      ? {available:false,epoch:null,quarantined:true,settings:null,expiresAt:null,retainOnLeave:false,remoteUse:false,provenance:'member-saved',scope:'self'}
      : (await read(client,actor)).result,{userId:actor.userId}),
    savePreferences: input=>change(input,false),
    deletePreferences: input=>change(input,true),
    saveRetention: input=>change(input,false,true),
  });
}
