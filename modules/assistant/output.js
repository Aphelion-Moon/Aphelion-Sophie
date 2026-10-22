import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { validateMemoryProposals } from './memories.js';
import { AI_REPLY_LIMIT } from './participation.js';

/** A valid schema never establishes factual accuracy. Release evaluation checks the claims themselves. */
export function validateAiOutput(value, { outcomes, answerOnly, sources, emojiKeys, memoryLabels, replyChars = 1600 }) {
  requireCondition(value !== null && typeof value === 'object' && outcomes.includes(value.kind), 'AI_OUTPUT_INVALID');
  // Memories ride along with any outcome, and only when this turn's contract offered member labels to write them with.
  const remembering = memoryLabels !== undefined && Object.hasOwn(value, 'memories');
  const memories = remembering ? validateMemoryProposals(value.memories, memoryLabels) : [];
  const extra = remembering ? ['memories'] : [];
  const withMemories = output => memories.length ? { ...output, memories } : output;
  if (value.kind === 'silent') { requireKeys(value, ['kind', ...extra], 'AI_OUTPUT_INVALID'); return withMemories({ kind: 'silent' }); }
  if (value.kind === 'react') {
    requireKeys(value, ['kind', 'emojiKey', ...extra], 'AI_OUTPUT_INVALID');
    requireCondition(emojiKeys.includes(value.emojiKey), 'AI_OUTPUT_INVALID');
    return withMemories({ kind: 'react', emojiKey: value.emojiKey });
  }
  requireKeys(value, ['kind', 'text', 'purpose', 'support', 'citations', ...extra], 'AI_OUTPUT_INVALID');
  requireCondition(typeof value.text === 'string' && value.text.isWellFormed() && value.text.trim().length > 0 &&
    value.text.length <= Math.min(replyChars, AI_REPLY_LIMIT) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.text), 'AI_OUTPUT_INVALID');
  requireCondition(['answer', 'conversation'].includes(value.purpose) &&
    ['provided_sources', 'current_conversation', 'general_knowledge'].includes(value.support), 'AI_OUTPUT_INVALID');
  requireCondition(Array.isArray(value.citations) && value.citations.length <= 4 &&
    new Set(value.citations).size === value.citations.length && value.citations.every(id => sources.some(source => source.id === id)), 'AI_CITATION_INVALID');
  requireCondition(value.support !== 'provided_sources' || value.citations.length > 0, 'AI_CITATION_INVALID');
  requireCondition(value.support === 'provided_sources' || value.citations.length === 0, 'AI_CITATION_INVALID');
  // Proactive question answers need reviewed supplied evidence. A self-reported confidence number is not a gate.
  if (answerOnly && (value.purpose !== 'answer' || value.support !== 'provided_sources')) return withMemories({ kind: 'silent' });
  const { memories: _proposed, ...reply } = value;
  return withMemories({ ...reply, text: reply.text.trim(), citations: [...reply.citations] });
}

const EMBED_TEXT = 4_000, EMBED_TOTAL = 6_000;
/**
 * A long reply's text in at most two embed descriptions of one message, split at a paragraph (else a line, else a space).
 * A code block cut by the split is closed at the end of one part and reopened, with its language, at the start of the next.
 */
export function splitAiReplyText(text) {
  const parts = []; let rest = text, fence = null;
  while (rest.length > 0) {
    const opening = fence === null ? '' : `${fence}\n`, room = EMBED_TEXT - opening.length - 4;
    let cut = rest.length;
    if (opening.length + rest.length > EMBED_TEXT) {
      const window = rest.slice(0, room);
      // The latest paragraph break in the second half, else line break, else space; a hard cut only when there is none.
      cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' ')].find(index => index >= room / 2) ?? room;
    }
    let part = opening + rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).replace(/^\s+/u, '');
    // Track whether this part leaves a code block open; fence lines are ``` optionally followed by a language tag. A reopened
    // block's first line belongs to this part, so the scan starts closed.
    fence = null;
    for (const line of part.split('\n')) if (/^```/u.test(line.trim())) fence = fence === null ? line.trim() : null;
    if (fence !== null && rest.length > 0) part += '\n```';
    else if (fence !== null) { part += '\n```'; fence = null; }
    parts.push(part);
    requireCondition(parts.length <= 2, 'AI_OUTPUT_TOO_LONG');
  }
  return parts;
}

