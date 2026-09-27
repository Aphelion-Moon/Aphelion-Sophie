import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ContractError, requireCondition, requireFreshObservation } from '../../../contracts/validation.js';
import { validateActorObservation } from '../../../platform/authorization/actor-policy.js';
import { requireAuthToken, validateDashboardAuth } from '../../../contracts/dashboard-auth.js';

export const authDigest = token => { requireAuthToken(token); return createHash('sha256').update(token).digest('hex'); };
export const sessionCsrf = token => { requireAuthToken(token); return createHmac('sha256', token).update('sophie-dashboard-csrf-v1').digest('hex'); };

/** Opaque browser principals share core authorization, never roles supplied by the browser or OAuth profile. */
export function createDashboardAuth({ configuration, store, oauth, discord, clock, enabled }) {
  validateDashboardAuth(configuration);
  requireCondition(configuration.guildId === discord.guildId && typeof clock === 'function' && typeof enabled === 'function', 'OAUTH_CONFIGURATION_INVALID');
  const fixed = structuredClone(configuration), principals = new WeakMap();
  const active = async () => requireCondition(await enabled() === true, 'OAUTH_DISABLED');
  function csrf(token, supplied) {
    requireAuthToken(supplied);
    requireCondition(timingSafeEqual(Buffer.from(sessionCsrf(token), 'hex'), Buffer.from(supplied, 'hex')), 'DASHBOARD_CSRF_INVALID');
  }
  async function authenticate({ token, method = 'GET', origin = null, csrfToken = null }) {
    await active(); requireCondition(['GET', 'POST'].includes(method), 'DASHBOARD_METHOD_INVALID');
    if (method === 'POST') { requireCondition(origin === fixed.origin, 'DASHBOARD_ORIGIN_INVALID'); csrf(token, csrfToken); }
    const identity = await store.readSession(authDigest(token)); await active();
    const proof = Object.freeze({ guildId: identity.guildId, userId: identity.userId });
    principals.set(proof, { tokenHash: authDigest(token), issuedAt: clock() });
    return { proof, csrfToken: sessionCsrf(token) };
  }
  return Object.freeze({
    async begin(previousBinding = null, returnPath = '/') {
      await active();
      const state = randomBytes(32).toString('hex'), binding = randomBytes(32).toString('hex');
      await store.beginFlow({ stateHash: authDigest(state), bindingHash: authDigest(binding),
        previousBindingHash: previousBinding === null ? null : authDigest(previousBinding), returnPath });
      await active(); return { location: oauth.authorizationUrl(state), binding };
    },
    async complete({ state, binding, code, previousToken = null, cancelled = false }) {
      requireCondition(typeof cancelled === 'boolean', 'DASHBOARD_LOGIN_INVALID'); await active();
      const claim = await store.consumeFlow({ stateHash: authDigest(state), bindingHash: authDigest(binding) });
      if (cancelled) return null;
      const proof = await oauth.exchange(code), identity = oauth.resolveIdentity(proof);
      requireCondition(identity.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const observation = await discord.observeActor(identity.userId); validateActorObservation(observation, clock());
      requireCondition(observation.guildId === fixed.guildId && observation.userId === identity.userId && observation.present && !observation.bot, 'OPERATION_DENIED');
      await active(); requireFreshObservation(observation, clock());
      const token = randomBytes(32).toString('hex');
      const { returnPath } = await store.finishLogin({ claim, observation, tokenHash: authDigest(token), previousTokenHash: previousToken === null ? null : authDigest(previousToken) });
      await active(); return { token, returnPath };
    },
    authenticate,
    async refreshSession(token) {
      await active(); const maxAge = await store.refreshSession(authDigest(token)); await active(); return maxAge;
    },
    async resolvePrincipal(proof) {
      const held = principals.get(proof), now = clock();
      requireCondition(held && now >= held.issuedAt && now - held.issuedAt <= 300_000, 'UNTRUSTED_PRINCIPAL');
      await active();
      try {
        const identity = await store.readSession(held.tokenHash);
        requireCondition(identity.guildId === proof.guildId && identity.userId === proof.userId, 'UNTRUSTED_PRINCIPAL');
        await active(); return identity;
      } catch (error) {
        if (error instanceof ContractError && ['DASHBOARD_SESSION_INVALID', 'DASHBOARD_POLICY_CHANGED'].includes(error.code)) throw new ContractError('UNTRUSTED_PRINCIPAL');
        throw error;
      }
    },
    async logout(input) {
      requireCondition(input.method === 'POST', 'DASHBOARD_METHOD_INVALID');
      await authenticate(input); await store.revokeSession(authDigest(input.token));
    },
  });
}
