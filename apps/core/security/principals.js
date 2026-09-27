import { ContractError, requireCondition } from '../../../contracts/validation.js';

/** Explicit identity sources only; no client-selected authentication provider. */
export function createCorePrincipals({ interactions, dashboard }) {
  requireCondition(typeof interactions?.resolvePrincipal === 'function' && typeof dashboard?.resolvePrincipal === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({ async resolvePrincipal(proof) {
    try { return await interactions.resolvePrincipal(proof); }
    catch (error) { if (!(error instanceof ContractError) || error.code !== 'UNTRUSTED_PRINCIPAL') throw error; }
    return dashboard.resolvePrincipal(proof);
  } });
}
