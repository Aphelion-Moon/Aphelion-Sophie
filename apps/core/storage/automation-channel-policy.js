import { requireId } from '../../../contracts/validation.js';

/** Shared current non-case text-channel check. Returns metadata only, never messages. */
export async function inspectAutomationChannel(client,{guildId,protectedCategoryId,channels,channelId}) {
  requireId(channelId);
  const excluded = async ids => (await client.query(`SELECT 1 FROM sophie_core.case_exclusions
    WHERE guild_id = $1 AND channel_id = ANY($2::text[]) LIMIT 1`,[guildId,ids])).rowCount > 0;
  if (channelId === protectedCategoryId || await excluded([channelId])) return null;
  const channel = await channels.inspect(channelId);
  if (!channel || channel.id !== channelId || channel.guildId !== guildId || channel.type !== 0 || channel.parentId === protectedCategoryId) return null;
  if (channel.parentId !== null) requireId(channel.parentId);
  if (await excluded([channelId,...(channel.parentId === null ? [] : [channel.parentId])])) return null;
  return channel;
}
