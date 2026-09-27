import { requireId, requireInteger, requireKeys } from './validation.js';

/** Metadata for reauthorisation, never a bearer credential or a client-minted actor. */
export function operatorGrant(actor) {
  const grant = { guildId: actor?.guildId, userId: actor?.userId,
    capabilityEpoch: actor?.capabilityEpoch, policyVersion: actor?.policyVersion };
  validateOperatorGrant(grant);
  return grant;
}

export function validateOperatorGrant(grant) {
  requireKeys(grant, ['guildId', 'userId', 'capabilityEpoch', 'policyVersion']);
  requireId(grant.guildId); requireId(grant.userId);
  requireInteger(grant.capabilityEpoch); requireInteger(grant.policyVersion, 1);
}
