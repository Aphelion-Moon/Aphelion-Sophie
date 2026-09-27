import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireId } from '../../contracts/validation.js';

/** Persistent navigation only; never copy a case title, category, answer or transcript. */
export function ticketDirectNotice(guildId, channelId, text = defaultSystemText) {
  requireId(guildId); requireId(channelId);
  return { content: text('tickets.dm', { link: `https://discord.com/channels/${guildId}/${channelId}` }),
    embeds: [], components: [], flags: 4, allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } };
}
