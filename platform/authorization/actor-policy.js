import { requireCondition, requireFreshObservation, requireId, requireInteger, requireKeys, requireRecord } from '../../contracts/validation.js';
import { validateResponders } from './case-responders.js';

const REQUIRED_CAPABILITIES = Object.freeze(['member.mute', 'member.unmute', 'shuttle.publish', 'case.registry']);
export const AI_CAPABILITIES = Object.freeze(['ai.control', 'ai.personality.publish', 'ai.knowledge.publish', 'ai.memory.audit', 'ai.sandbox.publish', 'ai.runtime.apply', 'ai.silence']);
export const CONFIGURED_CAPABILITIES = Object.freeze([...REQUIRED_CAPABILITIES, 'case.forms.publish', 'answers.publish', 'automation.publish', 'permissions.publish', ...AI_CAPABILITIES]);
export const MAX_CAPABILITY_ROLES = 50;

export function validateActorObservation(actor, now) {
  requireKeys(actor, ['guildId', 'userId', 'known', 'observedAt', 'present', 'roleIds', 'bot', 'timedOut', 'administrator', 'guildOwner', 'highestRolePosition']);
  requireFreshObservation(actor, now); requireId(actor.guildId); requireId(actor.userId);
  for (const key of ['present', 'bot', 'timedOut', 'administrator', 'guildOwner']) requireCondition(typeof actor[key] === 'boolean', 'INVALID_ACTOR_OBSERVATION');
  requireCondition(Array.isArray(actor.roleIds) && actor.roleIds.length <= 500 && new Set(actor.roleIds).size === actor.roleIds.length, 'INVALID_ACTOR_ROLES');
  actor.roleIds.forEach(requireId);
  requireInteger(actor.highestRolePosition, 0, 500);
  requireCondition(actor.present || (actor.roleIds.length === 0 && !actor.bot && !actor.timedOut && !actor.administrator && !actor.guildOwner && actor.highestRolePosition === 0), 'ABSENT_ACTOR_HAS_AUTHORITY');
}

/** Empty operator lists deny access. Role names and Discord Administrator never grant capabilities. */
export function validateCapabilityPolicy(policy) {
  requireKeys(policy, ['guildId', 'version', 'staff', 'leadOps', 'muzzled', 'grants', ...(Object.hasOwn(policy, 'responders') ? ['responders'] : [])]);
  for (const key of ['guildId', 'staff', 'leadOps', 'muzzled']) requireId(policy[key]);
  requireInteger(policy.version, 1);
  validateResponders(policy);
  requireCondition(new Set([policy.guildId, policy.staff, policy.leadOps, policy.muzzled]).size === 4, 'ROLE_OWNERSHIP_CONFLICT');
  requireRecord(policy.grants);
  requireKeys(policy.grants, [...REQUIRED_CAPABILITIES, ...CONFIGURED_CAPABILITIES.filter(key => !REQUIRED_CAPABILITIES.includes(key) && Object.hasOwn(policy.grants, key))]);
  for (const roles of Object.values(policy.grants)) {
    requireCondition(Array.isArray(roles) && roles.length <= MAX_CAPABILITY_ROLES && new Set(roles).size === roles.length,
      'INVALID_CAPABILITY_MAP');
    roles.forEach(requireId);
    // A configured permission is independent of case readership and owned member roles.
    // Never let @everyone or the restrictive Muzzled role itself grant an operation.
    requireCondition(roles.every(id => ![policy.guildId, policy.muzzled].includes(id)), 'INVALID_CAPABILITY_MAP');
  }
}

export function requireConfiguredCapability(policy, capability, actor, now) {
  validateCapabilityPolicy(policy); validateActorObservation(actor, now);
  requireCondition(CONFIGURED_CAPABILITIES.includes(capability), 'UNKNOWN_CAPABILITY');
  requireCondition(actor.guildId === policy.guildId && actor.present && !actor.bot && !actor.timedOut &&
    !actor.roleIds.includes(policy.muzzled) && (policy.grants[capability] ?? []).some(id => actor.roleIds.includes(id)), 'OPERATION_DENIED');
}

/** Conservative application moderation hierarchy; no owner/admin/self/bot bypass. */
export function requireModerationTarget(actor, target, now) {
  validateActorObservation(actor, now); validateActorObservation(target, now);
  requireCondition(actor.guildId === target.guildId && actor.userId !== target.userId && target.present &&
    !target.bot && !target.administrator && !target.guildOwner && actor.highestRolePosition > target.highestRolePosition, 'MODERATION_TARGET_DENIED');
}
