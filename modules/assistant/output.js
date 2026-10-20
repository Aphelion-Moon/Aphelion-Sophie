import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { validateMemoryProposals } from './memories.js';

/** A valid schema never establishes factual accuracy. Release evaluation checks the claims themselves. */
export function validateAiOutput(value, { outcomes, answerOnly, sources, emojiKeys, memoryLabels }) {
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
    value.text.length <= 1600 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.text), 'AI_OUTPUT_INVALID');
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

/** Links come only from the authorized source registry; suppress generated mention/link syntax. */
export function renderAiReply(output, sources) {
  // Memories are stored by core, never sent; only the reply itself is rendered.
  const { memories: _memories, ...reply } = output;
  output = validateAiOutput(reply, { outcomes: ['reply'], answerOnly: false, sources, emojiKeys: [] });
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
  const content = [text, ...links].join('\n');
  requireCondition(content.length <= 2000, 'AI_OUTPUT_TOO_LONG');
  return { content, allowed_mentions: { parse: [], users: [], roles: [], replied_user: false }, flags: 4 };
}

export function validateAiMessagePayload(payload) {
  requireKeys(payload, ['content', 'allowed_mentions', 'flags'], 'AI_OUTPUT_INVALID');
  requireCondition(typeof payload.content === 'string' && payload.content.length > 0 && payload.content.length <= 2000 && payload.content.isWellFormed() && payload.flags === 4, 'AI_OUTPUT_INVALID');
  requireKeys(payload.allowed_mentions, ['parse', 'users', 'roles', 'replied_user'], 'AI_OUTPUT_INVALID');
  requireCondition(['parse', 'users', 'roles'].every(key => Array.isArray(payload.allowed_mentions[key]) && payload.allowed_mentions[key].length === 0) &&
    payload.allowed_mentions.replied_user === false, 'AI_OUTPUT_INVALID');
}
