import { requireCondition, requireId, requireInteger, requireRecord } from '../../../contracts/validation.js';
import { validateGatewayChange, validateGatewaySession, validateGatewayUrl } from '../../../contracts/gateway.js';

/** Metadata-only projection inside core. Unknown dispatch bodies are not inspected or retained. */
export function projectGatewayDispatch(payload, configuration, now) {
  const { guildId, botUserId, applicationId } = configuration;
  requireRecord(payload); requireCondition(payload.op === 0, 'INVALID_GATEWAY_DISPATCH');
  requireInteger(payload.s); requireInteger(now);
  requireCondition(typeof payload.t === 'string' && /^[A-Z_]{1,80}$/.test(payload.t), 'INVALID_GATEWAY_DISPATCH');
  const ignored = { sequence: payload.s, change: { kind: 'ignored' } };
  if (payload.t === 'READY') {
    const data = payload.d;
    requireCondition(data?.user?.id === botUserId && data.user.bot === true && data.application?.id === applicationId, 'GATEWAY_IDENTITY_MISMATCH');
    requireCondition(Array.isArray(data.guilds) && data.guilds.some(guild => guild.id === guildId), 'GATEWAY_GUILD_MISSING');
    validateGatewaySession(data.session_id); validateGatewayUrl(data.resume_gateway_url);
    return { sequence: payload.s, ready: { sessionId: data.session_id, resumeUrl: data.resume_gateway_url } };
  }
  if (payload.t === 'RESUMED') return { sequence: payload.s, change: { kind: 'resumed' } };
  const supported = ['GUILD_CREATE', 'GUILD_DELETE', 'GUILD_UPDATE', 'GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE',
    'GUILD_MEMBER_REMOVE', 'GUILD_ROLE_CREATE', 'GUILD_ROLE_UPDATE', 'GUILD_ROLE_DELETE',
    'CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE', 'THREAD_CREATE', 'THREAD_UPDATE', 'THREAD_DELETE'];
  if (!supported.includes(payload.t)) return ignored;
  const data = payload.d; requireRecord(data, 'INVALID_GATEWAY_DISPATCH');
  const guildEvent = ['GUILD_CREATE', 'GUILD_DELETE', 'GUILD_UPDATE'].includes(payload.t);
  const eventGuild = guildEvent ? data.id : data.guild_id;
  requireId(eventGuild);
  if (eventGuild !== guildId) return ignored;
  let change;
  if (payload.t === 'GUILD_CREATE' || payload.t === 'GUILD_DELETE') {
    requireCondition(data.unavailable === undefined || typeof data.unavailable === 'boolean', 'INVALID_GATEWAY_DISPATCH');
    change = { kind: 'guild', available: payload.t === 'GUILD_CREATE' && data.unavailable !== true };
    if (change.available) requireCondition(Array.isArray(data.roles) && data.roles.length <= 500 &&
      ['crew', 'muzzled', 'whitelist', 'staff', 'leadOps'].every(key => data.roles.some(role => role.id === configuration[key])), 'ROLE_CONFIGURATION_INVALID');
  } else if (payload.t === 'GUILD_UPDATE') change = { kind: 'authority' };
  else if (payload.t.startsWith('GUILD_ROLE_')) change = { kind: 'role',
    roleId: payload.t === 'GUILD_ROLE_DELETE' ? data.role_id : data.role?.id, deleted: payload.t === 'GUILD_ROLE_DELETE' };
  else if (payload.t.startsWith('GUILD_MEMBER_')) {
    const present = payload.t !== 'GUILD_MEMBER_REMOVE';
    requireId(data.user?.id);
    const roleIds = present ? data.roles : [];
    let timedOut = false;
    if (present && data.communication_disabled_until != null) {
      const until = Date.parse(data.communication_disabled_until);
      requireCondition(Number.isFinite(until), 'INVALID_GATEWAY_DISPATCH'); timedOut = until > now;
    }
    change = { kind: 'member', userId: data.user.id, present, roleIds,
      bot: present && data.user.bot === true, timedOut };
  } else change = { kind: 'channel', channelId: data.id, parentId: data.parent_id ?? null };
  validateGatewayChange(change);
  return { sequence: payload.s, change: structuredClone(change) };
}
