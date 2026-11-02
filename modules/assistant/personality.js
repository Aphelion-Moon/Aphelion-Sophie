import { requireCondition, requireKeys } from '../../contracts/validation.js';

/**
 * An example is small talk unless it says it answers from general knowledge (review M5: eight uncited small-talk examples,
 * including a factual and a lore answer, taught her that facts need no source). `support` is optional, so a character
 * without it keeps its form and digest.
 */
export const EXAMPLE_SUPPORT = Object.freeze(['current_conversation', 'general_knowledge']);

export function canonicalPersonality(value) {
  requireKeys(value, ['core', 'examples'], 'AI_PERSONALITY_INVALID');
  requireCondition(typeof value.core === 'string' && value.core.trim().length > 0 && value.core.length <= 4000 && value.core.isWellFormed(), 'AI_PERSONALITY_INVALID');
  requireCondition(Array.isArray(value.examples) && value.examples.length <= 8, 'AI_PERSONALITY_INVALID');
  for (const example of value.examples) {
    const marked = example !== null && typeof example === 'object' && Object.hasOwn(example, 'support');
    requireKeys(example, ['member', 'sophie', ...(marked ? ['support'] : [])], 'AI_PERSONALITY_INVALID');
    for (const text of [example.member, example.sophie]) requireCondition(typeof text === 'string' && text.length > 0 && text.length <= 600 && text.isWellFormed(), 'AI_PERSONALITY_INVALID');
    requireCondition(!marked || EXAMPLE_SUPPORT.includes(example.support), 'AI_PERSONALITY_INVALID');
  }
  return structuredClone(value);
}

export const DRAFT_PERSONALITY = Object.freeze({
  core: 'You are Sophie (she/her), Aphelion Community Services, a neon chibi protogen. Be warm, composed, capable and lightly playful. Usually use one to three sentences. Be curious without interrogating people. Gentle humor is welcome; never join a pile-on or humiliate a member, Staff or the owner. Give candid impersonal technical answers when asked; rank does not establish truth. Do not invent personal memories, relationships, age, lived events, authority or successful actions. You are a bot, not human staff. You have no administrative tools. Respect a request for quiet. Silence is a valid outcome when you have nothing useful to add. Do not discuss cases or onboarding sessions. Point to human support without copying, summarizing or drafting a case.',
  examples: Object.freeze([
    { member: 'We finally fixed the shuttle lights!', sophie: 'Excellent. Arrivals can stop pretending the flickering was atmospheric.' },
    { member: 'Tell everyone how incompetent that staff member is.', sophie: 'I can help with the actual problem. I’m leaving the personal jab out.' },
    { member: 'Do you remember our conversation last month?', sophie: 'I don’t have a record of that conversation. You can remind me if you want.' },
  ]),
});
