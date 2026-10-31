import { requireCondition, requireName } from '../../../contracts/validation.js';

/**
 * The games feed (owner direction, 31 October 2026): every 15 minutes, when core starts and after, it reads the members'
 * linked game accounts and character names from the central identity database (reads only) and stores what changed in
 * their records; core then edits each post's games message as usual, behind live work. It never calls Discord itself.
 * A failed read is tried again in a minute and changes nothing.
 */
export function createMemberRecordGamesFeed({ store, central, enabled, clock, intervalMs = 15 * 60_000 }) {
  requireCondition(typeof store?.setGames === 'function' && typeof central?.readGameRecords === 'function' && typeof enabled === 'function' &&
    typeof clock === 'function' && Number.isSafeInteger(intervalMs) && intervalMs >= 60_000, 'TRUSTED_ADAPTERS_REQUIRED');
  let nextAt = 0;
  return Object.freeze({
    async runDue(owner) {
      requireName(owner);
      if (clock() < nextAt) return { status: 'idle' };
      if (await enabled() !== true) return { status: 'disabled' };
      nextAt = clock() + 60_000;
      try {
        const byUser = await central.readGameRecords();
        const { changed } = await store.setGames(byUser);
        nextAt = clock() + intervalMs;
        return { status: 'fed', linked: byUser.size, changed };
      } catch (error) {
        return { status: 'failed', code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : 'MEMBER_RECORD_GAMES_FAILED' };
      }
    },
  });
}
