import { createHash } from 'node:crypto';
import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';

/** Signed human text has a one-use core-only handoff. The shared service owns authorization and durable intent. */
export function createCaseReplyCommands({ authorization, verifier, store, replies, guildId, enabled }) {
  requireId(guildId); requireCondition(typeof enabled === 'function' && typeof verifier.takeCaseReplyText === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({ async execute(envelope) {
    if (await enabled() !== true) return 'disabled';
    try {
      requireCondition(envelope.command === 'ticket.reply' && envelope.guildId === guildId && envelope.targetId === envelope.userId, 'OPERATION_DENIED');
      const actor = await authorization.resolveActor(envelope), text = verifier.takeCaseReplyText(envelope);
      if (envelope.confirmed !== true) return 'case_reply_confirmation';
      const row = await store.describeCase({ actor, guildId, id: envelope.caseId, token: null });
      requireCondition(row.channelId !== null, 'CASE_ACCESS_DENIED');
      if (await enabled() !== true) return 'disabled';
      const result = await replies.request({ actor, channelId: row.channelId, expectedVersion: envelope.expectedVersion, text,
        requestId: createHash('sha256').update(`discord.case-reply.${guildId}.${envelope.interactionId}`).digest('hex') });
      return { pending: 'case_reply_recorded', confirmed: 'case_reply_confirmed', cancelled: 'case_reply_cancelled', withdrawn: 'case_reply_withdrawn' }[result.state] ?? 'case_reply_uncertain';
    } catch (error) {
      if (error instanceof ContractError) {
        if (['OPERATION_DENIED','UNTRUSTED_PRINCIPAL','UNTRUSTED_CASE_REPLY','CAPABILITY_REVOKED','CASE_ACCESS_DENIED','FOREIGN_GUILD','CASE_NOT_FOUND'].includes(error.code)) return 'denied';
        if (['STALE_CASE_VERSION','CASE_STATE_CONFLICT'].includes(error.code)) return 'case_stale';
        if (error.code === 'CASE_REPLY_LIMIT') return 'case_reply_limit';
      }
      return 'case_reply_uncertain';
    }
  } });
}
