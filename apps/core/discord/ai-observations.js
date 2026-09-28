import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { channelPermissions, PERMISSIONS, validateOverwrites } from '../../../platform/authorization/discord-permissions.js';
import { aiDigest } from '../storage/ai-controls.js';

/** Core-only live metadata. The returned narrow adapters cannot expose case content or credentials. */
export function createAiObservations({ pool, transport, authorityStore, capabilityPolicy, mapping, protectedCategoryId, observer, clock }) {
  const cache = new Map(), members = new WeakMap();
  const guildId = mapping.guildId, botUserId = mapping.botUserId;
  async function continuity() { const stamp = await observer.readAiContinuity(); requireCondition(typeof stamp === 'string', 'AI_AUTHORITY_UNAVAILABLE'); return stamp; }
  async function metadata(key, stamp, read) {
    const saved = cache.get(key), now = clock();
    if (saved?.stamp === stamp && saved.at <= now && now - saved.at < 2000) return saved;
    const value = { at: now, stamp, value: await read() };
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, value); return value;
  }
  async function excluded(channelId, parentId = null) {
    if (channelId === protectedCategoryId || parentId === protectedCategoryId) return true;
    return (await pool.query('SELECT 1 FROM sophie_core.case_exclusions WHERE guild_id=$1 AND channel_id=ANY($2::text[]) LIMIT 1',
      [guildId, [channelId, ...(parentId ? [parentId] : [])]])).rowCount > 0;
  }
  function roleIds(member, userId) {
    requireCondition(member?.user?.id === userId && Array.isArray(member.roles) && member.roles.length <= 500, 'AI_MEMBER_INVALID');
    member.roles.forEach(requireId); requireCondition(new Set(member.roles).size === member.roles.length, 'AI_MEMBER_INVALID'); return member.roles;
  }
  function timedOut(member) {
    if (member.communication_disabled_until == null) return false;
    const until = Date.parse(member.communication_disabled_until); requireCondition(Number.isFinite(until), 'AI_MEMBER_INVALID'); return until > clock();
  }
  async function inspect(event) {
    requireCondition(event.guildId === guildId, 'FOREIGN_GUILD'); requireId(event.channelId); requireId(event.userId);
    if (await excluded(event.channelId)) return null;
    const stamp = await continuity(), started = clock();
    const channel = await metadata(`channel.${event.channelId}`, stamp, () => transport.getChannel(event.channelId));
    const raw = channel.value;
    if (raw?.id !== event.channelId || raw.guild_id !== guildId || raw.type !== 0 || await excluded(raw.id, raw.parent_id)) return null;
    validateOverwrites(raw.permission_overwrites);
    const guild = await metadata('guild', stamp, () => transport.getGuild()); requireCondition(guild.value?.id === guildId, 'FOREIGN_GUILD'); requireId(guild.value.owner_id);
    const roles = await metadata('roles', stamp, () => transport.getRoles());
    requireCondition(Array.isArray(roles.value) && roles.value.length > 0 && roles.value.length <= 500, 'AI_ROLES_INVALID');
    const projected = roles.value.map(role => { requireInteger(role.position, 0, 500); return { id: role.id, permissions: role.permissions }; });
    const bot = await metadata('bot', stamp, () => transport.getMember(botUserId)), botRoles = roleIds(bot.value, botUserId);
    const member = await metadata(`member.${event.userId}`, stamp, () => transport.getMember(event.userId));
    if (member.value === null) return null;
    const userRoles = roleIds(member.value, event.userId);
    if (bot.value.user.bot !== true || member.value.user.bot === true || timedOut(bot.value) || timedOut(member.value) || userRoles.includes(mapping.muzzled)) return null;
    const permissions = (userId, roleIds) => channelPermissions({ guildId, userId, ownerId: guild.value.owner_id, roleIds, roles: projected, overwrites: raw.permission_overwrites });
    const humanBits = permissions(event.userId, userRoles), botBits = permissions(botUserId, botRoles);
    const humanRequired = PERMISSIONS.viewChannel | PERMISSIONS.sendMessages, botRequired = PERMISSIONS.viewChannel | PERMISSIONS.readHistory;
    if ((humanBits & humanRequired) !== humanRequired || (botBits & botRequired) !== botRequired) return null;
    const at = Math.min(started, ...[channel, guild, roles, bot, member].map(value => value.at));
    if (clock() - at >= 5000 || await continuity() !== stamp || await excluded(raw.id, raw.parent_id)) return null;
    const observation = { guildId, userId: event.userId, known: true, observedAt: at, present: true, roleIds: userRoles,
      bot: false, timedOut: false, administrator: userRoles.concat(guildId).some(id => projected.some(role => role.id === id && (BigInt(role.permissions) & PERMISSIONS.administrator) !== 0n)),
      guildOwner: guild.value.owner_id === event.userId,
      highestRolePosition: Math.max(0, ...roles.value.filter(role => role.id === guildId || userRoles.includes(role.id)).map(role => role.position)) };
    await authorityStore.registerPolicy(capabilityPolicy);
    const authority = await authorityStore.observeWithPresence(observation, capabilityPolicy.version);
    if (await continuity() !== stamp || clock() - at >= 5000) return null;
    // A bot-specific allow does not make a private channel visible to ordinary members.
    const everyone = channelPermissions({ guildId, userId: botUserId, roleIds: [], roles: projected, overwrites: raw.permission_overwrites.filter(value => value.type === 0) });
    return { checkedAt: at, eligible: true, continuity: stamp, botBits, botRoles,
      restricted: (everyone & PERMISSIONS.viewChannel) === 0n,
      presenceEpoch: authority.presenceEpoch, accessEpoch: authority.grant.capabilityEpoch,
      audienceHash: aiDigest({ guildId, channelId: raw.id, parentId: raw.parent_id ?? null, ownerId: guild.value.owner_id,
        roles: projected.sort((a, b) => a.id.localeCompare(b.id)), overwrites: [...raw.permission_overwrites].sort((a, b) => `${a.type}.${a.id}`.localeCompare(`${b.type}.${b.id}`)) }) };
  }
  return Object.freeze({
    async inspectContext(event) {
      members.delete(event); const current = await inspect(event); if (!current) return null;
      // Gateway commits deterministic decisions before handing this same create event to AI.
      // An admitted automation keeps ownership even when its delivery later becomes uncertain.
      if ((await pool.query('SELECT 1 FROM sophie_core.automation_deliveries WHERE guild_id=$1 AND message_id=$2 LIMIT 1', [guildId,event.messageId])).rowCount) return null;
      const source = await transport.getAiSourceMetadata(event.channelId, event.messageId);
      if (source?.id !== event.messageId || source.channelId !== event.channelId || source.authorId !== event.userId || source.bot || source.webhook || ![0, 19].includes(source.type) ||
        await continuity() !== current.continuity || clock() - current.checkedAt >= 5000) return null;
      members.set(event, current);
      return { eligible: true, checkedAt: current.checkedAt, audienceHash: current.audienceHash, restricted: current.restricted,
        continuity: current.continuity, messageRevision: source.revision,
        canReply: (current.botBits & PERMISSIONS.sendMessages) !== 0n, canReact: (current.botBits & PERMISSIONS.addReactions) !== 0n };
    },
    async inspectMember(event) { const current = members.get(event); members.delete(event); return current ?? null; },
    async canReact(request, emoji) {
      const current = await inspect(request); if (!current || (current.botBits & PERMISSIONS.addReactions) === 0n) return false;
      if (emoji.id !== null) {
        const actual = await transport.getAutomationEmoji(emoji.id);
        if (actual?.id !== emoji.id || actual.name !== emoji.name || actual.available === false || !Array.isArray(actual.roles) || actual.roles.length && !actual.roles.some(id => current.botRoles.includes(id))) return false;
      }
      const source = await transport.getAutomationSource(request.channelId, request.messageId);
      return source?.id === request.messageId && source.channelId === request.channelId && source.authorId === request.userId &&
        !(source.reactions ?? []).some(item => item.me && item.emoji?.id === emoji.id && (emoji.id !== null || item.emoji?.name === emoji.name)) &&
        clock() - current.checkedAt < 5000 && await continuity() === current.continuity;
    },
    clear() { cache.clear(); },
  });
}
