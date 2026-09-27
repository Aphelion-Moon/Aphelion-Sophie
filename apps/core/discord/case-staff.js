import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';
import { createHash } from 'node:crypto';
import { caseStatusView } from '../../../modules/tickets/lifecycle.js';

/** Signed Staff operations; authored labels never enter public replies, AI or generic receipts. */
export function createCaseStaff({ authorization, store, guildId, enabled }) {
  requireId(guildId); requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const denial = error => error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'CAPABILITY_REVOKED', 'CASE_ACCESS_DENIED', 'FOREIGN_GUILD', 'CASE_NOT_FOUND'].includes(error.code);
  async function source(envelope) {
    requireCondition(['ticket.queue', 'ticket.claim', 'ticket.unclaim', 'ticket.assign', 'ticket.label'].includes(envelope.command) &&
      envelope.guildId === guildId && envelope.targetId === envelope.userId, 'OPERATION_DENIED');
    return authorization.resolveActor(envelope);
  }
  const binding = envelope => ({ guildId, id: envelope.caseId ?? null, token: envelope.caseToken ?? null });
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await source(envelope);
        if (envelope.command === 'ticket.queue') {
          await store.listCases({ actor, guildId, filter: envelope.filter, after: envelope.after }); return 'case_queue';
        }
        const row = await store.describeCase({ actor, ...binding(envelope) });
        if (await enabled() !== true) return 'disabled';
        if (envelope.command === 'ticket.label') {
          await store.changeCaseLabels({ actor, id: row.id, expectedVersion: envelope.expectedVersion, priority: envelope.priority, tags: envelope.tags,
            requestId: createHash('sha256').update(`discord.case-labels.${guildId}.${envelope.interactionId}`).digest('hex') });
          return 'case_labels_recorded';
        }
        await store.changeCaseAssignment({ actor, guildId, id: row.id, interactionId: envelope.interactionId,
          expectedVersion: envelope.expectedVersion, action: envelope.command.slice('ticket.'.length),
          assigneeId: envelope.assigneeId ?? null, reason: envelope.reason ?? null });
        return 'case_staff_recorded';
      } catch (error) {
        if (denial(error)) return 'denied';
        if (error instanceof ContractError && ['STALE_CASE_VERSION', 'CASE_STATE_CONFLICT', 'CASE_ASSIGNMENT_CONFLICT'].includes(error.code)) return 'case_stale';
        if (error instanceof ContractError && error.code === 'STALE_CASE_QUEUE') return 'case_queue_stale';
        if (error instanceof ContractError && error.code === 'CASE_ASSIGNEE_DENIED') return 'case_assignee_denied';
        return 'unavailable';
      }
    },
    async queue(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      try {
        requireCondition(envelope.command === 'ticket.queue', 'OPERATION_DENIED'); const actor = await source(envelope);
        const view = await store.listCases({ actor, guildId, filter: envelope.filter, after: envelope.after });
        return await enabled() === true ? { state: 'ready', ...view } : { state: 'disabled' };
      } catch (error) { return { state: denial(error) ? 'denied' : error.code === 'STALE_CASE_QUEUE' ? 'stale' : 'unavailable' }; }
    },
    async status(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      try {
        requireCondition(envelope.command !== 'ticket.queue', 'OPERATION_DENIED'); const actor = await source(envelope);
        const row = await store.describeCase({ actor, ...binding(envelope) });
        return await enabled() === true ? caseStatusView(row) : { state: 'disabled' };
      } catch (error) { return { state: denial(error) ? 'denied' : 'unavailable' }; }
    },
  });
}
