import { ContractError, requireCondition } from '../../../contracts/validation.js';

const actions = Object.freeze({ 'ticket.issue.recheck': 'recheck', 'ticket.message.recover': 'adopt_message', 'ticket.channel.choose': 'select_channel' });
const outcomes = Object.freeze({ recheck: 'case_issue_recorded', adopt_message: 'case_recovery_recorded', select_channel: 'case_channel_recorded' });
const denied = error => error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'CAPABILITY_REVOKED', 'FOREIGN_GUILD', 'CASE_ACCESS_DENIED', 'CASE_ISSUE_NOT_FOUND'].includes(error.code);

/** Signed metadata only, with actual case-audience checks in each shared store operation. */
export function createCaseDeliveryIssues({ authorization, discord, channels, messages, replyMessages = null, store, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  async function actor(envelope) {
    requireCondition(envelope.guildId === discord.guildId && envelope.targetId === envelope.userId &&
      (envelope.command === 'ticket.issues' || Object.hasOwn(actions, envelope.command)), 'OPERATION_DENIED');
    return authorization.resolveActor(envelope);
  }
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const principal = await actor(envelope);
        if (envelope.command === 'ticket.issues') {
          await store.listCaseDeliveryIssues({ actor: principal, guildId: envelope.guildId, after: envelope.after ?? null }); return 'case_issue_queue';
        }
        const action = actions[envelope.command], resultId = action === 'adopt_message' ? envelope.messageId : action === 'select_channel' ? envelope.selectedChannelId : null;
        const request = { actor: principal, guildId: envelope.guildId, interactionId: envelope.interactionId,
          issueId: envelope.issueId, expectedRevision: envelope.expectedRevision, action, resultId };
        const source = await store.describeCaseDeliveryIssue(request);
        if (source.duplicate) return await enabled() === true ? outcomes[action] : 'disabled';
        requireCondition(action !== 'adopt_message' || (['case.intake','case.reply'].includes(source.kind) && source.recordId !== null), 'CASE_RECOVERY_NOT_STARTED');
        requireCondition(action !== 'select_channel' || (source.kind === 'case.provision' && source.candidateIds.includes(resultId)), 'SHUTTLE_CHANNEL_CHOICE_INVALID');
        const proof = source.kind === 'case.intake' || action === 'select_channel' || (source.kind === 'case.reply' && action === 'adopt_message') ? await channels.inspect(source.plan, action === 'select_channel' ? resultId : source.channelId) : null;
        const reader = source.kind === 'case.reply' ? replyMessages : messages;
        requireCondition(action !== 'adopt_message' || typeof reader?.inspect === 'function', 'CASE_RECOVERY_NOT_STARTED');
        const message = action === 'adopt_message' ? await reader.inspect({ plan: source.plan, channelId: source.channelId, recordId: source.recordId, messageId: resultId }) : null;
        const observation = await discord.observe(source.userId); if (await enabled() !== true) return 'disabled';
        await store.changeCaseDeliveryIssue({ ...request, observation, proof, message }); return outcomes[action];
      } catch (error) {
        if (denied(error)) return 'denied';
        if (error.code === 'STALE_CASE_ISSUE') return 'case_issue_stale';
        if (error.code === 'STALE_CASE_ISSUE_QUEUE') return 'case_issue_queue_stale';
        if (error.code === 'CASE_ISSUE_MESSAGE_REQUIRED') return 'case_issue_message_needed';
        if (['CASE_ISSUE_CHANNEL_REQUIRED', 'SHUTTLE_CHANNEL_CHOICE_INVALID', 'CASE_CHANNEL_ALREADY_BOUND'].includes(error.code)) return 'case_channel_rejected';
        if (['CASE_RECOVERY_NOT_STARTED', 'INVALID_CASE_ISSUE_ACTION', 'CASE_INTAKE_MESSAGE_COLLISION', 'CASE_INTAKE_MESSAGE_MISSING',
          'CASE_INTAKE_MESSAGE_CHANGED', 'SHUTTLE_MESSAGE_UNTRUSTED', 'SHUTTLE_MESSAGE_OWNERSHIP'].includes(error.code)) return 'case_recovery_rejected';
        if (['CASE_INTAKE_UNAVAILABLE', 'CASE_POLICY_CHANGED', 'CASE_CHANNEL_MISSING', 'CASE_CHANNEL_MISMATCH', 'CASE_CHANNEL_ACL_MISMATCH'].includes(error.code)) return 'case_issue_review';
        return 'unavailable';
      }
    },
    async queue(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      try {
        requireCondition(envelope.command === 'ticket.issues', 'OPERATION_DENIED'); const principal = await actor(envelope);
        const view = await store.listCaseDeliveryIssues({ actor: principal, guildId: envelope.guildId, after: envelope.after ?? null });
        return await enabled() === true ? view : { state: 'disabled' };
      } catch (error) { return { state: denied(error) ? 'denied' : error.code === 'STALE_CASE_ISSUE_QUEUE' ? 'stale' : 'unavailable' }; }
    },
  });
}
