import { requireCondition, requireId, requireKeys } from '../../contracts/validation.js';

export const RESPONDER_TYPES = Object.freeze(['quick-help', 'admin-help', 'staff-report', 'tech-support',
  'database-support', 'head-admin-contact', 'shuttle', 'staff-contact', 'player-report']);

/** Omission preserves the original role policy. Head Admin contact always has the restricted audience. */
export function responderRoles(policy, type) {
  requireCondition(RESPONDER_TYPES.includes(type), 'UNKNOWN_CASE_TYPE');
  return policy.responders?.[type] ?? (type === 'head-admin-contact' ? [policy.leadOps] : [policy.staff, policy.leadOps]);
}

export function validateResponders(policy) {
  if (!Object.hasOwn(policy, 'responders')) return;
  requireKeys(policy.responders, RESPONDER_TYPES);
  for (const [type, ids] of Object.entries(policy.responders)) {
    requireCondition(Array.isArray(ids) && ids.length >= 1 && ids.length <= 20 && new Set(ids).size === ids.length, 'INVALID_RESPONDER_MAP');
    ids.forEach(requireId);
    requireCondition(ids.every(id => ![policy.guildId, policy.botUserId, policy.muzzled].includes(id)), 'INVALID_RESPONDER_MAP');
    requireCondition(type !== 'head-admin-contact' || (ids.length === 1 && ids[0] === policy.leadOps), 'HEAD_ADMIN_AUDIENCE_REQUIRED');
  }
}
