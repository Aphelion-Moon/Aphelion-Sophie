import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';
import { requireOnboardingEligibility } from '../membership/index.js';

export const MAX_ONBOARDING_STEPS = 20;

export function requireOnboardingSteps(steps) {
  requireCondition(Array.isArray(steps) && steps.length >= 1 && steps.length <= MAX_ONBOARDING_STEPS, 'INVALID_SHUTTLE_STEPS');
}

export function validateDefinition(definition) {
  requireKeys(definition, ['id', 'version', 'status', 'stepIds', ...(Object.hasOwn(definition, 'screenCounts') ? ['screenCounts'] : [])]);
  requireName(definition.id);
  requireInteger(definition.version, 1);
  requireCondition(['published', 'withdrawn'].includes(definition.status), 'INVALID_DEFINITION_STATUS');
  requireOnboardingSteps(definition.stepIds);
  definition.stepIds.forEach(requireName);
  if (definition.screenCounts !== undefined) {
    requireCondition(Array.isArray(definition.screenCounts) && definition.screenCounts.length === definition.stepIds.length, 'INVALID_SHUTTLE_SCREENS');
    definition.screenCounts.forEach(count => requireInteger(count, 1, 5));
  }
  requireCondition(new Set(definition.stepIds).size === definition.stepIds.length, 'DUPLICATE_SHUTTLE_STEPS');
}

function requirePublished(definition) {
  validateDefinition(definition);
  requireCondition(definition.status === 'published', 'DEFINITION_WITHDRAWN');
}

function validateSession(session, definition = null) {
  requireKeys(session, ['id', 'guildId', 'userId', 'definitionId', 'definitionVersion', 'eligibilityEpoch', 'mode', 'stepIndex', 'status', 'version', 'nonce', 'grantAccessEpoch', 'helpPaused', ...(Object.hasOwn(session, 'screenIndex') ? ['screenIndex'] : [])]);
  for (const key of ['id', 'definitionId', 'nonce']) requireName(session[key]);
  requireId(session.guildId);
  requireId(session.userId);
  requireInteger(session.definitionVersion, 1);
  for (const key of ['version', 'eligibilityEpoch']) requireInteger(session[key]);
  requireInteger(session.stepIndex, 0, (definition?.stepIds.length ?? MAX_ONBOARDING_STEPS) - 1);
  if (session.screenIndex !== undefined) requireInteger(session.screenIndex, 0, 4);
  if (definition) {
    requireCondition(Object.hasOwn(session, 'screenIndex') === Object.hasOwn(definition, 'screenCounts'), 'INVALID_SESSION_PROGRESS');
    if (definition.screenCounts) {
      const last = definition.screenCounts[session.stepIndex] - 1;
      requireInteger(session.screenIndex, 0, last);
      requireCondition(session.status === 'active' || session.screenIndex === last, 'INVALID_SESSION_PROGRESS');
    }
  }
  requireCondition(['active', 'role_pending', 'complete'].includes(session.status), 'INVALID_SESSION_STATUS');
  requireCondition(typeof session.helpPaused === 'boolean' && (!session.helpPaused || session.status === 'active'), 'INVALID_SHUTTLE_PAUSE');
  requireCondition(['refresh', 'qualification'].includes(session.mode), 'INVALID_SESSION_MODE');
  if (session.grantAccessEpoch !== null) requireInteger(session.grantAccessEpoch);
  // Closure may restrict a session without a definition; granting always supplies its pinned definition.
  if (definition) requireCondition(session.status === 'active' || session.stepIndex === definition.stepIds.length - 1, 'INVALID_SESSION_PROGRESS');
  requireCondition(session.status === 'role_pending' ? session.grantAccessEpoch !== null : session.grantAccessEpoch === null, 'INVALID_GRANT_STATE');
}

