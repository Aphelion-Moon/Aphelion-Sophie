import { requireCondition, requireId } from '../../../contracts/validation.js';
import { validateAiMessagePayload } from '../../../modules/assistant/output.js';

/** A held request is already bound to core-owned scope. The current guard runs again before every effect. */
export function createAiMessages({ transport, botUserId, revalidate, canReact, effects, clock }) {
  requireId(botUserId);
  requireCondition(effects && ['claim','begin','note','cleanup','removed'].every(name => typeof effects[name] === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
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
    async reply(request, payload, history = [], sources = []) {
      validateAiMessagePayload(payload); await current(request);
      const held = await effects.claim(request, 'reply', null, history, sources);
      await current(request); await effects.begin(held); await current(request);
      const response = await transport.createAiMessage(request.channelId, request.messageId, payload, request.deadline);
      requireId(response?.id);
      requireCondition(response.channel_id === request.channelId && response.author?.id === botUserId && response.author.bot === true, 'AI_DELIVERY_UNCERTAIN');
      return effects.note(held, response.id);
    },
    async react(request, emoji, history = [], sources = []) {
      requireCondition(emoji && await canReact(request, emoji) === true, 'AI_REACTION_UNAVAILABLE'); await current(request);
      const held = await effects.claim(request, 'react', emoji, history, sources);
      await current(request); await effects.begin(held); await current(request);
      await transport.createAiReaction(request.channelId, request.messageId, emoji, request.deadline);
      return effects.note(held, emoji.key);
    },
    async remove(request, effect) {
      const owned = await effects.cleanup(effect);
      requireCondition(owned.guild_id === request.guildId && owned.channel_id === request.channelId, 'AI_EFFECT_UNTRUSTED');
      // Exact known artifact cleanup reads no message body and never changes channel access.
      if (owned.kind === 'reply') await transport.deleteAutomationMessage(owned.channel_id, owned.receipt_id);
      else await transport.deleteAutomationReaction(owned.channel_id, owned.message_id, { kind: 'reaction', emoji: { id: owned.emoji.id, name: owned.emoji.name } });
      await effects.removed(effect);
    },
  });
}
