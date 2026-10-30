import { requireId } from '../../../contracts/validation.js';

const isId = value => typeof value === 'string' && /^[1-9][0-9]{16,19}$/u.test(value);
const text = (value, max) => typeof value === 'string' && value.isWellFormed() ? value.replace(/\0/gu, '').slice(0, max) : null;
const time = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isSafeInteger(at) && at > 0 ? at : null; };

/**
 * The Gateway's part in member records (owner decisions, 30 October 2026): from a member change, who and what roles and
 * names; from a message, the fields of the Staff discussion copy. Everything else in the payload is dropped here. Whether a
 * message belongs to a record post is decided in storage, so messages anywhere else are discarded there, unread. Core
 * only; no AI sees any of it.
 */
export function createMemberRecordIngress({ guildId }) {
  requireId(guildId);
  return Object.freeze({
    guildId,
    prepare(payload) {
      const type = payload?.t, raw = payload?.d;
      if (raw === null || typeof raw !== 'object' || raw.guild_id !== guildId) return null;
      if (['GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE', 'GUILD_MEMBER_REMOVE'].includes(type)) {
        if (!isId(raw.user?.id)) return null;
        const present = type !== 'GUILD_MEMBER_REMOVE';
        const roleIds = present && Array.isArray(raw.roles) ? raw.roles.filter(isId).slice(0, 500) : [];
        return Object.freeze({ kind: 'member', type, userId: raw.user.id, bot: raw.user.bot === true, present, roleIds,
          username: text(raw.user.username, 64), globalName: text(raw.user.global_name, 64), nick: present ? text(raw.nick, 64) : null,
          joinedAtMs: present ? time(raw.joined_at) : null });
      }
      if (type === 'MESSAGE_CREATE' || type === 'MESSAGE_UPDATE') {
        // An edit without content (a link preview arriving) changes nothing Staff wrote.
        if (!isId(raw.channel_id) || !isId(raw.id) || typeof raw.content !== 'string') return null;
        const attachments = Array.isArray(raw.attachments) ? raw.attachments.slice(0, 10).map(item => ({ filename: text(item?.filename, 200),
          contentType: text(item?.content_type, 100), size: Number.isSafeInteger(item?.size) ? item.size : null })) : [];
        return Object.freeze({ kind: 'message', type, channelId: raw.channel_id, messageId: raw.id, authorId: isId(raw.author?.id) ? raw.author.id : null,
          authorName: text(raw.author?.global_name ?? raw.author?.username, 64), content: raw.content.slice(0, 4_000), attachments,
          messageAtMs: time(raw.edited_timestamp) ?? time(raw.timestamp) });
      }
      if (type === 'MESSAGE_DELETE' || type === 'MESSAGE_DELETE_BULK') {
        const ids = type === 'MESSAGE_DELETE' ? [raw.id] : raw.ids;
        if (!isId(raw.channel_id) || !Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every(isId)) return null;
        return Object.freeze({ kind: 'delete', type, channelId: raw.channel_id, messageIds: [...ids] });
      }
      return null;
    },
  });
}

