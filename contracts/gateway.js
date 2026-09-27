import { requireCondition, requireId, requireInteger, requireKeys, requireName } from './validation.js';

export function validateGatewayLease(lease) {
  requireKeys(lease, ['guildId', 'owner', 'fence']);
  requireId(lease.guildId); requireName(lease.owner); requireInteger(lease.fence, 1);
}

export function validateGatewaySession(sessionId) {
  requireCondition(typeof sessionId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(sessionId), 'INVALID_GATEWAY_SESSION');
}

/** Discord-supplied resume locations cannot become an arbitrary network capability. */
export function validateGatewayUrl(value) {
  requireCondition(typeof value === 'string' && value.length <= 256, 'INVALID_GATEWAY_URL');
  let url;
  try { url = new URL(value); } catch { requireCondition(false, 'INVALID_GATEWAY_URL'); }
  requireCondition(url.protocol === 'wss:' && /^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(url.hostname) &&
    (!url.port || url.port === '443') && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'INVALID_GATEWAY_URL');
}

export function validateGatewayChange(change) {
  const fields = { ignored: ['kind'], resumed: ['kind'], guild: ['kind', 'available'], authority: ['kind'],
    role: ['kind', 'roleId', 'deleted'], member: ['kind', 'userId', 'present', 'roleIds', 'bot', 'timedOut'], channel: ['kind', 'channelId', 'parentId'] };
  requireCondition(Object.hasOwn(fields, change?.kind), 'INVALID_GATEWAY_CHANGE');
  requireKeys(change, fields[change.kind]);
  if (change.kind === 'guild') requireCondition(typeof change.available === 'boolean', 'INVALID_GATEWAY_CHANGE');
  if (change.kind === 'role') { requireId(change.roleId); requireCondition(typeof change.deleted === 'boolean', 'INVALID_GATEWAY_CHANGE'); }
  if (change.kind === 'channel') {
    requireId(change.channelId); if (change.parentId !== null) requireId(change.parentId);
  }
  if (change.kind === 'member') {
    requireId(change.userId);
    for (const key of ['present', 'bot', 'timedOut']) requireCondition(typeof change[key] === 'boolean', 'INVALID_GATEWAY_CHANGE');
    requireCondition(Array.isArray(change.roleIds) && change.roleIds.length <= 500 &&
      new Set(change.roleIds).size === change.roleIds.length, 'INVALID_GATEWAY_CHANGE');
    change.roleIds.forEach(requireId);
    requireCondition(change.present || (!change.roleIds.length && !change.bot && !change.timedOut), 'INVALID_GATEWAY_CHANGE');
  }
}

export function requireContinuityStamp(stamp) {
  requireCondition(typeof stamp === 'string' && stamp.length > 0 && stamp.length <= 512, 'OBSERVATION_UNAVAILABLE');
  return stamp;
}
