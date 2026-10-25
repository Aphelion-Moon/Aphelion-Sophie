import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';

const DENIED = Object.freeze(['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'CAPABILITY_REVOKED', 'FOREIGN_GUILD', 'CASE_ACCESS_DENIED']);
// A member read overtaken by a change to that member passes in moments; it is read once more.
const OVERTAKEN = Object.freeze(['OBSERVATION_INVALIDATED', 'OBSERVATION_UNAVAILABLE', 'OBSERVATION_OUT_OF_ORDER']);

/**
 * `/whitelist progress member:` (owner request, 25 October 2026): Staff and Lead Ops check where a member is in the
 * Shuttle. The same check as `/whitelist queue` (case.manage for Shuttle assistance), so no capability policy changes. One
 * actor observation and one read of the member (owner decision of 24 October 2026: check each step once); the view is
 * kept for this interaction's reply only. Reads only: nothing about the member or their run changes. No AI.
 */
export function createShuttleProgress({ authorization, discord, read, enabled, clock }) {
  requireCondition(typeof authorization?.resolveActor === 'function' && typeof authorization.authorize === 'function' &&
    typeof discord?.observe === 'function' && typeof read === 'function' && typeof enabled === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const views = new WeakMap();
  async function observe(userId) {
    for (let tries = 1; ; tries++) {
      try { return await discord.observe(userId); }
      catch (error) { if (tries >= 2 || !(error instanceof ContractError) || !OVERTAKEN.includes(error.code)) throw error; }
    }
  }
  async function build(envelope) {
    const actor = await authorization.resolveActor(envelope);
    requireCondition(envelope.command === 'shuttle.progress' && envelope.guildId === discord.guildId && envelope.targetId === envelope.userId, 'OPERATION_DENIED');
    requireCondition(await authorization.authorize('case.manage', actor, { guildId: envelope.guildId, type: 'shuttle', openerId: actor.userId }) === true, 'OPERATION_DENIED');
    requireId(envelope.subjectId);
    const member = await observe(envelope.subjectId);
    const { run, grant } = await read(envelope.guildId, envelope.subjectId);
    return { state: 'ready', userId: envelope.subjectId, member: { present: member.present, crew: member.crew, muzzled: member.muzzled, whitelist: member.whitelist },
      run, grant, now: clock() };
  }
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      let view;
      try { view = await build(envelope); }
      catch (error) { view = { state: error instanceof ContractError && DENIED.includes(error.code) ? 'denied' : 'unavailable' }; }
      views.set(envelope, view);
      return 'shuttle_progress';
    },
    /** The view execute made for this interaction. */
    async view(envelope) { return views.get(envelope) ?? { state: 'unavailable' }; },
  });
}
