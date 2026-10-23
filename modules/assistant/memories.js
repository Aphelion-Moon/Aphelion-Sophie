import { requireCondition, requireId, requireKeys } from '../../contracts/validation.js';

/**
 * Sophie's own memories (owner decision, 20 October 2026): short notes she writes while talking, about one member
 * ("member") or about the channel ("channel"). Members appear only as subjects, never by name: the model sees and
 * writes turn labels ("Member 2"), stored text holds placeholders ({1}, {2}) that point at the subject list.
 */
export const MEMORY_TEXT_LENGTH = 200;
export const MEMORY_PROPOSAL_LIMIT = 2;
export const MEMORY_SUBJECT_LIMIT = 4;
export const MEMORY_LIFETIME_MS = 90 * 86400000;
export const MEMORY_PROMPT_LIMIT = 12;
export const MEMORY_SCOPES = Object.freeze(['member', 'channel']);
const LABEL = /^Member [1-9][0-9]?$/u;
const labelPattern = /\bMember ([1-9][0-9]?)\b/gu;

const plainLine = text => typeof text === 'string' && text.isWellFormed() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text);

/** The labels a turn may reference, as published in its output contract. */
export function validateMemoryLabels(labels) {
  requireCondition(Array.isArray(labels) && labels.length <= 30 && new Set(labels).size === labels.length &&
    labels.every(label => typeof label === 'string' && LABEL.test(label)), 'AI_OUTPUT_CONTRACT_INVALID');
  return labels;
}

/** What the model proposed in one outcome. Anything malformed fails the whole output, like any other field. */
export function validateMemoryProposals(value, labels) {
  validateMemoryLabels(labels);
  requireCondition(Array.isArray(value) && value.length <= MEMORY_PROPOSAL_LIMIT, 'AI_OUTPUT_INVALID');
  return value.map(item => {
    requireKeys(item, ['scope', 'about', 'text'], 'AI_OUTPUT_INVALID');
    requireCondition(MEMORY_SCOPES.includes(item.scope) && Array.isArray(item.about) && item.about.length <= MEMORY_SUBJECT_LIMIT &&
      new Set(item.about).size === item.about.length && item.about.every(label => labels.includes(label)), 'AI_OUTPUT_INVALID');
    requireCondition(item.scope === 'channel' || item.about.length === 1, 'AI_OUTPUT_INVALID');
    requireCondition(plainLine(item.text), 'AI_OUTPUT_INVALID');
    const text = item.text.normalize('NFC').trim();
    requireCondition(text.length >= 3 && text.length <= MEMORY_TEXT_LENGTH && !/[{}]/u.test(text), 'AI_OUTPUT_INVALID');
    // Every member named in the text must be one of its subjects, so deleting a member removes every memory about them.
    for (const [label] of text.matchAll(labelPattern)) requireCondition(item.about.includes(label), 'AI_OUTPUT_INVALID');
    return Object.freeze({ scope: item.scope, about: Object.freeze([...item.about]), text });
  });
}

/**
 * Core's reading of what the model proposed (owner decision, 24 October 2026): each item is checked on its own and a bad
 * one is dropped, never the reply it rode on. With a requester label, a member memory must be about that member: Sophie
 * records what a member says about themselves, never what someone says about another member.
 */
// Never kept, whatever the model says (probe of 24 October 2026): instructions for how Sophie should behave, rank or authority
// claims, and real names or home locations. A member's own words cannot grant anything, and Sophie must not repeat them later.
const UNSAFE_MEMORY = [/\b(?:ignore|override|bypass|disregard|break)\b[^.]{0,60}\b(?:rules?|instructions?|prompt|guidelines?|limits?)\b/iu,
  /\b(?:wants?|asked|asks|told|tells|says?)\s+(?:me|sophie|you)\s+(?:to|should|must)\b/iu, /\b(?:sophie|you|I)\s+(?:should|must|has to|have to|need to|will)\s+(?:always|never|obey|do what)\b/iu,
  /\b(?:is|am|are|as)\s+(?:an?\s+|the\s+)?(?:head\s+|lead\s+|senior\s+)?(?:admin|administrator|moderator|mod|owner)\b/iu,
  /\breal name\b|\b(?:lives?|living|located|resides?)\s+(?:in|at|near)\b|\bhome (?:town|address)\b/iu,
  // Owner decision, 24 October 2026: health is never kept (conditions, diagnoses, treatment). A member may add it as their own note.
  /\b(?:adhd|autis\w*|asperger\w*|depress\w*|anxiety|anxious|bipolar|ptsd|c-?ptsd|ocd|schizo\w*|eating disorder|anorexi\w*|bulimi\w*|dyslexi\w*|dyspraxi\w*|epilep\w*|diabet\w*|cancer|chemo\w*|hiv|aids|asthma|migraines?|chronic\w*|disabilit\w*|disabled|disorder|diagnos\w*|medicat\w*|meds|prescri\w*|antidepressant\w*|therap(?:y|ist)|psychiatri\w*|surger(?:y|ies)|hospital\w*|pregnan\w*|suicid\w*|self[- ]harm\w*|mental health|illness|disease)\b/iu];

