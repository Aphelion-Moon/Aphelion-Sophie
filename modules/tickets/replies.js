import { requireCondition, requireId, requireKeys } from '../../contracts/validation.js';

export const requireReplyId = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'INVALID_CASE_REPLY');
export function caseReplyCommandOption(reference) {
  return { type: 1, name: 'reply', description: 'Send your reviewed reply to all current readers of a private case.', options: [
    { ...reference },
    { type: 3, name: 'text', description: 'Your human-written reply, visible to all current case readers. Never use for Staff notes.', required: true, min_length: 1, max_length: 4000 },
    { type: 5, name: 'confirm', description: 'Confirm you reviewed this text and case, and want to send it to all current readers.', required: true },
  ] };
}
export function replyMarker(id) { requireReplyId(id); return `sophie:staff-reply:v1:${id}`; }
export function requireReplyText(text) {
  requireCondition(typeof text === 'string' && text.length >= 1 && text.length <= 4000 && text.trim().length > 0 &&
    text.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text), 'INVALID_CASE_REPLY');
}

/** Exact human-authored text, separate from restricted notes. The trusted store supplies the author. */
export function renderCaseReply({ id, authorId, text }) {
  requireReplyId(id); requireId(authorId); requireReplyText(text);
  return { content: '', embeds: [{ title: `Staff reply · user ${authorId}`, description: text, footer: { text: replyMarker(id) } }],
    components: [], allowed_mentions: { parse: [], roles: [], users: [], replied_user: false } };
}

export function validateCaseReplyPayload(value, id) {
  requireReplyId(id); requireKeys(value, ['content', 'embeds', 'components', 'allowed_mentions']);
  const mentions = value.allowed_mentions; requireKeys(mentions, ['parse', 'roles', 'users', 'replied_user']);
  requireCondition(['parse', 'roles', 'users'].every(key => Array.isArray(mentions[key]) && mentions[key].length === 0) &&
    mentions.replied_user === false && value.content === '' && Array.isArray(value.components) && value.components.length === 0 &&
    Array.isArray(value.embeds) && value.embeds.length === 1, 'INVALID_CASE_REPLY');
  const embed = value.embeds[0]; requireKeys(embed, ['title', 'description', 'footer']); requireKeys(embed.footer, ['text']);
  const author = typeof embed.title === 'string' && /^Staff reply · user (\d+)$/.exec(embed.title);
  requireCondition(author && embed.footer.text === replyMarker(id), 'INVALID_CASE_REPLY');
  requireId(author[1]); requireReplyText(embed.description);
}
