import { requireId, requireInteger, requireKeys } from './validation.js';

/** A revocable membership binding, never proof of an invitation or a bearer credential. */
export function validateCaseParticipantGrant(value) {
  requireKeys(value, ['guildId', 'userId', 'presenceEpoch']);
  requireId(value.guildId); requireId(value.userId); requireInteger(value.presenceEpoch, 1);
}
