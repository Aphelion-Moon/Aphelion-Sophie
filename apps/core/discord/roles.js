import { requireCondition, requireFreshObservation, requireId, requireInteger } from '../../../contracts/validation.js';
import { requireOwnedRoleChange, validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { validateActorObservation } from '../../../platform/authorization/actor-policy.js';
import { requireContinuityStamp } from '../../../contracts/gateway.js';

function memberRoles(member, userId) {
  requireCondition(member?.user?.id === userId && Array.isArray(member.roles) && member.roles.length <= 500, 'DISCORD_RESPONSE_INVALID');
  member.roles.forEach(requireId);
  requireCondition(new Set(member.roles).size === member.roles.length, 'DISCORD_RESPONSE_INVALID');
  return [...member.roles];
}

export const IDENTITY_SHARE_MS = 1_500;
/** How long a shared delivery preparation may be re-used; consumers still require it to be at most 5 s old. */
export const PREPARATION_SHARE_MS = 3_000;

/** Projects HTTP responses immediately to role metadata; ignores nicknames and profiles. */
export function createDiscordRoles({ transport, mapping, clock, readContinuity, readBoundary = null, readAuthority = null }) {
  validateRoleMapping(mapping);
  requireCondition(transport.guildId === mapping.guildId && typeof clock === 'function', 'FOREIGN_GUILD');
  requireCondition(typeof readContinuity === 'function' && [readBoundary, readAuthority].every(read => read === null || typeof read === 'function'), 'CONTINUITY_ADAPTER_REQUIRED');
  const fixed = structuredClone(mapping);
  const contexts = new WeakMap();
  const mentionableRoles = new WeakMap();
  const stamp = async () => requireContinuityStamp(await readContinuity());
  // Role and member reads are overtaken by an authority change (a member, role, channel or guild event, or a reconnect;
  // see the observer's readAuthorityBoundary), not by message traffic. With message events on, this bot's own posts and
  // edits would otherwise overtake nearly every read made just after them. Without that adapter, the full continuity.
  // Message reads elsewhere keep the full continuity (readContinuity below).
  const authority = async () => requireContinuityStamp(await (readAuthority ?? readContinuity)());
  const same = async expected => requireCondition(await authority() === expected, 'OBSERVATION_INVALIDATED');
  // The bot's own identity check carries no member authority, so observations and preparations made close together share one
  // result. It never outlives IDENTITY_SHARE_MS and ends on any authority change (see `authority` below). A failed check
  // is never shared. Guild roles and member state are always read afresh.
  let identity = null;
  // Opt-in for one Shuttle delivery that writes several messages in a row: its role and member reads may be re-used
  // while the Gateway records no member, authority, role, channel or guild change (the authority boundary) and for at
  // most PREPARATION_SHARE_MS. Each re-use gets a new context stamped with the current continuity, keeps the original
  // observedAt (so it only ages), and is otherwise identical to a fresh one. Role changes never opt in.
  const shared = new Map();
  const boundary = async () => readBoundary === null ? null : readBoundary();
  // Actor observations for dashboard requests share the single-flight core transport with background work. A request
  // already in flight is a short wait (at most 1.5 s in total), not a failed sign-in. observedAt is taken before the
  // reads, so waiting only ages the observation and freshness checks stay at least as strict.
  async function patient(read) {
    for (let waited = 0; ;) {
      try { return await read(); } catch (error) {
        const retry = error?.retryAfterMs;
        if (error?.code !== 'DISCORD_BUSY' || !Number.isSafeInteger(retry) || waited + retry > 1_500) throw error;
        waited += Math.max(50, retry); await new Promise(resolve => setTimeout(resolve, Math.max(50, retry)));
      }
    }
  }
  function confirmIdentity(version) {
    const now = clock();
    if (identity && identity.version === version && now >= identity.at && now - identity.at <= IDENTITY_SHARE_MS) return identity.promise;
    const record = { version, at: now, promise: patient(() => transport.getCurrentUser()).then(value => {
      requireCondition(value?.id === fixed.botUserId && value.bot === true, 'DISCORD_AUTHORIZATION_FAILED');
    }) };
    identity = record; record.promise.catch(() => { if (identity === record) identity = null; });
    return record.promise;
  }
  function prune() {
    const now = clock();
    for (const [key, value] of shared) if (shared.size >= 256 || now < value.observedAt || now - value.observedAt > PREPARATION_SHARE_MS) shared.delete(key);
  }
  async function prepare(userId, { share = false } = {}) {
    requireId(userId); requireCondition(typeof share === 'boolean', 'INVALID_ROLE_CONTEXT');
    const version = await authority();
    let observedAt = clock(); requireInteger(observedAt);
    const now = observedAt, before = share ? await boundary() : null, kept = shared.get(userId);
    let reads = before !== null && kept?.boundary === before && now >= kept.observedAt && now - kept.observedAt <= PREPARATION_SHARE_MS ? kept : null;
    if (reads) observedAt = reads.observedAt;
    else {
      // The identity check is shared like actor observations: it ends on any gateway dispatch and never outlives
      // IDENTITY_SHARE_MS.
      await confirmIdentity(version);
      const rawRoles = await transport.getRoles();
      requireCondition(Array.isArray(rawRoles) && rawRoles.length <= 500, 'DISCORD_RESPONSE_INVALID');
      reads = { rawRoles, bot: await transport.getMember(fixed.botUserId), rawMember: await transport.getMember(userId), observedAt };
    }
    const { rawRoles, bot, rawMember } = reads;
    const roles = rawRoles.map(role => ({ id: role.id, position: role.position, managed: role.managed, permissions: role.permissions }));
    const botRoleIds = memberRoles(bot, fixed.botUserId);
    const memberRoleIds = rawMember === null ? [] : memberRoles(rawMember, userId);
    let botTimedOut = false;
    if (bot.communication_disabled_until != null) {
      const until = Date.parse(bot.communication_disabled_until);
      requireCondition(Number.isFinite(until), 'DISCORD_RESPONSE_INVALID');
      botTimedOut = until > clock();
    }
    const context = Object.freeze({ guildId: fixed.guildId, userId, known: true, observedAt,
      roles: Object.freeze(roles.map(Object.freeze)), botRoleIds: Object.freeze(botRoleIds), memberRoleIds: Object.freeze(memberRoleIds), botTimedOut });
    const observation = { guildId: fixed.guildId, userId, known: true, observedAt, present: rawMember !== null,
      crew: memberRoleIds.includes(fixed.crew), muzzled: memberRoleIds.includes(fixed.muzzled), whitelist: memberRoleIds.includes(fixed.whitelist) };
    requireFreshObservation(observation, clock());
    await same(version);
    // Kept for re-use only if no authority change was recorded while reading (or since the shared reads were made).
    if (before !== null) {
      if (await boundary() === before) { if (reads !== kept) { prune(); shared.set(userId, { ...reads, boundary: before }); } }
      else {
        shared.delete(userId);
        // A re-used read that an authority change overtook is discarded and read again, once.
        if (reads === kept) return prepare(userId, { share });
        requireCondition(false, 'OBSERVATION_INVALIDATED');
      }
    }
    contexts.set(context, version);
    mentionableRoles.set(context, new Set(rawRoles.filter(role => role.mentionable === true).map(role => role.id)));
    requireFreshObservation(context, clock());
    return { context, observation };
  }
  async function observe(userId) {
    requireId(userId);
    const version = await authority();
    const startedAt = clock(); requireInteger(startedAt);
    const member = await transport.getMember(userId);
    const roles = member === null ? [] : memberRoles(member, userId);
    const observation = { guildId: fixed.guildId, userId, known: true, observedAt: startedAt, present: member !== null,
      crew: roles.includes(fixed.crew), muzzled: roles.includes(fixed.muzzled), whitelist: roles.includes(fixed.whitelist) };
    requireFreshObservation(observation, clock());
    await same(version);
    requireFreshObservation(observation, clock());
    return observation;
  }
  return Object.freeze({
    guildId: fixed.guildId,
    observe,
    readContinuity: stamp,
    /** The stamp role and member observations are checked against; see `authority` above. */
    readAuthority: authority,
    async assertCurrent(context) {
      requireCondition(contexts.has(context), 'UNTRUSTED_ROLE_CONTEXT');
      await same(contexts.get(context));
      requireFreshObservation(context, clock());
    },
    async roleMentionable(context, roleId) {
      requireId(roleId); requireCondition(contexts.has(context), 'UNTRUSTED_ROLE_CONTEXT');
      await same(contexts.get(context)); requireFreshObservation(context, clock());
      requireCondition(context.roles.some(role => role.id === roleId), 'ROLE_CONFIGURATION_INVALID');
      return mentionableRoles.get(context).has(roleId);
    },
    async observeActor(userId) {
      requireId(userId);
      const version = await authority();
      const observedAt = clock(); requireInteger(observedAt);
      await confirmIdentity(version);
      const guild = await patient(() => transport.getGuild());
      requireCondition(guild?.id === fixed.guildId, 'FOREIGN_GUILD'); requireId(guild.owner_id);
      const roles = await patient(() => transport.getRoles());
      requireCondition(Array.isArray(roles) && roles.length >= 1 && roles.length <= 500, 'DISCORD_RESPONSE_INVALID');
      for (const role of roles) {
        requireId(role?.id); requireInteger(role.position, 0, 500);
        requireCondition(typeof role.permissions === 'string' && /^\d{1,32}$/.test(role.permissions), 'DISCORD_RESPONSE_INVALID');
      }
      requireCondition(new Set(roles.map(role => role.id)).size === roles.length && roles.some(role => role.id === fixed.guildId), 'DISCORD_RESPONSE_INVALID');
      const member = await patient(() => transport.getMember(userId));
      const roleIds = member === null ? [] : memberRoles(member, userId);
      requireCondition(roleIds.every(id => roles.some(role => role.id === id)), 'ROLE_CONFIGURATION_INVALID');
      requireCondition(member === null || member.user.bot === undefined || typeof member.user.bot === 'boolean', 'DISCORD_RESPONSE_INVALID');
      let timedOut = false;
      if (member?.communication_disabled_until != null) {
        const until = Date.parse(member.communication_disabled_until);
        requireCondition(Number.isFinite(until), 'DISCORD_RESPONSE_INVALID'); timedOut = until > clock();
      }
      const currentRoles = roles.filter(role => role.id === fixed.guildId || roleIds.includes(role.id));
      const permissions = currentRoles.reduce((bits, role) => bits | BigInt(role.permissions), 0n);
      const actor = { guildId: fixed.guildId, userId, known: true, observedAt, present: member !== null, roleIds,
        bot: member?.user.bot === true, timedOut, administrator: member !== null && !!(permissions & (1n << 3n)),
        guildOwner: member !== null && guild.owner_id === userId,
        highestRolePosition: member === null ? 0 : Math.max(0, ...currentRoles.map(role => role.position)) };
      validateActorObservation(actor, clock());
      await same(version);
      requireFreshObservation(actor, clock());
      return actor;
    },
    prepare,
    /** The authority boundary, or null when sharing is unavailable. See prepare(). */
    readAuthorityBoundary: boundary,
    async change(context, change) {
      requireCondition(contexts.has(context), 'UNTRUSTED_ROLE_CONTEXT');
      await same(contexts.get(context));
      const { roleId, add } = requireOwnedRoleChange(context, fixed, change, clock());
      contexts.delete(context); // One fresh context authorises at most one attempted role mutation.
      await transport.changeMemberRole(context.userId, roleId, add);
    },
  });
}
