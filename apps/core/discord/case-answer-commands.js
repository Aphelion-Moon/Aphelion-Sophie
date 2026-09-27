import { createHash } from 'node:crypto';
import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';

const requestId = envelope => createHash('sha256').update(`discord.case-answer-review.${envelope.guildId}.${envelope.interactionId}`).digest('hex');
const replyStatus = result => ({ pending: 'case_reply_recorded', confirmed: 'case_reply_confirmed', cancelled: 'case_reply_cancelled', withdrawn: 'case_reply_withdrawn' })[result.state] ?? 'case_reply_uncertain';
export function createCaseAnswerCommands({ authorization, store, replies, guildId, enabled }) {
  requireId(guildId); requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  async function actorFor(envelope) {
    requireCondition(envelope.guildId === guildId && envelope.targetId === envelope.userId &&
      ['ticket.answer','ticket.answer.confirm','ticket.answer.cancel'].includes(envelope.command), 'OPERATION_DENIED');
    return authorization.resolveActor(envelope);
  }
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await actorFor(envelope);
        if (envelope.command === 'ticket.answer.confirm') return replyStatus(await replies.confirmAnswerReview({ actor, token: envelope.reviewToken }));
        if (envelope.command === 'ticket.answer.cancel') {
          const result = await replies.cancelAnswerReview({ actor, token: envelope.reviewToken });
          return result.state === 'submitted' ? 'case_answer_submitted' : 'case_answer_cancelled';
        }
        const row = await store.describeCase({ actor, guildId, id: envelope.caseId, token: null });
        requireCondition(row.channelId !== null, 'CASE_ACCESS_DENIED');
        if (await enabled() !== true) return 'disabled';
        await replies.prepareAnswerReview({ actor, channelId: row.channelId, expectedVersion: envelope.expectedVersion, name: envelope.answerName, requestId: requestId(envelope) });
        return 'case_answer_review';
      } catch (error) {
        if (error instanceof ContractError) {
          if (['OPERATION_DENIED','UNTRUSTED_PRINCIPAL','CAPABILITY_REVOKED','CASE_ACCESS_DENIED','FOREIGN_GUILD','CASE_NOT_FOUND'].includes(error.code)) return 'denied';
          if (['STALE_CASE_VERSION','CASE_STATE_CONFLICT','CASE_ANSWER_REVIEW_STALE','ANSWER_REVIEW_STALE','ANSWER_UNAVAILABLE'].includes(error.code)) return 'case_answer_stale';
          if (error.code === 'CASE_ANSWER_REVIEW_LIMIT') return 'case_answer_limit';
          if (error.code === 'CASE_REPLY_LIMIT') return 'case_reply_limit';
        }
        return envelope.command === 'ticket.answer.confirm' ? 'case_reply_uncertain' :
          envelope.command === 'ticket.answer.cancel' ? 'case_answer_cancel_uncertain' : 'case_answer_unavailable';
      }
    },
    async view(envelope) {
      try {
        requireCondition(await enabled() === true && envelope.command === 'ticket.answer', 'OPERATION_DENIED');
        const actor = await actorFor(envelope), result = await replies.readAnswerReview({ actor, requestId: requestId(envelope) });
        return await enabled() === true ? result : { state: 'unavailable' };
      } catch (error) {
        return { state: error instanceof ContractError && ['OPERATION_DENIED','UNTRUSTED_PRINCIPAL','CASE_ACCESS_DENIED','CAPABILITY_REVOKED'].includes(error.code) ? 'denied' : 'unavailable' };
      }
    },
  });
}
