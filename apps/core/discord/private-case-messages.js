import { responderRoles } from '../../../platform/authorization/case-responders.js';
import { createHash } from 'node:crypto';
import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { requireScreenId, validateOnboardingPart, validateOnboardingPayload } from '../../../modules/onboarding/screens.js';
import { requireAlertId, alertMarker, validateOnboardingAlertPayload } from '../../../modules/onboarding/alerts.js';
import { requireIntakeMessageId, intakeMessageMarker, validateCaseIntakePayload, intakeResponderRole } from '../../../modules/tickets/intake-messages.js';
import { requireReplyId, replyMarker, validateCaseReplyPayload } from '../../../modules/tickets/replies.js';
import { validateCasePolicy, validateCasePlan, casePlanKey, caseIdentityKey } from '../../../modules/tickets/channel-policy.js';
import { validateRoleMapping, validateRoleContext } from '../../../modules/membership/discord-policy.js';
import { PERMISSIONS, channelPermissions } from '../../../platform/authorization/discord-permissions.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function visibleBody(value) {
  return { content: value.content ?? '', embeds: (value.embeds ?? []).map(embed => ({
    ...(embed.title === undefined ? {} : { title: embed.title }), description: embed.description,
    ...(embed.footer === undefined ? {} : { footer: { text: embed.footer.text } }),
    // Discord adds non-visible scan metadata to otherwise unchanged embeds.
    ...(Object.keys(embed).some(key => !['type', 'title', 'description', 'footer', 'content_scan_version'].includes(key)) ||
      (embed.content_scan_version !== undefined && (!Number.isSafeInteger(embed.content_scan_version) || embed.content_scan_version < 0)) ||
      (embed.footer && Object.keys(embed.footer).some(key => key !== 'text')) ? { unexpected: true } : {}),
  })), components: (value.components ?? []).map(row => ({ type: row.type, components: (row.components ?? []).map(button => ({
    type: button.type, style: button.style, label: button.label, disabled: button.disabled ?? false, custom_id: button.custom_id,
    ...(Object.keys(button).some(key => !['id', 'type', 'style', 'label', 'disabled', 'custom_id'].includes(key)) ? { unexpected: true } : {}),
  })) })) };
}

/**
 * A Shuttle step message is compared by its text and whether link previews are suppressed. Discord may attach
 * preview embeds to it afterwards, so those are not part of what this bot wrote.
 */
const stepBody = value => ({ content: value.content ?? '', suppressed: ((value.flags ?? 0) & 4) !== 0,
  ...((value.components ?? []).length > 0 ? { unexpected: true } : {}) });
// 'screen' is the single-message format sent before message groups. It can be recognised for recovery; the
// transport has no route that sends it.
const SHUTTLE_KINDS = Object.freeze(['status', 'content', 'nav', 'screen']);

