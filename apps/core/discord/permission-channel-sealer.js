import { requireCondition, requireFreshObservation, requireId, requireKeys } from '../../../contracts/validation.js';
import { validateRoleContext, validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { CASE_CHANNEL_BITS, sameOverwrites } from '../../../modules/tickets/channel-policy.js';
import { PERMISSIONS, channelPermissions, guildPermissions } from '../../../platform/authorization/discord-permissions.js';
import { permissionDigest } from '../runtime/permission-configuration.js';
import { projectChannelMetadata } from './case-channels.js';

export const sealedPermissionOverwrites = (guildId, botUserId) => [
  { id: guildId, type: 0, allow: '0', deny: String(CASE_CHANNEL_BITS) },
  { id: botUserId, type: 1, allow: String(CASE_CHANNEL_BITS), deny: '0' },
];

/** The only mutation this adapter can issue is a fixed bot-only audience. */
export function createPermissionChannelSealer({ transport, roles, mapping, clock }) {
  validateRoleMapping(mapping);
  requireCondition(transport.guildId === mapping.guildId && roles.guildId === mapping.guildId && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const fixed = structuredClone(mapping), prepared = new WeakMap(), observed = new WeakMap();
  const targetKey = target => {
    requireKeys(target, ['guildId', 'channelId', 'marker', 'parentId']);
    for (const key of ['guildId', 'channelId', 'parentId']) requireId(target[key]);
    requireCondition(target.guildId === fixed.guildId && typeof target.marker === 'string' && /^sophie:case:v1:[a-f0-9]{48}$/.test(target.marker), 'CASE_CHANNEL_MISMATCH');
    return permissionDigest(target);
  };
  const isSealed = (channel, target) => channel.parentId === target.parentId && sameOverwrites(channel.overwrites, sealedPermissionOverwrites(fixed.guildId, fixed.botUserId));
  async function channel(target) {
    const row = projectChannelMetadata(await transport.getChannel(target.channelId), fixed.guildId);
    requireCondition(row.id === target.channelId && row.type === 0 && row.marker === target.marker, 'CASE_CHANNEL_MISMATCH'); return row;
  }
  return Object.freeze({
    guildId: fixed.guildId,
    async prepare(target) {
      const key = targetKey(target), bound = structuredClone(target);
      // Preparing the bot itself avoids reading any case member's profile/content.
      const { context } = await roles.prepare(fixed.botUserId); validateRoleContext(context, fixed, clock());
      const current = await channel(bound), category = projectChannelMetadata(await transport.getChannel(bound.parentId), fixed.guildId);
      requireCondition(category.id === bound.parentId && category.type === 4, 'CASE_CATEGORY_INVALID');
      const principal = { guildId: fixed.guildId, userId: fixed.botUserId, roleIds: context.botRoleIds,
        roles: context.roles.map(row => ({ id: row.id, permissions: row.permissions })) };
      const needed = PERMISSIONS.viewChannel | PERMISSIONS.manageChannels | PERMISSIONS.manageRoles;
      requireCondition(!context.botTimedOut && (guildPermissions(principal) & (needed | CASE_CHANNEL_BITS)) === (needed | CASE_CHANNEL_BITS) &&
        [current, category].every(row => (channelPermissions({ ...principal, overwrites: row.overwrites }) & needed) === needed), 'BOT_PERMISSION_MISSING');
      await roles.assertCurrent(context);
      const proof = Object.freeze({ alreadySealed: isSealed(current, bound) }); prepared.set(proof, { key, target: bound, context }); return proof;
    },
    async apply(proof, target, authorize) {
      const record = prepared.get(proof); requireCondition(record?.key === targetKey(target), 'PERMISSION_SEAL_UNTRUSTED');
      prepared.delete(proof);
      requireCondition(typeof authorize === 'function' && await authorize() === true, 'MAINTENANCE_STALE');
      await roles.assertCurrent(record.context);
      if (proof.alreadySealed) return { written: false };
      const result = await transport.replaceCaseAudience(record.target.channelId, record.target.parentId, sealedPermissionOverwrites(fixed.guildId, fixed.botUserId));
      requireCondition(result?.id === record.target.channelId && result.guild_id === fixed.guildId, 'CASE_CHANNEL_MISMATCH');
      return { written: true };
    },
    async inspect(target) {
      const key = targetKey(target), bound = structuredClone(target), observedAt = clock(), current = await channel(bound);
      requireFreshObservation({ known: true, observedAt }, clock());
      const proof = Object.freeze({ sealed: isSealed(current, bound) }); observed.set(proof, { key, observedAt }); return proof;
    },
    verify(proof, target) {
      const record = observed.get(proof); requireCondition(record?.key === targetKey(target), 'PERMISSION_SEAL_UNTRUSTED');
      requireFreshObservation({ known: true, observedAt: record.observedAt }, clock());
      requireCondition(proof.sealed === true, 'PERMISSION_CHANNEL_NOT_SEALED'); return true;
    },
  });
}