/** The future repository must enforce one active session and unique interaction IDs. */
export function startOnboarding({ id, nonce, member, definition, now }) {
  requireName(id);
  requireName(nonce);
  requirePublished(definition);
  requireOnboardingEligibility(member, now);
  return {
    id, guildId: member.guildId, userId: member.userId,
    definitionId: definition.id, definitionVersion: definition.version,
    eligibilityEpoch: member.eligibilityEpoch,
    mode: member.observation.whitelist ? 'refresh' : 'qualification',
    stepIndex: 0, ...(definition.screenCounts ? { screenIndex: 0 } : {}), status: 'active', version: 0, nonce,
    grantAccessEpoch: null, helpPaused: false,
  };
}

function requireSession(session, member, definition, command, now, allowPaused = false) {
  requirePublished(definition);
  validateSession(session, definition);
  requireOnboardingEligibility(member, now);
  requireCondition(allowPaused || !session.helpPaused, 'SHUTTLE_PAUSED');
  requireKeys(command, ['guildId', 'userId', 'expectedVersion', 'nonce', 'nextNonce']);
  requireName(command.nextNonce);
  requireCondition(command.nextNonce !== session.nonce, 'NONCE_NOT_ROTATED');
  requireCondition(command.guildId === session.guildId && command.userId === session.userId, 'FOREIGN_SHUTTLE_CONTROL');
  requireCondition(member.guildId === session.guildId && member.userId === session.userId, 'MEMBER_MISMATCH');
  requireCondition(command.expectedVersion === session.version && command.nonce === session.nonce, 'STALE_SHUTTLE_CONTROL');
  requireCondition(session.definitionId === definition.id && session.definitionVersion === definition.version, 'DEFINITION_MISMATCH');
  requireCondition(session.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
  requireInteger(session.stepIndex, 0, definition.stepIds.length - 1);
}

function finish(session, member) {
  if (member.observation.whitelist) return { session: { ...session, status: 'complete', grantAccessEpoch: null }, effects: [] };
  const pending = { ...session, status: 'role_pending', grantAccessEpoch: member.accessEpoch };
  return {
    session: pending,
    effects: [{
      kind: 'whitelist.grant',
      operationId: `${pending.id}.grant.${pending.version}`,
      guildId: member.guildId, userId: member.userId, sessionId: pending.id,
      expectedSessionVersion: pending.version,
      eligibilityEpoch: member.eligibilityEpoch, accessEpoch: member.accessEpoch,
    }],
  };
}

/** Returns data for a single atomic state/outbox commit; performs no external effects. */
export function advanceOnboarding(session, member, definition, command, now) {
  requireSession(session, member, definition, command, now);
  requireCondition(session.status === 'active', 'SHUTTLE_NOT_ACTIVE');
  requireCondition(!definition.screenCounts || session.screenIndex === definition.screenCounts[session.stepIndex] - 1, 'SHUTTLE_SCREENS_UNREAD');
  const next = { ...session, version: session.version + 1, nonce: command.nextNonce };
  if (session.stepIndex === definition.stepIds.length - 1) return finish(next, member);
  return { session: { ...next, stepIndex: session.stepIndex + 1, ...(definition.screenCounts ? { screenIndex: 0 } : {}) }, effects: [] };
}

export function backOnboarding(session, member, definition, command, now) {
  requireSession(session, member, definition, command, now);
  requireCondition(session.status === 'active' && session.stepIndex > 0, 'BACK_UNAVAILABLE');
  requireCondition(!definition.screenCounts || session.screenIndex === 0, 'BACK_UNAVAILABLE');
  return { session: { ...session, stepIndex: session.stepIndex - 1,
    ...(definition.screenCounts ? { screenIndex: definition.screenCounts[session.stepIndex - 1] - 1 } : {}),
    version: session.version + 1, nonce: command.nextNonce }, effects: [] };
}

/** Screen navigation has the same authority/version fences as step acknowledgement. */
function navigateScreen(session, member, definition, command, now, direction) {
  requireSession(session, member, definition, command, now);
  requireCondition(session.status === 'active' && !!definition.screenCounts, 'SCREEN_NAVIGATION_UNAVAILABLE');
  const index = session.screenIndex + direction;
  requireCondition(index >= 0 && index < definition.screenCounts[session.stepIndex], 'SCREEN_NAVIGATION_UNAVAILABLE');
  return { session: { ...session, screenIndex: index, version: session.version + 1, nonce: command.nextNonce }, effects: [] };
}
export const nextOnboardingScreen = (session, member, definition, command, now) => navigateScreen(session, member, definition, command, now, 1);
export const previousOnboardingScreen = (session, member, definition, command, now) => navigateScreen(session, member, definition, command, now, -1);

/** After a mute cancels pending delivery, require a fresh final acknowledgement. */
export function retryWhitelist(session, member, definition, command, now) {
  requireSession(session, member, definition, command, now);
  requireCondition(session.status === 'role_pending', 'NO_PENDING_GRANT');
  return finish({ ...session, version: session.version + 1, nonce: command.nextNonce }, member);
}

/** A published help rule can withdraw the pending intent without changing earned access. */
export function pauseOnboarding(session, member, definition, command, now) {
  requireSession(session, member, definition, command, now);
  requireCondition(session.status !== 'complete', 'SHUTTLE_NOT_ACTIVE');
  return { session: { ...session, status: 'active', grantAccessEpoch: null, helpPaused: true,
    version: session.version + 1, nonce: command.nextNonce }, effects: [] };
}

/** Core must authorize and audit the Staff action. Resumption itself grants no role. */
export function resumeOnboarding(session, member, definition, command, now) {
  requireSession(session, member, definition, command, now, true);
  requireCondition(session.helpPaused, 'SHUTTLE_NOT_PAUSED');
  return { session: { ...session, helpPaused: false, version: session.version + 1, nonce: command.nextNonce }, effects: [] };
}

/** Authorised case closure invalidates unfinished grants; already confirmed access stays earned. */
export function cancelOnboardingGrantForClosure(session, nextNonce) {
  validateSession(session); requireName(nextNonce);
  return session.status !== 'role_pending' ? session : { ...session, status: 'active', grantAccessEpoch: null,
    version: session.version + 1, nonce: nextNonce };
}

/** Dispatcher calls this after loading current state and fresh Discord membership. */
export function requireGrantDelivery(session, member, effect, definition, now) {
  requireKeys(effect, ['kind', 'operationId', 'guildId', 'userId', 'sessionId', 'expectedSessionVersion', 'eligibilityEpoch', 'accessEpoch']);
  requirePublished(definition);
  validateSession(session, definition);
  requireOnboardingEligibility(member, now);
  requireCondition(!session.helpPaused, 'SHUTTLE_PAUSED');
  requireCondition(session.definitionId === definition.id && session.definitionVersion === definition.version, 'DEFINITION_MISMATCH');
  requireCondition(effect.kind === 'whitelist.grant' && effect.sessionId === session.id, 'GRANT_MISMATCH');
  requireCondition(effect.operationId === `${session.id}.grant.${session.version}`, 'GRANT_MISMATCH');
  requireCondition(session.status === 'role_pending' && effect.expectedSessionVersion === session.version, 'STALE_GRANT');
  requireCondition(effect.guildId === member.guildId && effect.userId === member.userId && session.guildId === member.guildId && session.userId === member.userId, 'MEMBER_MISMATCH');
  requireCondition(session.eligibilityEpoch === member.eligibilityEpoch && effect.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
  requireCondition(session.grantAccessEpoch === member.accessEpoch && effect.accessEpoch === member.accessEpoch, 'STALE_GRANT');
}

/** Confirmation follows a fresh role observation, never just an HTTP success. */
export function confirmWhitelist(session, member, effect, definition, now) {
  requireGrantDelivery(session, member, effect, definition, now);
  requireCondition(member.observation.whitelist, 'ROLE_NOT_CONFIRMED');
  return { ...session, status: 'complete', version: session.version + 1, grantAccessEpoch: null };
}
