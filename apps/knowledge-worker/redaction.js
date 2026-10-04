import { isIP } from 'node:net';
import { requireCondition } from '../../contracts/validation.js';

export const AI_REDACTION_VERSION = 'direct-identifiers-v1';
const invisible = /[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const normalize = text => text.normalize('NFKC').replace(invisible, '');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Local data minimization, not anonymisation: names and personal facts can remain in free text. */
export function redactAiIdentifiers(text, aliases = []) {
  requireCondition(typeof text === 'string' && text.length <= 32768 && text.isWellFormed() &&
    Array.isArray(aliases) && aliases.length <= 128, 'AI_REDACTION_INVALID');
  let result = normalize(text);
  // Metadata-derived names are used only on eligible member text, never on system instructions.
  const names = [...new Set(aliases.filter(value => typeof value === 'string' && value.isWellFormed() &&
    value.length >= 2 && value.length <= 80).map(normalize).filter(value => value.trim().length >= 2))];
  if (names.length) result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${names.sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu'), '[member]');
  if (!/[<@:0-9/]/u.test(result) && !/\bwww\./iu.test(result)) return result;
  result = result
    .replace(/<(?:@!?|@&|#)[0-9]{1,20}>|<a?:[a-zA-Z0-9_]{2,32}:[0-9]{1,20}>|<\/[^>\r\n]{1,100}:[0-9]{1,20}>/gu, '[mention]')
    .replace(/\b(?:[a-z][a-z0-9+.-]{1,15}:\/\/|www\.)[^\s<>"`]+/giu, '[link]')
    // Scan tokens once: unanchored email/domain patterns can repeatedly rescan long nonmatches.
    .replace(/[^\s<>()\[\]{}"`,;]+/gu, value => {
      if (value.includes('@')) return value.startsWith('@') ? '[handle]' : '[email]';
      const withoutSlashes = value.startsWith('//') ? value.slice(2) : value;
      const end = withoutSlashes.search(/[/?#]/u);
      const host = end < 0 ? withoutSlashes : withoutSlashes.slice(0, end);
      return (end >= 0 || value.startsWith('//')) && /^(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,63}$/u.test(host) ? '[link]' : value;
    })
    .replace(/(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.]*(?:%[a-z0-9_.-]+)?/giu,
      value => isIP(value.split('%')[0]) === 6 ? '[ip]' : value)
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/gu, value => isIP(value) === 4 ? '[ip]' : value)
    .replace(/[0-9]{15,}/gu, '[id]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, '[id]')
    .replace(/(?<![\p{L}\p{N}])(?![0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T\s]|$))\+?[0-9](?:[0-9 ()\t.-]{4,40}[0-9])(?![\p{L}\p{N}])/gu, value => {
      const digits = value.replace(/[^0-9]/gu, '').length;
      // Keep ordinary dates, short quantities and version numbers usable. Date-of-birth prose can still identify someone.
      if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value) || /^[0-9]{1,3}(?:\.[0-9]{1,3}){1,3}$/u.test(value)) return value;
      return digits >= 7 ? '[phone]' : value;
    });
  requireCondition(result.length <= 32768, 'AI_REDACTION_LIMIT');
  return result;
}
