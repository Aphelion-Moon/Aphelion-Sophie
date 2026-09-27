import catalogue from './system-messages.json' with { type: 'json' };
import { requireCondition, requireKeys } from './validation.js';

export const SYSTEM_MESSAGES = Object.freeze(catalogue.map(entry => Object.freeze(entry)));
const byId = new Map(SYSTEM_MESSAGES.map(entry => [entry.id, entry]));
const placeholders = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]).sort();
const parameterLimits = { step: 2, total: 2, title: 80, screen: 1, screens: 1, answer: 3500, type: 60, version: 10, userId: 20, link: 80 };

/** Bounded presentation data, never executable templates or permission rules. */
export function canonicalSystemWording(value) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'SYSTEM_WORDING_INVALID');
  const result = {};
  for (const id of Object.keys(value).sort()) {
    const entry = byId.get(id), wording = value[id];
    requireCondition(entry && typeof wording === 'string' && wording.trim().length > 0 && wording.isWellFormed() &&
      wording.length <= entry.max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(wording), 'SYSTEM_WORDING_INVALID');
    requireCondition(JSON.stringify(placeholders(wording)) === JSON.stringify(placeholders(entry.source)), 'SYSTEM_WORDING_PLACEHOLDERS');
    const expanded = wording.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key) => 'x'.repeat(parameterLimits[key] ?? key.length + 2));
    requireCondition(expanded.length <= entry.max, 'SYSTEM_WORDING_INVALID');
    if (wording !== entry.source) result[id] = wording;
  }
  requireCondition(new TextEncoder().encode(JSON.stringify(result)).length <= 100_000, 'SYSTEM_WORDING_INVALID');
  return result;
}

export function createSystemText(overrides = {}) {
  const fixed = canonicalSystemWording(overrides);
  return (id, parameters = {}) => {
    const entry = byId.get(id); requireCondition(entry, 'SYSTEM_MESSAGE_UNKNOWN');
    requireKeys(parameters, [...new Set(placeholders(entry.source))]);
    return (fixed[id] ?? entry.source).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, key) => String(parameters[key]));
  };
}
export const defaultSystemText = createSystemText();