/** Closed own-message formats. No history scan, arbitrary route or externally supplied renderer. */
export function createPrivateCaseMessages({ purpose, transport, roles, channels, mapping, policy, clock }) {
  requireCondition(['screen', 'alert', 'intake', 'reply'].includes(purpose), 'INVALID_CASE_MESSAGE_PURPOSE');
  const validateId = { screen: requireScreenId, alert: requireAlertId, intake: requireIntakeMessageId, reply: requireReplyId }[purpose];
  const marker = { alert: alertMarker, intake: intakeMessageMarker, reply: replyMarker }[purpose];
  // Shuttle messages carry no marker: each is named by the ID recorded from this bot's own create response, and
  // anything that changes state also requires its exact body. kind is status, content or nav; screenId is the run's.
  const validatePayload = { screen: (payload, recordId, kind, screenId) => {
    requireCondition(SHUTTLE_KINDS.includes(kind), 'INVALID_SHUTTLE_PAYLOAD'); requireScreenId(screenId);
    if (kind === 'screen') validateOnboardingPayload(payload, screenId); else validateOnboardingPart(kind, payload, screenId);
  }, alert: validateOnboardingAlertPayload, intake: validateCaseIntakePayload, reply: validateCaseReplyPayload }[purpose];
  const read = { screen: transport.getOnboardingMessage, alert: transport.getOnboardingAlert, intake: transport.getCaseIntakeMessage, reply: transport.getCaseReplyMessage }[purpose];
  const create = { screen: transport.createOnboardingMessage, alert: transport.createOnboardingAlert, intake: transport.createCaseIntakeMessage, reply: transport.createCaseReplyMessage }[purpose];
  validateRoleMapping(mapping); validateCasePolicy(policy);
  requireCondition([transport.guildId, roles.guildId, channels.guildId, mapping.guildId].every(id => id === policy.guildId) &&
    mapping.botUserId === policy.botUserId, 'CASE_CONFIGURATION_INVALID');
  const fixed = structuredClone(policy), roleMapping = structuredClone(mapping);
  const observations = new WeakMap(), preparations = new WeakMap();
  const key = casePlanKey;
  // The authority boundary when a write started (see roles.prepare); null where sharing is unavailable.
  const boundary = async () => purpose === 'screen' && typeof roles.readAuthorityBoundary === 'function' ? roles.readAuthorityBoundary() : null;
  function certify(raw, expected, observedAt, version, writtenBoundary = null) {
    const { recordId, plan, channelId, messageId = null } = expected;
    validateId(recordId); requireId(channelId); validateCasePlan(plan);
    requireCondition(plan.guildId === fixed.guildId, 'FOREIGN_GUILD');
    if (raw !== null) {
      requireId(raw?.id);
      requireCondition(raw.channel_id === channelId && (messageId === null || raw.id === messageId) && raw.author?.id === fixed.botUserId &&
        raw.author.bot === true && raw.webhook_id === undefined && raw.type === 0 && Array.isArray(raw.attachments) && raw.attachments.length === 0 &&
        Array.isArray(raw.embeds) && raw.embeds.length <= 10 &&
        (raw.components === undefined || (Array.isArray(raw.components) && raw.components.length <= 5)) &&
        (purpose === 'screen' || raw.embeds.some(embed => embed.footer?.text === marker(recordId))), 'SHUTTLE_MESSAGE_OWNERSHIP');
    } else requireId(messageId);
    const proof = Object.freeze({ messageId: raw?.id ?? messageId, missing: raw === null });
    observations.set(proof, { recordId, planKey: key(plan), identityKey: caseIdentityKey(plan), channelId, messageId: proof.messageId, missing: proof.missing,
      bodyHash: raw === null ? null : hash(visibleBody(raw)), stepHash: raw === null || purpose !== 'screen' ? null : hash(stepBody(raw)),
      mentionsMatch: purpose === 'screen' || (raw?.mention_everyone === false && Array.isArray(raw?.mentions) && raw.mentions.length === 0 &&
        Array.isArray(raw?.mention_roles) && (purpose === 'reply' ? raw.mention_roles.length === 0 :
          purpose === 'intake' ? raw.mention_roles.length <= 1 : raw.mention_roles.length === 1 && raw.mention_roles[0] === responderRoles(fixed, 'shuttle')[0])),
      mentionRoles: Array.isArray(raw?.mention_roles) ? [...raw.mention_roles] : [], known: true, observedAt, version, writtenBoundary });
    return proof;
  }
  function receipt(proof, expected) {
    const record = observations.get(proof);
    requireCondition(record && record.recordId === expected.recordId && record.channelId === expected.channelId &&
      record.identityKey === caseIdentityKey(expected.plan), 'SHUTTLE_MESSAGE_UNTRUSTED');
    return record;
  }
  async function candidate(proof, expected) {
    const record = receipt(proof, expected);
    requireCondition(record.planKey === key(expected.plan), 'CASE_AUDIENCE_CHANGED');
    requireFreshObservation(record, clock());
    requireCondition(await roles.readContinuity() === record.version, 'OBSERVATION_INVALIDATED');
    requireFreshObservation(record, clock());
    return { messageId: record.messageId, missing: record.missing };
  }
  /**
   * Accepts this bot's own write response without reading the message back. Discord dispatches an event for the write
   * itself, so the continuity stamp moves on; instead the authority boundary must be unchanged since the write began.
   */
  async function written(proof, expected) {
    const record = receipt(proof, expected);
    requireCondition(record.planKey === key(expected.plan), 'CASE_AUDIENCE_CHANGED');
    requireFreshObservation(record, clock());
    requireCondition(record.writtenBoundary !== null && await boundary() === record.writtenBoundary, 'OBSERVATION_INVALIDATED');
    requireFreshObservation(record, clock());
    return { messageId: record.messageId, missing: record.missing };
  }
  async function consume(preparation, plan, channelId, retired) {
    const record = preparations.get(preparation);
    requireCondition(record && record.planKey === key(plan) && record.channelId === channelId && (!record.retired || retired), 'SHUTTLE_MESSAGE_UNTRUSTED');
    preparations.delete(preparation);
    await roles.assertCurrent(record.context);
    const channel = await channels.verification.candidate(record.proof, plan);
    requireCondition(channel.id === channelId, 'CASE_CHANNEL_MISMATCH');
    if (!retired) await channels.verification.channel(record.proof, plan, false);
    return record;
  }
  return Object.freeze({
    guildId: fixed.guildId,
    verification: Object.freeze({
      // A late authentic result may retain its own ID; it cannot confirm state or authorize access.
      receipt(proof, expected) { const record = receipt(proof, expected); return { messageId: record.messageId, missing: record.missing }; },
      candidate,
      written,
      async matches(proof, expected, { fromWrite = false } = {}) {
        if (fromWrite) await written(proof, expected); else await candidate(proof, expected);
        validatePayload(expected.payload, expected.recordId, expected.kind, expected.screenId);
        const record = observations.get(proof);
        if (record.missing) return false;
        if (purpose === 'screen' && expected.kind === 'content') return record.stepHash === hash(stepBody(expected.payload));
        return record.mentionsMatch && (purpose !== 'intake' || JSON.stringify(record.mentionRoles) === JSON.stringify(expected.payload.allowed_mentions.roles)) &&
          record.bodyHash === hash(visibleBody(expected.payload));
      },
    }),
    // share: a Shuttle delivery writing several messages in a row may re-use recent role and channel reads while the
    // Gateway records no authority change (see roles.prepare). Every preparation is still single-use.
    async prepare(plan, channelId, retired, notify = false, { share = false } = {}) {
      requireId(channelId); requireCondition(typeof retired === 'boolean' && typeof notify === 'boolean', 'INVALID_SHUTTLE_SCREEN');
      requireCondition(typeof share === 'boolean' && (!share || purpose === 'screen'), 'INVALID_SHUTTLE_SCREEN');
      const { context, observation } = await roles.prepare(plan.openerId, { share });
      validateRoleContext(context, roleMapping, clock());
      const proof = await channels.inspect(plan, channelId, { share });
      const channel = await channels.verification.candidate(proof, plan);
      if (!retired) await channels.verification.channel(proof, plan, false);
      const permissions = channelPermissions({ guildId: fixed.guildId, userId: fixed.botUserId,
        roles: context.roles.map(role => ({ id: role.id, permissions: role.permissions })), roleIds: context.botRoleIds, overwrites: channel.overwrites });
      const needed = PERMISSIONS.viewChannel | PERMISSIONS.readHistory | (retired ? 0n : PERMISSIONS.sendMessages | PERMISSIONS.embedLinks);
      requireCondition(!context.botTimedOut && (permissions & needed) === needed, 'BOT_PERMISSION_MISSING');
      let mentionRoleId = null;
      if (purpose === 'alert') { requireCondition(plan.type === 'shuttle' && !retired, 'INVALID_SHUTTLE_ALERT'); mentionRoleId = responderRoles(fixed, 'shuttle')[0]; }
      if (purpose === 'intake') { const role = intakeResponderRole(plan.type, fixed); requireCondition(!retired, 'INVALID_INTAKE_MESSAGE'); if (notify) mentionRoleId = role; }
      if (mentionRoleId !== null) {
        const mentionable = await roles.roleMentionable(context, mentionRoleId);
        requireCondition(mentionable || (permissions & (1n << 17n)) !== 0n, 'STAFF_MENTION_UNAVAILABLE');
      }
      await roles.assertCurrent(context);
      const preparation = Object.freeze({ observation: Object.freeze({ ...observation }), proof });
      preparations.set(preparation, { context, proof, planKey: key(plan), channelId, retired, mentionRoleId }); return preparation;
    },
    async inspect({ plan, channelId, recordId, messageId }) {
      validateId(recordId); requireId(channelId); requireId(messageId);
      const version = await roles.readContinuity(), startedAt = clock();
      const raw = await read(channelId, messageId);
      return certify(raw, { plan, channelId, recordId, messageId }, startedAt, version);
    },
    async create(preparation, { plan, channelId, recordId, payload, kind, screenId }) {
      requireCondition(kind !== 'screen', 'INVALID_SHUTTLE_PAYLOAD'); // Recognised for recovery only; never sent.
      validatePayload(payload, recordId, kind, screenId);
      if (purpose === 'alert') requireCondition(payload.allowed_mentions.roles[0] === responderRoles(fixed, 'shuttle')[0], 'INVALID_SHUTTLE_ALERT');
      const held = await consume(preparation, plan, channelId, false);
      if (purpose === 'intake') requireCondition((payload.allowed_mentions.roles[0] ?? null) === held.mentionRoleId &&
        (held.mentionRoleId === null || held.mentionRoleId === intakeResponderRole(plan.type, fixed)), 'INVALID_INTAKE_MESSAGE');
      const version = await roles.readContinuity(), startedAt = clock(), stamp = await boundary();
      const raw = purpose === 'screen' ? await create(channelId, recordId, kind, screenId, payload) : await create(channelId, recordId, payload);
      return certify(raw, { plan, channelId, recordId }, startedAt, version, stamp);
    },
    // A message someone deleted comes back as a missing proof rather than an error.
    async edit(preparation, { plan, channelId, recordId, messageId, payload, retired, kind, screenId }) {
      requireCondition(purpose === 'screen' && kind !== 'screen', 'INVALID_CASE_MESSAGE_PURPOSE');
      validatePayload(payload, recordId, kind, screenId); requireId(messageId);
      await consume(preparation, plan, channelId, retired);
      const version = await roles.readContinuity(), startedAt = clock(), stamp = await boundary();
      const raw = await transport.editOnboardingMessage(channelId, messageId, kind, screenId, payload);
      return certify(raw, { plan, channelId, recordId, messageId }, startedAt, version, stamp);
    },
    /** Deletes one of a run's own messages. The result is a missing proof whether it was deleted now or before. */
    async remove(preparation, { plan, channelId, recordId, messageId }) {
      requireCondition(purpose === 'screen', 'INVALID_CASE_MESSAGE_PURPOSE');
      validateId(recordId); requireId(messageId);
      // Removal needs ownership and the channel, not an audience that may since have closed.
      await consume(preparation, plan, channelId, true);
      const version = await roles.readContinuity(), startedAt = clock(), stamp = await boundary();
      await transport.deleteOnboardingMessage(channelId, messageId);
      return certify(null, { plan, channelId, recordId, messageId }, startedAt, version, stamp);
    },
    async withdraw(preparation, { plan, channelId, recordId, messageId, message }) {
      requireCondition(purpose === 'reply', 'INVALID_CASE_MESSAGE_PURPOSE');
      validateId(recordId); requireId(channelId); requireId(messageId);
      const expected = { plan, channelId, recordId };
      const observed = await candidate(message, expected);
      requireCondition(observed.messageId === messageId, 'SHUTTLE_MESSAGE_UNTRUSTED');
      // Withdrawal needs identity/ownership, not a still-open audience or the revoked author's grant.
      await consume(preparation, plan, channelId, true);
      await candidate(message, expected);
      if (!observed.missing) await transport.deleteCaseReplyMessage(channelId, messageId, recordId);
    },
  });
}
