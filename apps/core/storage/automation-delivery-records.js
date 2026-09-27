import { requireCondition, requireKeys } from '../../../contracts/validation.js';
import { automationPlanKey } from '../../../modules/automation/delivery.js';
import { automationDigest, checkedAutomationPolicy } from './automation-policy-records.js';

export const recordAutomationDeliveryEvent = (client,id,kind) => client.query(`INSERT INTO sophie_core.automation_delivery_events (delivery_id,sequence,kind)
  SELECT $1,COALESCE(MAX(sequence),0)+1,$2 FROM sophie_core.automation_delivery_events WHERE delivery_id=$1 RETURNING sequence`,[id,kind]);

/** Callers that mutate lock the outbox first, then the delivery, in this order. */
export async function loadAutomationDelivery(client,{guildId,operationId,job,lock=true}) {
  requireCondition(job?.kind === 'automation.dispatch','AUTOMATION_CORRUPT');
  requireKeys(job.effect,['kind','guildId','userId','operationId','deliveryId'],'AUTOMATION_CORRUPT');
  const row = (await client.query(`SELECT * FROM sophie_core.automation_deliveries WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,[job.effect.deliveryId])).rows[0];
  requireCondition(row && job.effect.kind === job.kind && row.guild_id === guildId && job.effect.guildId === guildId &&
    job.user_id === row.user_id && job.effect.userId === row.user_id && operationId === `automation.${row.id}` &&
    job.effect.operationId === operationId && row.id === automationDigest([guildId,row.message_id,row.rule_id]).slice(0,32),'AUTOMATION_CORRUPT');
  const event = (await client.query('SELECT * FROM sophie_core.automation_events WHERE guild_id=$1 AND message_id=$2',[guildId,row.message_id])).rows[0];
  const policy = checkedAutomationPolicy((await client.query('SELECT * FROM sophie_core.automation_policies WHERE guild_id=$1 AND revision=$2',[guildId,row.policy_revision])).rows[0]);
  const rule = policy?.document?.rules.find(value=>value.id === row.rule_id);
  requireCondition(event && policy?.action === 'publish' && event.policy_revision === row.policy_revision && event.policy_sha256 === policy.sha256 &&
    event.channel_id === row.channel_id && event.user_id === row.user_id && Number(event.observed_at_ms) === Number(row.created_at_ms) &&
    event.decisions.some(value=>value?.ruleId === row.rule_id && value.state === 'selected') &&
    rule?.channels.includes(row.channel_id) && automationDigest(rule.action) === row.action_sha256,'AUTOMATION_CORRUPT');
  const plan = {id:row.id,guildId,userId:row.user_id,channelId:row.channel_id,sourceMessageId:row.message_id,
    policyRevision:row.policy_revision,action:rule.action,expiresAt:Number(row.expires_at_ms)};
  automationPlanKey(plan); return {row,plan};
}
