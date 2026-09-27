import { ContractError, requireCondition } from '../../../contracts/validation.js';
import { DiscordError } from './transport.js';
import { FORM_CASE_TYPES } from '../../../modules/tickets/intake.js';

function status(error) {
  if (!(error instanceof ContractError)) return 'unavailable';
  if (['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_ABSENT', 'FOREIGN_GUILD', 'CAPABILITY_REVOKED', 'CASE_FORM_OWNER_MISMATCH'].includes(error.code)) return 'denied';
  if (['CASE_FORM_BUSY', 'MEMBER_CASE_LIMIT', 'GUILD_PROVISIONING_LIMIT', 'CASE_COOLDOWN'].includes(error.code)) return 'ticket_busy';
  if (['CASE_FORM_EXPIRED', 'CASE_FORM_ALREADY_SUBMITTED', 'CASE_FORM_UNAVAILABLE', 'CASE_FORM_VERSION_STALE', 'CASE_POLICY_CHANGED', 'CASE_CONTACT_CONFIRMATION_REQUIRED'].includes(error.code)) return 'ticket_form_unavailable';
  if (error.code === 'CASE_PARTICIPANT_DENIED') return 'case_participant_denied';
  if (['INVALID_CASE_FORM_ANSWERS', 'INVALID_CASE_FORM_TEXT'].includes(error.code)) return 'ticket_form_invalid';
  return 'unavailable';
}

/** Signed actor -> current membership -> durable intake. Private values have one explicit core-only handoff. */
export function createCaseIntake({ authorization, verifier, discord, channels, store, enabled, onFault = () => {} }) {
  requireCondition(typeof enabled === 'function' && typeof verifier.takeCaseFormSubmission === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function actorFor(envelope, commands) {
    const actor = await authorization.resolveActor(envelope);
    requireCondition(envelope.guildId === discord.guildId && envelope.targetId === envelope.userId && commands.includes(envelope.command), 'OPERATION_DENIED');
    return actor;
  }
  return Object.freeze({
    async prepare(envelope, { isCurrent }) {
      if (!isCurrent() || await enabled() !== true) return { status: 'disabled' };
      try {
        const actor = await actorFor(envelope, ['ticket.begin', 'ticket.contact.confirm']);
        if (envelope.command === 'ticket.begin') requireCondition(FORM_CASE_TYPES.includes(envelope.caseType), 'INVALID_CASE_FORM_TYPE');
        const observation = await discord.observe(envelope.userId);
        requireCondition(isCurrent() && await enabled() === true, 'CASE_FORM_DEADLINE');
        const modal = envelope.command === 'ticket.contact.confirm' ? await store.confirmStaffContact({ actor, observation, formToken: envelope.formToken, isCurrent }) :
          await store.beginCaseForm({ actor, observation, interactionId: envelope.interactionId, caseType: envelope.caseType, subjectId: envelope.subjectId ?? null, isCurrent });
        requireCondition(isCurrent() && await enabled() === true, 'CASE_FORM_DEADLINE'); return { status: 'modal', modal };
      } catch (error) { return { status: status(error) }; }
    },
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await actorFor(envelope, ['ticket.begin', 'ticket.submit', 'ticket.destination']);
        if (envelope.command === 'ticket.destination') return 'ticket_recorded';
        const observation = await discord.observe(envelope.userId); if (await enabled() !== true) return 'disabled';
        if (envelope.command === 'ticket.begin') {
          requireCondition(envelope.caseType === 'quick-help', 'INVALID_CASE_FORM_TYPE');
          await store.openQuickHelp({ actor, observation, interactionId: envelope.interactionId });
        } else {
          const values = verifier.takeCaseFormSubmission(envelope);
          await store.submitCaseForm({ actor, observation, interactionId: envelope.interactionId, formToken: envelope.formToken, values });
        }
        return 'ticket_recorded';
      } catch (error) { return status(error); }
    },
    async destination(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      let stage = 'ACTOR';
      try {
        const actor = await actorFor(envelope, ['ticket.begin', 'ticket.submit', 'ticket.destination']);
        const reference = envelope.command === 'ticket.destination' ? { caseToken: envelope.caseToken } : { interactionId: envelope.interactionId };
        stage = 'DESCRIBE';
        const result = await store.describeTicketDestination({ actor, observation: await discord.observe(envelope.userId), ...reference });
        if (result.state !== 'inspect') return result;
        stage = 'CHANNEL';
        const proof = await channels.inspect(result.plan, result.channelId); if (await enabled() !== true) return { state: 'disabled' };
        stage = 'CONFIRM';
        return await store.confirmTicketDestination({ actor, observation: await discord.observe(envelope.userId), caseToken: result.plan.token, proof });
      } catch (error) {
        const codes = ['RATE_LIMITED', 'DISCORD_BUSY', 'DISCORD_UNAVAILABLE', 'DISCORD_AUTHORIZATION_FAILED', 'DISCORD_RESOURCE_MISSING',
          'DISCORD_RESPONSE_INVALID', 'DISCORD_RATE_LIMIT_INVALID', 'AUTHORITY_UNCERTAIN', 'OBSERVATION_INVALIDATED', 'MEMBERSHIP_STALE',
          'OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_ABSENT', 'FOREIGN_GUILD', 'CAPABILITY_REVOKED', 'CASE_DESTINATION_DENIED',
          'CASE_CHANNEL_MISSING', 'CASE_CHANNEL_MISMATCH', 'CASE_CHANNEL_ACL_MISMATCH', 'CASE_OBSERVATION_UNTRUSTED', 'CASE_AUDIENCE_CHANGED'];
        const code = (error instanceof ContractError || error instanceof DiscordError) && codes.includes(error.code) ? error.code : 'UNAVAILABLE';
        try { onFault(`TICKET_DESTINATION_${stage}_${code}`); } catch { /* Diagnostics cannot change the response or reveal the original error. */ }
        return { state: status(error) === 'denied' ? 'denied' : 'unavailable' };
      }
    },
  });
}
