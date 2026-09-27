import { requireCondition, requireId } from '../../../contracts/validation.js';
import { validateAiMessagePayload } from '../../../modules/assistant/output.js';

/** A held request is already bound to core-owned scope. The current guard runs again before every effect. */
export function createAiMessages({ transport, botUserId, revalidate, canReact, clock }) {
  requireId(botUserId);
  const effects = new WeakMap();
  async function current(request) {
    requireCondition(await revalidate(request) === true && clock() < request.deadline, 'AI_DELIVERY_REVOKED');
  }
  return Object.freeze({
    async typing(request) {
      requireCondition(request.profile.typing && !request.decision.proactive && request.decision.outcomes.includes('reply'), 'AI_TYPING_UNAVAILABLE');
      await current(request);
      // One short indicator, no queued refresh loop or promise that a reply will be delivered.
      await transport.indicateAiTyping(request.channelId, Math.min(request.deadline, clock() + 1000));
    },
    async reply(request, payload) {
      validateAiMessagePayload(payload); await current(request);
      const response = await transport.createAiMessage(request.channelId, request.messageId, payload, request.deadline);
      requireId(response?.id);
      requireCondition(response.channel_id === request.channelId && response.author?.id === botUserId && response.author.bot === true, 'AI_DELIVERY_UNCERTAIN');
      const effect = Object.freeze({ id: response.id }); effects.set(effect, { kind: 'reply', guildId: request.guildId, channelId: request.channelId, messageId: response.id }); return effect;
    },
    async react(request, emoji) {
      requireCondition(emoji && await canReact(request, emoji) === true, 'AI_REACTION_UNAVAILABLE'); await current(request);
      await transport.createAiReaction(request.channelId, request.messageId, emoji, request.deadline);
      const effect = Object.freeze({ id: emoji.key }); effects.set(effect, { kind: 'react', guildId: request.guildId, channelId: request.channelId, messageId: request.messageId, emoji: { id: emoji.id, name: emoji.name } }); return effect;
    },
    async remove(request, effect) {
      const owned = effects.get(effect);
      requireCondition(owned && owned.guildId === request.guildId && owned.channelId === request.channelId, 'AI_EFFECT_UNTRUSTED');
      // Exact known artifact cleanup reads no message body and never changes channel access.
      if (owned.kind === 'reply') await transport.deleteAutomationMessage(owned.channelId, owned.messageId);
      else await transport.deleteAutomationReaction(owned.channelId, owned.messageId, { kind: 'reaction', emoji: owned.emoji });
      effects.delete(effect);
    },
  });
}
