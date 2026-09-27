import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireKeys } from '../../contracts/validation.js';

/** Fixed Discord destinations only. These links do not confer case or role permissions. */
export function onboardingNavigationReply(view, text = defaultSystemText) {
  requireCondition(view !== null && typeof view === 'object', 'INVALID_SHUTTLE_DESTINATION');
  if (view.state === 'ready') {
    requireKeys(view, ['state', 'guildId', 'channelId']); requireId(view.guildId); requireId(view.channelId);
    return { content: text('onboarding.navigation.ready'), components: [{ type: 1, components: [{ type: 2, style: 5,
      label: text('onboarding.open'), url: `https://discord.com/channels/${view.guildId}/${view.channelId}` }] }] };
  }
  requireKeys(view, ['state']);
  requireCondition(['preparing', 'disabled', 'denied', 'unavailable'].includes(view.state), 'INVALID_SHUTTLE_DESTINATION');
  if (view.state === 'preparing') return { content: text('onboarding.navigation.preparing'), components: [] };
  const messages = { disabled: text('reply.disabled'),
    denied: text('reply.denied'),
    unavailable: text('onboarding.navigation.unavailable') };
  return { content: messages[view.state], components: [] };
}
