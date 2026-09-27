import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { planAutomation } from '../../../modules/automation/index.js';
import { automationDigest as digest, latestAutomationPolicy, lockAutomationPolicy } from './automation-policy-records.js';
import { inspectAutomationChannel } from './automation-channel-policy.js';
import { enqueue } from './outbox.js';

/** Invoked only within the owned Gateway cursor transaction. No incoming text enters storage or jobs. */
export function createAutomationAdmission({guildId,protectedCategoryId,channels,ingress}) {
  requireId(guildId); requireId(protectedCategoryId);
  requireCondition(ingress?.guildId === guildId && ['prepare','inspect','content','discard'].every(key=>typeof ingress[key] === 'function') &&
    typeof channels?.inspect === 'function','TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({guildId,prepare:ingress.prepare,discard:ingress.discard,
    async record(client,{proof,epoch,sequence}) {
      if (proof === null) return;
      const event = ingress.inspect(proof); requireInteger(epoch); requireInteger(sequence);
      await lockAutomationPolicy(client,guildId);
      const prior = (await client.query('SELECT channel_id,user_id FROM sophie_core.automation_events WHERE guild_id = $1 AND message_id = $2',[guildId,event.messageId])).rows[0];
      if (prior) {
        requireCondition(prior.channel_id === event.channelId && prior.user_id === event.userId,'AUTOMATION_EVENT_COLLISION'); return;
      }
      const policy = await latestAutomationPolicy(client,guildId);
      if (policy?.action !== 'publish' || !policy.document.rules.some(rule=>rule.channels.includes(event.channelId))) return;
      if (await inspectAutomationChannel(client,{guildId,protectedCategoryId,channels,channelId:event.channelId}) === null) return;
      const cooldowns = (await client.query(`SELECT rule_id,scope,admitted_at_ms FROM sophie_core.automation_cooldowns
        WHERE guild_id = $1 AND ((scope = 'user' AND subject_id = $2) OR (scope = 'channel' AND subject_id = $3))`,[guildId,event.userId,event.channelId])).rows;
      const userLast = Object.create(null),channelLast = Object.create(null);
      for (const row of cooldowns) (row.scope === 'user' ? userLast : channelLast)[row.rule_id] = Number(row.admitted_at_ms);
      const content = ingress.content(proof);
      const plan = content === null ? {actions:[],decisions:[]} : planAutomation(policy.document,{atMs:event.observedAt,channelId:event.channelId,
        userId:event.userId,content,bot:false,webhook:false,self:false},{excluded:false,userLast,channelLast});
      const count = (await client.query(`SELECT count(*)::int AS guild,
        count(*) FILTER (WHERE user_id = $2)::int AS member, count(*) FILTER (WHERE channel_id = $3)::int AS channel
        FROM sophie_core.automation_deliveries WHERE guild_id = $1 AND state = 'pending'`,[guildId,event.userId,event.channelId])).rows[0];
      const available = Math.max(0,Math.min(100-count.guild,5-count.member,10-count.channel));
      const selected = plan.actions.slice(0,available), ids = new Set(selected.map(item=>item.ruleId));
      const decisions = plan.decisions.map(item=>item.state === 'selected' && !ids.has(item.ruleId) ? {...item,state:'capacity'} : item);
      // Recheck retained exclusions after the asynchronous metadata/cooldown reads, before admission.
      if (await inspectAutomationChannel(client,{guildId,protectedCategoryId,channels,channelId:event.channelId}) === null) return;
      await client.query(`INSERT INTO sophie_core.automation_events
        (guild_id,message_id,channel_id,user_id,policy_revision,policy_sha256,observed_at_ms,continuity_epoch,sequence,outcome,decisions)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[guildId,event.messageId,event.channelId,event.userId,policy.revision,policy.sha256,
        event.observedAt,epoch,sequence,content === null ? 'invalid-content' : selected.length < plan.actions.length ? 'capacity' : 'evaluated',JSON.stringify(decisions)]);
      for (const item of selected) {
        const id = digest([guildId,event.messageId,item.ruleId]).slice(0,32);
        await client.query(`INSERT INTO sophie_core.automation_deliveries
          (id,guild_id,message_id,channel_id,user_id,policy_revision,rule_id,action_sha256,created_at_ms,expires_at_ms)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,guildId,event.messageId,event.channelId,event.userId,policy.revision,item.ruleId,digest(item.action),event.observedAt,event.observedAt+60000]);
        for (const [scope,subject] of [['user',event.userId],['channel',event.channelId]]) await client.query(`INSERT INTO sophie_core.automation_cooldowns
          (guild_id,rule_id,scope,subject_id,admitted_at_ms) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (guild_id,rule_id,scope,subject_id) DO UPDATE SET admitted_at_ms = GREATEST(automation_cooldowns.admitted_at_ms,EXCLUDED.admitted_at_ms)`,
        [guildId,item.ruleId,scope,subject,event.observedAt]);
        await enqueue(client,{kind:'automation.dispatch',guildId,userId:event.userId,operationId:`automation.${id}`,deliveryId:id});
      }
    },
  });
}