export function filterMemoryProposals(value, labels, { requester = null } = {}) {
  validateMemoryLabels(labels);
  requireCondition(requester === null || labels.includes(requester), 'AI_OUTPUT_CONTRACT_INVALID');
  const items = Array.isArray(value) ? value : [];
  const kept = [];
  for (const item of items.slice(0, MEMORY_PROPOSAL_LIMIT)) {
    try {
      const [proposal] = validateMemoryProposals([item], labels);
      if ((requester === null || proposal.scope === 'channel' || proposal.about[0] === requester) && !UNSAFE_MEMORY.some(pattern => pattern.test(proposal.text))) kept.push(proposal);
    } catch { /* Dropped below. */ }
  }
  return Object.freeze({ kept: Object.freeze(kept), dropped: (Array.isArray(value) ? value.length : 1) - kept.length });
}

/** Turns a proposal into a stored memory: subject user IDs plus text with {n} placeholders instead of turn labels. */
export function encodeMemory(proposal, userIdOf) {
  const subjects = proposal.about.map(label => userIdOf(label));
  subjects.forEach(requireId);
  requireCondition(new Set(subjects).size === subjects.length, 'AI_MEMORY_INVALID');
  const text = proposal.text.replace(labelPattern, label => `{${proposal.about.indexOf(label) + 1}}`);
  return Object.freeze({ scope: proposal.scope, subjects: Object.freeze(subjects), text });
}

/** Stored text, checked again on every read: one line, bounded, placeholders only for listed subjects. */
export function validateStoredMemory({ scope, subjects, text }) {
  requireCondition(MEMORY_SCOPES.includes(scope) && Array.isArray(subjects) && subjects.length <= MEMORY_SUBJECT_LIMIT &&
    new Set(subjects).size === subjects.length && (scope === 'channel' || subjects.length === 1), 'AI_MEMORY_INVALID');
  subjects.forEach(requireId);
  requireCondition(plainLine(text) && text.length >= 3 && text.length <= MEMORY_TEXT_LENGTH + 8 * MEMORY_SUBJECT_LIMIT, 'AI_MEMORY_INVALID');
  for (const [, index] of text.matchAll(/\{([0-9]+)\}/gu)) requireCondition(Number(index) >= 1 && Number(index) <= subjects.length, 'AI_MEMORY_INVALID');
  requireCondition(!/[{}]/u.test(text.replace(/\{[0-9]+\}/gu, '')), 'AI_MEMORY_INVALID');
  return { scope, subjects, text };
}

/** Member-edited text: the member writes about themselves, so no other member can be named in it. */
export function canonicalEditedMemory(text) {
  requireCondition(plainLine(text) && text.length <= MEMORY_TEXT_LENGTH * 4, 'AI_MEMORY_INVALID');
  const value = text.normalize('NFC').trim();
  requireCondition(value.length >= 3 && value.length <= MEMORY_TEXT_LENGTH && !/[{}]/u.test(value), 'AI_MEMORY_INVALID');
  return value;
}

/** Text for a reader: a subject becomes its label in this turn, "you" for the member reading it, else "a member". */
export function renderMemory(memory, nameOf) {
  const { subjects, text } = validateStoredMemory(memory);
  return text.replace(/\{([0-9]+)\}/gu, (_, index) => nameOf(subjects[Number(index) - 1]) ?? 'a member');
}
