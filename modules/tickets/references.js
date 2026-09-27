import { requireCondition, requireInteger, requireName } from '../../contracts/validation.js';

export function requireCaseToken(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{48}$/.test(value), 'INVALID_CASE_OPERATION_TOKEN');
}

export function parseCaseVersion(value) {
  requireCondition(typeof value === 'string' && /^[0-9]{1,10}$/.test(value), 'INVALID_CASE_REFERENCE');
  const version = Number(value); requireInteger(version, 0, 2_147_483_644);
  requireCondition(String(version) === value, 'INVALID_CASE_REFERENCE'); return version;
}

export function parseCaseReference(value) {
  requireCondition(typeof value === 'string', 'INVALID_CASE_REFERENCE');
  const match = /^([a-zA-Z0-9][a-zA-Z0-9._-]{0,95})@([0-9]{1,10})$/.exec(value);
  requireCondition(match !== null, 'INVALID_CASE_REFERENCE'); requireName(match[1]);
  return { caseId: match[1], expectedVersion: parseCaseVersion(match[2]) };
}
