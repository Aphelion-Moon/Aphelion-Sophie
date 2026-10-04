import { requireCondition } from '../../../contracts/validation.js';

/** Shared Staff operations. Receipt preflight precedes external observations and opaque proofs. */
export function createOnboardingStaffOperations({ store, discord, channels, screenMessages, alertMessages, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const active = async () => requireCondition(await enabled() === true, 'SHUTTLE_STAFF_DISABLED');
  return Object.freeze({
    async resolve(request) {
      await active(); const source = await store.describeOnboardingHelp(request);
      if (source.duplicate) { await active(); return { recorded: true, duplicate: true, resumed: source.resumed }; }
      const observation = await discord.observe(source.userId); await active();
      const result = await store.resolveOnboardingHelp({ ...request, observation });
      await store.describeOnboardingHelp(request); await active(); return { recorded: true, ...result };
    },
    async repair(request) {
      await active(); const source = await store.describeOnboardingDeliveryIssue(request);
      if (source.duplicate) { await active(); return { recorded: true, duplicate: true }; }
      const recovery = request.action === 'adopt_message', selection = request.action === 'select_channel';
      requireCondition(['recheck', 'adopt_message', 'select_channel'].includes(request.action), 'SHUTTLE_RECOVERY_KIND_INVALID');
      if (recovery) requireCondition(['shuttle.render', 'shuttle.alert'].includes(source.kind), 'SHUTTLE_RECOVERY_KIND_INVALID');
      if (selection) requireCondition(source.kind === 'case.provision' && source.candidateIds.includes(request.resultId), 'SHUTTLE_CHANNEL_CHOICE_INVALID');
      const proof = source.kind === 'whitelist.grant' || recovery || selection ? await channels.inspect(source.plan, selection ? request.resultId : source.channelId) : null;
      let message = null;
      if (recovery) {
        const adapter = source.kind === 'shuttle.render' ? screenMessages : alertMessages;
        requireCondition(typeof adapter?.inspect === 'function', 'SHUTTLE_VERIFIER_REQUIRED');
        message = await adapter.inspect({ plan: source.plan, channelId: source.channelId, messageId: request.resultId,
          ...(source.kind === 'shuttle.render' ? { screenId: source.recordId } : { alertId: source.recordId }) });
      }
      const observation = await discord.observe(source.userId); await active();
      const apply = recovery ? store.recoverOnboardingMessage : selection ? store.chooseOnboardingChannel : store.recheckOnboardingDeliveryIssue;
      const result = await apply({ ...request, observation, proof, message });
      await store.describeOnboardingDeliveryIssue(request); await active(); return { recorded: true, ...result };
    },
  });
}
