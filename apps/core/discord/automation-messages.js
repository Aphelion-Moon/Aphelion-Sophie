import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { automationPlanKey, automationPayload } from '../../../modules/automation/delivery.js';
import { channelPermissions, PERMISSIONS } from '../../../platform/authorization/discord-permissions.js';

/** Only explicit approved actions; source responses are projected to routing/reaction metadata. */
export function createAutomationMessages({ transport, roles, botUserId, protectedCategoryId, clock }) {
  requireId(botUserId); requireId(protectedCategoryId);
  const preparations = new WeakMap(), receipts = new WeakMap(), removals = new WeakMap(), recoveries = new WeakMap();
  async function current(proof, plan) {
    const held = preparations.get(proof);
    requireCondition(held?.key === automationPlanKey(plan), 'AUTOMATION_PROOF_INVALID');
    requireCondition(clock() < plan.expiresAt, 'AUTOMATION_EXPIRED');
    await roles.assertCurrent(held.context); requireFreshObservation(held, clock());
    return held;
  }
  function ownMessage(raw, plan) {
    const body = automationPayload(plan.id, plan.action), button = raw?.components?.[0]?.components?.[0];
    return raw?.channel_id === plan.channelId && raw.author?.id === botUserId && raw.author.bot === true && raw.type === 0 &&
      raw.webhook_id === undefined && raw.content === body.content && raw.attachments?.length === 0 && raw.embeds?.length === 0 &&
      raw.components?.length === 1 && raw.components[0].type === 1 && raw.components[0].components?.length === 1 &&
      button?.type === 2 && button.style === 2 && button.label === 'Automated response' && button.disabled === true && button.custom_id === `sophie:auto:${plan.id}` &&
      raw.mention_everyone === false && raw.mentions?.length === 0 && raw.mention_roles?.length === 0;
  }
  function reactionPresent(raw, plan) {
    return (raw.reactions ?? []).some(item => item.me === true && item.emoji?.id === plan.action.emoji.id &&
      (item.emoji.id !== null || item.emoji.name === plan.action.emoji.name));
  }
  const verification = Object.freeze({
    current,
    receipt(proof, plan) {
      const held = receipts.get(proof); requireCondition(held?.key === automationPlanKey(plan), 'AUTOMATION_RECEIPT_INVALID');
      return held.messageId;
    },
    removal(proof, plan, messageId) {
      const held = removals.get(proof);
      requireCondition(held?.key === automationPlanKey(plan) && held.messageId === messageId, 'AUTOMATION_RECEIPT_INVALID');
    },
    async recovery(proof, plan, messageId) {
      const held = recoveries.get(proof);
      requireCondition(held?.key === automationPlanKey(plan) && held.messageId === messageId,'AUTOMATION_RECOVERY_INVALID');
      await roles.assertCurrent(held.context); requireFreshObservation(held,clock());
    },
  });
  return Object.freeze({ verification,
    async recover(plan, messageId) {
      automationPlanKey(plan); requireCondition(plan.guildId === transport.guildId,'FOREIGN_GUILD');
      if (plan.action.kind === 'message') requireId(messageId);
      else requireCondition(messageId === null,'AUTOMATION_INPUT_INVALID');
      const observedAt = clock(), version = await roles.readContinuity();
      const {context} = await roles.prepare(botUserId), channel = await transport.getChannel(plan.channelId);
      requireCondition(channel?.id === plan.channelId && channel.guild_id === plan.guildId && channel.type === 0 &&
        channel.id !== protectedCategoryId && channel.parent_id !== protectedCategoryId,'AUTOMATION_CHANNEL_UNAVAILABLE');
      const required = PERMISSIONS.viewChannel | PERMISSIONS.readHistory;
      const permissions = channelPermissions({guildId:plan.guildId,userId:botUserId,roleIds:context.botRoleIds,
        roles:context.roles.map(({id,permissions})=>({id,permissions})),overwrites:channel.permission_overwrites});
      requireCondition(!context.botTimedOut && (permissions & required) === required,'AUTOMATION_RECOVERY_UNAVAILABLE');
      if (plan.action.kind === 'message') {
        const raw = await transport.getAutomationMessage(plan.channelId,messageId);
        requireCondition(raw?.id === messageId && ownMessage(raw,plan),'AUTOMATION_RECOVERY_UNAVAILABLE');
      } else {
        const source = await transport.getAutomationSource(plan.channelId,plan.sourceMessageId);
        requireCondition(source?.id === plan.sourceMessageId && source.channelId === plan.channelId && source.authorId === plan.userId &&
          !source.bot && !source.webhook && !source.interaction && [0,19].includes(source.type) && reactionPresent(source,plan),'AUTOMATION_RECOVERY_UNAVAILABLE');
      }
      requireCondition(await roles.readContinuity() === version,'OBSERVATION_INVALIDATED');
      const proof = Object.freeze({});recoveries.set(proof,{key:automationPlanKey(plan),messageId,context,observedAt,known:true});
      await verification.recovery(proof,plan,messageId);return proof;
    },
    async prepare(plan) {
      automationPlanKey(plan); requireCondition(plan.guildId === transport.guildId, 'FOREIGN_GUILD');
      const observedAt = clock(), version = await roles.readContinuity();
      const { context, observation } = await roles.prepare(plan.userId), actor = await roles.observeActor(plan.userId);
      requireCondition(observation.present && !observation.muzzled && actor.present && !actor.bot && !actor.timedOut && !context.botTimedOut,
        'AUTOMATION_INELIGIBLE');
      const raw = await transport.getChannel(plan.channelId);
      requireCondition(raw?.id === plan.channelId && raw.guild_id === plan.guildId && raw.type === 0 &&
        raw.id !== protectedCategoryId && raw.parent_id !== protectedCategoryId, 'AUTOMATION_INELIGIBLE');
      const permissions = (userId, roleIds, ownerId = null) => channelPermissions({ guildId: plan.guildId, userId, ownerId, roleIds,
        roles: context.roles.map(({id,permissions})=>({id,permissions})), overwrites: raw.permission_overwrites });
      const human = PERMISSIONS.viewChannel | PERMISSIONS.sendMessages;
      const bot = PERMISSIONS.viewChannel | PERMISSIONS.readHistory | (plan.action.kind === 'message' ? PERMISSIONS.sendMessages : PERMISSIONS.addReactions);
      requireCondition((permissions(plan.userId,context.memberRoleIds,actor.guildOwner ? plan.userId : null) & human) === human &&
        (permissions(botUserId,context.botRoleIds) & bot) === bot, 'AUTOMATION_INELIGIBLE');
      if (plan.action.kind === 'reaction' && plan.action.emoji.id !== null) {
        const emoji = await transport.getAutomationEmoji(plan.action.emoji.id);
        requireCondition(emoji?.id === plan.action.emoji.id && emoji.name === plan.action.emoji.name && emoji.available !== false &&
          Array.isArray(emoji.roles) && (emoji.roles.length === 0 || emoji.roles.some(id=>context.botRoleIds.includes(id))), 'AUTOMATION_INELIGIBLE');
      }
      const source = await transport.getAutomationSource(plan.channelId,plan.sourceMessageId);
      requireCondition(source?.id === plan.sourceMessageId && source.channelId === plan.channelId && source.authorId === plan.userId &&
        !source.bot && !source.webhook && !source.interaction && [0,19].includes(source.type), 'AUTOMATION_INELIGIBLE');
      requireCondition(await roles.readContinuity() === version, 'OBSERVATION_INVALIDATED');
      const proof = Object.freeze({});
      preparations.set(proof,{key:automationPlanKey(plan),context,observedAt,known:true,
        reacted:plan.action.kind === 'reaction' && reactionPresent(source,plan)});
      await current(proof,plan); return proof;
    },
    async create(plan, proof) {
      const held = await current(proof,plan);
      requireCondition(!held.reacted, 'AUTOMATION_EXISTING_REACTION');
      preparations.delete(proof); // One proof permits at most one attempted creation.
      let messageId = null;
      if (plan.action.kind === 'message') {
        const raw = await transport.createAutomationMessage(plan.channelId,plan.id,plan.action);
        requireCondition(ownMessage(raw,plan), 'AUTOMATION_RECEIPT_INVALID'); requireId(raw.id); messageId = raw.id;
      } else await transport.createAutomationReaction(plan.channelId,plan.sourceMessageId,plan.action);
      const receipt = Object.freeze({}); receipts.set(receipt,{key:automationPlanKey(plan),messageId}); return receipt;
    },
    async verify(plan, proof, messageId) {
      const held = await current(proof,plan);
      if (plan.action.kind === 'reaction') return held.reacted;
      requireId(messageId);
      const raw = await transport.getAutomationMessage(plan.channelId,messageId);
      await current(proof,plan); return raw?.id === messageId && ownMessage(raw,plan);
    },
    async remove(plan, messageId) {
      automationPlanKey(plan); requireCondition(plan.guildId === transport.guildId, 'FOREIGN_GUILD');
      const identity = await transport.getCurrentUser();
      requireCondition(identity?.id === botUserId && identity.bot === true, 'DISCORD_AUTHORIZATION_FAILED');
      // Exact retained own artifact only; never read bodies after a channel becomes a case.
      if (plan.action.kind === 'message') { requireId(messageId); await transport.deleteAutomationMessage(plan.channelId,messageId); }
      else { requireCondition(messageId === null,'AUTOMATION_CORRUPT'); await transport.deleteAutomationReaction(plan.channelId,plan.sourceMessageId,plan.action); }
      const proof = Object.freeze({}); removals.set(proof,{key:automationPlanKey(plan),messageId}); return proof;
    },
  });
}
