import { requireCondition } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalPublication } from '../../../modules/onboarding/screens.js';
import { inTransaction } from './transaction.js';
import { lockOnboardingDefinition, writeOnboardingPublication } from './onboarding-publication-records.js';

export function createOnboardingPublicationStore({ pool, authorize }) {
  return Object.freeze({
    async publishOnboarding({ actor, publication }) {
      const fixed = canonicalPublication(publication);
      return inTransaction(pool, async client => {
        requireCondition(await authorize('shuttle.publish', actor, { definitionId: fixed.id }) === true, 'OPERATION_DENIED');
        const grant = operatorGrant(actor);
        await lockOnboardingDefinition(client, fixed.id); await writeOnboardingPublication(client, fixed, grant);
        requireCondition(await authorize('shuttle.publish', actor, { definitionId: fixed.id }) === true, 'OPERATION_DENIED');
      });
    },
  });
}
