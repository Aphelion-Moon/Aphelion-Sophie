import { requireCondition, requireKeys } from '../../contracts/validation.js';

/** Only application-owned acyclic JSON data enters this contract. */
export function freezeAiMaterial(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeAiMaterial(child);
    Object.freeze(value);
  }
  return value;
}

/** Compare transient material in its authorized lane; callers must not persist either input. */
export function firstChangedAiBlock(previous, current) {
  if (JSON.stringify({ ...previous.body, messages: undefined }) !== JSON.stringify({ ...current.body, messages: undefined })) return 'protocol';
  const before = previous.blocks, after = current.blocks;
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    const left = before[index], right = after[index];
    if (left?.kind !== right?.kind || left?.id !== right?.id ||
      previous.messages[index]?.content !== current.messages[index]?.content ||
      previous.messages[index]?.role !== current.messages[index]?.role) return right?.kind ?? left.kind;
  }
  return null;
}

/** Generation constraints do not replace core's independent output and authority checks. */
export function createAiOutputSchema(contract) {
  requireKeys(contract, ['outcomes', 'answerOnly', 'sourceIds', 'emojiKeys'], 'AI_OUTPUT_CONTRACT_INVALID');
  const { outcomes, answerOnly, sourceIds, emojiKeys } = contract;
  requireCondition(Array.isArray(outcomes) && outcomes.length <= 3 && outcomes.includes('silent') &&
    new Set(outcomes).size === outcomes.length && outcomes.every(kind => ['silent','reply','react'].includes(kind)) &&
    typeof answerOnly === 'boolean', 'AI_OUTPUT_CONTRACT_INVALID');
  for (const [values, limit] of [[sourceIds, 6], [emojiKeys, 32]]) requireCondition(Array.isArray(values) && values.length <= limit &&
    new Set(values).size === values.length && values.every(value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,96}$/.test(value)), 'AI_OUTPUT_CONTRACT_INVALID');
  const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
  const oneOf = [object({ kind: { const: 'silent' } })];
  if (outcomes.includes('react') && emojiKeys.length) oneOf.push(object({ kind: { const: 'react' }, emojiKey: { enum: [...emojiKeys] } }));
  if (outcomes.includes('reply')) {
    const common = { kind: { const: 'reply' }, text: { type: 'string', minLength: 1, maxLength: 1600 },
      purpose: { enum: answerOnly ? ['answer'] : ['answer', 'conversation'] } };
    if (!answerOnly) oneOf.push(object({ ...common, support: { enum: ['current_conversation','general_knowledge'] },
      citations: { type: 'array', maxItems: 0, items: { type: 'string' } } }));
    if (sourceIds.length) oneOf.push(object({ ...common, support: { const: 'provided_sources' },
      citations: { type: 'array', minItems: 1, maxItems: 4, items: { enum: [...sourceIds] } } }));
  }
  return { oneOf };
}

export function validateAiPrompt({ messages, trimGroups = [], outputContract, sourceMessages = [], contractMessageIndex, blocks }) {
  createAiOutputSchema(outputContract);
  requireCondition(Array.isArray(messages) && messages.length >= 2 && messages.length <= 55 &&
    messages[0].role === 'system' && messages.at(-1).role === 'user' &&
    messages.every(item => ['system', 'user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.isWellFormed() && item.content.length <= 32768) &&
    messages.reduce((count, item) => count + item.content.length, 0) <= 196608, 'AI_PROMPT_INVALID');
  if (contractMessageIndex !== undefined) requireCondition(contractMessageIndex === messages.length - 2 && contractMessageIndex > 0 &&
    messages[contractMessageIndex].role === 'system', 'AI_PROMPT_INVALID');
  requireCondition(Array.isArray(sourceMessages) && sourceMessages.length === outputContract.sourceIds.length && sourceMessages.every((source, i) =>
    source?.id === outputContract.sourceIds[i] && Number.isSafeInteger(source.index) && source.index > 0 && source.index < messages.length - 1 &&
    messages[source.index].role === 'user') && new Set(sourceMessages.map(source => source.index)).size === sourceMessages.length, 'AI_PROMPT_INVALID');
  if (blocks !== undefined) requireCondition(Array.isArray(blocks) && blocks.length === messages.length && blocks.every((block, index) =>
    block && ['authoring', 'example', 'evidence', 'history', 'contract', 'question'].includes(block.kind) &&
    Object.keys(block).every(key => key === 'kind' || key === 'id') &&
    (block.kind === 'evidence' ? sourceMessages.some(source => source.index === index && source.id === block.id) : !Object.hasOwn(block, 'id'))), 'AI_PROMPT_INVALID');
  requireCondition(Array.isArray(trimGroups) && trimGroups.length <= 44 && trimGroups.every(group => Array.isArray(group) &&
    group.length > 0 && group.length <= 2 && group.every(index => Number.isSafeInteger(index) && index > 0 && index < messages.length - 1 && messages[index].role !== 'system')) &&
    new Set(trimGroups.flat()).size === trimGroups.flat().length, 'AI_PROMPT_INVALID');
}
