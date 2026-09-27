import { ContractError, requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes, onboardingParkedCodes, caseIntakeParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

/** One answer/notification POST per invocation. Verified parts precede the one bounded responder mention. */
export function createCaseIntakeDispatcher({ outbox, store, roles, messages, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const parkedCodes = [...commonParkedCodes, ...caseParkedCodes, ...onboardingParkedCodes, ...caseIntakeParkedCodes, 'STAFF_MENTION_UNAVAILABLE'];
  async function ready(claim) {
    requireCondition(await enabled() === true, 'DELIVERY_DISABLED'); await outbox.requireDeliveryReady(claim); await outbox.renew(claim);
  }
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner); if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30_000, ['case.intake']); if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const { claim } = job; let possiblyAttempted = false, armed = false, recordId = null;
      try {
        requireCondition(claim.guildId === roles.guildId && claim.guildId === messages.guildId, 'CASE_CONFIGURATION_INVALID'); await ready(claim);
        const state = await store.inspectCaseIntake({ claim, observation: await roles.observe(job.userId) }); if (state.settled) return { status: 'settled' };
        recordId = state.recordId;
        if (state.messageId === null) requireCondition(!state.createStarted, 'CASE_INTAKE_UNCERTAIN');
        let messageId = state.messageId;
        if (messageId === null) {
          const preparation = await messages.prepare(state.plan, state.channelId, state.kind === 'notice'); await ready(claim);
          const write = await store.beginCaseIntakeMessage({ claim, observation: preparation.observation, proof: preparation.proof, recordId });
          if (write.settled) return { status: 'settled' }; armed = true; await ready(claim); possiblyAttempted = true;
          const receipt = await messages.create(preparation, write); messageId = receipt.messageId;
          await store.noteCaseIntakeMessage({ claim, recordId, proof: receipt }); await ready(claim);
        }
        const message = await messages.inspect({ ...state, messageId });
        const current = await messages.prepare(state.plan, state.channelId, false); await ready(claim);
        const confirmed = await store.confirmCaseIntakeMessage({ claim, recordId, observation: current.observation, proof: current.proof, message });
        if (confirmed.settled) return { status: 'settled', confirmed: true };
        await outbox.continue(claim); return { status: 'progressed' };
      } catch (error) {
        if ((armed && !possiblyAttempted) || (possiblyAttempted && ['RATE_LIMITED', 'DISCORD_AUTHORIZATION_FAILED'].includes(error.code))) {
          try { await store.releaseUnsentCaseIntakeMessage({ claim, recordId }); }
          catch (failure) { if (failure.code !== 'OUTBOX_LEASE_LOST') throw new ContractError('DELIVERY_STATE_UNAVAILABLE'); }
        }
        const inspect = possiblyAttempted || ['CASE_INTAKE_UNAVAILABLE', 'CASE_CHANNEL_ACL_MISMATCH', 'CASE_CHANNEL_MISMATCH', 'CASE_CHANNEL_MISSING'].includes(error.code);
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes,
          ...(inspect ? { noteUncertain: () => store.queueCaseIntakeInspection(claim) } : {}) });
      }
    },
  });
}
