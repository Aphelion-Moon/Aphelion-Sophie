import { requireCondition, requireFreshObservation, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';

const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;
// Owned community roles must not acquire moderation/administration privileges.
const PRIVILEGED = [1n, 2n, 3n, 4n, 5n, 7n, 13n, 19n, 22n, 23n, 24n, 27n, 28n, 29n, 30n, 33n, 34n, 40n, 41n, 51n, 52n]
  .reduce((bits, position) => bits | (1n << position), 0n);

/** Explicit IDs and ownership only. There is no name lookup or full-role replacement. */
export function validateRoleMapping(mapping) {
  requireKeys(mapping, ['guildId', 'botUserId', 'crew', 'muzzled', 'whitelist', 'staff', 'leadOps', 'externallyOwnedRoleIds']);
  for (const key of ['guildId', 'botUserId', 'crew', 'muzzled', 'whitelist', 'staff', 'leadOps']) requireId(mapping[key]);
  const ids = [mapping.crew, mapping.muzzled, mapping.whitelist, mapping.staff, mapping.leadOps];
  requireCondition(new Set(ids).size === ids.length && !ids.includes(mapping.guildId), 'ROLE_OWNERSHIP_CONFLICT');
  requireCondition(Array.isArray(mapping.externallyOwnedRoleIds) && mapping.externallyOwnedRoleIds.length <= 250, 'INVALID_ROLE_OWNERSHIP');
  mapping.externallyOwnedRoleIds.forEach(requireId);
  requireCondition(new Set(mapping.externallyOwnedRoleIds).size === mapping.externallyOwnedRoleIds.length, 'INVALID_ROLE_OWNERSHIP');
  requireCondition(![mapping.crew, mapping.muzzled, mapping.whitelist].some(id => mapping.externallyOwnedRoleIds.includes(id)), 'ROLE_OWNERSHIP_CONFLICT');
}

export function validateRoleContext(context, mapping, now) {
  validateRoleMapping(mapping);
  requireKeys(context, ['guildId', 'userId', 'known', 'observedAt', 'roles', 'botRoleIds', 'memberRoleIds', 'botTimedOut']);
  requireFreshObservation(context, now);
  requireId(context.userId);
  requireCondition(context.guildId === mapping.guildId, 'FOREIGN_GUILD');
  requireCondition(typeof context.botTimedOut === 'boolean', 'INVALID_ROLE_CONTEXT');
  requireCondition(Array.isArray(context.roles) && context.roles.length >= 1 && context.roles.length <= 500, 'INVALID_ROLE_CONTEXT');
  for (const role of context.roles) {
    requireKeys(role, ['id', 'position', 'managed', 'permissions']);
    requireId(role.id); requireInteger(role.position, 0, 500);
    requireCondition(typeof role.managed === 'boolean' && typeof role.permissions === 'string' && /^\d{1,32}$/.test(role.permissions), 'INVALID_ROLE_CONTEXT');
  }
  requireCondition(new Set(context.roles.map(role => role.id)).size === context.roles.length, 'INVALID_ROLE_CONTEXT');
  requireCondition(context.roles.some(role => role.id === mapping.guildId), 'INVALID_ROLE_CONTEXT');
  for (const ids of [context.botRoleIds, context.memberRoleIds]) {
    requireCondition(Array.isArray(ids) && ids.length <= 500 && new Set(ids).size === ids.length, 'INVALID_ROLE_CONTEXT');
    ids.forEach(requireId);
    requireCondition(ids.every(id => context.roles.some(role => role.id === id)), 'ROLE_CONFIGURATION_INVALID');
  }
}

export function requireOwnedRoleChange(context, mapping, change, now) {
  validateRoleContext(context, mapping, now);
  const changes = {
    add_crew: ['crew', true], remove_crew: ['crew', false],
    add_muzzled: ['muzzled', true], remove_muzzled: ['muzzled', false],
    add_whitelist: ['whitelist', true], remove_whitelist: ['whitelist', false],
  };
  requireCondition(Object.hasOwn(changes, change), 'ROLE_CHANGE_NOT_OWNED');
  const [name, add] = changes[change];
  const roleId = mapping[name];
  const role = context.roles.find(item => item.id === roleId);
  requireCondition(role && !role.managed, 'ROLE_CONFIGURATION_INVALID');
  requireCondition(!add || !(BigInt(role.permissions) & PRIVILEGED), 'ROLE_CONFIGURATION_INVALID');
  const botRoles = context.roles.filter(item => item.id === mapping.guildId || context.botRoleIds.includes(item.id));
  const permissions = botRoles.reduce((bits, item) => bits | BigInt(item.permissions), 0n);
  requireCondition(!context.botTimedOut && !!(permissions & (MANAGE_ROLES | ADMINISTRATOR)), 'BOT_PERMISSION_MISSING');
  // Equal positions fail closed until Discord's ordering has been verified in staging.
  requireCondition(botRoles.some(item => item.position > role.position), 'ROLE_HIERARCHY_BLOCKED');
  requireCondition(context.userId !== mapping.botUserId, 'BOT_SELF_ROLE_CHANGE_DENIED');
  return { roleId, add };
}
