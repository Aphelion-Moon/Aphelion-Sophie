import { randomBytes } from 'node:crypto';
import { ContractError, requireCondition, requireName } from '../../../contracts/validation.js';
import { validateTicketLimits } from '../../../modules/tickets/index.js';

/** Signed entry -> fresh self-service authorization -> one atomic session/case reservation. */
export function createOnboardingCommands({ authorization, discord, channels, store, enabled, definitionId, limits }) {
  requireName(definitionId); validateTicketLimits(limits);
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const fixedLimits = structuredClone(limits);
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await authorization.resolveActor(envelope);
        requireCondition(envelope.guildId === discord.guildId && ['shuttle.start', 'shuttle.control'].includes(envelope.command) &&
          envelope.targetId === envelope.userId, 'OPERATION_DENIED');
        const observation = await discord.observe(envelope.userId);
        if (await enabled() !== true) return 'disabled';
        if (envelope.command === 'shuttle.control') {
          const control = { screenId: envelope.screenId, channelId: envelope.channelId, messageId: envelope.messageId, controlVersion: envelope.controlVersion };
          const { plan } = await store.describeOnboardingControl({ actor, observation, ...control });
          const proof = await channels.inspect(plan, envelope.channelId);
          if (await enabled() !== true) return 'disabled';
          const result = await store.actOnOnboarding({ actor, interactionId: envelope.interactionId, action: envelope.action,
            observation: await discord.observe(envelope.userId), proof, ...control });
          return envelope.action === 'help' ? result.session.helpPaused ? 'shuttle_help_paused' : 'shuttle_help_recorded' : 'shuttle_progress_recorded';
        }
        const existing = await store.describeOnboardingEntryChannel({ actor, observation });
        if (existing !== null) {
          const proof = await channels.inspectPresence(existing.plan, existing.channelId);
          if (proof.missing) await store.recoverMissingOnboardingChannel({ actor, id: existing.id, proof,
            observation: await discord.observe(envelope.userId) });
        }
        if (await enabled() !== true) return 'disabled';
        await store.openOnboarding({ actor, interactionId: envelope.interactionId, id: `shuttle.${envelope.interactionId}`,
          caseId: `shuttle-case.${envelope.interactionId}`, nonce: randomBytes(16).toString('hex'),
          observation: await discord.observe(envelope.userId), definitionId, limits: fixedLimits });
        return 'shuttle_recorded';
      } catch (error) {
        if (error instanceof ContractError && error.code === 'SHUTTLE_PAUSED') return 'shuttle_paused';
        if (error instanceof ContractError && ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_ABSENT',
          'MEMBER_MUZZLED', 'NOT_IN_GUILD', 'CAPABILITY_REVOKED', 'FOREIGN_GUILD', 'FOREIGN_SHUTTLE_CONTROL'].includes(error.code)) return 'denied';
        if (error instanceof ContractError && ['STALE_SHUTTLE_CONTROL', 'SHUTTLE_NOT_ACTIVE', 'BACK_UNAVAILABLE',
          'NO_PENDING_GRANT', 'SHUTTLE_SCREEN_NOT_FOUND', 'SHUTTLE_SCREENS_UNREAD', 'SCREEN_NAVIGATION_UNAVAILABLE'].includes(error.code)) return 'shuttle_stale';
        if (error instanceof ContractError && ['MEMBER_CASE_LIMIT', 'GUILD_PROVISIONING_LIMIT', 'CASE_COOLDOWN'].includes(error.code)) return 'shuttle_busy';
        if (error instanceof ContractError && ['DEFINITION_WITHDRAWN', 'DEFINITION_NOT_FOUND', 'SHUTTLE_CASE_UNAVAILABLE',
          'SHUTTLE_RESTART_REQUIRED', 'DEFINITION_MISMATCH', 'SHUTTLE_CONTENT_REQUIRED', 'CASE_CHANNEL_ACL_MISMATCH'].includes(error.code)) return 'shuttle_review';
        return 'unavailable';
      }
    },
  });
}

/** Explicit command union. No arbitrary operation name or dynamic plugin dispatch. */
export function createAdministrationCommands({ moderation, onboarding, onboardingClosure = null, assistance = null, deliveryIssues = null, caseLifecycle = null, caseStaff = null, caseIntake = null, caseDeliveryIssues = null, caseParticipants = null, caseContacts = null, caseReplies = null, publicAnswers = null, caseAnswers = null, knowledgeLookup = null }) {
  return Object.freeze({ async execute(envelope) {
    if(envelope.command==='knowledge.lookup')return knowledgeLookup===null ? 'denied':knowledgeLookup.execute(envelope);
    if (['ticket.answer','ticket.answer.confirm','ticket.answer.cancel'].includes(envelope.command)) return caseAnswers === null ? 'denied' : caseAnswers.execute(envelope);
    if (['answer.list', 'answer.show'].includes(envelope.command)) return publicAnswers === null ? 'denied' : publicAnswers.execute(envelope);
    if (envelope.command === 'ticket.reply') return caseReplies === null ? 'denied' : caseReplies.execute(envelope);
    if (['ticket.contact.start', 'ticket.contact.select', 'ticket.contact.cancel', 'ticket.contact.queue', 'ticket.contact.destination'].includes(envelope.command)) return caseContacts === null ? 'denied' : caseContacts.execute(envelope);
    if (envelope.command === 'ticket.participant') return caseParticipants === null ? 'denied' : caseParticipants.execute(envelope);
    if (['ticket.issues', 'ticket.issue.recheck', 'ticket.message.recover', 'ticket.channel.choose'].includes(envelope.command)) return caseDeliveryIssues === null ? 'denied' : caseDeliveryIssues.execute(envelope);
    if (['ticket.begin', 'ticket.submit', 'ticket.destination'].includes(envelope.command)) return caseIntake === null ? 'denied' : caseIntake.execute(envelope);
    if (['ticket.queue', 'ticket.claim', 'ticket.unclaim', 'ticket.assign', 'ticket.label'].includes(envelope.command)) return caseStaff === null ? 'denied' : caseStaff.execute(envelope);
    if (['ticket.status', 'ticket.close', 'ticket.reopen'].includes(envelope.command)) return caseLifecycle === null ? 'denied' : caseLifecycle.execute(envelope);
    if (['shuttle.issues', 'shuttle.issue.recheck', 'shuttle.message.recover', 'shuttle.channel.choose'].includes(envelope.command)) return deliveryIssues === null ? 'denied' : deliveryIssues.execute(envelope);
    if (['shuttle.queue', 'shuttle.help.resolve'].includes(envelope.command)) return assistance === null ? 'denied' : assistance.execute(envelope);
    if (envelope.command === 'shuttle.close') return onboardingClosure === null ? 'denied' : onboardingClosure.execute(envelope);
    if (['shuttle.start', 'shuttle.control'].includes(envelope.command)) return onboarding.execute(envelope);
    if (['mute', 'unmute'].includes(envelope.command)) return moderation.execute(envelope);
    return 'denied';
  } });
}
