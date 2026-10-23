import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { onboardingEntryPanel } from '../../../modules/onboarding/entry-controls.js';
import { activityLaunchPost } from '../../../modules/onboarding/activity-post.js';

const NO_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], replied_user: false });

/**
 * Public static copy only. The entry panel's button invokes the ordinary signed self-service entry; the Activity
 * launch post's button only asks Discord to open the Activity, which signs in and checks access itself.
 *
 * The Activity launch post is Sophie's own message in the channel, not a reply to the command (owner's pick of 24
 * October 2026: no "used /whitelist post" line), sent only after every check; the command gets a private answer either
 * way. A post Discord refuses (no access to the channel) is reported, never retried. mediaOrigin is the Activity host that
 * serves the post's art images (null: the art goes as code blocks).
 */
export function createOnboardingEntryPanel({ authorization, transport, store, policy, definitionId, enabled, readSystemText, commands = ['shuttle.panel', 'shuttle.post'],
  nonce = () => randomBytes(12).toString('hex'), mediaOrigin = null }) {
  requireCondition(Array.isArray(commands) && commands.length > 0 && commands.every(command => ['shuttle.panel', 'shuttle.post'].includes(command)), 'TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({ async prepare(envelope, { isCurrent }) {
    requireCondition(commands.includes(envelope.command) && envelope.guildId === policy.guildId, 'OPERATION_DENIED');
    const actor = await authorization.resolveActor(envelope);
    const authorize = async () => requireCondition(await enabled() && isCurrent() &&
      await authorization.authorize('shuttle.publish', actor, { guildId: policy.guildId, definitionId }), 'OPERATION_DENIED');
    await authorize();
    const channel = await transport.getChannel(envelope.channelId);
    requireCondition(channel?.id === envelope.channelId && channel.guild_id === policy.guildId && channel.type === 0 &&
      channel.parent_id !== policy.categoryId && (!Object.hasOwn(policy, 'shuttleCategoryId') || channel.parent_id !== policy.shuttleCategoryId), 'OPERATION_DENIED');
    requireCondition(!await store.hasCaseExclusion({ guildId: policy.guildId, lineage: [channel.id, ...(channel.parent_id ? [channel.parent_id] : [])] }), 'OPERATION_DENIED');
    const text = await readSystemText();
    if (envelope.command !== 'shuttle.post') { const data = onboardingEntryPanel(text); await authorize(); return data; }
    const post = activityLaunchPost(text, { mediaOrigin });
    await authorize();
    let posted = true;
    try { await transport.createActivityPost(channel.id, nonce(), post); } catch { posted = false; }
    return { content: text(posted ? 'activity.post.posted' : 'activity.post.not_posted'), flags: 64, allowed_mentions: NO_MENTIONS };
  } });
}
