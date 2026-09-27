import { ContractError, requireCondition } from '../../../contracts/validation.js';
import { validateTicketLimits } from '../../../modules/tickets/index.js';
import { caseStatusView } from '../../../modules/tickets/lifecycle.js';

/** Signed Staff commands use the same versioned service as future dashboard routes. */
export function createCaseLifecycle({ authorization, discord, store, enabled, limits }) {
  validateTicketLimits(limits); requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const fixedLimits = structuredClone(limits);
  async function source(envelope) {
    requireCondition(['ticket.status', 'ticket.close', 'ticket.reopen'].includes(envelope.command) &&
      envelope.guildId === discord.guildId && envelope.userId === envelope.targetId, 'OPERATION_DENIED');
    const actor = await authorization.resolveActor(envelope);
    const record = await store.describeCase({ actor, guildId: envelope.guildId, id: envelope.caseId ?? null, channelId: envelope.channelId });
    return { actor, record };
  }
  const denial = error => error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'CAPABILITY_REVOKED', 'CASE_ACCESS_DENIED', 'FOREIGN_GUILD', 'CASE_NOT_FOUND'].includes(error.code);
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const { actor, record } = await source(envelope);
        if (envelope.command === 'ticket.status') return 'case_status';
        const observation = await discord.observe(record.userId);
        if (await enabled() !== true) return 'disabled';
        const change = envelope.command === 'ticket.close' ? store.closeCase : store.reopenCase;
        await change({ actor, observation, id: record.id, interactionId: envelope.interactionId, expectedVersion: envelope.expectedVersion,
          reason: envelope.reason, limits: fixedLimits });
        return 'case_change_recorded';
      } catch (error) {
        if (denial(error)) return 'denied';
        if (error instanceof ContractError && ['STALE_CASE_VERSION', 'CASE_STATE_CONFLICT'].includes(error.code)) return 'case_stale';
        if (error instanceof ContractError && ['MEMBER_CASE_LIMIT', 'GUILD_PROVISIONING_LIMIT', 'CASE_COOLDOWN'].includes(error.code)) return 'case_capacity';
        return 'unavailable';
      }
    },
    async status(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      try {
        const { record } = await source(envelope);
        if (await enabled() !== true) return { state: 'disabled' };
        return caseStatusView(record);
      } catch (error) { return { state: denial(error) ? 'denied' : 'unavailable' }; }
    },
  });
}
