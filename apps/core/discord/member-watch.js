import { ContractError, requireCondition } from '../../../contracts/validation.js';

const DENIED = Object.freeze(['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'CAPABILITY_REVOKED', 'FOREIGN_GUILD', 'CASE_ACCESS_DENIED']);

/**
 * `/member watch member: on:` (owner direction, 30 October 2026: "All staff can use the member watch command"): Staff and
 * Lead Ops turn the Watch tag on a member's record post on or off. The same check as `/whitelist progress` (case.manage for
 * Shuttle assistance, which Staff and Lead Ops hold), so no capability policy changes; one actor observation. The change is
 * an entry in the record naming who made it, and core applies the tag. Nothing about the member's roles or access changes.
 * No AI.
 */
export function createMemberWatch({ authorization, store, guildId, enabled }) {
  requireCondition(typeof authorization?.resolveActor === 'function' && typeof authorization.authorize === 'function' &&
    typeof store?.setWatch === 'function' && typeof enabled === 'function' && typeof guildId === 'string', 'TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await authorization.resolveActor(envelope);
        requireCondition(envelope.command === 'member.watch' && envelope.guildId === guildId && envelope.targetId === envelope.userId &&
          typeof envelope.watch === 'boolean', 'OPERATION_DENIED');
        requireCondition(await authorization.authorize('case.manage', actor, { guildId, type: 'shuttle', openerId: actor.userId }) === true, 'OPERATION_DENIED');
        const result = await store.setWatch({ userId: envelope.subjectId, watch: envelope.watch, by: actor.userId, interactionId: envelope.interactionId });
        return result === 'missing' ? 'member_watch_missing' : envelope.watch ? 'member_watch_on' : 'member_watch_off';
      } catch (error) {
        if (error instanceof ContractError && DENIED.includes(error.code)) return 'denied';
        throw error;
      }
    },
  });
}