/** Links come only from the authorized source registry; suppress generated mention/link syntax. */
export function renderAiReply(output, sources, { replyChars = 1600 } = {}) {
  // Memories are stored by core, never sent; only the reply itself is rendered.
  const { memories: _memories, ...reply } = output;
  output = validateAiOutput(reply, { outcomes: ['reply'], answerOnly: false, sources, emojiKeys: [], replyChars });
  const text = output.text.replace(/@/gu, '@\u200b').replace(/https?:\/\/\S+/giu, '[link omitted]')
    .replace(/<[^>]*>/gu, '').replace(/!\[/gu, '[');
  // One small-print line per cited page (several passages of one page share it). Links inside the attribution or licence
  // text are dropped rather than shown as placeholders; the page link itself comes from the source registry.
  const plain = value => value.replace(/@/gu, '@\u200b').replace(/\s*\(?https?:\/\/\S+\)?/giu, '').replace(/[<>\r\n*_`~|\\#]/gu, '').replace(/[;,:]\s*$/u, '').trim();
  const links = [...new Map(output.citations.map(id => {
    const source = sources.find(item => item.id === id);
    requireCondition(source && typeof source.url === 'string' && /^https:\/\/[^\s<>]+$/u.test(source.url), 'AI_CITATION_INVALID');
    requireCondition(typeof source.attribution === 'string' && source.attribution.length > 0 && source.attribution.length <= 500 &&
      typeof source.rights === 'string' && source.rights.length > 0 && source.rights.length <= 300, 'AI_CITATION_INVALID');
    const title = typeof source.title === 'string' ? plain(source.title).replace(/\s*\(part \d+\)$/u, '') : '';
    return [source.url, `-# ${[title, plain(source.attribution), plain(source.rights)].filter(Boolean).join(' · ')} <${source.url}>`];
  })).values()];
  const content = [text, ...links].join('\n'), allowed_mentions = { parse: [], users: [], roles: [], replied_user: false };
  if (content.length <= 2000) return { content, allowed_mentions, flags: 4 };
  // Longer answers (owner decision, 23 October 2026) stay one message, so one effect still records and withdraws the whole
  // reply: the text goes into embeds, the small-print source lines after it. Link previews are off by angle brackets.
  const parts = splitAiReplyText(text), small = links.join('\n');
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const inEmbed = small.length > 0 && total + small.length + 1 <= EMBED_TOTAL && parts.at(-1).length + small.length + 1 <= 4_096;
  const embeds = parts.map((description, index) => ({ description: inEmbed && index === parts.length - 1 ? `${description}\n${small}` : description }));
  requireCondition(inEmbed || small.length <= 2000, 'AI_OUTPUT_TOO_LONG');
  return { content: inEmbed ? '' : small, embeds, allowed_mentions, flags: 0 };
}

export function validateAiMessagePayload(payload) {
  const embedded = Object.hasOwn(payload ?? {}, 'embeds');
  requireKeys(payload, ['content', 'allowed_mentions', 'flags', ...(embedded ? ['embeds'] : [])], 'AI_OUTPUT_INVALID');
  requireCondition(typeof payload.content === 'string' && payload.content.length <= 2000 && payload.content.isWellFormed(), 'AI_OUTPUT_INVALID');
  if (!embedded) requireCondition(payload.content.length > 0 && payload.flags === 4, 'AI_OUTPUT_INVALID');
  else {
    // Embeds carry only description text; every link in them or in the content is wrapped so Discord shows no preview.
    requireCondition(payload.flags === 0 && Array.isArray(payload.embeds) && payload.embeds.length >= 1 && payload.embeds.length <= 2 &&
      payload.embeds.every(embed => Object.keys(embed).length === 1 && typeof embed.description === 'string' && embed.description.length > 0 &&
        embed.description.length <= 4_096 && embed.description.isWellFormed()) &&
      payload.embeds.reduce((sum, embed) => sum + embed.description.length, 0) <= EMBED_TOTAL &&
      ![payload.content, ...payload.embeds.map(embed => embed.description)].some(text => /(?<!<)https?:\/\//iu.test(text)), 'AI_OUTPUT_INVALID');
  }
  requireKeys(payload.allowed_mentions, ['parse', 'users', 'roles', 'replied_user'], 'AI_OUTPUT_INVALID');
  requireCondition(['parse', 'users', 'roles'].every(key => Array.isArray(payload.allowed_mentions[key]) && payload.allowed_mentions[key].length === 0) &&
    payload.allowed_mentions.replied_user === false, 'AI_OUTPUT_INVALID');
}
