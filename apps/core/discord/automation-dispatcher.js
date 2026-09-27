import { requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, automationParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

export function createAutomationDispatcher({ outbox, store, messages, enabled }) {
  const ready = async claim => { requireCondition(await enabled() === true,'DELIVERY_DISABLED'); await outbox.requireDeliveryReady(claim); await outbox.renew(claim); };
  return Object.freeze({ async runOnce(owner) {
    requireName(owner); if (await enabled() !== true) return {status:'disabled'};
    const job = await outbox.claim(owner,30000,['automation.dispatch']);
    if (!job) return {status:'idle'}; if (job.parked) return {status:'operator_required',code:'ATTEMPT_LIMIT'};
    const {claim} = job; let started=false, attempted=false, removing=false;
    try {
      await ready(claim);
      let state = await store.prepare(claim);
      if (state.settled) return {status:'settled'};
      if (!state.withdraw && state.row.receipt_available) state = await store.confirm(claim,state.proof);
      if (state.settled) return {status:'settled'};
      if (state.withdraw) {
        await ready(claim); removing=true;
        await store.removed(claim,await messages.remove(state.plan,state.row.sent_message_id));
        await outbox.continue(claim); return {status:'progressed'};
      }
      await ready(claim);
      const sending = await store.begin(claim,state.proof);
      if (sending.settled) return {status:'settled'};
      if (sending.withdraw || sending.row.receipt_available) { await outbox.continue(claim); return {status:'progressed'}; }
      started=true; await ready(claim); attempted=true;
      const proof = await messages.create(sending.plan,state.proof);
      await store.note(claim,proof); attempted=false; started=false;
      await outbox.continue(claim); return {status:'progressed'};
    } catch (error) {
      const preflight = ['RATE_LIMITED','DISCORD_RATE_LIMIT_INVALID','DISCORD_BUSY','DISCORD_TRANSPORT_DISABLED',
        'OBSERVATION_INVALIDATED','MEMBERSHIP_STALE','AUTOMATION_PROOF_INVALID','AUTOMATION_EXPIRED','AUTOMATION_EXISTING_REACTION'];
      const rejected = ['AUTOMATION_ACTION_REJECTED','DISCORD_AUTHORIZATION_FAILED','DISCORD_RESOURCE_MISSING'];
      const unsent = started && (!attempted || preflight.includes(error.code) || rejected.includes(error.code));
      if (unsent) {
        try {
          const settled = await store.releaseUnsent(claim,rejected.includes(error.code));
          if (settled?.settled) return {status:'settled',rejected:true};
        } catch (failure) { if (failure.code !== 'OUTBOX_LEASE_LOST') throw failure; }
      }
      const failure = started && attempted && !unsent ? {code:'AUTOMATION_UNCERTAIN'} : error;
      return settleDeliveryFailure({outbox,claim,error:failure,possiblyAttempted:removing,
        parkedCodes:[...commonParkedCodes,...automationParkedCodes]});
    }
  }});
}
