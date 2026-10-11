import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { memberMemoryForInference } from '../../../modules/assistant/preferences.js';

/**
 * Trusted core read for the requester's own turn. It returns only what that member saved and chose to share,
 * has no write path, and never reads another member's record.
 */
export function createAiMemory({ pool, guildId, journal, clock = Date.now }) {
  requireId(guildId);
  requireCondition(pool && typeof pool.query === 'function' && typeof journal?.read === 'function' && typeof clock === 'function','TRUSTED_ADAPTERS_REQUIRED');
  async function read(userId) {
    requireId(userId);
    const row = (await pool.query('SELECT epoch,settings,expires_at FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2',[guildId,userId])).rows[0];
    const watermark = await journal.read(guildId,userId), epoch = Number(row?.epoch ?? 0);
    requireInteger(watermark); requireInteger(epoch);
    // A record that disagrees with its independent watermark may be a restored copy of deleted notes.
    if (epoch !== watermark || !row?.settings || !(row.expires_at instanceof Date) || row.expires_at.getTime() <= clock()) return null;
    const shared = memberMemoryForInference(row.settings);
    return shared === null ? null : Object.freeze({ epoch, ...shared });
  }
  return Object.freeze({
    read,
    /** A turn prepared with saved notes may proceed only while that exact saved version is still current. */
    async current(userId, saved) {
      if (saved === null) return true;
      const latest = await read(userId);
      return latest !== null && latest.epoch === saved.epoch;
    },
  });
}
