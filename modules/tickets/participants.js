import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { validateCaseParticipantGrant } from '../../contracts/case-participant.js';

export const MAX_CASE_PARTICIPANTS = 20;
export const CASE_PARTICIPANT_REASONS = Object.freeze({
  add: Object.freeze(['requested-help', 'case-context']), remove: Object.freeze(['no-longer-needed', 'added-in-error']),
});

export function requireParticipantChange({ action, userId, reason, confirmed }) {
  requireId(userId);
  requireCondition(Object.hasOwn(CASE_PARTICIPANT_REASONS, action) && CASE_PARTICIPANT_REASONS[action].includes(reason), 'INVALID_CASE_PARTICIPANT_ACTION');
  requireCondition(confirmed === true, 'CASE_PARTICIPANT_CONFIRMATION_REQUIRED');
}

export function validateCaseAudience(audience, guildId, openerId) {
  requireKeys(audience, ['version', 'participants']); requireInteger(audience.version, 1, 2_147_483_646);
  requireCondition(Array.isArray(audience.participants) && audience.participants.length <= MAX_CASE_PARTICIPANTS, 'INVALID_CASE_PARTICIPANTS');
  const ids = new Set();
  for (const grant of audience.participants) {
    validateCaseParticipantGrant(grant);
    requireCondition(grant.guildId === guildId && grant.userId !== openerId && !ids.has(grant.userId), 'INVALID_CASE_PARTICIPANTS'); ids.add(grant.userId);
  }
}

export function caseParticipantCommandOption(reference) {
  return { type: 1, name: 'participant', description: 'Explicitly add or remove a case participant.', options: [
    { ...reference }, { type: 3, name: 'action', description: 'Change to the case audience.', required: true,
      choices: ['add', 'remove'].map(value => ({ name: value, value })) },
    { type: 6, name: 'member', description: 'The participant to add or remove.', required: true },
    { type: 3, name: 'reason', description: 'Reason for this audience change.', required: true,
      choices: Object.values(CASE_PARTICIPANT_REASONS).flat().map(value => ({ name: value, value })) },
    { type: 5, name: 'confirm', description: 'Confirm this member may see the retained case history when added.', required: true },
  ] };
}
