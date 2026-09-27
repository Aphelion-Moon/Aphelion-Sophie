import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** Resolve an ephemeral destination from current ownership and a fresh private-channel proof. */
export function createOnboardingNavigation({ authorization, discord, channels, store, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  return Object.freeze({
    async resolve(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const actor = await authorization.resolveActor(envelope);
        requireCondition(envelope.command === 'shuttle.start' && envelope.guildId === discord.guildId &&
          envelope.targetId === envelope.userId, 'OPERATION_DENIED');
        const destination = await store.describeOnboardingDestination({ actor, observation: await discord.observe(envelope.userId) });
        if (destination.state === 'preparing') return { state: 'preparing' };
        const proof = await channels.inspect(destination.plan, destination.channelId);
        if (await enabled() !== true) return { state: 'disabled' };
        return await store.confirmOnboardingDestination({ actor, observation: await discord.observe(envelope.userId),
          sessionId: destination.sessionId, proof });
      } catch (error) {
        if (error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_MUZZLED',
          'NOT_IN_GUILD', 'CAPABILITY_REVOKED', 'FOREIGN_GUILD'].includes(error.code)) return { state: 'denied' };
        if (error instanceof ContractError && ['OBSERVATION_INVALIDATED', 'MEMBERSHIP_STALE', 'DISCORD_TRANSPORT_BUSY'].includes(error.code) && attempt === 0) continue;
        return { state: 'unavailable' };
      }
      }
    },
  });
}
