import { requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

export function createCaseDirectNoticeDispatcher({ outbox, store, roles, channels, messages, enabled }) {
  const ready = async claim => { requireCondition(await enabled() === true, 'DELIVERY_DISABLED'); await outbox.requireDeliveryReady(claim); await outbox.renew(claim); };
  return Object.freeze({ async runOnce(owner) {
    requireName(owner); if (await enabled() !== true) return { status: 'disabled' };
    const job = await outbox.claim(owner, 30_000, ['case.dm']);
    if (!job) return { status: 'idle' }; if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
    const { claim } = job; let started = false, attempted = false;
    try {
      await ready(claim);
      const state = await store.inspect({ claim, observation: await roles.observe(job.userId) });
      if (state.settled) return { status: 'settled' };
      const dm = await messages.prepare(state.plan);
      const channel = await channels.inspect(state.plan, state.channelId);
      await ready(claim);
      const sending = await store.begin({ claim, observation: await roles.observe(job.userId), dm, channel });
      if (sending.settled) return { status: 'settled' }; started = true;
      await ready(claim); attempted = true;
      const proof = await messages.send({ ...sending, dm, channel });
      await store.note({ claim, proof }); await store.finish(claim);
      return { status: 'settled', sent: true };
    } catch (error) {
      if (error.code === 'CASE_DM_BLOCKED') { await store.blocked(claim); return { status: 'settled', blocked: true }; }
      if (started && (!attempted || ['RATE_LIMITED', 'DISCORD_BUSY', 'DISCORD_TRANSPORT_DISABLED'].includes(error.code))) await store.releaseUnsent(claim);
      return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted: attempted,
        parkedCodes: [...commonParkedCodes, ...caseParkedCodes, 'CASE_CHANNEL_ACL_MISMATCH', 'CASE_DM_UNCERTAIN', 'CASE_DM_UNTRUSTED'] });
    }
  } });
}
