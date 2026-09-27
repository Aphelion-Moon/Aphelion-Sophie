import { requireCondition } from '../../../contracts/validation.js';
import { createActorAuthorityStore } from '../storage/actor-authority.js';
import { createCoreAuthorization } from '../security/authorization.js';
import { createCoreStore } from '../storage/core-store.js';
import { createCaseChannels } from '../discord/case-channels.js';
import { createCaseDispatcher } from '../discord/case-dispatcher.js';
import { createConfigurationCaseOutbox } from '../storage/configuration-case-outbox.js';
import { loadCasePlan } from '../storage/case-audience.js';
import { currentContactSource } from '../storage/case-contact-records.js';

/** Owner composition under an exclusive barrier; normal runtime remains stopped. */
export function createConfigurationReconciliation({pool,operationId,configuration,roles,transport,enabled,clock}) {
  const authorization=createCoreAuthorization({principals:{resolvePrincipal:async()=>{throw Error('NO_INTERACTIVE_PRINCIPALS');}},discord:roles,
    authorityStore:createActorAuthorityStore({pool,clock}),policy:configuration.capabilityPolicy,clock,isAuthorityCurrent:enabled,readContinuity:roles.readContinuity});
  const channels=createCaseChannels({transport,roles,mapping:configuration.mapping,policy:configuration.casePolicy,clock,authorizeCaseParticipant:authorization.authorizeCaseParticipant});
  const store=createCoreStore({pool,clock,authorize:authorization.authorize,authorizeRecorded:authorization.authorizeRecorded,
    authorizeCaseParticipant:authorization.authorizeCaseParticipant,casePolicy:configuration.casePolicy,caseVerification:channels.verification});
  const worker=createCaseDispatcher({outbox:createConfigurationCaseOutbox({pool,operationId}),store,roles,channels,enabled});
  return Object.freeze({runOnce:()=>worker.runOnce('configuration.reconcile'),
    async verify() {
      requireCondition(await enabled(),'MAINTENANCE_STALE');
      const rows=(await pool.query(`SELECT r.*,p.policy_version,p.operation_token,p.presence_epoch,p.audience_version,p.phase,
        ARRAY(SELECT c.channel_id FROM sophie_core.case_channels c WHERE c.guild_id=r.guild_id AND c.case_id=r.id ORDER BY c.channel_id) AS channel_ids
        FROM sophie_core.case_reservations r JOIN sophie_core.case_provisions p ON p.guild_id=r.guild_id AND p.case_id=r.id
        WHERE r.guild_id=$1 AND p.create_started`,[configuration.mapping.guildId])).rows;
      for(const row of rows) {
        const plan=await loadCasePlan(pool,row),observation=await roles.observe(row.user_id);
        const state=(await pool.query('SELECT state FROM sophie_core.members WHERE guild_id=$1 AND user_id=$2',[row.guild_id,row.user_id])).rows[0]?.state;
        const contactAllowed=await currentContactSource(pool,row,authorization.authorizeRecorded);
        const allowed=observation.present&&state?.presenceEpoch===Number(row.presence_epoch)&&contactAllowed&&row.state!=='failed';
        const mode=allowed?row.desired_access:'sealed';
        for(const id of row.channel_ids) {
          const proof=await channels.inspect(plan,id);
          await channels.verification.channel(proof,plan,id===row.channel_id?mode:'sealed');
        }
      }
      return {casesVerified:rows.length};
    },
  });
}
