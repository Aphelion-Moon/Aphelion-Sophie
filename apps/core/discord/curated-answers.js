import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';

/** Resolve signed identity again for response delivery; never retain public text in routing receipts. */
export function createCuratedAnswerCommands({ authorization, answers, guildId, enabled }) {
  requireId(guildId); requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  async function actorFor(envelope) {
    requireCondition(envelope.guildId === guildId && envelope.targetId === envelope.userId &&
      ['answer.list', 'answer.show'].includes(envelope.command), 'OPERATION_DENIED');
    return authorization.resolveActor(envelope);
  }
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try { await actorFor(envelope); return 'public_answer'; }
      catch { return 'denied'; }
    },
    async view(envelope) {
      if (await enabled() !== true) return { status: 'disabled' };
      try {
        const actor = await actorFor(envelope);
        const result = envelope.command === 'answer.list' ?
          { kind: 'list', ...await answers.list({ actor, after: envelope.after }) } :
          { kind: 'show', entry: await answers.lookup({ actor, name: envelope.answerName }) };
        if (await enabled() !== true) return { status: 'disabled' };
        return { status: 'available', ...result };
      } catch (error) {
        if (error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_ABSENT',
          'NOT_IN_GUILD', 'CAPABILITY_REVOKED', 'FOREIGN_GUILD'].includes(error.code)) return { status: 'denied' };
        return { status: 'unavailable' };
      }
    },
  });
}
