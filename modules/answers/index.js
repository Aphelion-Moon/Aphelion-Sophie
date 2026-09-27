import { requireCondition, requireInteger, requireKeys } from '../../contracts/validation.js';

export const ANSWER_LIMIT = 100;
export const requireAnswerName = value => requireCondition(typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value), 'ANSWER_INPUT_INVALID');
export const requireAnswerHash = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'ANSWER_INPUT_INVALID');
export function canonicalAnswerReference(value) {
  requireKeys(value, ['name','revision','sha256'], 'ANSWER_INPUT_INVALID');
  requireAnswerName(value.name); requireAnswerHash(value.sha256); requireInteger(value.revision, 1, 2_147_483_646);
  return { name: value.name, revision: value.revision, sha256: value.sha256 };
}
function text(value, maximum, multiline = false) {
  requireCondition(typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim().length > 0 && value.isWellFormed() &&
    !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value), 'ANSWER_INPUT_INVALID');
  return value;
}
/** Public authored configuration only. No case reference, executable template or import path. */
export function canonicalAnswer(document) {
  requireKeys(document, ['title','text','source'], 'ANSWER_INPUT_INVALID');
  return { title: text(document.title, 80), text: text(document.text, 4000, true), source: text(document.source, 300) };
}
