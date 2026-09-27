import { requireCondition } from '../../../contracts/validation.js';
import { onboardingEntryPanel } from '../../../modules/onboarding/entry-controls.js';

/** Public static copy only. The button invokes the ordinary signed self-service entry. */
export function createOnboardingEntryPanel({ authorization, transport, store, policy, definitionId, enabled, readSystemText }) {
  return Object.freeze({ async prepare(envelope, { isCurrent }) {
    requireCondition(envelope.command === 'shuttle.panel' && envelope.guildId === policy.guildId, 'OPERATION_DENIED');
    const actor = await authorization.resolveActor(envelope);
    const authorize = async () => requireCondition(await enabled() && isCurrent() &&
      await authorization.authorize('shuttle.publish', actor, { guildId: policy.guildId, definitionId }), 'OPERATION_DENIED');
    await authorize();
    const channel = await transport.getChannel(envelope.channelId);
    requireCondition(channel?.id === envelope.channelId && channel.guild_id === policy.guildId && channel.type === 0 &&
      channel.parent_id !== policy.categoryId, 'OPERATION_DENIED');
    requireCondition(!await store.hasCaseExclusion({ guildId: policy.guildId, lineage: [channel.id, ...(channel.parent_id ? [channel.parent_id] : [])] }), 'OPERATION_DENIED');
    const data = onboardingEntryPanel(await readSystemText());
    await authorize();
    return data;
  } });
}
