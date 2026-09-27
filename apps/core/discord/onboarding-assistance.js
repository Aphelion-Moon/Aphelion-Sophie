import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** Staff-only metadata queue and logged resolution, shared with the private response adapter. */
export function createOnboardingAssistance({ authorization, discord, store, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  async function principal(envelope) {
    const actor = await authorization.resolveActor(envelope);
    requireCondition(envelope.guildId === discord.guildId && envelope.targetId === envelope.userId &&
      ['shuttle.queue', 'shuttle.help.resolve'].includes(envelope.command), 'OPERATION_DENIED');
    requireCondition(await authorization.authorize('case.manage', actor,
      { guildId: envelope.guildId, type: 'shuttle', openerId: actor.userId }) === true, 'OPERATION_DENIED');
    return actor;
  }
  function failure(error) {
    return error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'CAPABILITY_REVOKED',
      'FOREIGN_GUILD', 'CASE_ACCESS_DENIED'].includes(error.code) ? 'denied' : 'unavailable';
  }
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await principal(envelope);
        if (envelope.command === 'shuttle.queue') return 'shuttle_help_queue';
        const request = await store.describeOnboardingHelp({ actor, guildId: envelope.guildId, requestId: envelope.requestId });
        const observation = await discord.observe(request.userId);
        if (await enabled() !== true) return 'disabled';
        const result = await store.resolveOnboardingHelp({ actor, interactionId: envelope.interactionId, requestId: envelope.requestId,
          expectedRevision: envelope.expectedRevision, observation });
        return result.resumed ? 'shuttle_help_resumed' : 'shuttle_help_resolved';
      } catch (error) {
        if (error instanceof ContractError && ['MEMBER_MUZZLED', 'NOT_IN_GUILD'].includes(error.code)) return 'shuttle_help_waiting';
        if (error instanceof ContractError && ['STALE_SHUTTLE_HELP', 'SHUTTLE_HELP_NOT_FOUND'].includes(error.code)) return 'shuttle_help_stale';
        return failure(error);
      }
    },
    async queue(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      try {
        const actor = await principal(envelope);
        requireCondition(envelope.command === 'shuttle.queue', 'OPERATION_DENIED');
        const result = await store.listOnboardingHelp({ actor, guildId: envelope.guildId, after: envelope.after ?? null });
        if (await enabled() !== true) return { state: 'disabled' };
        return result;
      } catch (error) { return { state: failure(error) }; }
    },
  });
}
