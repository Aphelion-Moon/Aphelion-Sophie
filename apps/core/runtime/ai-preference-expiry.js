import { requireId } from '../../../contracts/validation.js';

/** Local settings expiry runs independently of inference and never stalls the administration worker. */
export function createAiPreferenceExpiry({pool,guildId,onFault}) {
  requireId(guildId);let timer=null,stopped=false,pending=Promise.resolve();
  const expire=()=>pool.query(`UPDATE sophie_ai.response_preferences SET settings=NULL WHERE (guild_id,user_id) IN
    (SELECT guild_id,user_id FROM sophie_ai.response_preferences WHERE guild_id=$1 AND settings IS NOT NULL AND expires_at<=clock_timestamp()
      ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED)`,[guildId]);
  function tick() {
    if(stopped)return;
    pending=Promise.resolve().then(expire).catch(()=>onFault('AI_PREFERENCES_UNAVAILABLE')).finally(()=>{
      if(!stopped){timer=setTimeout(tick,30000);timer.unref?.();}
    });
  }
  return Object.freeze({start:tick,async stop(){stopped=true;clearTimeout(timer);await pending;}});
}
