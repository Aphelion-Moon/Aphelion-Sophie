import { createHash, randomBytes } from 'node:crypto';
import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { validateActorObservation } from '../../../platform/authorization/actor-policy.js';

export const ACTIVITY_SESSION_MS = 60 * 60 * 1_000;
const MAX_SESSIONS = 5_000;
const digest = token => createHash('sha256').update(token).digest('hex');

export function requireActivityToken(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'ACTIVITY_SESSION_INVALID');
}

/**
 * Shuttle Activity sign-in (P40). Discord's client hands the Activity an OAuth code; core exchanges it, checks that
 * the Activity instance it names is running in this server with that member in it, and issues an opaque bearer token.
 * Tokens live only in memory for an hour (Discord's frame blocks ordinary cookies); a restart signs everyone out and
 * the Activity signs in again. A token identifies a member and nothing more: every request still authorizes afresh.
 */
export function createActivityAuth({ applicationId, guildId, oauth, instances, discord, clock, enabled }) {
  requireId(applicationId); requireId(guildId);
  requireCondition(typeof oauth?.exchangeActivity === 'function' && typeof oauth.resolveIdentity === 'function' && typeof instances === 'function' &&
    typeof discord?.observeActor === 'function' && typeof clock === 'function' && typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const sessions = new Map(), principals = new WeakMap();
  const active = async () => requireCondition(await enabled() === true, 'OAUTH_DISABLED');
  function live(hash) {
    const held = sessions.get(hash), now = clock();
    if (held && now >= held.issuedAt && now < held.expiresAt) return held;
    sessions.delete(hash); return null;
  }
  function remember(hash, value) {
    if (sessions.size >= MAX_SESSIONS) for (const key of [...sessions.keys()]) live(key);
    // Still full: the oldest sign-in makes room (Map keeps insertion order).
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    sessions.set(hash, value);
  }
  return Object.freeze({
    async signIn({ code, instanceId }) {
      await active();
      requireCondition(typeof instanceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(instanceId), 'ACTIVITY_INSTANCE_INVALID');
      const exchanged = await oauth.exchangeActivity(code), identity = oauth.resolveIdentity(exchanged.proof);
      requireCondition(identity.guildId === guildId, 'FOREIGN_GUILD');
      const instance = await instances(instanceId);
      requireCondition(instance !== null && typeof instance === 'object' && instance.application_id === applicationId && instance.instance_id === instanceId &&
        instance.location?.guild_id === guildId && Array.isArray(instance.users) && instance.users.includes(identity.userId), 'ACTIVITY_INSTANCE_INVALID');
      const observation = await discord.observeActor(identity.userId); validateActorObservation(observation, clock());
      requireCondition(observation.guildId === guildId && observation.userId === identity.userId && observation.present && !observation.bot, 'OPERATION_DENIED');
      await active(); requireFreshObservation(observation, clock());
      const token = randomBytes(32).toString('hex'), issuedAt = clock();
      remember(digest(token), { userId: identity.userId, instanceId, issuedAt, expiresAt: issuedAt + ACTIVITY_SESSION_MS });
      return { token, accessToken: exchanged.accessToken, scopes: exchanged.scopes, expiresIn: ACTIVITY_SESSION_MS / 1_000 };
    },
    /**
     * A proof for one request, resolved through core principals like an interaction or dashboard proof. In memory: the
     * request's listener has already checked the runtime gate, and the actor check checks it again (Activity review,
     * 24 October 2026: it was asked here and at each principal resolution too, two database reads each).
     */
    async authenticate(token) {
      requireActivityToken(token);
      const held = live(digest(token));
      requireCondition(held !== null, 'ACTIVITY_SESSION_INVALID');
      const proof = Object.freeze({ guildId, userId: held.userId });
      principals.set(proof, { hash: digest(token), issuedAt: clock() });
      return proof;
    },
    async resolvePrincipal(proof) {
      const held = principals.get(proof), now = clock();
      requireCondition(held !== undefined && now >= held.issuedAt && now - held.issuedAt <= 300_000, 'UNTRUSTED_PRINCIPAL');
      const session = live(held.hash);
      requireCondition(session !== null && session.userId === proof.userId, 'UNTRUSTED_PRINCIPAL');
      return { guildId, userId: session.userId };
    },
    signOut(token) { requireActivityToken(token); sessions.delete(digest(token)); },
  });
}
