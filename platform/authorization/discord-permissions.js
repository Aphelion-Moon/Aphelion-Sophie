import { requireCondition, requireId, requireKeys } from '../../contracts/validation.js';

export const PERMISSIONS = Object.freeze({
  administrator: 1n << 3n, manageChannels: 1n << 4n, addReactions: 1n << 6n,
  viewChannel: 1n << 10n, sendMessages: 1n << 11n, embedLinks: 1n << 14n,
  attachFiles: 1n << 15n, readHistory: 1n << 16n, manageRoles: 1n << 28n,
  manageThreads: 1n << 34n,
  createPublicThreads: 1n << 35n, createPrivateThreads: 1n << 36n, sendMessagesInThreads: 1n << 38n,
  sendVoiceMessages: 1n << 46n, sendPolls: 1n << 49n, useExternalApps: 1n << 50n,
});

export function permissionBits(value) {
  requireCondition(typeof value === 'string' && /^\d{1,32}$/.test(value), 'INVALID_PERMISSION_BITS');
  return BigInt(value);
}

export function validateOverwrites(overwrites) {
  requireCondition(Array.isArray(overwrites) && overwrites.length <= 100, 'INVALID_CHANNEL_OVERWRITES');
  const seen = new Set();
  for (const entry of overwrites) {
    requireKeys(entry, ['id', 'type', 'allow', 'deny']); requireId(entry.id);
    requireCondition(entry.type === 0 || entry.type === 1, 'INVALID_CHANNEL_OVERWRITES');
    const key = `${entry.type}:${entry.id}`;
    requireCondition(!seen.has(key), 'INVALID_CHANNEL_OVERWRITES'); seen.add(key);
    requireCondition((permissionBits(entry.allow) & permissionBits(entry.deny)) === 0n, 'INVALID_CHANNEL_OVERWRITES');
  }
}

export function guildPermissions({ guildId, userId, ownerId = null, roleIds, roles }) {
  requireId(guildId); requireId(userId); if (ownerId !== null) requireId(ownerId);
  requireCondition(Array.isArray(roles) && roles.length > 0 && roles.length <= 500, 'INVALID_GUILD_ROLES');
  const byId = new Map();
  for (const role of roles) {
    requireKeys(role, ['id', 'permissions']); requireId(role.id);
    requireCondition(!byId.has(role.id), 'INVALID_GUILD_ROLES'); byId.set(role.id, permissionBits(role.permissions));
  }
  requireCondition(byId.has(guildId) && Array.isArray(roleIds) && roleIds.length <= 500 && new Set(roleIds).size === roleIds.length, 'INVALID_ACTOR_ROLES');
  roleIds.forEach(id => { requireId(id); requireCondition(byId.has(id), 'INVALID_ACTOR_ROLES'); });
  let permissions = byId.get(guildId);
  for (const id of roleIds) permissions |= byId.get(id);
  return userId === ownerId || (permissions & PERMISSIONS.administrator) !== 0n ? -1n : permissions;
}

/** Role position has no part in overwrite precedence. Administrator/owner bypass is explicit. */
export function channelPermissions({ guildId, userId, ownerId = null, roleIds, roles, overwrites }) {
  validateOverwrites(overwrites);
  let permissions = guildPermissions({ guildId, userId, ownerId, roleIds, roles });
  if (permissions === -1n) return permissions;
  const everyone = overwrites.find(entry => entry.type === 0 && entry.id === guildId);
  if (everyone) permissions = (permissions & ~permissionBits(everyone.deny)) | permissionBits(everyone.allow);
  let allowed = 0n, denied = 0n;
  for (const entry of overwrites) {
    if (entry.type === 0 && entry.id !== guildId && roleIds.includes(entry.id)) {
      allowed |= permissionBits(entry.allow); denied |= permissionBits(entry.deny);
    }
  }
  permissions = (permissions & ~denied) | allowed;
  const member = overwrites.find(entry => entry.type === 1 && entry.id === userId);
  return member ? (permissions & ~permissionBits(member.deny)) | permissionBits(member.allow) : permissions;
}
