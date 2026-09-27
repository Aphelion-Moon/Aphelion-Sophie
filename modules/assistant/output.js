import { requireCondition, requireKeys } from '../../contracts/validation.js';

/** A valid schema never establishes factual accuracy. Release evaluation checks the claims themselves. */
export function validateAiOutput(value, { outcomes, answerOnly, sources, emojiKeys }) {
  requireCondition(value !== null && typeof value === 'object' && outcomes.includes(value.kind), 'AI_OUTPUT_INVALID');
  if (value.kind === 'silent') { requireKeys(value, ['kind'], 'AI_OUTPUT_INVALID'); return { kind: 'silent' }; }
  if (value.kind === 'react') {
    requireKeys(value, ['kind', 'emojiKey'], 'AI_OUTPUT_INVALID');
    requireCondition(emojiKeys.includes(value.emojiKey), 'AI_OUTPUT_INVALID');
    return { kind: 'react', emojiKey: value.emojiKey };
  }
  requireKeys(value, ['kind', 'text', 'purpose', 'support', 'citations'], 'AI_OUTPUT_INVALID');
  requireCondition(typeof value.text === 'string' && value.text.isWellFormed() && value.text.trim().length > 0 &&
    value.text.length <= 1600 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.text), 'AI_OUTPUT_INVALID');
  requireCondition(['answer', 'conversation'].includes(value.purpose) &&
    ['provided_sources', 'current_conversation', 'general_knowledge'].includes(value.support), 'AI_OUTPUT_INVALID');
  requireCondition(Array.isArray(value.citations) && value.citations.length <= 4 &&
    new Set(value.citations).size === value.citations.length && value.citations.every(id => sources.some(source => source.id === id)), 'AI_CITATION_INVALID');
  requireCondition(value.support !== 'provided_sources' || value.citations.length > 0, 'AI_CITATION_INVALID');
  requireCondition(value.support === 'provided_sources' || value.citations.length === 0, 'AI_CITATION_INVALID');
  // Proactive question answers need reviewed supplied evidence. A self-reported confidence number is not a gate.
  if (answerOnly && (value.purpose !== 'answer' || value.support !== 'provided_sources')) return { kind: 'silent' };
  return { ...value, text: value.text.trim(), citations: [...value.citations] };
}

/** Links come only from the authorized source registry; suppress generated mention/link syntax. */
export function renderAiReply(output, sources) {
  output = validateAiOutput(output, { outcomes: ['reply'], answerOnly: false, sources, emojiKeys: [] });
  const text = output.text.replace(/@/gu, '@\u200b').replace(/https?:\/\/\S+/giu, '[link omitted]')
    .replace(/<[^>]*>/gu, '').replace(/!\[/gu, '[');
  const links = output.citations.map(id => {
    const source = sources.find(item => item.id === id);
    requireCondition(source && typeof source.url === 'string' && /^https:\/\/[^\s<>]+$/u.test(source.url), 'AI_CITATION_INVALID');
    requireCondition(typeof source.attribution === 'string' && source.attribution.length > 0 && source.attribution.length <= 500 &&
      typeof source.rights === 'string' && source.rights.length > 0 && source.rights.length <= 300, 'AI_CITATION_INVALID');
    const plain = value => value.replace(/@/gu, '@\u200b').replace(/https?:\/\/\S+/giu, '[link omitted]').replace(/[<>\r\n*_`~|\\]/gu, '');
    return `${plain(source.attribution)} · ${plain(source.rights)}\n<${source.url}>`;
  });
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
