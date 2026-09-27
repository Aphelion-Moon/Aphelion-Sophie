import { requireCondition, requireFreshObservation, requireId, requireKeys } from '../../../contracts/validation.js';
import { requireCaseToken } from '../../../modules/tickets/references.js';
import { PERMISSIONS, channelPermissions } from '../../../platform/authorization/discord-permissions.js';

/** Secondary channel check only: the caller must independently authorize the current case audience. */
export function createCaseChildAccess({ guildId, botUserId, transport, roles, clock }) {
  requireId(guildId); requireId(botUserId);
  requireCondition(guildId === transport.guildId && guildId === roles.guildId && typeof clock === 'function', 'CASE_CONTENT_CONFIGURATION_INVALID');
  const proofs = new WeakMap();
  function key(scope) {
    requireKeys(scope, ['guildId', 'caseToken', 'rootChannelId', 'channelId', 'userId']);
    for (const field of ['guildId', 'rootChannelId', 'channelId', 'userId']) requireId(scope[field]); requireCaseToken(scope.caseToken);
    requireCondition(scope.guildId === guildId && scope.channelId !== scope.rootChannelId && scope.userId !== botUserId, 'CASE_CHILD_ACCESS_DENIED');
    return JSON.stringify([scope.guildId, scope.caseToken, scope.rootChannelId, scope.channelId, scope.userId]);
  }
  return Object.freeze({
    async inspect(scope) {
      const binding = key(scope), version = await roles.readContinuity(), observedAt = clock();
      const { context, observation } = await roles.prepare(scope.userId);
      requireCondition(observation.present, 'CASE_CHILD_ACCESS_DENIED');
      const guild = await transport.getGuild();
      requireCondition(guild?.id === guildId, 'CASE_CHILD_ACCESS_DENIED'); requireId(guild.owner_id);
      const parent = await transport.getChannel(scope.rootChannelId), child = await transport.getChannel(scope.channelId);
      requireCondition(parent?.id === scope.rootChannelId && parent.guild_id === guildId && parent.type === 0 &&
        parent.topic === `sophie:case:v1:${scope.caseToken}`, 'CASE_CHILD_ACCESS_DENIED');
      requireCondition(child?.id === scope.channelId && child.guild_id === guildId && child.parent_id === scope.rootChannelId &&
        [10, 11, 12].includes(child.type), 'CASE_CHILD_ACCESS_DENIED');
      const projectedRoles = context.roles.map(role => ({ id: role.id, permissions: role.permissions }));
      for (const [userId, roleIds] of [[scope.userId, context.memberRoleIds], [botUserId, context.botRoleIds]]) {
        const permissions = channelPermissions({ guildId, userId, ownerId: guild.owner_id, roleIds,
          roles: projectedRoles, overwrites: parent.permission_overwrites });
        const needed = PERMISSIONS.viewChannel | PERMISSIONS.readHistory;
        requireCondition((permissions & needed) === needed, 'CASE_CHILD_ACCESS_DENIED');
        if (child.type === 12 && (permissions & PERMISSIONS.manageThreads) === 0n) {
          const member = await transport.getThreadMember(scope.channelId, userId);
          requireCondition(member?.id === scope.channelId && member.user_id === userId, 'CASE_CHILD_ACCESS_DENIED');
        }
      }
      await roles.assertCurrent(context);
      requireCondition(await roles.readContinuity() === version, 'OBSERVATION_INVALIDATED');
      requireFreshObservation({ known: true, observedAt }, clock());
      const proof = Object.freeze({}); proofs.set(proof, { binding, version, observedAt }); return proof;
    },
    async verify(proof, scope) {
      const saved = proofs.get(proof);
      requireCondition(saved !== undefined && saved.binding === key(scope), 'UNTRUSTED_CASE_CHILD_ACCESS');
      requireFreshObservation({ known: true, observedAt: saved.observedAt }, clock());
      requireCondition(await roles.readContinuity() === saved.version, 'OBSERVATION_INVALIDATED');
      requireFreshObservation({ known: true, observedAt: saved.observedAt }, clock());
      return true;
    },
  });
}
