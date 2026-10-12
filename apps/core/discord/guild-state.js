import { requireCondition, requireId } from '../../../contracts/validation.js';

const ID = /^[1-9][0-9]{0,19}$/; const BITS = /^[0-9]{1,20}$/;
const MAX_ROLES = 500; const MAX_CHANNELS = 2000;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && ID.test(value);
const timeOf = value => { if (typeof value !== 'string') return null; const time = Date.parse(value); return Number.isFinite(time) ? time : null; };

function normalizeRole(raw) {
  if (!isRecord(raw) || !isId(raw.id) || typeof raw.position !== 'number' || !Number.isFinite(raw.position)) return null;
  const permissions = String(raw.permissions);
  return BITS.test(permissions) ? { id: raw.id, permissions, position: raw.position } : null;
}

function normalizeOverwrite(raw) {
  if (!isRecord(raw) || !isId(raw.id)) return null;
  const type = Number(raw.type); const allow = String(raw.allow); const deny = String(raw.deny);
  return (type === 0 || type === 1) && BITS.test(allow) && BITS.test(deny) ? { id: raw.id, type, allow, deny } : null;
}

// One bad overwrite invalidates the whole channel: silently dropping a deny would widen access.
function normalizeChannel(raw) {
  if (!isRecord(raw) || !isId(raw.id) || !Number.isInteger(raw.type)) return null;
  const source = raw.permission_overwrites ?? [];
  if (!Array.isArray(source)) return null;
  const overwrites = source.map(normalizeOverwrite);
  return overwrites.includes(null) ? null : { id: raw.id, type: raw.type, parentId: isId(raw.parent_id) ? raw.parent_id : null, overwrites };
}

function normalizeMember(raw, user = raw?.user) {
  if (!isRecord(raw) || !isRecord(user) || !isId(user.id) || !Array.isArray(raw.roles)) return null;
  return { userId: user.id, bot: user.bot === true, roles: [...new Set(raw.roles.filter(isId))],
    joinedAt: timeOf(raw.joined_at), timedOutUntil: timeOf(raw.communication_disabled_until) };
}

function normalizeEmoji(raw) {
  if (!isRecord(raw) || !isId(raw.id)) return null;
  return { id: raw.id, name: typeof raw.name === 'string' ? raw.name : null, available: raw.available !== false,
    roles: Array.isArray(raw.roles) ? [...new Set(raw.roles.filter(isId))] : [] };
}

