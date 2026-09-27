import { requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes, onboardingParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

/** One create/edit at most per call. Retired screens can only receive an inert replacement. */
export function createOnboardingDispatcher({ outbox, store, roles, messages, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const parkedCodes = [...commonParkedCodes, ...caseParkedCodes, ...onboardingParkedCodes];
  async function ready(claim) {
    requireCondition(await enabled() === true, 'DELIVERY_DISABLED');
    await outbox.requireDeliveryReady(claim); await outbox.renew(claim);
  }
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner);
      if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30_000, ['shuttle.render']);
      if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const { claim } = job;
      let possiblyAttempted = false;
      try {
        requireCondition(claim.guildId === messages.guildId && claim.guildId === roles.guildId, 'CASE_CONFIGURATION_INVALID');
        await ready(claim);
        const current = await store.inspectOnboardingRender({ claim, observation: await roles.observe(job.userId) });
        if (current.settled) return { status: 'settled' };
        if (current.messageId === null) requireCondition(!current.createStarted, 'SHUTTLE_MESSAGE_UNCERTAIN');
        const preparation = await messages.prepare(current.plan, current.channelId, current.retired);
        let observed = current.messageId === null ? null : await messages.inspect(current);
        if (observed !== null) {
          const result = await store.confirmOnboardingRender({ claim, observation: preparation.observation, proof: preparation.proof, message: observed });
          if (result.settled) return { status: 'settled', current: result.current, replacedMissing: result.replacedMissing ?? false };
        }
        await ready(claim);
        const write = await store.beginOnboardingWrite({ claim, observation: preparation.observation, proof: preparation.proof, message: observed });
        await ready(claim); possiblyAttempted = true;
        if (observed === null) {
          observed = await messages.create(preparation, { ...current, ...write });
          await store.noteOnboardingMessage({ claim, proof: observed });
        } else observed = await messages.edit(preparation, { ...current, ...write });
        await ready(claim);
        const after = await messages.inspect({ ...current, messageId: observed.messageId });
        const fresh = await messages.prepare(current.plan, current.channelId, write.retired);
        const result = await store.confirmOnboardingRender({ claim, observation: fresh.observation, proof: fresh.proof, message: after });
        if (!result.settled) { await outbox.continue(claim); return { status: 'progressed' }; }
        return { status: 'settled', current: result.current };
      } catch (error) {
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes,
          noteUncertain: possiblyAttempted ? () => store.noteUncertainOnboardingWrite(claim) : undefined });
      }
    },
  });
}
