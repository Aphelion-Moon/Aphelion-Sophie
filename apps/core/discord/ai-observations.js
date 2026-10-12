import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { channelPermissions, PERMISSIONS, validateOverwrites } from '../../../platform/authorization/discord-permissions.js';
import { aiDigest } from '../storage/ai-controls.js';

/**
 * Core-only live metadata, read from the Gateway-maintained guild state rather than Discord REST. Discord pushes every
 * member, role and channel change to core as it happens, so this is current state, not a snapshot; it is refused while
 * the Gateway is not current. The returned narrow adapters cannot expose case content or credentials.
 */
export function createAiObservations({ pool, transport, guildState, authorityStore, capabilityPolicy, mapping, protectedCategoryId, observer, clock,
  trace = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  requireCondition(guildState && ['accept', 'ready', 'session', 'revision', 'guild', 'roles', 'channel', 'member', 'rememberMember', 'emoji', 'message'].every(name => typeof guildState[name] === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  const members = new WeakMap();
  let generation = 0;
  const guildId = mapping.guildId, botUserId = mapping.botUserId;
  // A member the Gateway has not described yet (large guilds omit members from GUILD_CREATE) is read once over REST;
  // later Gateway member events keep it current. Short cooldowns are waited out within a bounded total.
  async function patient(read, label) {
    let waited = 0;
    for (;;) {
      try { return await read(); } catch (error) {
        const retry = error?.retryAfterMs;
        if (['RATE_LIMITED', 'DISCORD_BUSY'].includes(error?.code) && Number.isSafeInteger(retry) && retry <= 2500 && waited + retry <= 3000) {
          waited += Math.max(50, retry); await wait(Math.max(50, retry)); continue;
        }
        // Route class and cooldown only: no identifiers.
        if (['RATE_LIMITED', 'DISCORD_BUSY'].includes(error?.code)) {
          try { trace(`AI_OBSERVATION_LIMITED_${label}_${error.code}_${Number.isSafeInteger(retry) ? Math.min(99999, retry) : 0}MS`); } catch { /* Diagnostics only. */ }
        }
        throw error;
      }
    }
  }
  async function memberOf(userId, label) {
    const known = guildState.member(userId);
    if (known !== undefined) return known;
    const raw = await patient(() => transport.getMember(userId), label);
    guildState.rememberMember(userId, raw ?? null);
    return guildState.member(userId) ?? null;
  }
  async function excluded(channelId, parentId = null) {
    if (channelId === protectedCategoryId || parentId === protectedCategoryId) return true;
    return (await pool.query('SELECT 1 FROM sophie_core.case_exclusions WHERE guild_id=$1 AND channel_id=ANY($2::text[]) LIMIT 1',
      [guildId, [channelId, ...(parentId ? [parentId] : [])]])).rowCount > 0;
  }
  // A resumed Gateway session replays missed events but never resends GUILD_CREATE, so a core process that started by
  // resuming has an empty projection. It is hydrated once over REST (one guild read with roles, emojis and owner, one
  // channel list; members are read lazily) while the Gateway is current. A guild event that arrives during the reads
  // retries, so the older REST snapshot never overwrites it; a new session (READY) abandons the attempt.
  let hydrating = null;
  function hydrate() {
    hydrating ??= (async () => {
      for (let attempt = 0; attempt < 3 && !guildState.ready(); attempt++) {
        const session = guildState.session(), revision = guildState.revision();
        if (typeof await observer.readAiContinuity() !== 'string') return;
        const [guild, channels] = await Promise.all([patient(() => transport.getGuild(), 'GUILD'), patient(() => transport.getGuildChannels(), 'CHANNELS')]);
        if (guildState.ready() || guildState.session() !== session) return;
        if (guildState.revision() !== revision) continue;
        requireCondition(guild?.id === guildId && Array.isArray(guild.roles) && Array.isArray(channels), 'AI_GUILD_SNAPSHOT_INVALID');
        guildState.accept({ op: 0, t: 'GUILD_CREATE', s: 0, d: { id: guild.id, owner_id: guild.owner_id, roles: guild.roles, emojis: guild.emojis ?? [], channels, members: [] } });
        try { trace('AI_GUILD_STATE_HYDRATED'); } catch { /* Diagnostics only. */ }
      }
    })().finally(() => { hydrating = null; });
    return hydrating;
  }
  // The Gateway must be current (journal lease and guild availability) and the projection must belong to the same session.
  async function gatewayCurrent(session) { return guildState.ready() && guildState.session() === session && typeof await observer.readAiContinuity() === 'string'; }
  async function isCurrent(observation, channelId) {
    return observation.generation === generation && !await excluded(channelId, observation.parentId) && await gatewayCurrent(observation.session);
  }
  async function inspect(event) {
    requireCondition(event.guildId === guildId, 'FOREIGN_GUILD'); requireId(event.channelId); requireId(event.userId);
    if (await excluded(event.channelId)) return null;
    if (!guildState.ready()) await hydrate();
    const version = generation, session = guildState.session();
    if (!await gatewayCurrent(session)) return null;
    const raw = guildState.channel(event.channelId), guild = guildState.guild(), roles = guildState.roles();
    if (raw?.id !== event.channelId || raw.type !== 0 || guild?.id !== guildId || await excluded(raw.id, raw.parentId)) return null;
    requireId(guild.ownerId); validateOverwrites(raw.overwrites);
    requireCondition(roles.length > 0 && roles.length <= 500, 'AI_ROLES_INVALID');
    const projected = roles.map(role => { requireInteger(role.position, 0, 500); return { id: role.id, permissions: role.permissions }; });
    const bot = await memberOf(botUserId, 'BOT'), member = await memberOf(event.userId, 'MEMBER');
    if (!bot || !member || bot.userId !== botUserId || member.userId !== event.userId) return null;
    const now = clock(), timedOut = value => value.timedOutUntil !== null && value.timedOutUntil > now;
    if (bot.bot !== true || member.bot || timedOut(bot) || timedOut(member) || member.roles.includes(mapping.muzzled)) return null;
    const permissions = (userId, roleIds) => channelPermissions({ guildId, userId, ownerId: guild.ownerId, roleIds, roles: projected, overwrites: raw.overwrites });
    const humanBits = permissions(event.userId, member.roles), botBits = permissions(botUserId, bot.roles);
    const humanRequired = PERMISSIONS.viewChannel | PERMISSIONS.sendMessages, botRequired = PERMISSIONS.viewChannel | PERMISSIONS.readHistory;
    if ((humanBits & humanRequired) !== humanRequired || (botBits & botRequired) !== botRequired) return null;
    const boundary = { checkedAt: now, continuity: String(session), session, generation: version, parentId: raw.parentId };
    const observation = { guildId, userId: event.userId, known: true, observedAt: now, present: true, roleIds: member.roles,
      bot: false, timedOut: false, administrator: member.roles.concat(guildId).some(id => projected.some(role => role.id === id && (BigInt(role.permissions) & PERMISSIONS.administrator) !== 0n)),
      guildOwner: guild.ownerId === event.userId,
      highestRolePosition: Math.max(0, ...roles.filter(role => role.id === guildId || member.roles.includes(role.id)).map(role => role.position)) };
    await authorityStore.registerPolicy(capabilityPolicy);
    const authority = await authorityStore.observeWithPresence(observation, capabilityPolicy.version);
    if (!await isCurrent(boundary, event.channelId)) return null;
    // A bot-specific allow does not make a private channel visible to ordinary members.
    const everyone = channelPermissions({ guildId, userId: botUserId, roleIds: [], roles: projected, overwrites: raw.overwrites.filter(value => value.type === 0) });
    return { ...boundary, eligible: true, botBits, botRoles: bot.roles,
      restricted: (everyone & PERMISSIONS.viewChannel) === 0n,
      presenceEpoch: authority.presenceEpoch, accessEpoch: authority.grant.capabilityEpoch,
      // Discord's start of the member's current stint; a leave and rejoin always moves it forward.
      joinedAt: member.joinedAt,
      // Binds the member's own state, so an unrelated member's change no longer voids this member's turn.
      memberHash: aiDigest({ roles: [...member.roles].sort(), timedOutUntil: member.timedOutUntil, joinedAt: member.joinedAt }),
      audienceHash: aiDigest({ guildId, channelId: raw.id, parentId: raw.parentId, ownerId: guild.ownerId,
        roles: projected.sort((a, b) => a.id.localeCompare(b.id)), overwrites: [...raw.overwrites].sort((a, b) => `${a.type}.${a.id}`.localeCompare(`${b.type}.${b.id}`)) }) };
  }
  return Object.freeze({
    // Qualification observes audience and permissions without fetching any message or case content.
    inspectChannel: request => inspect(request),
    async inspectContext(event) {
      members.delete(event); const current = await inspect(event); if (!current) return null;
      // Gateway commits deterministic decisions before handing this same create event to AI.
      // An admitted automation keeps ownership even when its delivery later becomes uncertain.
      if ((await pool.query('SELECT 1 FROM sophie_core.automation_deliveries WHERE guild_id=$1 AND message_id=$2 LIMIT 1', [guildId,event.messageId])).rowCount) return null;
      // Message identity and revision come from the Gateway too: creates are recorded before AI sees them, and edits
      // and deletes update or tombstone them. An unknown message (evicted or from before a restart) is refused.
      const source = guildState.message(event.messageId);
      if (!source || source.channelId !== event.channelId || source.authorId !== event.userId || !await isCurrent(current, event.channelId)) return null;
      members.set(event, current);
      return { eligible: true, checkedAt: current.checkedAt, audienceHash: current.audienceHash, restricted: current.restricted,
        continuity: current.continuity, messageRevision: source.revision,
        canReply: (current.botBits & PERMISSIONS.sendMessages) !== 0n, canReact: (current.botBits & PERMISSIONS.addReactions) !== 0n };
    },
    async inspectMember(event) { const value = members.get(event); members.delete(event); return value && await isCurrent(value, event.channelId) ? value : null; },
    async canReact(request, emoji) {
      const current = await inspect(request); if (!current || (current.botBits & PERMISSIONS.addReactions) === 0n) return false;
      if (emoji.id !== null) {
        const actual = guildState.emoji(emoji.id);
        if (actual?.id !== emoji.id || actual.name !== emoji.name || actual.available === false || actual.roles.length && !actual.roles.some(id => current.botRoles.includes(id))) return false;
      }
      const source = guildState.message(request.messageId);
      // Discord treats a repeated reaction by the same user as a no-op, so no read of existing reactions is needed.
      return source?.channelId === request.channelId && source.authorId === request.userId && await isCurrent(current, request.channelId);
    },
    clear() { generation++; },
  });
}
