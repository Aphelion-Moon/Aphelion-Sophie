import { requireId } from '../../../contracts/validation.js';

/** Channel metadata only. No message-history or arbitrary route access. */
export function createAutomationChannels({ transport }) {
  return Object.freeze({ async inspect(channelId) {
    requireId(channelId);
    try {
      const row = await transport.getChannel(channelId);
      if (row === null) return null;
      return { id: row.id, guildId: row.guild_id, type: row.type, parentId: row.parent_id ?? null };
    } catch (error) {
      if (['DISCORD_RESOURCE_MISSING','DISCORD_AUTHORIZATION_FAILED'].includes(error.code)) return null;
      throw error;
    }
  } });
}
