import { requireCondition, requireId } from '../../../contracts/validation.js';

/** Names and IDs only. Never return channel topics, overwrites, member lists or messages. */
export function createPermissionOptions({ transport }) {
  return Object.freeze({ async read() {
    const roles = await transport.getRoles(), channels = await transport.getGuildChannels();
    requireCondition(Array.isArray(roles) && roles.length <= 500 && Array.isArray(channels) && channels.length <= 500, 'PERMISSION_OPTIONS_INVALID');
    const name = row => {
      requireId(row.id); requireCondition(typeof row.name === 'string' && row.name.length <= 100, 'PERMISSION_OPTIONS_INVALID');
      return { id: row.id, name: row.name };
    };
    const result = { roles: roles.filter(row => row.managed === false).map(name), categories: channels.filter(row => row.type === 4).map(name) };
    for (const rows of Object.values(result)) requireCondition(new Set(rows.map(row => row.id)).size === rows.length, 'PERMISSION_OPTIONS_INVALID');
    return result;
  } });
}
