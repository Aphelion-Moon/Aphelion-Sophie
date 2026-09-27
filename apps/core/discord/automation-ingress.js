import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';

/** Opaque transient handoff inside core. Content is read only after retained/channel exclusion checks. */
export function createAutomationIngress({guildId,botUserId,clock}) {
  requireId(guildId); requireId(botUserId); requireCondition(typeof clock === 'function','TRUSTED_ADAPTERS_REQUIRED');
  const pending = new WeakMap();
  function read(proof) {
    const saved = pending.get(proof); requireCondition(saved !== undefined,'UNTRUSTED_AUTOMATION_EVENT');
    const now = clock(); requireInteger(now);
    requireCondition(now >= saved.header.observedAt && now - saved.header.observedAt <= 60000,'AUTOMATION_EVENT_EXPIRED');
    return saved;
  }
  return Object.freeze({guildId,
    prepare(payload) {
      if (payload.t !== 'MESSAGE_CREATE') return null;
      const raw = payload.d;
      if (raw?.guild_id !== guildId || ![0,19].includes(raw.type) || raw.author?.bot === true || raw.author?.id === botUserId ||
        raw.webhook_id != null || raw.interaction != null || raw.interaction_metadata != null || (Number.isSafeInteger(raw.flags) && (raw.flags & 64) !== 0)) return null;
      requireId(raw.id); requireId(raw.channel_id); requireId(raw.author?.id);
      requireCondition(raw.author.bot === undefined || raw.author.bot === false,'AUTOMATION_EVENT_INVALID');
      const observedAt = clock(); requireInteger(observedAt);
      const proof = Object.freeze({});
      pending.set(proof,{raw,header:{guildId,channelId:raw.channel_id,messageId:raw.id,userId:raw.author.id,observedAt}});
      return proof;
    },
    inspect: proof => ({...read(proof).header}),
    content(proof) {
      const value = read(proof).raw.content;
      if (typeof value !== 'string' || value.length > 4000 || !value.isWellFormed()) return null;
      return value;
    },
    discard: proof => pending.delete(proof),
  });
}
