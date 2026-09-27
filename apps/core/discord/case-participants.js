import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** Explicit selections only. The requester's identity remains the Staff actor, never the selected participant. */
export function createCaseParticipants({ authorization, discord, store, enabled }) {
  requireCondition(typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        requireCondition(envelope.command === 'ticket.participant' && envelope.guildId === discord.guildId && envelope.targetId === envelope.userId, 'OPERATION_DENIED');
        const actor = await authorization.resolveActor(envelope);
        const row = await store.describeCase({ actor, guildId: envelope.guildId, id: envelope.caseId });
        const observation = await discord.observe(row.userId); if (await enabled() !== true) return 'disabled';
        await store.changeCaseParticipant({ actor, observation, id: row.id, interactionId: envelope.interactionId,
          expectedVersion: envelope.expectedVersion, action: envelope.participantAction, userId: envelope.participantId,
          reason: envelope.reason, confirmed: envelope.confirmed });
        return 'case_participant_recorded';
      } catch (error) {
        if (!(error instanceof ContractError)) return 'unavailable';
        if (['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'CAPABILITY_REVOKED', 'CASE_ACCESS_DENIED', 'FOREIGN_GUILD', 'CASE_NOT_FOUND'].includes(error.code)) return 'denied';
        if (['STALE_CASE_VERSION', 'CASE_STATE_CONFLICT', 'CASE_PARTICIPANT_CONFLICT'].includes(error.code)) return 'case_stale';
        if (error.code === 'CASE_PARTICIPANT_DENIED') return 'case_participant_denied';
        return 'unavailable';
      }
    },
  });
}
