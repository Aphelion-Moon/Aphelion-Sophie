import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

const QUIET = Object.freeze({ parse: [], users: [], roles: [], replied_user: false });

/** The notice for Staff: who was given Whitelist, by mention (shown as their name, never notified). Fixed wording. */
export function whitelistNotice(userId) {
  requireId(userId);
  return { content: `**Whitelist granted** · <@${userId}> finished the Arrivals Shuttle and Sophie gave them Whitelist.`, allowed_mentions: { ...QUIET } };
}

/**
 * Posts the notices core queues when Sophie's grant of Whitelist is confirmed (owner request, 24 October 2026), to the
 * configured staff channel. One bounded job per call. The nonce comes from the job, so a send retried after an uncertain
 * outcome is the same post; a channel Sophie cannot write to parks the job. No AI, no ticket data.
 */
export function createWhitelistNoticeDispatcher({ outbox, transport, channelId, enabled }) {
  requireId(channelId);
  requireCondition(typeof enabled === 'function' && typeof transport?.createWhitelistNotice === 'function' && typeof outbox?.finish === 'function',
    'TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner);
      if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30_000, ['whitelist.notice']);
      if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const { claim } = job;
      let possiblyAttempted = false;
      try {
        requireCondition(claim.guildId === transport.guildId, 'ROLE_CONFIGURATION_INVALID');
        await outbox.requireDeliveryReady(claim);
        possiblyAttempted = true;
        await transport.createWhitelistNotice(channelId, createHash('sha256').update(claim.operationId).digest('hex').slice(0, 24), whitelistNotice(job.userId));
        await outbox.finish(claim);
        return { status: 'settled' };
      } catch (error) {
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes: commonParkedCodes });
      }
    },
  });
}
