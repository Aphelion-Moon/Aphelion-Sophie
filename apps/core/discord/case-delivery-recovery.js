import { requireCondition } from '../../../contracts/validation.js';

/** Shared by signed commands and authenticated HTTP. Only trusted adapters create external proofs. */
export function createCaseDeliveryRecovery({ store, discord, channels, messages, replyMessages = null, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const active = async () => requireCondition(await enabled() === true, 'CASE_RECOVERY_DISABLED');
  return Object.freeze({ async change(request) {
    await active();
    // A committed receipt must be resolved before inspecting a now-advanced message part.
    const source = await store.describeCaseDeliveryIssue(request);
    if (source.duplicate) { await active(); return { recorded: true, duplicate: true }; }
    const { action, resultId } = request;
    requireCondition(action !== 'adopt_message' || (['case.intake', 'case.reply'].includes(source.kind) && source.recordId !== null), 'CASE_RECOVERY_NOT_STARTED');
    requireCondition(action !== 'select_channel' || (source.kind === 'case.provision' && source.candidateIds.includes(resultId)), 'SHUTTLE_CHANNEL_CHOICE_INVALID');
    const proof = source.kind === 'case.intake' || action === 'select_channel' || (source.kind === 'case.reply' && action === 'adopt_message') ?
      await channels.inspect(source.plan, action === 'select_channel' ? resultId : source.channelId) : null;
    const reader = source.kind === 'case.reply' ? replyMessages : messages;
    requireCondition(action !== 'adopt_message' || typeof reader?.inspect === 'function', 'CASE_RECOVERY_NOT_STARTED');
    const message = action === 'adopt_message' ? await reader.inspect({ plan: source.plan, channelId: source.channelId, recordId: source.recordId, messageId: resultId }) : null;
    const observation = await discord.observe(source.userId); await active();
    const result = await store.changeCaseDeliveryIssue({ ...request, observation, proof, message });
    // The receipt remains repeatable if access or the delivery gate changes after commit.
    await store.describeCaseDeliveryIssue(request); await active();
    return { recorded: true, duplicate: result.duplicate };
  } });
}
