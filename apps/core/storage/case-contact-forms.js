import { requireCondition, requireFreshObservation } from '../../../contracts/validation.js';
import { requireReceiptId } from './receipts.js';
import { operatorGrant, validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { contactRecipientIds, contactScope } from '../../../modules/tickets/contacts.js';
import { requireFormToken } from '../../../modules/tickets/intake.js';
import { requireContactBindings } from './case-contact-records.js';
import { ownedCaseFormSlot, reserveCaseFormSlot } from './case-form-slots.js';
import { readCaseForm } from './case-form-records.js';

/** Shared intake transaction owner supplies operation; this module handles selection, never answers. */
export function createCaseContactForms({ operation, authorize, authorizeRecorded, resolveCaseParticipant, authorizeCaseParticipant, policy, limits, clock }) {
  const access = async (actor, member) => requireCondition(await authorize('case.manage', actor, contactScope(member.guildId, member.userId)) === true, 'OPERATION_DENIED');
  async function validateSlot(actor, member, slot, { participants = true, confirmed = false, cancelling = false } = {}) {
    requireCondition(slot.case_type === 'staff-contact' && (cancelling || !slot.contact_cancelled) && (!confirmed || slot.contact_confirmed), 'CASE_CONTACT_CONFIRMATION_REQUIRED');
    validateOperatorGrant(slot.contact_operator_grant);
    requireCondition(slot.contact_operator_grant.guildId === member.guildId && slot.contact_operator_grant.userId === member.userId, 'OPERATION_DENIED');
    requireContactBindings(slot.contact_grants, policy, member.userId); await access(actor, member);
    requireCondition(await authorizeRecorded('case.manage', slot.contact_operator_grant, contactScope(member.guildId, member.userId)) === true, 'OPERATION_DENIED');
    if (participants) for (const binding of slot.contact_grants) requireCondition(await authorizeCaseParticipant(binding) === true, 'CASE_PARTICIPANT_DENIED');
    await access(actor, member); requireFreshObservation(member.observation, clock());
  }
  return Object.freeze({
    validateSubmission: (actor, member, slot) => validateSlot(actor, member, slot, { confirmed: true }),
    services: Object.freeze({
      async beginStaffContact({ actor, observation, interactionId, recipientIds }) {
        requireReceiptId(interactionId); const ids = contactRecipientIds(recipientIds);
        return operation(actor, observation, async (client, member) => {
          await access(actor, member);
          requireCondition(ids.every(id => ![member.userId, policy.botUserId, policy.staff, policy.leadOps, policy.guildId].includes(id)), 'CASE_PARTICIPANT_DENIED');
          const bindings = [];
          for (const userId of ids) {
            const binding = await resolveCaseParticipant({ guildId: member.guildId, userId });
            requireCondition(binding !== null && binding.guildId === member.guildId && binding.userId === userId, 'CASE_PARTICIPANT_DENIED'); bindings.push(binding);
          }
          requireContactBindings(bindings, policy, member.userId);
          for (const binding of bindings) requireCondition(await authorizeCaseParticipant(binding) === true, 'CASE_PARTICIPANT_DENIED');
          await access(actor, member); requireFreshObservation(member.observation, clock());
          const selected = await reserveCaseFormSlot(client, member, { interactionId, caseType: 'staff-contact', contactGrants: bindings,
            contactGrant: operatorGrant(actor), policy, limits, clock, isCurrent: () => true });
          await access(actor, member); return { token: selected.token };
        });
      },
      async reviewStaffContact({ actor, observation, interactionId }) {
        requireReceiptId(interactionId);
        return operation(actor, observation, async (client, member) => {
          const token = (await client.query('SELECT token FROM sophie_core.case_form_slots WHERE guild_id = $1 AND interaction_id = $2 AND user_id = $3',
            [member.guildId, interactionId, member.userId])).rows[0]?.token;
          requireCondition(token !== undefined, 'CASE_FORM_OWNER_MISMATCH');
          const slot = await ownedCaseFormSlot(client, member, policy, token); await validateSlot(actor, member, slot);
          requireCondition(slot.consumed_case_id === null, 'CASE_FORM_ALREADY_SUBMITTED');
          requireCondition((await readCaseForm(client, member.guildId, slot.case_type, slot.form_version)).status === 'published', 'CASE_FORM_UNAVAILABLE');
          return { state: 'review', token, openerId: member.userId, recipientIds: slot.contact_grants.map(binding => binding.userId) };
        });
      },
      async confirmStaffContact({ actor, observation, formToken, isCurrent = () => true }) {
        requireFormToken(formToken); requireCondition(typeof isCurrent === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
        return operation(actor, observation, async (client, member) => {
          requireCondition(isCurrent(), 'CASE_FORM_DEADLINE');
          const slot = await ownedCaseFormSlot(client, member, policy, formToken);
          // This opens blank authored questions, grants no access, and must fit the initial response deadline.
          // Recipients are freshly checked during selection/review, submission and every delivery boundary.
          await validateSlot(actor, member, slot, { participants: false });
          requireCondition(slot.consumed_case_id === null, 'CASE_FORM_ALREADY_SUBMITTED');
          const published = await readCaseForm(client, member.guildId, slot.case_type, slot.form_version);
          requireCondition(published.status === 'published' && isCurrent(), 'CASE_FORM_UNAVAILABLE');
          await client.query('UPDATE sophie_core.case_form_slots SET contact_confirmed = true WHERE guild_id = $1 AND token = $2', [member.guildId, formToken]);
          requireCondition(isCurrent(), 'CASE_FORM_DEADLINE');
          return { token: formToken, version: slot.form_version, form: published.form };
        }).then(value => { requireCondition(isCurrent(), 'CASE_FORM_DEADLINE'); return value; });
      },
      async cancelStaffContact({ actor, observation, formToken }) {
        requireFormToken(formToken);
        return operation(actor, observation, async (client, member) => {
          const slot = await ownedCaseFormSlot(client, member, policy, formToken);
          await validateSlot(actor, member, slot, { participants: false, cancelling: true });
          requireCondition(slot.consumed_case_id === null, 'CASE_FORM_ALREADY_SUBMITTED');
          await client.query('UPDATE sophie_core.case_form_slots SET contact_cancelled = true WHERE guild_id = $1 AND token = $2', [member.guildId, formToken]);
        });
      },
    }),
  });
}
