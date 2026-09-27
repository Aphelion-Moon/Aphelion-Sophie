import { requireCondition, requireFreshObservation, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { requireEditorRequestId } from '../../../modules/onboarding/authoring.js';
import { permissionBits } from '../../../platform/authorization/discord-permissions.js';
import { permissionDigest } from '../runtime/permission-configuration.js';
import { projectChannelMetadata } from './case-channels.js';

function requestKey(request) {
  requireKeys(request, ['binding', 'channelIds', 'categoryIds', 'roleIds']);
  requireKeys(request.binding, ['operationId', 'generation', 'candidateHash', 'controlHash']);
  for (const key of ['operationId', 'candidateHash', 'controlHash']) requireEditorRequestId(request.binding[key]);
  requireInteger(request.binding.generation, 1);
  for (const key of ['channelIds', 'categoryIds', 'roleIds']) {
    const ids = request[key]; requireCondition(Array.isArray(ids) && ids.length <= (key === 'channelIds' ? 10000 : 500), 'PERMISSION_INVENTORY_LIMIT');
    ids.forEach(requireId); requireCondition(new Set(ids).size === ids.length, 'PERMISSION_INVENTORY_INVALID');
  }
  return permissionDigest({ ...request, channelIds: [...request.channelIds].sort(), categoryIds: [...request.categoryIds].sort(), roleIds: [...request.roleIds].sort() });
}

/** Core-only metadata adapter. It has no message/member reads or permission writes. */
export function createPermissionChannelInventory({ transport, clock }) {
  requireId(transport.guildId); requireCondition(typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const observations = new WeakMap();
  return Object.freeze({
    guildId: transport.guildId,
    async read(request) {
      const fixed = structuredClone(request), key = requestKey(fixed), observedAt = clock();
      const rawRoles = await transport.getRoles(), rawChannels = await transport.getGuildChannels();
      requireCondition(Array.isArray(rawRoles) && rawRoles.length <= 500 && Array.isArray(rawChannels) && rawChannels.length <= 500, 'PERMISSION_INVENTORY_LIMIT');
      const roles = rawRoles.map(row => {
        requireId(row?.id); requireInteger(row.position, 0, 500); requireCondition(typeof row.managed === 'boolean', 'PERMISSION_INVENTORY_INVALID');
        return { id: row.id, position: row.position, managed: row.managed, permissions: String(permissionBits(row.permissions)) };
      });
      const channels = rawChannels.map(raw => projectChannelMetadata(raw, transport.guildId, true));
      for (const rows of [roles, channels]) requireCondition(new Set(rows.map(row => row.id)).size === rows.length, 'PERMISSION_INVENTORY_INVALID');
      const selected = new Set([...fixed.channelIds, ...fixed.categoryIds]), selectedRoles = new Set(fixed.roleIds);
      const snapshot = { guildId: transport.guildId,
        roles: roles.filter(row => selectedRoles.has(row.id)).sort((a, b) => a.id.localeCompare(b.id)),
        channels: channels.filter(row => selected.has(row.id) || row.marker !== null).map(row => ({ ...row,
          overwrites: row.overwrites.map(entry => ({ ...entry, allow: String(permissionBits(entry.allow)), deny: String(permissionBits(entry.deny)) }))
            .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`)) })).sort((a, b) => a.id.localeCompare(b.id)) };
      requireFreshObservation({ known: true, observedAt }, clock());
      const proof = Object.freeze({ sha256: permissionDigest(snapshot) });
      observations.set(proof, { key, snapshot, observedAt }); return proof;
    },
    snapshot(proof, request) {
      const record = observations.get(proof);
      requireCondition(record?.key === requestKey(request), 'PERMISSION_INVENTORY_UNTRUSTED');
      requireFreshObservation({ known: true, observedAt: record.observedAt }, clock());
      return structuredClone(record.snapshot);
    },
  });
}
