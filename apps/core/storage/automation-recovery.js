import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { operatorGrant, validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { commonParkedCodes, automationParkedCodes } from '../../../contracts/delivery-errors.js';
import { requireAutomationId } from '../../../modules/automation/delivery.js';
import { requireAutomationHash } from '../../../modules/automation/index.js';
import { automationDigest } from './automation-policy-records.js';
import { loadAutomationDelivery, recordAutomationDeliveryEvent } from './automation-delivery-records.js';
import { inspectAutomationChannel } from './automation-channel-policy.js';
import { inTransaction } from './transaction.js';

const repairable = code => [...commonParkedCodes,...automationParkedCodes,'ATTEMPT_LIMIT','DISCORD_RATE_LIMIT_INVALID'].includes(code);
const unknown = row => row.create_started && !row.receipt_available;
function intent({deliveryId,expectedVersion,action,messageId}) {
  requireAutomationId(deliveryId,'AUTOMATION_INPUT_INVALID');requireInteger(expectedVersion,0,2147483645);
  requireCondition(['recheck','recover'].includes(action),'AUTOMATION_INPUT_INVALID');
  if (messageId !== null) requireId(messageId);
  requireCondition(action !== 'recheck' || messageId === null,'AUTOMATION_INPUT_INVALID');
  return {deliveryId,expectedVersion,action,messageId};
}
function checkedReceipt(row) {
  validateOperatorGrant(row.operator_grant);
  const request = intent({deliveryId:row.delivery_id,expectedVersion:row.expected_fence,action:row.action,messageId:row.message_id});
  requireCondition(row.operator_grant.guildId === row.guild_id && row.request_sha256 === automationDigest(request),'AUTOMATION_CORRUPT');
  return {deliveryId:row.delivery_id,action:row.action,acceptedVersion:row.expected_fence+1,recorded:true};
}

/** Publisher-authorized repair intent only. Normal workers decide current confirmation/withdrawal. */
export function createAutomationRecovery({pool,authorize,guildId,protectedCategoryId,channels,messages}) {
  requireId(guildId);requireId(protectedCategoryId);
  async function access(actor) {
    requireCondition(await authorize('automation.publish',actor,{guildId}) === true,'OPERATION_DENIED');
    const grant=operatorGrant(actor);requireCondition(grant.guildId === guildId,'FOREIGN_GUILD');return grant;
  }
  async function load(client,deliveryId,lock=false) {
    requireAutomationId(deliveryId);const operationId=`automation.${deliveryId}`;
    const job=(await client.query(`SELECT * FROM sophie_core.outbox WHERE guild_id=$1 AND operation_id=$2 AND kind='automation.dispatch'${lock?' FOR UPDATE':''}`,[guildId,operationId])).rows[0];
    requireCondition(job,'AUTOMATION_RECOVERY_NOT_FOUND');
    return {job,...await loadAutomationDelivery(client,{guildId,operationId,job,lock})};
  }
  async function allowedChannel(client,plan) {
    requireCondition(await inspectAutomationChannel(client,{guildId,protectedCategoryId,channels,channelId:plan.channelId}) !== null,'AUTOMATION_CHANNEL_UNAVAILABLE');
  }
  function describe({row,plan,job}) {
    const canChange=job.status === 'parked' && repairable(job.last_error_code);
    return {deliveryId:row.id,reviewVersion:job.fence,ruleId:row.rule_id,policyRevision:row.policy_revision,
      channelId:row.channel_id,sourceMessageId:row.message_id,userId:row.user_id,kind:plan.action.kind,
      state:row.state,jobStatus:job.status,possibleSend:row.create_started,receiptAvailable:row.receipt_available,
      messageId:row.sent_message_id,withdrawalReason:row.withdrawal_reason,expiresAt:Number(row.expires_at_ms),
      reason:job.last_error_code === 'AUTOMATION_UNCERTAIN' ? 'The send outcome is unknown. Verify an existing effect; never repeat the send.' :
        canChange ? 'Delivery needs operator review.' : 'This job is not available for automation recovery.',
      canRecheck:canChange && !unknown(row),canRecover:canChange && row.state === 'pending' && unknown(row)};
  }
  return Object.freeze({
    async list({actor,before=null}) {
      if(before!==null)requireAutomationId(before,'AUTOMATION_INPUT_INVALID');
      return inTransaction(pool,async client=>{
        await access(actor);
        const jobs=(await client.query(`SELECT d.id FROM sophie_core.automation_deliveries d JOIN sophie_core.outbox o
          ON o.guild_id=d.guild_id AND o.operation_id='automation.'||d.id AND o.user_id=d.user_id AND o.kind='automation.dispatch'
          WHERE d.guild_id=$1 AND o.status='parked' AND ($2::text IS NULL OR d.id<$2) ORDER BY d.id DESC LIMIT 11`,[guildId,before])).rows;
        const entries=[];
        for(const item of jobs.slice(0,10)) {
          try {entries.push(describe(await load(client,item.id)));}
          catch(error) {
            if(error.code !== 'AUTOMATION_CORRUPT')throw error;
            entries.push({deliveryId:item.id,integrity:'unverified',canRecheck:false,canRecover:false,
              reason:'Retained automation references failed verification. An operator must review the retained metadata before repair.'});
          }
        }
        await access(actor);return {entries,nextBefore:jobs.length>10?entries.at(-1).deliveryId:null};
      });
    },
    async detail({actor,deliveryId,before=null}) {
      requireAutomationId(deliveryId,'AUTOMATION_INPUT_INVALID');if(before!==null)requireInteger(before,1,2147483646);
      return inTransaction(pool,async client=>{
        await access(actor);const entry=describe(await load(client,deliveryId));
        const rows=(await client.query(`SELECT e.*,a.request_id,a.request_sha256,a.guild_id,a.expected_fence,a.action,a.message_id,a.operator_grant
          FROM sophie_core.automation_delivery_events e LEFT JOIN sophie_core.automation_recovery_actions a
          ON a.delivery_id=e.delivery_id AND a.event_sequence=e.sequence
          WHERE e.delivery_id=$1 AND ($2::integer IS NULL OR e.sequence<$2) ORDER BY e.sequence DESC LIMIT 11`,[deliveryId,before])).rows;
        const events=rows.slice(0,10).map(row=>{
          if(row.request_id!==null)checkedReceipt(row);
          return {sequence:row.sequence,kind:row.kind,recordedAt:row.recorded_at.toISOString(),operatorId:row.operator_grant?.userId??null,messageId:row.message_id};
        });
        await access(actor);return {entry,events,nextBefore:rows.length>10?events.at(-1).sequence:null};
      });
    },
    async change({actor,...fields}) {
      requireKeys(fields,['deliveryId','expectedVersion','action','messageId','requestId','confirmed'],'AUTOMATION_INPUT_INVALID');
      const request=intent(fields),{requestId,confirmed}=fields;requireAutomationHash(requestId);
      requireCondition(confirmed === true,'AUTOMATION_CONFIRMATION_REQUIRED');const sha256=automationDigest(request);
      return inTransaction(pool,async client=>{
        const grant=await access(actor);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,044))',[`${guildId}:${requestId}`]);
        const prior=(await client.query('SELECT * FROM sophie_core.automation_recovery_actions WHERE guild_id=$1 AND request_id=$2',[guildId,requestId])).rows[0];
        if(prior){
          const result=checkedReceipt(prior);
          requireCondition(prior.operator_grant.userId === grant.userId && prior.request_sha256 === sha256,'AUTOMATION_REQUEST_COLLISION');
          await access(actor);return {...result,duplicate:true};
        }
        const {row,plan,job}=await load(client,request.deliveryId,true);
        requireCondition(job.status === 'parked' && job.fence === request.expectedVersion && repairable(job.last_error_code),'AUTOMATION_RECOVERY_STALE');
        let proof=null;
        if(request.action === 'recover') {
          requireCondition(row.state === 'pending' && unknown(row) && job.dispatch_started,'AUTOMATION_RECOVERY_UNAVAILABLE');
          requireCondition(plan.action.kind === 'message' ? request.messageId !== null : request.messageId === null,'AUTOMATION_INPUT_INVALID');
          await allowedChannel(client,plan);
          proof=await messages.recover(plan,request.messageId);
          await allowedChannel(client,plan);
          await messages.verification.recovery(proof,plan,request.messageId);
          await client.query('UPDATE sophie_core.automation_deliveries SET receipt_available=true,sent_message_id=$2 WHERE id=$1',[row.id,request.messageId]);
          await recordAutomationDeliveryEvent(client,row.id,'receipt');
        } else requireCondition(!unknown(row),'AUTOMATION_RECOVERY_UNAVAILABLE');
        const audit=await recordAutomationDeliveryEvent(client,row.id,request.action === 'recover'?'operator-recover':'operator-recheck');
        await client.query(`INSERT INTO sophie_core.automation_recovery_actions
          (guild_id,request_id,request_sha256,delivery_id,event_sequence,expected_fence,action,message_id,operator_grant)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[guildId,requestId,sha256,row.id,audit.rows[0].sequence,request.expectedVersion,request.action,request.messageId,grant]);
        await client.query(`UPDATE sophie_core.outbox SET status='ready',lease_owner=NULL,lease_until=NULL,fence=fence+1,attempts=0,last_error_code=NULL,
          available_at=GREATEST(available_at,clock_timestamp()) WHERE guild_id=$1 AND operation_id=$2`,[guildId,job.operation_id]);
        await access(actor);
        if(proof)await messages.verification.recovery(proof,plan,request.messageId);
        return {deliveryId:row.id,action:request.action,acceptedVersion:request.expectedVersion+1,recorded:true,duplicate:false};
      });
    },
  });
}
