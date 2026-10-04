import { ContractError, requireCondition } from '../../../contracts/validation.js';
import { createOnboardingStaffOperations } from './onboarding-staff-operations.js';

/** Fresh Staff authority for both execution and the later private response. */
export function createOnboardingDeliveryIssues({ authorization, discord, channels, store, enabled, screenMessages = null, alertMessages = null }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const operations = createOnboardingStaffOperations({ store, discord, channels, screenMessages, alertMessages, enabled });
  async function principal(envelope) {
    const actor = await authorization.resolveActor(envelope);
    requireCondition(envelope.guildId === discord.guildId && envelope.targetId === envelope.userId &&
      ['shuttle.issues', 'shuttle.issue.recheck', 'shuttle.message.recover', 'shuttle.channel.choose'].includes(envelope.command), 'OPERATION_DENIED');
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
        if (envelope.command === 'shuttle.issues') return 'shuttle_issue_queue';
        const recovery = envelope.command === 'shuttle.message.recover';
        const selection = envelope.command === 'shuttle.channel.choose';
        await operations.repair({ actor, guildId: envelope.guildId, interactionId: envelope.interactionId, issueId: envelope.issueId,
          expectedRevision: envelope.expectedRevision, action: recovery ? 'adopt_message' : selection ? 'select_channel' : 'recheck',
          resultId: recovery ? envelope.messageId : selection ? envelope.selectedChannelId : null });
        return recovery ? 'shuttle_recovery_recorded' : selection ? 'shuttle_channel_recorded' : 'shuttle_issue_recorded';
      } catch (error) {
        if (error instanceof ContractError && error.code === 'SHUTTLE_STAFF_DISABLED') return 'disabled';
        if (error instanceof ContractError && ['STALE_SHUTTLE_ISSUE', 'SHUTTLE_ISSUE_NOT_FOUND'].includes(error.code)) return 'shuttle_issue_stale';
        if (error instanceof ContractError && error.code === 'SHUTTLE_MESSAGE_ID_REQUIRED') return 'shuttle_issue_message_needed';
        if (error instanceof ContractError && ['SHUTTLE_CHANNEL_CHOICE_INVALID', 'CASE_CHANNEL_ALREADY_BOUND'].includes(error.code)) return 'shuttle_channel_rejected';
        if (error instanceof ContractError && ['SHUTTLE_RECOVERY_KIND_INVALID', 'SHUTTLE_RECOVERY_NOT_STARTED',
          'SHUTTLE_RECOVERY_MESSAGE_MISSING', 'SHUTTLE_RECOVERY_MESSAGE_CHANGED', 'SHUTTLE_MESSAGE_OWNERSHIP',
          'SHUTTLE_MESSAGE_COLLISION', 'SHUTTLE_MESSAGE_UNTRUSTED'].includes(error.code)) return 'shuttle_recovery_rejected';
        if (error instanceof ContractError && ['SHUTTLE_CASE_UNAVAILABLE', 'CASE_POLICY_CHANGED', 'CASE_CHANNEL_MISSING',
          'CASE_CHANNEL_MISMATCH', 'CASE_CHANNEL_ACL_MISMATCH'].includes(error.code)) return 'shuttle_issue_review';
        return failure(error);
      }
    },
    async queue(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      try {
        const actor = await principal(envelope);
        requireCondition(envelope.command === 'shuttle.issues', 'OPERATION_DENIED');
        const result = await store.listOnboardingDeliveryIssues({ actor, guildId: envelope.guildId, after: envelope.after ?? null });
        if (await enabled() !== true) return { state: 'disabled' };
        return result;
      } catch (error) { return { state: failure(error) }; }
    },
  });
}
