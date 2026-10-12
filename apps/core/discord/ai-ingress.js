import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { redactAiIdentifiers } from '../../knowledge-worker/redaction.js';
import { namedAddress, questionCandidate } from '../../../modules/assistant/participation.js';

/** Core-only transient event. Embedded replies/forwards and attachments never become AI context. */
export function createAiIngress({ guildId, botUserId, clock }) {
  requireId(guildId); requireId(botUserId);
  const proofs = new WeakMap(), flood = new Map();
  function held(proof) {
    const event = proofs.get(proof); requireCondition(event, 'AI_EVENT_UNTRUSTED');
    requireCondition(clock() >= event.receivedAt && clock() - event.receivedAt < 15000, 'AI_EVENT_EXPIRED'); return event;
  }
  return Object.freeze({ guildId,
    prepare(payload) {
      if (!['MESSAGE_CREATE','MESSAGE_UPDATE'].includes(payload.t)) return null;
      const raw = payload.d;
      // Partial edits cannot prove that attachments, mentions and reference metadata remain eligible.
      if (payload.t === 'MESSAGE_UPDATE' && (!Array.isArray(raw?.attachments) || !Array.isArray(raw?.mentions) ||
        typeof raw.edited_timestamp !== 'string' || !Number.isFinite(Date.parse(raw.edited_timestamp)))) return null;
      if (raw?.guild_id !== guildId || ![0, 19].includes(raw.type) || raw.author?.bot !== false && raw.author?.bot !== undefined ||
        raw.author?.id === botUserId || raw.webhook_id != null || raw.interaction != null || raw.interaction_metadata != null) return null;
      for (const id of [raw.id, raw.channel_id, raw.author?.id]) requireId(id);
      const proof = Object.freeze({}), receivedAt = clock(); requireInteger(receivedAt);
      for (const [id, entry] of flood) if (receivedAt - entry.at >= 10000) flood.delete(id);
      const entry = flood.get(raw.author.id) ?? { at:receivedAt, count:0 };
      if (entry.count >= 12 || !flood.has(raw.author.id) && flood.size >= 1000) return null;
      entry.count++; flood.set(raw.author.id,entry);
      proofs.set(proof, { raw, receivedAt, kind:payload.t }); return proof;
    },
    inspect(proof) { const { raw, receivedAt, kind } = held(proof); return { guildId, channelId: raw.channel_id, userId: raw.author.id, messageId: raw.id, receivedAt, kind }; },
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
      const target = raw.message_reference?.message_id ?? null;
      if (target !== null) requireId(target);
      // This runs only after core's metadata/consent admission. Never retain a reverse name map.
      const members = Array.isArray(raw.mentions) ? raw.mentions : [];
      if (members.length > 32) return null;
      const aliases = [raw.author.username, raw.author.global_name, raw.member?.nick,
        ...members.flatMap(member => [member.username, member.global_name])];
      const redacted = redactAiIdentifiers(text, aliases);
      if (redacted.length > 4000) return null;
      // Calling Sophie by name addresses her like a mention or a reply does (owner decision, 12 October 2026).
      return { text: redacted, question: questionCandidate(text), addressed: mentioned || replied || namedAddress(text), directedToOther: directedToOther || raw.type === 19 && !replied,
        conversationTarget: target, inputRevision: raw.edited_timestamp ?? 'original' };
    },
    discard: proof => proofs.delete(proof),
  });
}