/** In-memory projection of one guild's roles, channels, members and message identity, maintained from Gateway dispatches. Performs no I/O. */
export function createGuildState({ guildId, botUserId, messageCapacity = 5000, memberCapacity = 100000 }) {
  requireId(guildId); requireId(botUserId);
  requireCondition(Number.isSafeInteger(messageCapacity) && messageCapacity > 0 && Number.isSafeInteger(memberCapacity) && memberCapacity > 0, 'INVALID_INTEGER');
  const roles = new Map(); const channels = new Map(); const members = new Map(); const emojis = new Map(); const messages = new Map();
  let guild = null; let ready = false; let session = 0;

  // Map iteration order is insertion order, so delete-then-set both refreshes an entry and keeps the first key the oldest.
  const remember = (map, capacity, key, value) => {
    map.delete(key); map.set(key, value);
    while (map.size > capacity) map.delete(map.keys().next().value);
  };
  const storeMember = member => { if (member) remember(members, memberCapacity, member.userId, member); };
  const storeRole = role => { if (role && (roles.has(role.id) || roles.size < MAX_ROLES)) roles.set(role.id, role); };
  const storeChannel = (raw) => {
    const channel = normalizeChannel(raw);
    // An update that no longer validates must not leave the stale permission data behind.
    if (!channel) { if (isRecord(raw) && isId(raw.id)) channels.delete(raw.id); return; }
    if (channels.has(channel.id) || channels.size < MAX_CHANNELS) channels.set(channel.id, channel);
  };
  const replaceRoles = list => { const next = list.map(normalizeRole).filter(Boolean); roles.clear(); next.forEach(storeRole); };
  const replaceEmojis = list => { const next = list.map(normalizeEmoji).filter(Boolean); emojis.clear(); next.forEach(item => emojis.set(item.id, item)); };
  const clearAll = () => { guild = null; roles.clear(); channels.clear(); members.clear(); emojis.clear(); messages.clear(); };

  function guildCreate(data) {
    if (data.unavailable === true) { ready = false; return; }
    if (!Array.isArray(data.roles) || !Array.isArray(data.channels)) { ready = false; return; }
    guild = { id: data.id, ownerId: isId(data.owner_id) ? data.owner_id : null };
    replaceRoles(data.roles);
    channels.clear();
    [...data.channels, ...(Array.isArray(data.threads) ? data.threads : [])].forEach(storeChannel);
    if (Array.isArray(data.members)) data.members.forEach(raw => storeMember(normalizeMember(raw)));
    if (Array.isArray(data.emojis)) replaceEmojis(data.emojis);
    ready = true;
  }

  function messageCreate(data) {
    if (!isRecord(data.author) || !isId(data.author.id)) return;
    // The partial member on a message is current as of that message; webhook authors are not guild members.
    if (isRecord(data.member) && data.webhook_id == null) storeMember(normalizeMember({ ...data.member, user: data.author }));
    if (isId(data.id) && isId(data.channel_id)) remember(messages, messageCapacity, data.id, { channelId: data.channel_id, authorId: data.author.id, revision: 'original' });
  }

  function dispatch(type, data) {
    switch (type) {
      case 'GUILD_CREATE': return guildCreate(data);
      case 'GUILD_UPDATE':
        if (guild && isId(data.owner_id)) guild.ownerId = data.owner_id;
        if (Array.isArray(data.roles)) replaceRoles(data.roles);
        return;
      case 'GUILD_DELETE': ready = false; return;
      case 'GUILD_ROLE_CREATE': case 'GUILD_ROLE_UPDATE': return storeRole(normalizeRole(data.role));
      case 'GUILD_ROLE_DELETE':
        if (!isId(data.role_id)) return;
        roles.delete(data.role_id);
        // Discord sends no member updates when a role is deleted, so cached members would keep the dead id.
        for (const member of members.values()) if (member?.roles.includes(data.role_id)) member.roles = member.roles.filter(id => id !== data.role_id);
        return;
      case 'CHANNEL_CREATE': case 'CHANNEL_UPDATE': case 'THREAD_CREATE': case 'THREAD_UPDATE': return storeChannel(data);
      case 'CHANNEL_DELETE': case 'THREAD_DELETE': if (isId(data.id)) channels.delete(data.id); return;
      case 'GUILD_MEMBER_ADD': case 'GUILD_MEMBER_UPDATE': return storeMember(normalizeMember(data));
      case 'GUILD_MEMBER_REMOVE': if (isRecord(data.user) && isId(data.user.id)) remember(members, memberCapacity, data.user.id, null); return;
      case 'GUILD_EMOJIS_UPDATE': if (Array.isArray(data.emojis)) replaceEmojis(data.emojis); return;
      case 'MESSAGE_CREATE': return messageCreate(data);
      case 'MESSAGE_UPDATE': {
        const known = isId(data.id) ? messages.get(data.id) : null;
        if (known && typeof data.edited_timestamp === 'string') known.revision = data.edited_timestamp;
        return;
      }
      case 'MESSAGE_DELETE': if (isId(data.id)) remember(messages, messageCapacity, data.id, null); return;
      case 'MESSAGE_DELETE_BULK': if (Array.isArray(data.ids)) for (const id of data.ids) if (isId(id)) remember(messages, messageCapacity, id, null); return;
      default:
    }
  }

  /** Never throws: this runs on the Gateway read path and a bad dispatch must not take the connection down. */
  function accept(payload) {
    let type;
    try {
      if (!isRecord(payload) || payload.op !== 0 || typeof payload.t !== 'string') return;
      type = payload.t;
      if (type === 'READY') { clearAll(); ready = false; session += 1; return; }
      const data = payload.d;
      if (!isRecord(data)) return;
      const own = type === 'GUILD_CREATE' || type === 'GUILD_UPDATE' || type === 'GUILD_DELETE' ? data.id : data.guild_id;
      if (own !== guildId) return;
      dispatch(type, data);
    } catch {
      // A half-applied GUILD_CREATE cannot be trusted; other handlers mutate one entry at a time.
      if (type === 'GUILD_CREATE') ready = false;
    }
  }

  function rememberMember(userId, raw) {
    try {
      if (!isId(userId)) return;
      if (raw === null) { remember(members, memberCapacity, userId, null); return; }
      if (!isRecord(raw) || raw.user?.id !== userId) return;
      storeMember(normalizeMember(raw));
    } catch { /* invalid REST bodies are skipped */ }
  }

  return Object.freeze({
    accept, rememberMember,
    ready: () => ready, session: () => session,
    guild: () => (guild ? structuredClone(guild) : null),
    roles: () => structuredClone([...roles.values()]),
    channel: id => (channels.has(id) ? structuredClone(channels.get(id)) : null),
    member: userId => (members.has(userId) ? structuredClone(members.get(userId)) : undefined),
    emoji: id => (emojis.has(id) ? structuredClone(emojis.get(id)) : null),
    message: id => (messages.has(id) ? structuredClone(messages.get(id)) : undefined),
    status: () => ({ ready, session, roles: roles.size, channels: channels.size, members: members.size, messages: messages.size }),
  });
}
