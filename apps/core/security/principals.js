import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** Explicit identity sources only; no client-selected authentication provider. */
export function createCorePrincipals({ interactions, dashboard, activity = null }) {
  requireCondition(typeof interactions?.resolvePrincipal === 'function' && typeof dashboard?.resolvePrincipal === 'function' &&
    (activity === null || typeof activity.resolvePrincipal === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  const sources = [interactions, dashboard, ...(activity === null ? [] : [activity])];
  return Object.freeze({ async resolvePrincipal(proof) {
    for (const [index, source] of sources.entries()) {
      try { return await source.resolvePrincipal(proof); }
      catch (error) { if (index === sources.length - 1 || !(error instanceof ContractError) || error.code !== 'UNTRUSTED_PRINCIPAL') throw error; }
    }
  } });
}
