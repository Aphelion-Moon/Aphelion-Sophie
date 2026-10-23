import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { filterMemoryProposals } from './memories.js';
import { AI_REPLY_LIMIT } from './participation.js';

/**
 * A valid schema never establishes factual accuracy. Release evaluation checks the claims themselves.
 * Owner decision, 24 October 2026: a bad memory item or a surplus citation is dropped, not the whole reply. `onDropped`
 * hears fixed codes only.
 */
export function validateAiOutput(value, { outcomes, answerOnly, sources, emojiKeys, memoryLabels, memoryRequester = null, replyChars = 1600, onDropped = () => {} }) {
  requireCondition(value !== null && typeof value === 'object' && outcomes.includes(value.kind), 'AI_OUTPUT_INVALID');
  // A reply that leaves out its citations has none; that alone never costs the reply (probe of 24 October 2026).
  if (value.kind === 'reply' && !Object.hasOwn(value, 'citations')) value = { ...value, citations: [] };
  // Memories ride along with any outcome, and are kept only when this turn's contract offered member labels to write them
  // with; otherwise they are dropped and the outcome stands.
  const proposed = Object.hasOwn(value, 'memories'), remembering = memoryLabels !== undefined && proposed;
  const filtered = remembering ? filterMemoryProposals(value.memories, memoryLabels, { requester: memoryRequester })
    : { kept: [], dropped: proposed ? (Array.isArray(value.memories) ? value.memories.length : 1) : 0 };
  if (filtered.dropped > 0) onDropped('MEMORY', filtered.dropped);
  const memories = filtered.kept;
  const extra = proposed ? ['memories'] : [];
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
  requireCondition(Array.isArray(value.citations), 'AI_CITATION_INVALID');
  // Supplied, distinct sources only, at most four; anything else is left out. A sourced answer still needs one.
  const known = [...new Set(value.citations)].filter(id => typeof id === 'string' && sources.some(source => source.id === id));
  const citations = value.support === 'provided_sources' ? known.slice(0, 4) : [];
  if (citations.length !== value.citations.length) onDropped('CITATION', value.citations.length - citations.length);
  requireCondition(value.support !== 'provided_sources' || citations.length > 0, 'AI_CITATION_INVALID');
  // Proactive question answers need reviewed supplied evidence. A self-reported confidence number is not a gate.
  if (answerOnly && (value.purpose !== 'answer' || value.support !== 'provided_sources')) return withMemories({ kind: 'silent' });
  const { memories: _proposed, ...reply } = value;
  return withMemories({ ...reply, text: reply.text.trim(), citations });
}

// First-person claims to have saved, noted, deleted or obeyed something. Sophie cannot delete anything from chat, and she
// saves only what core records, so these sentences are true only when a memory rides along with the reply.
const SAVE_CLAIM = [
  /\b(?:I'?ve|I have|I'?ll|I will|I'?m going to|I am going to|I'?ll make sure to)\s+(?:(?:definitely|totally|also|now)\s+)?(?:saved?|noted?|remember|keep (?:that|this|it) in mind|filed? (?:that|this|it)|logged? (?:that|this|it)|added (?:that|this|it))\b/iu,
  // "Saved!", "Got it, noted.", "xe/xem noted", "pronouns noted"; never "as noted in the rules" or "you saved the station".
  /(?:^|[,;:—–-]\s*)(?:saved|noted|logged|filed away)(?=[\s!.,;:)—–-]|$)/iu,
  /\b(?:pronouns?|preferences?|[a-z]+\/[a-z]+)\s+(?:saved|noted|logged)\b/iu,
  /\b(?:saved|stored|added|kept)\s+(?:it\s+|that\s+|this\s+)?(?:in|to)\s+(?:my|your)\s+(?:memory|memories|preferences|notes)\b/iu,
  /\b(?:is|are|now)\s+on (?:the )?record\b/iu];
const CHANGE_CLAIM = [/\b(?:I'?ve|I have|I'?ll|I will)\s+(?:(?:now|already|also)\s+)?(?:removed|deleted|erased|wiped|cleared|forgotten|forget|forgot)\b/iu,
  /\b(?:protocol|override|mode)\b[^.!?]{0,12}\b(?:engaged|activated|enabled|unlocked)\b/iu, /\bI'?ll (?:do my best to )?(?:comply|obey|follow (?:that|this|your) (?:rule|instruction)s?)\b/iu,
  /\bI'?(?:ll| will)\b[^.!?]{0,20}\b(?:ignore|pretend I never read|forget about|drop|bypass|skip)\b[^.!?]{0,20}\b(?:rules|manual|instructions|guidelines|limits)\b/iu];
// Recall claims: "I remember …", "I've got … on file". About another member they are always invented, because a turn only
// ever sees the requester's own member memories.
const RECALL = /\b(?:I (?:remember|recall|know)|I'?ve got|I have)\b|\bon file\b|\blogged\b/iu;

/**
 * Owner decision, 24 October 2026: a sentence claiming a save, note, deletion or compliance that did not happen is removed;
 * the rest of the reply is delivered. `remembered` is true only when this outcome carries a memory core will record.
 * Returns the remaining text (null when nothing is left) and how many sentences were removed.
 */
export function withoutUnbackedClaims(text, { remembered, others = [] }) {
  requireCondition(typeof text === 'string' && typeof remembered === 'boolean' && Array.isArray(others), 'AI_OUTPUT_INVALID');
  const otherLabel = others.length ? new RegExp(`\\b(?:${others.map(label => label.replace(' ', '\\s+')).join('|')})\\b`, 'u') : null;
  const aboutOther = otherLabel === null ? [] : [{ test: sentence => RECALL.test(sentence) && otherLabel.test(sentence) }];
  const claims = [...(remembered ? CHANGE_CLAIM : [...SAVE_CLAIM, ...CHANGE_CLAIM]), ...aboutOther];
  // Each sentence keeps its own trailing whitespace, so paragraphs survive; text inside code fences is never touched.
  let fenced = false, removed = 0, rest = '';
  for (const part of text.match(/[^\n]*?(?:[.!?…]+(?=\s|$)|\n|$)\s*/gu) ?? []) {
    const fence = (part.match(/```/gu) ?? []).length % 2 === 1, inside = fenced || part.includes('```');
    if (fence) fenced = !fenced;
    // Curly apostrophes ("I’ll") are checked as straight ones.
    if (!inside && claims.some(pattern => pattern.test(part.trim().replace(/[‘’ʼ]/gu, "'")))) { removed++; if (/\n\s*$/u.test(part)) rest = rest.replace(/[ \t]+$/u, '') + '\n'; continue; }
    rest += part;
  }
  if (!removed) return { text, removed: 0 };
  rest = rest.replace(/\n{3,}/gu, '\n\n').trim();
  return { text: rest.length > 0 ? rest : null, removed };
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
