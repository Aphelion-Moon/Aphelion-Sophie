import { requireCondition, requireId } from '../../../contracts/validation.js';

/**
 * The station board and boarding pass at the end of the Shuttle Activity (owner decision of 22 October 2026): the
 * server's approximate crew and online counts, and, for the signed-in member only, their own display name and the date
 * they joined. Read from Discord by core, kept in memory briefly, never stored or logged. Read-only; no AI.
 */
export function createActivityStation({ transport, guildId, clock, countsMs = 300_000, passMs = 60_000 }) {
  requireId(guildId);
  requireCondition(typeof transport?.getGuildCounts === 'function' && typeof transport.getMember === 'function' && typeof clock === 'function',
    'TRUSTED_ADAPTERS_REQUIRED');
  let counts = null, counting = null;
  const passes = new Map();
  // One read of the counts at a time: members arriving while it is under way share it.
  async function readCounts() {
    const guild = await transport.getGuildCounts();
    requireCondition(guild?.id === guildId, 'DISCORD_RESPONSE_INVALID');
    counts = { at: clock(), value: Object.freeze({ crew: tally(guild.approximate_member_count), online: tally(guild.approximate_presence_count) }) };
    return counts.value;
  }
  const tally = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return Object.freeze({
    /** { crew, online }: approximate member and presence counts, each null when Discord does not say. */
    async station() {
      if (counts && clock() - counts.at < countsMs) return counts.value;
      counting ??= readCounts().finally(() => { counting = null; });
      return counting;
    },
    /** The member's own pass: { name, joined } (joined as YYYY-MM-DD, or null), or null if they are not in the server. */
    async pass(userId) {
      requireId(userId);
      const kept = passes.get(userId);
      if (kept && clock() - kept.at < passMs) return kept.value;
      const member = await transport.getMember(userId);
      const name = member?.nick ?? member?.user?.global_name ?? member?.user?.username;
      const joined = typeof member?.joined_at === 'string' && Number.isFinite(Date.parse(member.joined_at)) ? new Date(member.joined_at).toISOString().slice(0, 10) : null;
      const value = typeof name === 'string' && name.trim() ? Object.freeze({ name: [...name.trim()].slice(0, 32).join(''), joined }) : null;
      if (passes.size >= 256) passes.clear();
      passes.set(userId, { at: clock(), value });
      return value;
    },
  });
}
