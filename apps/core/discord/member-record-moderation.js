import { requireCondition, requireName } from '../../../contracts/validation.js';

/**
 * The game moderation feed (owner direction, 2 November 2026): every 15 minutes, when core starts and after, it reads the
 * game servers' bans, notes and admin help tickets from the central identity database (reads only) and enters what is new
 * or changed in the members' records; core then posts the entries as usual, behind live work. It never calls Discord
 * itself. A failed read is tried again in a minute and changes nothing.
 */
export function createMemberRecordModerationFeed({ store, central, enabled, clock, intervalMs = 15 * 60_000 }) {
  requireCondition(typeof store?.enterModeration === 'function' && typeof central?.readModerationRecords === 'function' && typeof enabled === 'function' &&
    typeof clock === 'function' && Number.isSafeInteger(intervalMs) && intervalMs >= 60_000, 'TRUSTED_ADAPTERS_REQUIRED');
  let nextAt = 0;
  return Object.freeze({
    async runDue(owner) {
      requireName(owner);
      if (clock() < nextAt) return { status: 'idle' };
      if (await enabled() !== true) return { status: 'disabled' };
      nextAt = clock() + 60_000;
      try {
        const rows = await central.readModerationRecords();
        const { entered, changed, skipped } = await store.enterModeration(rows);
        nextAt = clock() + intervalMs;
        return { status: 'fed', read: rows.length, entered, changed, skipped };
      } catch (error) {
        return { status: 'failed', code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? error.code : 'MEMBER_RECORD_MODERATION_FAILED' };
      }
    },
  });
}
