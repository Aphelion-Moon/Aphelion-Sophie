import { requireCondition } from '../../../contracts/validation.js';
import { latestAutomationPolicy } from './automation-policy-records.js';
import { inspectAutomationChannel } from './automation-channel-policy.js';
import { lockClaim, finishClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';
import { loadAutomationDelivery, recordAutomationDeliveryEvent as audit } from './automation-delivery-records.js';

/** One bounded automatic action, with durable possible-send state and sticky compensation. */
export function createAutomationDelivery({ pool, clock, guildId, protectedCategoryId, channels, messages, automationEnabled }) {
  async function bound(client, claim, job) {
    requireCondition(claim.guildId === guildId,'AUTOMATION_CORRUPT');
    return loadAutomationDelivery(client,{guildId,operationId:claim.operationId,job});
  }
  async function mark(client, state, reason) {
    if (state.row.withdrawal_reason) return;
    await client.query('UPDATE sophie_core.automation_deliveries SET withdrawal_reason=$2 WHERE id=$1',[state.row.id,reason]);
    state.row.withdrawal_reason = reason; await audit(client,state.row.id,'withdrawal-required');
  }
  async function settle(client,claim,state,status) {
    await client.query('UPDATE sophie_core.automation_deliveries SET state=$2,settled_at=clock_timestamp() WHERE id=$1',[state.row.id,status]);
    await audit(client,state.row.id,status); await finishClaim(client,claim,'done'); return {settled:true};
  }
  async function current(client,claim) {
    const state = await bound(client,claim,await lockClaim(client,claim)), {row,plan} = state;
    if (row.state !== 'pending') { await finishClaim(client,claim,'done'); return {settled:true}; }
    // An unknown remote effect must never become a cancelled/no-effect claim.
    requireCondition(!row.create_started || row.receipt_available,'AUTOMATION_UNCERTAIN');
    if (!row.withdrawal_reason) {
      if (await automationEnabled() !== true) await mark(client,state,'disabled');
      else if (clock() >= plan.expiresAt || clock() < Number(row.created_at_ms)) await mark(client,state,'expired');
      else {
        const policy = await latestAutomationPolicy(client,guildId);
        if (policy?.revision !== row.policy_revision || policy.action !== 'publish') await mark(client,state,'policy');
        else if (await inspectAutomationChannel(client,{guildId,protectedCategoryId,channels,channelId:plan.channelId}) === null) await mark(client,state,'channel');
      }
    }
    if (row.withdrawal_reason && !row.receipt_available) return settle(client,claim,state,'cancelled');
    return {...state,settled:false,withdraw:row.withdrawal_reason !== null};
  }
  async function wake(client,claim) {
    // Late positive receipts settle uncertainty without ever authorizing another creation.
    await client.query(`UPDATE sophie_core.outbox SET status='ready',lease_owner=NULL,lease_until=NULL,available_at=clock_timestamp(),
      attempts=0,last_error_code=NULL,fence=fence+1 WHERE guild_id=$1 AND operation_id=$2 AND status='parked'
      AND last_error_code IN ('AUTOMATION_UNCERTAIN','ATTEMPT_LIMIT')`,[guildId,claim.operationId]);
  }
  return Object.freeze({
    inspect(claim) { return inTransaction(pool,client=>current(client,claim)); },
    prepare(claim) {
      return inTransaction(pool,async client=>{
        const state = await current(client,claim); if (state.settled || state.withdraw) return state;
        try { state.proof = await messages.prepare(state.plan); }
        catch (error) {
          if (error.code !== 'AUTOMATION_INELIGIBLE') throw error;
          await mark(client,state,'eligibility');
          if (!state.row.receipt_available) return settle(client,claim,state,'cancelled');
          return {...state,withdraw:true};
        }
        const checked = await current(client,claim);
        return {...checked,proof:state.proof};
      });
    },
    begin(claim,proof) {
      return inTransaction(pool,async client=>{
        const state = await current(client,claim); if (state.settled || state.withdraw || state.row.receipt_available) return state;
        const held = await messages.verification.current(proof,state.plan);
        if (held.reacted) { await mark(client,state,'existing-reaction'); return settle(client,claim,state,'cancelled'); }
        await client.query('UPDATE sophie_core.automation_deliveries SET create_started=true WHERE id=$1',[state.row.id]);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started=true WHERE guild_id=$1 AND operation_id=$2',[guildId,claim.operationId]);
        await audit(client,state.row.id,'send-started'); return state;
      });
    },
    note(claim,proof) {
      validateClaim(claim);
      return inTransaction(pool,async client=>{
        const job = (await client.query('SELECT * FROM sophie_core.outbox WHERE guild_id=$1 AND operation_id=$2 FOR UPDATE',[claim.guildId,claim.operationId])).rows[0];
        requireCondition(job && Number(job.fence) >= claim.fence,'AUTOMATION_CORRUPT');
        const state = await bound(client,claim,job), {row,plan} = state;
        requireCondition(row.create_started,'AUTOMATION_CORRUPT');
        const messageId = messages.verification.receipt(proof,plan);
        requireCondition(!row.receipt_available || row.sent_message_id === messageId,'AUTOMATION_CORRUPT');
        if (!row.receipt_available) {
          await client.query('UPDATE sophie_core.automation_deliveries SET receipt_available=true,sent_message_id=$2 WHERE id=$1',[row.id,messageId]);
          await audit(client,row.id,'receipt');
        }
        await wake(client,claim);
      });
    },
    confirm(claim,proof) {
      return inTransaction(pool,async client=>{
        const state = await current(client,claim); if (state.settled || state.withdraw) return state;
        requireCondition(state.row.receipt_available,'AUTOMATION_CORRUPT');
        if (!await messages.verify(state.plan,proof,state.row.sent_message_id)) {
          await mark(client,state,'effect-missing'); return {...state,withdraw:true};
        }
        const checked = await current(client,claim); if (checked.settled || checked.withdraw) return checked;
        await messages.verification.current(proof,state.plan);
        return settle(client,claim,state,'confirmed');
      });
    },
    removed(claim,proof) {
      validateClaim(claim);
      return inTransaction(pool,async client=>{
        const job = (await client.query('SELECT * FROM sophie_core.outbox WHERE guild_id=$1 AND operation_id=$2 FOR UPDATE',[claim.guildId,claim.operationId])).rows[0];
        requireCondition(job && Number(job.fence) >= claim.fence,'AUTOMATION_CORRUPT');
        const state = await bound(client,claim,job);
        requireCondition(state.row.receipt_available && state.row.withdrawal_reason,'AUTOMATION_CORRUPT');
        messages.verification.removal(proof,state.plan,state.row.sent_message_id);
        if (state.row.state === 'pending') {
          await client.query("UPDATE sophie_core.automation_deliveries SET state='withdrawn',settled_at=clock_timestamp() WHERE id=$1",[state.row.id]);
          await audit(client,state.row.id,'withdrawn');
        }
        await wake(client,claim);
      });
    },
    releaseUnsent(claim,rejected=false) {
      return inTransaction(pool,async client=>{
        const state = await bound(client,claim,await lockClaim(client,claim));
        requireCondition(!state.row.receipt_available && state.row.state === 'pending','AUTOMATION_CORRUPT');
        await client.query('UPDATE sophie_core.automation_deliveries SET create_started=false WHERE id=$1',[state.row.id]);
        await audit(client,state.row.id,'unsent');
        if (rejected) { await mark(client,state,'rejected'); return settle(client,claim,state,'cancelled'); }
      });
    },
  });
}
