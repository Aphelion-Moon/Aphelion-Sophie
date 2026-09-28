import { requireCondition } from '../../../contracts/validation.js';

/** Transient core-owned handoff after journal commit; AI never blocks the Gateway/admin lane. */
export function createAiGateway({ ingress, turns, onFault }) {
  requireCondition(typeof onFault === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const reserved = new Map(), pending = new Set(); let stopped = false;
  return Object.freeze({
    prepare(payload) {
      if (stopped) return null;
      const raw = payload.d;
      if (raw?.guild_id !== ingress.guildId && raw?.id !== ingress.guildId) return null;
      // No content inspection. Audience changes retire the entire temporary context.
      const edit=payload.t==='MESSAGE_UPDATE' ? {channelId:raw.channel_id,messageId:raw.id}:null;
      if(edit && turns.prepareEdit?.(edit)!==true){turns.invalidate(edit);return null;}
      if (payload.t==='MESSAGE_DELETE') turns.invalidate({ channelId: raw.channel_id, messageId: raw.id });
      else if (payload.t === 'MESSAGE_DELETE_BULK') turns.invalidate({ channelId: raw.channel_id });
      else if (/^(?:CHANNEL_|THREAD_|GUILD_ROLE_|GUILD_MEMBER_|GUILD_UPDATE|GUILD_DELETE)/u.test(payload.t)) turns.invalidate();
      if (reserved.size + pending.size >= 4) {if(edit)turns.invalidate(edit);return null;}
      const proof = ingress.prepare(payload);
      if (proof !== null) reserved.set(proof,edit);else if(edit)turns.invalidate(edit);
      return proof;
    },
    committed(proof, accepted) {
      if (proof === null || !reserved.has(proof)) return;
      const edit=reserved.get(proof);reserved.delete(proof);
      if (stopped || !accepted) { if(edit)turns.invalidate(edit);ingress.discard(proof); return; }
      const work = Promise.resolve().then(() => edit ? turns.edit(proof,edit):turns.handle(proof)).catch(() => {if(edit)turns.invalidate(edit);onFault('AI_TURN_UNAVAILABLE');})
        .finally(() => { pending.delete(work); ingress.discard(proof); });
      pending.add(work);
    },
    invalidate() { turns.invalidate(); },
    async stop() {
      stopped = true; for (const proof of reserved.keys()) ingress.discard(proof); reserved.clear();
      await turns.stop(); await Promise.allSettled([...pending]);
    },
  });
}
