import { ContractError, requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes, onboardingParkedCodes, onboardingAlertParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

/** One alert POST at most. Unknown creation is parked; known messages are only inspected. */
export function createOnboardingAlertDispatcher({ outbox, store, roles, messages, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const parkedCodes = [...commonParkedCodes, ...caseParkedCodes, ...onboardingParkedCodes, ...onboardingAlertParkedCodes];
  async function ready(claim) {
    requireCondition(await enabled() === true, 'DELIVERY_DISABLED');
    await outbox.requireDeliveryReady(claim); await outbox.renew(claim);
  }
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner); if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30_000, ['shuttle.alert']); if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const { claim } = job; let possiblyAttempted = false;
      try {
        requireCondition(claim.guildId === roles.guildId && claim.guildId === messages.guildId, 'CASE_CONFIGURATION_INVALID');
        await ready(claim);
        const state = await store.inspectOnboardingAlert({ claim, observation: await roles.observe(job.userId) });
        if (state.settled) return { status: 'settled', obsolete: state.obsolete ?? false };
        if (state.messageId === null) requireCondition(!state.createStarted, 'SHUTTLE_ALERT_UNCERTAIN');
        let prepared = await messages.prepare(state.plan, state.channelId), message;
        if (state.messageId === null) {
          await ready(claim);
          const write = await store.beginOnboardingAlert({ claim, observation: prepared.observation, proof: prepared.proof });
          if (write.settled) return { status: 'settled', obsolete: write.obsolete ?? false };
          await ready(claim); possiblyAttempted = true;
          message = await messages.create(prepared, write);
          await store.noteOnboardingAlert({ claim, proof: message });
          await ready(claim);
          prepared = await messages.prepare(state.plan, state.channelId);
        }
        const observed = await messages.inspect({ ...state, messageId: message?.messageId ?? state.messageId });
        await ready(claim);
        return { status: 'settled', ...await store.confirmOnboardingAlert({ claim, observation: prepared.observation, proof: prepared.proof, message: observed }) };
      } catch (error) {
        if (possiblyAttempted && ['RATE_LIMITED', 'DISCORD_AUTHORIZATION_FAILED'].includes(error.code)) {
          try { await store.releaseUnsentOnboardingAlert(claim); }
          catch (failure) { if (failure.code !== 'OUTBOX_LEASE_LOST') throw new ContractError('DELIVERY_STATE_UNAVAILABLE'); }
        }
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes });
      }
    },
  });
}
