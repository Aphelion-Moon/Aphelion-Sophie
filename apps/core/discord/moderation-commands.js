import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** Verified command identity -> shared use case -> durable intent. No role writes here. */
export function createModerationCommands({ authorization, discord, store, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await authorization.resolveActor(envelope);
        requireCondition(envelope.guildId === discord.guildId && ['mute', 'unmute'].includes(envelope.command), 'OPERATION_DENIED');
        const observation = await discord.observe(envelope.targetId);
        if (await enabled() !== true) return 'disabled';
        await store[envelope.command === 'mute' ? 'requestMute' : 'requestUnmute']({ actor,
          interactionId: envelope.interactionId, observation });
        return 'recorded';
      } catch (error) {
        if (error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MODERATION_TARGET_DENIED',
          'CAPABILITY_REVOKED', 'MEMBER_ABSENT', 'FOREIGN_GUILD'].includes(error.code)) return 'denied';
        // An uncertain database commit is not reported as a confirmed rejection or success.
        return 'unavailable';
      }
    },
  });
}
