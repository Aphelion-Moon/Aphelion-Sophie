import { requireId } from '../../../contracts/validation.js';

/**
 * Shared current non-case text-channel check. Returns metadata only, never messages. `exceptions` (AI only; owner decision of
 * 23 October 2026) names exact channels Sophie's AI may use although they sit in the protected category: the category itself,
 * every other channel in it, and any channel Sophie's own case records exclude stay refused.
 */
export async function inspectAutomationChannel(client,{guildId,protectedCategoryId,channels,channelId,exceptions=[]}) {
  requireId(channelId); exceptions.forEach(requireId);
  const excepted = exceptions.includes(channelId);
  const excluded = async ids => (await client.query(`SELECT 1 FROM sophie_core.case_exclusions
    WHERE guild_id = $1 AND channel_id = ANY($2::text[]) LIMIT 1`,[guildId,ids])).rowCount > 0;
  if (channelId === protectedCategoryId || await excluded([channelId])) return null;
  const channel = await channels.inspect(channelId);
  if (!channel || channel.id !== channelId || channel.guildId !== guildId || channel.type !== 0 || channel.parentId === protectedCategoryId && !excepted) return null;
  if (channel.parentId !== null) requireId(channel.parentId);
  if (await excluded([channelId,...(channel.parentId === null || excepted ? [] : [channel.parentId])])) return null;
  return channel;
}
