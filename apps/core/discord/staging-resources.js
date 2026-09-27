import { requireCondition, requireId } from '../../../contracts/validation.js';
import { PERMISSIONS } from '../../../platform/authorization/discord-permissions.js';

export const STAGING_ROLE_KEYS = Object.freeze(['crew', 'muzzled', 'whitelist', 'staff', 'leadOps']);
const labels = { crew: 'Crew', muzzled: 'Muzzled', whitelist: 'Whitelist', staff: 'Staff', leadOps: 'Head Admin' };
export const STAGING_BOT_PERMISSIONS = PERMISSIONS.manageRoles | PERMISSIONS.manageChannels | PERMISSIONS.viewChannel |
  PERMISSIONS.sendMessages | PERMISSIONS.readHistory | PERMISSIONS.embedLinks | PERMISSIONS.attachFiles | PERMISSIONS.addReactions;
// Discord permits only administrators to set Manage Roles in channel overwrites.
// Keep it on the bot's guild role; the private channel inherits that permission.
const channelBotPermissions = STAGING_BOT_PERMISSIONS & ~PERMISSIONS.manageRoles;
const readWrite = PERMISSIONS.viewChannel | PERMISSIONS.sendMessages | PERMISSIONS.readHistory | PERMISSIONS.embedLinks | PERMISSIONS.addReactions;
export function requireStagingMarker(marker) { requireCondition(typeof marker === 'string' && /^[a-f0-9]{16}$/.test(marker), 'STAGING_BOOTSTRAP_INVALID'); }
export function stagingRolePayload(key, marker) {
  requireStagingMarker(marker); requireCondition(STAGING_ROLE_KEYS.includes(key), 'STAGING_BOOTSTRAP_INVALID');
  return { name: `Sophie Test ${labels[key]} [${marker}]`, permissions: '0', hoist: false, mentionable: key === 'staff' };
}
export function stagingChannelPayload(kind, marker, guildId, botUserId, roles = null) {
  requireStagingMarker(marker); requireId(guildId); requireId(botUserId);
  requireCondition(['category', 'lobby'].includes(kind), 'STAGING_BOOTSTRAP_INVALID');
  const overwrite = (id, type, allow, deny = 0n) => ({ id, type, allow: String(allow), deny: String(deny) });
  const permission_overwrites = [overwrite(guildId, 0, 0n, PERMISSIONS.viewChannel), overwrite(botUserId, 1, channelBotPermissions)];
  if (kind === 'lobby') for (const key of ['crew', 'staff', 'leadOps']) { requireId(roles?.[key]); permission_overwrites.push(overwrite(roles[key], 0, readWrite)); }
  return { name: kind === 'category' ? `Sophie Test Cases [${marker}]` : `sophie-test-${marker}`,
    type: kind === 'category' ? 4 : 0, parent_id: null, permission_overwrites };
}
