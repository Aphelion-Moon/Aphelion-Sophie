import { ContractError, requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes, onboardingParkedCodes, caseReplyParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

export function createCaseReplyDispatcher({ outbox, store, roles, messages, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const parkedCodes = [...commonParkedCodes, ...caseParkedCodes, ...onboardingParkedCodes, ...caseReplyParkedCodes];
  async function ready(claim) { requireCondition(await enabled() === true, 'DELIVERY_DISABLED'); await outbox.requireDeliveryReady(claim); await outbox.renew(claim); }
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner); if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30000, ['case.reply']); if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const { claim } = job; let armed = false, possiblyAttempted = false, creating = false;
      try {
        requireCondition(claim.guildId === roles.guildId && claim.guildId === messages.guildId, 'CASE_REPLY_CONFIGURATION_INVALID'); await ready(claim);
        let state = await store.inspect({ claim, observation: await roles.observe(job.userId) }); if (state.settled) return { status: 'settled' };
        if (state.messageId === null) {
          requireCondition(!state.createStarted, 'CASE_REPLY_UNCERTAIN');
          const prepared = await messages.prepare(state.plan, state.channelId); await ready(claim);
          const write = await store.begin({ claim, observation: prepared.observation, proof: prepared.proof });
          if (write.settled) return { status: 'settled' };
          if (write.withdrawing) { await outbox.continue(claim); return { status: 'progressed' }; }
          armed = true; await ready(claim); possiblyAttempted = true; creating = true;
          const receipt = await messages.create(prepared, write); creating = false;
          await store.note({ claim, proof: receipt }); await ready(claim);
          state = await store.inspect({ claim, observation: await roles.observe(job.userId) }); if (state.settled) return { status: 'settled' };
        }
        let message = await messages.inspect(state);
        if (!state.withdrawing) {
          const current = await messages.prepare(state.plan, state.channelId); await ready(claim);
          const confirmed = await store.confirm({ claim, observation: current.observation, proof: current.proof, message });
          if (confirmed.settled) return { status: 'settled', confirmed: confirmed.confirmed === true };
          state = confirmed;
        }
        const prepared = await messages.prepare(state.plan, state.channelId, true); await ready(claim);
        // Audience/version may have changed during confirm; bind the observation to the new plan.
        message = await messages.inspect(state);
        const withdrawal = await store.withdrawal({ claim, observation: prepared.observation, proof: prepared.proof, message });
        if (withdrawal.settled) return { status: 'settled' }; await ready(claim); possiblyAttempted = true;
        await messages.withdraw(prepared, { ...withdrawal, message }); await ready(claim);
        const absent = await messages.inspect(withdrawal), current = await messages.prepare(withdrawal.plan, withdrawal.channelId, true);
        await store.withdrawal({ claim, observation: current.observation, proof: current.proof, message: absent, finish: true });
        return { status: 'settled', withdrawn: true };
      } catch (error) {
        if ((armed && !possiblyAttempted) || (creating && ['RATE_LIMITED', 'DISCORD_AUTHORIZATION_FAILED'].includes(error.code))) {
          try { await store.releaseUnsent(claim); }
          catch (failure) { if (failure.code !== 'OUTBOX_LEASE_LOST') throw new ContractError('DELIVERY_STATE_UNAVAILABLE'); }
        }
        if (['CASE_CHANNEL_ACL_MISMATCH', 'CASE_AUDIENCE_CHANGED'].includes(error.code)) {
          try {
            if (await store.invalidate(claim)) { await outbox.continue(claim); return { status: 'progressed', withdrawing: true }; }
          }
          catch (failure) { if (failure.code === 'OUTBOX_LEASE_LOST') return { status: 'lease_lost' }; throw new ContractError('DELIVERY_STATE_UNAVAILABLE'); }
        }
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes });
      }
    },
  });
}
