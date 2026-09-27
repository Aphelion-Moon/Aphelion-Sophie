import { loadCasePlan } from './case-audience.js';
import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { FORM_CASE_TYPES, canonicalCaseAnswers, requireFormToken, requireCaseSubject } from '../../../modules/tickets/intake.js';
import { validateTicketLimits } from '../../../modules/tickets/index.js';
import { validateCasePolicy, requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { createMemberOperation } from './members.js';
import { registerCasePolicy, reserveCaseRecords } from './case-records.js';
import { caseFormHash, readCaseForm } from './case-form-records.js';
import { ownedCaseFormSlot, reserveCaseFormSlot } from './case-form-slots.js';
import { createCaseContactForms } from './case-contact-forms.js';
import { recordInitialContactAudience } from './case-contact-records.js';
import { createCaseContactNavigation } from './case-contact-navigation.js';
import { receipt, saveReceipt, requireReceiptId } from './receipts.js';
import { loadCaseRecord } from './case-lookup.js';
import { recordCaseIntakeDelivery } from './case-intake-message-records.js';

/** Intake content stays in core. Outbox, receipts, navigation and audit contain references/hashes only. */
export function createCaseIntakeStore({ pool, clock, authorize, policy, verification, limits,
  authorizeRecorded = async () => false, resolveCaseParticipant = async () => null, authorizeCaseParticipant = async () => false }) {
  validateCasePolicy(policy); validateTicketLimits(limits);
  requireCondition(typeof authorize === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition([authorizeRecorded, resolveCaseParticipant, authorizeCaseParticipant].every(value => typeof value === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  const fixed = structuredClone(policy), budget = structuredClone(limits), memberOperation = createMemberOperation({ pool, clock });
  const access = async (actor, member) => {
    requireCondition(member.guildId === fixed.guildId && member.observation.present, 'MEMBER_ABSENT');
    requireCondition(await authorize('case.create', actor, { guildId: member.guildId, userId: member.userId }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === member.guildId && grant.userId === member.userId, 'OPERATION_DENIED');
    requireFreshObservation(member.observation, clock()); return grant;
  };
  const operation = (actor, observation, work) => memberOperation(observation, async (client, member) => {
    const grant = await access(actor, member); await registerCasePolicy(client, fixed); const value = await work(client, member, grant);
    await access(actor, member); return value;
  });
  const contacts = createCaseContactForms({ operation, authorize, authorizeRecorded, resolveCaseParticipant, authorizeCaseParticipant, policy: fixed, limits: budget, clock });
  async function record(client, member, grant, { interactionId, caseType, version = null, token = null, answers = [], subjectId = null, contactBindings = null }) {
    requireCaseSubject(caseType, subjectId);
    const caseId = `ticket.${interactionId}`;
    await reserveCaseRecords(client, member, { id: caseId, type: caseType, limits: budget, policy: fixed, clock });
    await client.query(`INSERT INTO sophie_core.case_intakes
      (case_id, guild_id, user_id, case_type, form_version, form_token, answers, answers_sha256, interaction_id, operator_grant, subject_id, contact_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [caseId, member.guildId, member.userId, caseType, version, token, JSON.stringify(answers), caseFormHash(answers), interactionId, grant, subjectId, caseType === 'staff-contact' ? 'pending' : null]);
    if (caseType === 'staff-contact') await recordInitialContactAudience(client, { caseId, guildId: member.guildId, bindings: contactBindings, interactionId, grant });
    await recordCaseIntakeDelivery(client, { id: caseId, guildId: member.guildId, openerId: member.userId, type: caseType }, fixed);
    return caseId;
  }
  async function destination(client, member, reference) {
    const row = await loadCaseRecord(client, { guildId: member.guildId, ...reference });
    requireCondition(row.user_id === member.userId && row.policy_version === fixed.version && Number(row.presence_epoch) === member.presenceEpoch,
      'CASE_DESTINATION_DENIED');
    requireCondition((await client.query('SELECT 1 FROM sophie_core.case_intakes WHERE case_id = $1 AND guild_id = $2 AND user_id = $3',
      [row.id, member.guildId, member.userId])).rowCount === 1, 'CASE_DESTINATION_DENIED');
    const plan = await loadCasePlan(client, row);
    if (row.state === 'pending') return { state: 'preparing', caseToken: row.operation_token };
    if (row.state !== 'open' || row.desired_access !== 'open') return { state: 'closed' };
    requireId(row.channel_id); return { state: 'inspect', plan, channelId: row.channel_id };
  }
  return Object.freeze({
    ...contacts.services,
    ...createCaseContactNavigation({ pool, clock, authorize, authorizeCaseParticipant, policy: fixed, verification }),
    async beginCaseForm({ actor, observation, interactionId, caseType, subjectId = null, isCurrent = () => true }) {
      requireId(interactionId); requireCondition(FORM_CASE_TYPES.includes(caseType) && caseType !== 'staff-contact' && typeof isCurrent === 'function', 'INVALID_CASE_FORM_TYPE');
      requireCaseSubject(caseType, subjectId);
      return operation(actor, observation, (client, member) => reserveCaseFormSlot(client, member,
        { interactionId, caseType, subjectId, policy: fixed, limits: budget, clock, isCurrent }))
        .then(result => { requireCondition(isCurrent(), 'CASE_FORM_DEADLINE'); return result; });
    },
    async openQuickHelp({ actor, observation, interactionId }) {
      return operation(actor, observation, async (client, member, grant) => {
        const previous = await receipt(client, member.guildId, member.userId, interactionId, { action: 'ticket.quick-help' });
        if (previous) return { ...previous, duplicate: true };
        const caseId = await record(client, member, grant, { interactionId, caseType: 'quick-help' });
        await saveReceipt(client, member.guildId, interactionId, { caseId }); return { caseId, duplicate: false };
      });
    },
    async submitCaseForm({ actor, observation, interactionId, formToken, values, expectedCaseType = null }) {
      requireReceiptId(interactionId); requireFormToken(formToken);
      requireCondition(expectedCaseType === null || expectedCaseType === 'staff-contact', 'INVALID_CASE_FORM_TYPE');
      return operation(actor, observation, async (client, member, grant) => {
        const slot = await ownedCaseFormSlot(client, member, fixed, formToken);
        requireCondition(expectedCaseType === null || slot.case_type === expectedCaseType, 'INVALID_CASE_FORM_TYPE');
        if (slot.case_type === 'staff-contact') await contacts.validateSubmission(actor, member, slot);
        const published = await readCaseForm(client, member.guildId, slot.case_type, slot.form_version);
        const answers = canonicalCaseAnswers(published.form, values), hash = caseFormHash(answers);
        const previous = await receipt(client, member.guildId, member.userId, interactionId, { action: 'ticket.submit', formToken, answersHash: hash });
        if (slot.consumed_case_id !== null) {
          const intake = (await client.query('SELECT answers_sha256, subject_id FROM sophie_core.case_intakes WHERE case_id = $1 AND guild_id = $2 AND user_id = $3 AND form_token = $4',
            [slot.consumed_case_id, member.guildId, member.userId, formToken])).rows[0];
          requireCondition(intake?.answers_sha256 === hash && intake.subject_id === slot.subject_id && (!previous || previous.caseId === slot.consumed_case_id), 'CASE_FORM_ALREADY_SUBMITTED');
          if (!previous) await saveReceipt(client, member.guildId, interactionId, { caseId: slot.consumed_case_id });
          return { caseId: slot.consumed_case_id, duplicate: true };
        }
        requireCondition(previous === null && published.status === 'published', 'CASE_FORM_UNAVAILABLE');
        const caseId = await record(client, member, grant, { interactionId, caseType: slot.case_type, version: slot.form_version, token: formToken, answers, subjectId: slot.subject_id, contactBindings: slot.contact_grants });
        if (slot.case_type === 'staff-contact') await contacts.validateSubmission(actor, member, slot);
        await client.query('UPDATE sophie_core.case_form_slots SET consumed_case_id = $3 WHERE guild_id = $1 AND token = $2', [member.guildId, formToken, caseId]);
        await saveReceipt(client, member.guildId, interactionId, { caseId }); return { caseId, duplicate: false };
      });
    },
    async describeTicketDestination({ actor, observation, interactionId = null, caseToken = null }) {
      requireCondition((interactionId === null) !== (caseToken === null), 'INVALID_CASE_REFERENCE');
      if (caseToken !== null) requireFormToken(caseToken); else requireReceiptId(interactionId);
      return operation(actor, observation, async (client, member) => {
        if (caseToken !== null) return destination(client, member, { token: caseToken });
        const result = (await client.query(`SELECT result FROM sophie_core.receipts WHERE guild_id = $1 AND user_id = $2 AND interaction_id = $3
          AND request->>'action' IN ('ticket.quick-help', 'ticket.submit')`, [member.guildId, member.userId, interactionId])).rows[0]?.result;
        requireCondition(result?.caseId !== undefined, 'CASE_DESTINATION_DENIED'); return destination(client, member, { id: result.caseId });
      });
    },
    async confirmTicketDestination({ actor, observation, caseToken, proof }) {
      requireFormToken(caseToken);
      return operation(actor, observation, async (client, member) => {
        const current = await destination(client, member, { token: caseToken }); requireCondition(current.state === 'inspect', 'CASE_DESTINATION_DENIED');
        requireCondition(typeof verification?.channel === 'function', 'CASE_VERIFIER_REQUIRED');
        const channel = await verification.channel(proof, current.plan, false); requireCaseChannel(channel, current.plan, fixed, false);
        requireCondition(channel.id === current.channelId, 'CASE_CHANNEL_MISMATCH');
        return { state: 'ready', guildId: member.guildId, channelId: current.channelId };
      });
    },
  });
}
