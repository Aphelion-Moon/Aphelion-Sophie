import { requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes, onboardingParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

// A step change is a handful of writes (old messages deleted, new ones posted, status card edited). One claim performs
// up to this many, renewing its lease between them, then continues as a new attempt.
const MAX_WRITES_PER_CLAIM = 16;
// Any Gateway dispatch, including the event for this bot's own previous write, ends an observation's continuity.
// A check overtaken that way is repeated with a new (usually shared) preparation instead of failing the job.
const OBSERVATION_ATTEMPTS = 3;

/**
 * Brings one Shuttle run's message group up to date: the status card first when it is new, then removal of an earlier
 * step, then the current step and its navigation card in order, then the status card. Each write commits its intent
 * before the request and its result after it; one claim performs a bounded series of them.
 */
export function createOnboardingDispatcher({ outbox, store, roles, messages, enabled, trace = () => {}, requestCount = () => 0 }) {
  requireCondition(typeof enabled === 'function' && typeof trace === 'function' && typeof requestCount === 'function', 'DELIVERY_GATE_REQUIRED');
  const parkedCodes = [...commonParkedCodes, ...caseParkedCodes, ...onboardingParkedCodes];
  async function ready(claim) {
    requireCondition(await enabled() === true, 'DELIVERY_DISABLED');
    await outbox.requireDeliveryReady(claim); await outbox.renew(claim);
  }
  // Fixed diagnostic codes only: the outcome, whole milliseconds spent, Discord requests sent and how long the job
  // waited to be claimed. No IDs, wording or message content.
  function note(result, startedAt, calls, waitedMs) {
    const bound = (value, limit) => Math.min(limit, Math.max(0, Math.round(value)));
    try {
      trace(`SHUTTLE_RENDER_${String(result.status).toUpperCase().replace(/[^A-Z]/g, '_')}_${bound(performance.now() - startedAt, 99_999)}MS_` +
        `${bound(requestCount() - calls, 999)}CALLS_${bound(waitedMs, 99_999)}WAITMS`);
    } catch { /* Diagnostics never affect delivery. */ }
  }
  async function observed(work) {
    for (let attempt = 1; ; attempt++) {
      try { return await work(); } catch (error) {
        if (error?.code !== 'OBSERVATION_INVALIDATED' || attempt >= OBSERVATION_ATTEMPTS) throw error;
      }
    }
  }
  async function render({ claim, userId }) {
    let possiblyAttempted = false;
    try {
      requireCondition(claim.guildId === messages.guildId && claim.guildId === roles.guildId, 'CASE_CONFIGURATION_INVALID');
      await ready(claim);
      const current = await observed(async () => store.inspectOnboardingRender({ claim,
        observation: (await roles.prepare(userId, { share: true })).observation }));
      if (current.settled) return { status: 'settled', current: current.current };
      const prepare = retired => messages.prepare(current.plan, current.channelId, retired, false, { share: true });
      for (let writes = 0; writes < MAX_WRITES_PER_CLAIM; writes++) {
        await ready(claim);
        let preparation;
        const write = await observed(async () => {
          preparation = await prepare(current.retired);
          return store.beginOnboardingWrite({ claim, observation: preparation.observation, proof: preparation.proof });
        });
        if (write.action === 'none') return { status: 'settled', current: write.current };
        const target = { plan: write.plan, channelId: write.channelId, recordId: write.recordId, screenId: write.screenId,
          kind: write.kind, payload: write.payload, messageId: write.messageId, retired: write.retired };
        if (write.action === 'inspect') {
          // A read, not a write: settles an unconfirmed edit (or an entry re-check) from what Discord now shows.
          await observed(async () => {
            const shown = await messages.inspect(target), fresh = await prepare(write.retired);
            return store.confirmOnboardingWrite({ claim, observation: fresh.observation, proof: fresh.proof, message: shown, write, fromWrite: false });
          });
          continue;
        }
        await ready(claim); possiblyAttempted = true;
        let result;
        if (write.action === 'create') {
          result = await messages.create(preparation, target);
          await store.noteOnboardingMessage({ claim, proof: result, recordId: write.recordId });
        } else if (write.action === 'edit') result = await messages.edit(preparation, target);
        else result = await messages.remove(preparation, target);
        possiblyAttempted = false;
        try {
          await observed(async () => {
            const fresh = await prepare(write.retired);
            return store.confirmOnboardingWrite({ claim, observation: fresh.observation, proof: fresh.proof, message: result, write });
          });
        } catch (error) {
          if (error?.code !== 'OBSERVATION_INVALIDATED') throw error;
          // An authority change overtook the write: confirm it from a fresh read instead of from its response.
          const after = await messages.inspect({ ...target, messageId: write.messageId ?? result.messageId });
          const fresh = await messages.prepare(current.plan, current.channelId, write.retired);
          await store.confirmOnboardingWrite({ claim, observation: fresh.observation, proof: fresh.proof, message: after, write, fromWrite: false });
        }
      }
      await outbox.continue(claim); return { status: 'progressed' };
    } catch (error) {
      return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes,
        noteUncertain: possiblyAttempted ? () => store.noteUncertainOnboardingWrite(claim) : undefined });
    }
  }
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner);
      if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30_000, ['shuttle.render']);
      if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const startedAt = performance.now(), calls = requestCount();
      const result = await render(job);
      note(result, startedAt, calls, job.waitedMs ?? 0);
      return result;
    },
  });
}
