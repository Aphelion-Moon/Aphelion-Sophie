import { ContractError, requireCondition } from '../../../contracts/validation.js';
import { createContactNavigation } from './contact-navigation.js';
import { contactScope } from '../../../modules/tickets/contacts.js';

const commands = ['ticket.contact.start', 'ticket.contact.select', 'ticket.contact.cancel', 'ticket.contact.queue', 'ticket.contact.destination'];
function status(error) {
  if (!(error instanceof ContractError)) return 'unavailable';
  if (['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_ABSENT', 'CASE_DESTINATION_DENIED', 'CASE_FORM_OWNER_MISMATCH'].includes(error.code)) return 'denied';
  if (error.code === 'CASE_PARTICIPANT_DENIED') return 'case_participant_denied';
  if (['CASE_FORM_BUSY', 'MEMBER_CASE_LIMIT', 'GUILD_PROVISIONING_LIMIT', 'CASE_COOLDOWN'].includes(error.code)) return 'ticket_busy';
  if (['CASE_FORM_EXPIRED', 'CASE_FORM_ALREADY_SUBMITTED', 'CASE_FORM_UNAVAILABLE', 'CASE_CONTACT_CONFIRMATION_REQUIRED'].includes(error.code)) return 'ticket_form_unavailable';
  return 'unavailable';
}

/** Signed actor selection; ephemeral metadata is reauthorized again by view before delivery. */
export function createCaseContacts({ authorization, discord, channels, store, enabled }) {
  requireCondition(typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function actorFor(envelope) {
    const actor = await authorization.resolveActor(envelope);
    requireCondition(envelope.guildId === discord.guildId && envelope.targetId === envelope.userId && commands.includes(envelope.command), 'OPERATION_DENIED');
    return actor;
  }
  const navigation = createContactNavigation({ authorization, discord, channels, store, enabled });
  const selectionAccess = async (actor, envelope) => requireCondition(await authorization.authorize('case.manage', actor,
    contactScope(envelope.guildId, envelope.userId)) === true, 'OPERATION_DENIED');
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      try {
        const actor = await actorFor(envelope);
        if (envelope.command === 'ticket.contact.start') await selectionAccess(actor, envelope);
        if (['ticket.contact.select', 'ticket.contact.cancel'].includes(envelope.command)) {
          const observation = await discord.observe(envelope.userId); if (await enabled() !== true) return 'disabled';
          if (envelope.command === 'ticket.contact.select') await store.beginStaffContact({ actor, observation, interactionId: envelope.interactionId, recipientIds: envelope.recipientIds });
          else { await store.cancelStaffContact({ actor, observation, formToken: envelope.formToken }); return 'case_contact_cancelled'; }
        }
        return 'case_contact';
      } catch (error) { return status(error); }
    },
    async view(envelope) {
      if (await enabled() !== true) return { state: 'disabled' };
      try {
        const actor = await actorFor(envelope);
        if (envelope.command === 'ticket.contact.start') { await selectionAccess(actor, envelope); return { state: 'select' }; }
        if (envelope.command === 'ticket.contact.select') return await store.reviewStaffContact({ actor, observation: await discord.observe(envelope.userId), interactionId: envelope.interactionId });
        if (envelope.command === 'ticket.contact.queue') return await navigation.list({ actor, after: envelope.after });
        requireCondition(envelope.command === 'ticket.contact.destination', 'OPERATION_DENIED');
        return await navigation.destination({ actor, caseToken: envelope.caseToken });
      } catch (error) { return { state: status(error) === 'denied' ? 'denied' : 'unavailable' }; }
    },
  });
}
