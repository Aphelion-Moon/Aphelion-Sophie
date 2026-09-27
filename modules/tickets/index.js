import { requireCondition, requireFreshObservation, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { responderRoles, validateResponders } from '../../platform/authorization/case-responders.js';

export const CASE_TYPES = Object.freeze([
  Object.freeze({ id: 'quick-help', label: 'Quick Help', staffGroup: 'staff', publicEntry: true }),
  Object.freeze({ id: 'admin-help', label: 'Admin Help', staffGroup: 'staff', publicEntry: true }),
  Object.freeze({ id: 'staff-report', label: 'Report a Staffer', staffGroup: 'staff', publicEntry: true }),
  Object.freeze({ id: 'tech-support', label: 'Tech Support', staffGroup: 'staff', publicEntry: true }),
  Object.freeze({ id: 'database-support', label: 'Database Support', staffGroup: 'staff', publicEntry: true }),
  Object.freeze({ id: 'head-admin-contact', label: 'Speak with the Head Admins', staffGroup: 'leadOps', publicEntry: true }),
  Object.freeze({ id: 'shuttle', label: 'Shuttle assistance', staffGroup: 'staff', publicEntry: false }),
  Object.freeze({ id: 'staff-contact', label: 'Staff contact', staffGroup: 'staff', publicEntry: false }),
  Object.freeze({ id: 'player-report', label: 'Player report', staffGroup: 'staff', publicEntry: false }),
]);

/** No scheduled expiry. This does not claim infinite disk capacity or backup safety. */
export const CASE_RETENTION = Object.freeze({ mode: 'indefinite', automaticExpiry: false });

/** Pure application policy; Discord Administrator bypass must still be disclosed. */
export function requireCaseAccess({ actor, caseRecord, roles, operation, now }) {
  requireFreshObservation(actor, now);
  requireId(actor.userId);
  requireId(actor.guildId);
  requireKeys(roles, ['staff', 'leadOps', ...(Object.hasOwn(roles, 'responders') ? ['responders'] : [])]);
  validateResponders(roles);
  requireId(roles.staff);
  requireId(roles.leadOps);
  requireCondition(roles.staff !== roles.leadOps, 'ROLE_OWNERSHIP_CONFLICT');
  requireCondition(actor.present === true && actor.guildId === caseRecord.guildId, 'CASE_ACCESS_DENIED');
  requireCondition(Array.isArray(actor.roleIds), 'INVALID_ACTOR_ROLES');
  actor.roleIds.forEach(requireId);
  requireCondition(Array.isArray(caseRecord.participantIds), 'INVALID_CASE_PARTICIPANTS');
  caseRecord.participantIds.forEach(requireId);
  const type = CASE_TYPES.find(candidate => candidate.id === caseRecord.type);
  requireCondition(type !== undefined, 'UNKNOWN_CASE_TYPE');
  requireCondition(['read', 'reply', 'export', 'notes', 'manage'].includes(operation), 'UNKNOWN_CASE_OPERATION');
  const responder = responderRoles(roles, type.id).some(id => actor.roleIds.includes(id));
  // Subject is deliberately absent from the participant calculation.
  const participant = actor.userId === caseRecord.openerId || caseRecord.participantIds.includes(actor.userId);
  requireCondition(responder || (participant && ['read', 'reply', 'export'].includes(operation)), 'CASE_ACCESS_DENIED');
}

/** Counts must be read and reserved in the same transaction as case provisioning. */
export function requireTicketCapacity(usage, limits, now) {
  requireKeys(usage, ['memberOpen', 'guildPending', 'lastCreatedAt']);
  validateTicketLimits(limits);
  requireInteger(now);
  requireInteger(usage.memberOpen);
  requireInteger(usage.guildPending);
  requireCondition(usage.memberOpen < limits.memberOpen, 'MEMBER_CASE_LIMIT');
  requireCondition(usage.guildPending < limits.guildPending, 'GUILD_PROVISIONING_LIMIT');
  if (usage.lastCreatedAt !== null) {
    requireInteger(usage.lastCreatedAt);
    requireCondition(usage.lastCreatedAt <= now && now - usage.lastCreatedAt >= limits.cooldownMs, 'CASE_COOLDOWN');
  }
}

export function validateTicketLimits(limits) {
  requireKeys(limits, ['memberOpen', 'guildPending', 'cooldownMs']);
  requireInteger(limits.memberOpen, 1, 20);
  requireInteger(limits.guildPending, 1, 100);
  requireInteger(limits.cooldownMs, 1_000, 3_600_000);
}
