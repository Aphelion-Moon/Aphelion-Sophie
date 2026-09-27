import { requireCondition } from '../../contracts/validation.js';

export const CASE_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
export function requireCaseLabels({ priority, tags }) {
  requireCondition(CASE_PRIORITIES.includes(priority) && Array.isArray(tags) && tags.length <= 8 &&
    tags.every(tag => typeof tag === 'string' && tag.length <= 32 && /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(tag) && tag === tag.trim()) &&
    new Set(tags.map(tag => tag.toLowerCase())).size === tags.length, 'CASE_LABELS_INVALID');
}
export function parseCaseTags(value) {
  requireCondition(typeof value === 'string' && value.length <= 263, 'CASE_LABELS_INVALID');
  const tags = value === '-' || value.trim() === '' ? [] : value.split(',').map(tag => tag.trim());
  requireCaseLabels({ priority: 'normal', tags }); return Object.freeze(tags);
}
export function caseLabelCommandOption(reference) {
  return { type: 1, name: 'label', description: 'Set human-written tags and manual priority; does not change access.', options: [
    { ...reference },
    { type: 3, name: 'priority', description: 'Manual Staff priority.', required: true, choices: CASE_PRIORITIES.map(value => ({ name: value, value })) },
    { type: 3, name: 'tags', description: 'Up to 8 comma-separated labels (32 characters each); use - to clear.', required: true, max_length: 263 },
  ] };
}
