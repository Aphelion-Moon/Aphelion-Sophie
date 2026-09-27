import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';

/** Core-only transient event. Embedded replies/forwards and attachments never become AI context. */
export function createAiIngress({ guildId, botUserId, clock }) {
  requireId(guildId); requireId(botUserId);
  const proofs = new WeakMap();
  function held(proof) {
    const event = proofs.get(proof); requireCondition(event, 'AI_EVENT_UNTRUSTED');
    requireCondition(clock() >= event.receivedAt && clock() - event.receivedAt < 15000, 'AI_EVENT_EXPIRED'); return event;
  }
  return Object.freeze({ guildId,
    prepare(payload) {
      if (payload.t !== 'MESSAGE_CREATE') return null;
      const raw = payload.d;
      if (raw?.guild_id !== guildId || ![0, 19].includes(raw.type) || raw.author?.bot !== false && raw.author?.bot !== undefined ||
        raw.author?.id === botUserId || raw.webhook_id != null || raw.interaction != null || raw.interaction_metadata != null) return null;
      for (const id of [raw.id, raw.channel_id, raw.author?.id]) requireId(id);
      const proof = Object.freeze({}), receivedAt = clock(); requireInteger(receivedAt);
      proofs.set(proof, { raw, receivedAt }); return proof;
    },
    inspect(proof) { const { raw, receivedAt } = held(proof); return { guildId, channelId: raw.channel_id, userId: raw.author.id, messageId: raw.id, receivedAt }; },
    content(proof) {
      const { raw } = held(proof);
      // No embedded snapshot attribution shortcut; no fetching references or URLs to fill missing content.
      if (raw.message_snapshots?.length || raw.attachments?.length || raw.message_reference?.channel_id && raw.message_reference.channel_id !== raw.channel_id) return null;
      const text = raw.content;
      if (typeof text !== 'string' || text.length === 0 || text.length > 4000 || !text.isWellFormed()) return null;
      // Links to Discord content are outside this initial source contract, including known ticket references.
      if (/https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/(?:channels|api\/webhooks)\//iu.test(text)) return null;
      const mentioned = Array.isArray(raw.mentions) && raw.mentions.some(item => item.id === botUserId);
      // Only reference metadata is inspected; quoted message text is never serialized.
      const replied = raw.type === 19 && raw.message_reference?.channel_id === raw.channel_id && raw.referenced_message?.author?.id === botUserId;
      const directedToOther = Array.isArray(raw.mentions) && raw.mentions.some(item => item.id !== botUserId);
      return { text, addressed: mentioned || replied, directedToOther, inputRevision: raw.edited_timestamp ?? 'original' };
    },
    discard: proof => proofs.delete(proof),
  });
}
