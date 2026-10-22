import { requireCondition } from '../../../contracts/validation.js';
import { onboardingEntryPanel } from '../../../modules/onboarding/entry-controls.js';
import { activityLaunchPost } from '../../../modules/onboarding/activity-post.js';

/**
 * Public static copy only. The entry panel's button invokes the ordinary signed self-service entry; the Activity
 * launch post's button only asks Discord to open the Activity, which signs in and checks access itself.
 */
export function createOnboardingEntryPanel({ authorization, transport, store, policy, definitionId, enabled, readSystemText }) {
  return Object.freeze({ async prepare(envelope, { isCurrent }) {
    requireCondition(['shuttle.panel', 'shuttle.post'].includes(envelope.command) && envelope.guildId === policy.guildId, 'OPERATION_DENIED');
    const actor = await authorization.resolveActor(envelope);
    const authorize = async () => requireCondition(await enabled() && isCurrent() &&
      await authorization.authorize('shuttle.publish', actor, { guildId: policy.guildId, definitionId }), 'OPERATION_DENIED');
    await authorize();
    const channel = await transport.getChannel(envelope.channelId);
    requireCondition(channel?.id === envelope.channelId && channel.guild_id === policy.guildId && channel.type === 0 &&
      channel.parent_id !== policy.categoryId && (!Object.hasOwn(policy, 'shuttleCategoryId') || channel.parent_id !== policy.shuttleCategoryId), 'OPERATION_DENIED');
    requireCondition(!await store.hasCaseExclusion({ guildId: policy.guildId, lineage: [channel.id, ...(channel.parent_id ? [channel.parent_id] : [])] }), 'OPERATION_DENIED');
    const text = await readSystemText(), data = envelope.command === 'shuttle.post' ? activityLaunchPost(text) : onboardingEntryPanel(text);
    await authorize();
    return data;
  } });
}
