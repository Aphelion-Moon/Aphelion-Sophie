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

/** Projects HTTP responses immediately to role metadata; ignores nicknames and profiles. */
export function createDiscordRoles({ transport, mapping, clock, readContinuity }) {
  validateRoleMapping(mapping);
  requireCondition(transport.guildId === mapping.guildId && typeof clock === 'function', 'FOREIGN_GUILD');
  requireCondition(typeof readContinuity === 'function', 'CONTINUITY_ADAPTER_REQUIRED');
  const fixed = structuredClone(mapping);
  const contexts = new WeakMap();
  const mentionableRoles = new WeakMap();
  const stamp = async () => requireContinuityStamp(await readContinuity());
  const same = async expected => requireCondition(await stamp() === expected, 'OBSERVATION_INVALIDATED');
  async function observe(userId) {
    requireId(userId);
    const version = await stamp();
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
      const version = await stamp();
      const observedAt = clock(); requireInteger(observedAt);
      const identity = await transport.getCurrentUser();
      requireCondition(identity?.id === fixed.botUserId && identity.bot === true, 'DISCORD_AUTHORIZATION_FAILED');
      const guild = await transport.getGuild();
      requireCondition(guild?.id === fixed.guildId, 'FOREIGN_GUILD'); requireId(guild.owner_id);
      const roles = await transport.getRoles();
      requireCondition(Array.isArray(roles) && roles.length >= 1 && roles.length <= 500, 'DISCORD_RESPONSE_INVALID');
      for (const role of roles) {
        requireId(role?.id); requireInteger(role.position, 0, 500);
        requireCondition(typeof role.permissions === 'string' && /^\d{1,32}$/.test(role.permissions), 'DISCORD_RESPONSE_INVALID');
      }
      requireCondition(new Set(roles.map(role => role.id)).size === roles.length && roles.some(role => role.id === fixed.guildId), 'DISCORD_RESPONSE_INVALID');
      const member = await transport.getMember(userId);
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
    async prepare(userId) {
      requireId(userId);
      const version = await stamp();
      const observedAt = clock(); requireInteger(observedAt);
      const identity = await transport.getCurrentUser();
      requireCondition(identity?.id === fixed.botUserId && identity.bot === true, 'DISCORD_AUTHORIZATION_FAILED');
      const rawRoles = await transport.getRoles();
      requireCondition(Array.isArray(rawRoles) && rawRoles.length <= 500, 'DISCORD_RESPONSE_INVALID');
      const roles = rawRoles.map(role => ({ id: role.id, position: role.position, managed: role.managed, permissions: role.permissions }));
      const bot = await transport.getMember(fixed.botUserId);
      const botRoleIds = memberRoles(bot, fixed.botUserId);
      const rawMember = await transport.getMember(userId);
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
      await same(version); contexts.set(context, version);
      mentionableRoles.set(context, new Set(rawRoles.filter(role => role.mentionable === true).map(role => role.id)));
      requireFreshObservation(context, clock());
      return { context, observation };
    },
    async change(context, change) {
      requireCondition(contexts.has(context), 'UNTRUSTED_ROLE_CONTEXT');
      await same(contexts.get(context));
      const { roleId, add } = requireOwnedRoleChange(context, fixed, change, clock());
      contexts.delete(context); // One fresh context authorises at most one attempted role mutation.
      await transport.changeMemberRole(context.userId, roleId, add);
    },
  });
}
