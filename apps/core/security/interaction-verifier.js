import { createPublicKey, verify } from 'node:crypto';
import { parseAnswerCommand } from '../../../modules/answers/discord.js';
import { requireAnswerName } from '../../../modules/answers/index.js';
import { parseAnswerReplyControl } from '../../../modules/tickets/answer-replies.js';
import { parseCaseTags, requireCaseLabels } from '../../../modules/tickets/labels.js';
import { requireReplyText } from '../../../modules/tickets/replies.js';
import { ContractError, requireCondition, requireId, requireInteger, requireName } from '../../../contracts/validation.js';
import { parseCaseReference, requireCaseActionReason } from '../../../modules/tickets/lifecycle.js';
import { parseCaseStaffControl, requireCaseQueueFilter, CASE_ASSIGN_REASONS } from '../../../modules/tickets/staff.js';
import { parseCaseIntakeControl, parseCaseFormSubmission, PUBLIC_CASE_TYPES } from '../../../modules/tickets/intake.js';
import { parseCaseIssueControl, parseCaseIssueReference } from '../../../modules/tickets/delivery-issues.js';
import { requireParticipantChange } from '../../../modules/tickets/participants.js';
import { parseContactSelection, parseContactControl } from '../../../modules/tickets/contacts.js';
import { ONBOARDING_ENTRY_ID } from '../../../modules/onboarding/entry-controls.js';
import { parseOnboardingControl } from '../../../modules/onboarding/screens.js';
import { parseOnboardingHelpControl } from '../../../modules/onboarding/assistance.js';
import { parseOnboardingIssueControl, parseOnboardingRecoveryReference } from '../../../modules/onboarding/delivery-issues.js';

/** Verify before parsing. Routing holds references; bounded form values have a separate core-only handoff. */
export function createInteractionVerifier({ publicKeyHex, applicationId, guildId, clock }) {
  requireId(applicationId); requireId(guildId);
  requireCondition(typeof publicKeyHex === 'string' && /^[a-fA-F0-9]{64}$/.test(publicKeyHex) && typeof clock === 'function', 'INTERACTION_VERIFIER_CONFIGURATION_INVALID');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
  const verified = new WeakMap();
  return Object.freeze({
    verify({ body, signature, timestamp }) {
      requireCondition(Buffer.isBuffer(body) && body.length > 0 && body.length <= 262_144, 'INTERACTION_BODY_INVALID');
      requireCondition(typeof signature === 'string' && /^[a-fA-F0-9]{128}$/.test(signature) &&
        typeof timestamp === 'string' && /^[0-9]{10,11}$/.test(timestamp), 'INTERACTION_SIGNATURE_INVALID');
      const now = clock(); requireInteger(now);
      const signedAt = Number(timestamp) * 1_000;
      requireCondition(signedAt <= now + 5_000 && now - signedAt <= 300_000, 'INTERACTION_TIMESTAMP_INVALID');
      requireCondition(verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex')), 'INTERACTION_SIGNATURE_INVALID');
      let payload;
      try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
      catch { throw new ContractError('INTERACTION_BODY_INVALID'); }
      requireCondition(payload !== null && typeof payload === 'object' && !Array.isArray(payload), 'INTERACTION_BODY_INVALID');
      requireCondition(payload.application_id === applicationId, 'FOREIGN_APPLICATION');
      if (payload.type === 1) return Object.freeze({ kind: 'ping' });
      requireCondition((payload.type === 2 && payload.data?.type === 1) || payload.type === 3 || payload.type === 5, 'INTERACTION_TYPE_UNSUPPORTED');
      requireCondition(payload.guild_id === guildId && payload.context === 0 &&
        payload.authorizing_integration_owners?.['0'] === guildId, 'FOREIGN_GUILD');
      requireId(payload.id); requireId(payload.channel_id); requireId(payload.member?.user?.id);
      requireCondition(payload.member.user.bot !== true, 'BOT_ACTOR_DENIED');
      // Never retain incoming roles, resolved entities or source messages in routing envelopes.
      let command, targetId, formValues = null, replyText = null, control = {};
      if (payload.type === 5) {
        const parsed = parseCaseFormSubmission(payload.data); command = 'ticket.submit'; targetId = payload.member.user.id;
        control = { formToken: parsed.formToken }; formValues = parsed.values;
      } else if (payload.type === 3) {
        requireId(payload.message?.id);
        targetId = payload.member.user.id;
        if (payload.data?.component_type === 5) ({ command, ...control } = parseContactSelection(payload.data));
        else {
          requireCondition(payload.data?.component_type === 2 &&
            payload.data.values === undefined && payload.data.resolved === undefined, 'INTERACTION_COMPONENT_UNSUPPORTED');
          if (payload.data.custom_id === ONBOARDING_ENTRY_ID) command = 'shuttle.start';
          else if (typeof payload.data.custom_id === 'string' && payload.data.custom_id.startsWith('sophie:answer-reply:')) {
            ({ command, ...control } = parseAnswerReplyControl(payload.data.custom_id));
          }
          else if (typeof payload.data.custom_id === 'string' && payload.data.custom_id.startsWith('sophie:contact:')) {
            ({ command, ...control } = parseContactControl(payload.data.custom_id));
          }
          else if (typeof payload.data.custom_id === 'string' && payload.data.custom_id.startsWith('sophie:case-issue:')) {
            ({ command, ...control } = parseCaseIssueControl(payload.data.custom_id));
          }
          else if (typeof payload.data.custom_id === 'string' && payload.data.custom_id.startsWith('sophie:ticket:')) {
            ({ command, ...control } = parseCaseIntakeControl(payload.data.custom_id));
          }
          else if (typeof payload.data.custom_id === 'string' &&
            (payload.data.custom_id.startsWith('sophie:case-queue:') || payload.data.custom_id.startsWith('sophie:case-staff:'))) {
            ({ command, ...control } = parseCaseStaffControl(payload.data.custom_id));
          }
          else if (typeof payload.data.custom_id === 'string' && payload.data.custom_id.startsWith('sophie:shuttle-issue:')) {
            ({ command, ...control } = parseOnboardingIssueControl(payload.data.custom_id));
          }
          else if (typeof payload.data.custom_id === 'string' && payload.data.custom_id.startsWith('sophie:shuttle-help:')) {
            ({ command, ...control } = parseOnboardingHelpControl(payload.data.custom_id));
          }
          else { command = 'shuttle.control'; control = { ...parseOnboardingControl(payload.data.custom_id), messageId: payload.message.id }; }
        }
      } else if (payload.data.name === 'answer') {
        ({ command, ...control } = parseAnswerCommand(payload.data.options)); targetId = payload.member.user.id;
      } else if (payload.data.name === 'ticket') {
        const options = payload.data.options;
        requireCondition(Array.isArray(options) && options.length === 1 && options[0]?.type === 1 &&
          ['open', 'report', 'contact', 'contacts', 'status', 'close', 'reopen', 'queue', 'claim', 'unclaim', 'assign', 'label', 'reply', 'answer', 'participant', 'issues', 'recover', 'choose'].includes(options[0].name) && options[0].value === undefined, 'INTERACTION_OPTIONS_INVALID');
        const action = options[0].name, fields = options[0].options ?? [];
        requireCondition(Array.isArray(fields) && fields.every(field => [3, 5, 6].includes(field?.type) && field.options === undefined), 'INTERACTION_OPTIONS_INVALID');
        targetId = payload.member.user.id; command = `ticket.${action}`;
        if (['contact', 'contacts'].includes(action)) {
          requireCondition(fields.length === 0, 'INTERACTION_OPTIONS_INVALID'); command = action === 'contact' ? 'ticket.contact.start' : 'ticket.contact.queue';
          if (action === 'contacts') control = { after: null };
        } else if (action === 'issues') {
          requireCondition(fields.length === 0, 'INTERACTION_OPTIONS_INVALID'); control = { after: null };
        } else if (['recover', 'choose'].includes(action)) {
          const selectedField = action === 'choose' ? 'channel' : 'message';
          requireCondition(fields.length === 2 && fields.every(field => field.type === 3 && ['issue', selectedField].includes(field.name)) &&
            new Set(fields.map(field => field.name)).size === 2, 'INTERACTION_OPTIONS_INVALID');
          const resultId = fields.find(field => field.name === selectedField).value; requireId(resultId);
          command = action === 'choose' ? 'ticket.channel.choose' : 'ticket.message.recover';
          control = { ...parseCaseIssueReference(fields.find(field => field.name === 'issue').value),
            ...(action === 'choose' ? { selectedChannelId: resultId } : { messageId: resultId }) };
        } else if (action === 'report') {
          requireCondition(fields.length === 0 || (fields.length === 1 && fields[0].name === 'player' && fields[0].type === 6), 'INTERACTION_OPTIONS_INVALID');
          if (fields.length) requireId(fields[0].value);
          const subjectId = fields[0]?.value ?? null;
          command = 'ticket.begin'; control = { caseType: 'player-report', subjectId };
        } else if (action === 'open') {
          requireCondition(fields.length === 1 && fields[0].name === 'type' && fields[0].type === 3 && PUBLIC_CASE_TYPES.includes(fields[0].value), 'INTERACTION_OPTIONS_INVALID');
          command = 'ticket.begin'; control = { caseType: fields[0].value };
        } else if (action === 'status') {
          requireCondition(fields.length === 0 || (fields.length === 1 && fields[0].name === 'case' && fields[0].type === 3), 'INTERACTION_OPTIONS_INVALID');
          if (fields.length) { requireName(fields[0].value); control = { caseId: fields[0].value }; }
        } else if (action === 'queue') {
          requireCondition(fields.length === 0 || (fields.length === 1 && fields[0].name === 'state' && fields[0].type === 3), 'INTERACTION_OPTIONS_INVALID');
          const filter = fields[0]?.value ?? 'active'; requireCaseQueueFilter(filter); control = { filter, after: null };
        } else if (['claim', 'unclaim'].includes(action)) {
          requireCondition(fields.length === 1 && fields[0].type === 3 && fields[0].name === 'case', 'INTERACTION_OPTIONS_INVALID');
          control = parseCaseReference(fields[0].value);
        } else if (action === 'label') {
          requireCondition(fields.length === 3 && fields.every(field => field.type === 3 && ['case', 'priority', 'tags'].includes(field.name)) &&
            new Set(fields.map(field => field.name)).size === 3, 'INTERACTION_OPTIONS_INVALID');
          const selected = Object.fromEntries(fields.map(field => [field.name, field.value])), tags = parseCaseTags(selected.tags);
          requireCaseLabels({ priority: selected.priority, tags });
          control = { ...parseCaseReference(selected.case), priority: selected.priority, tags };
        } else if (action === 'answer') {
          requireCondition(fields.length === 2 && fields.every(field => field.type === 3 && ['case','name'].includes(field.name)) &&
            new Set(fields.map(field => field.name)).size === 2, 'INTERACTION_OPTIONS_INVALID');
          const selected = Object.fromEntries(fields.map(field => [field.name,field.value])); requireAnswerName(selected.name);
          control = { ...parseCaseReference(selected.case), answerName: selected.name };
        } else if (action === 'reply') {
          const names = { case: 3, text: 3, confirm: 5 };
          requireCondition(fields.length === 3 && fields.every(field => Object.hasOwn(names, field.name) && names[field.name] === field.type) &&
            new Set(fields.map(field => field.name)).size === 3, 'INTERACTION_OPTIONS_INVALID');
          const selected = Object.fromEntries(fields.map(field => [field.name, field.value]));
          requireReplyText(selected.text); requireCondition(typeof selected.confirm === 'boolean', 'INTERACTION_OPTIONS_INVALID');
          control = { ...parseCaseReference(selected.case), confirmed: selected.confirm }; replyText = selected.text;
        } else if (action === 'participant') {
          const names = { case: 3, action: 3, member: 6, reason: 3, confirm: 5 };
          requireCondition(fields.length === 5 && fields.every(field => Object.hasOwn(names, field.name) && names[field.name] === field.type) &&
            new Set(fields.map(field => field.name)).size === 5, 'INTERACTION_OPTIONS_INVALID');
          const selected = Object.fromEntries(fields.map(field => [field.name, field.value]));
          requireParticipantChange({ action: selected.action, userId: selected.member, reason: selected.reason, confirmed: selected.confirm });
          control = { ...parseCaseReference(selected.case), participantAction: selected.action, participantId: selected.member,
            reason: selected.reason, confirmed: selected.confirm };
        } else if (action === 'assign') {
          requireCondition(fields.length === 3 && fields.every(field => field.type === (field.name === 'member' ? 6 : 3) &&
            ['case', 'reason', 'member'].includes(field.name)) && new Set(fields.map(field => field.name)).size === 3, 'INTERACTION_OPTIONS_INVALID');
          const assigneeId = fields.find(field => field.name === 'member').value, reason = fields.find(field => field.name === 'reason').value;
          requireId(assigneeId); requireCondition(CASE_ASSIGN_REASONS.includes(reason), 'INVALID_CASE_REASON');
          control = { ...parseCaseReference(fields.find(field => field.name === 'case').value), assigneeId, reason };
        } else {
          requireCondition(fields.length === 2 && fields.every(field => field.type === 3 && ['case', 'reason'].includes(field.name)) &&
            new Set(fields.map(field => field.name)).size === 2, 'INTERACTION_OPTIONS_INVALID');
          const reason = fields.find(field => field.name === 'reason').value; requireCaseActionReason(action, reason);
          control = { ...parseCaseReference(fields.find(field => field.name === 'case').value), reason };
        }
      } else if (payload.data.name === 'whitelist') {
        const options = payload.data.options;
        requireCondition(Array.isArray(options) && options.length === 1 && ['start', 'panel', 'close', 'queue', 'issues', 'recover', 'choose'].includes(options[0]?.name) && options[0]?.type === 1 &&
          options[0].value === undefined, 'INTERACTION_OPTIONS_INVALID');
        command = `shuttle.${options[0].name}`; targetId = payload.member.user.id;
        if (command === 'shuttle.close') {
          const fields = options[0].options;
          requireCondition(Array.isArray(fields) && fields.length >= 1 && fields.length <= 2 &&
            fields.every(field => field.options === undefined && ((field.name === 'confirm' && field.type === 5 && typeof field.value === 'boolean') ||
              (field.name === 'channel' && field.type === 7))) && new Set(fields.map(field => field.name)).size === fields.length &&
            fields.some(field => field.name === 'confirm'), 'INTERACTION_OPTIONS_INVALID');
          const channel = fields.find(field => field.name === 'channel'); if (channel) requireId(channel.value);
          control = { confirmed: fields.find(field => field.name === 'confirm').value, selectedChannelId: channel?.value ?? payload.channel_id };
        } else if (['shuttle.recover', 'shuttle.choose'].includes(command)) {
          const fields = options[0].options;
          const selectedField = command === 'shuttle.choose' ? 'channel' : 'message';
          requireCondition(Array.isArray(fields) && fields.length === 2 && fields.every(field => field?.type === 3 &&
            ['issue', selectedField].includes(field.name) && field.options === undefined) && new Set(fields.map(field => field.name)).size === 2, 'INTERACTION_OPTIONS_INVALID');
          const resultId = fields.find(field => field.name === selectedField).value; requireId(resultId);
          command = selectedField === 'channel' ? 'shuttle.channel.choose' : 'shuttle.message.recover';
          control = { ...parseOnboardingRecoveryReference(fields.find(field => field.name === 'issue').value),
            ...(selectedField === 'channel' ? { selectedChannelId: resultId } : { messageId: resultId }) };
        } else {
          requireCondition(options[0].options === undefined || (Array.isArray(options[0].options) && options[0].options.length === 0), 'INTERACTION_OPTIONS_INVALID');
          if (['shuttle.queue', 'shuttle.issues'].includes(command)) control = { after: null };
        }
      } else {
        command = payload.data.name;
        requireCondition(['mute', 'unmute'].includes(command), 'INTERACTION_COMMAND_UNSUPPORTED');
        const options = payload.data.options;
        requireCondition(Array.isArray(options) && options.length === 1 && options[0]?.name === 'member' && options[0]?.type === 6, 'INTERACTION_OPTIONS_INVALID');
        requireId(options[0].value); targetId = options[0].value;
      }
      requireCondition(typeof payload.token === 'string' && /^[A-Za-z0-9._-]{20,2048}$/.test(payload.token), 'INTERACTION_TOKEN_INVALID');
      const envelope = Object.freeze({ kind: 'command', interactionId: payload.id, guildId, channelId: payload.channel_id,
        userId: payload.member.user.id, command, targetId, ...control });
      verified.set(envelope, { verifiedAt: now, token: payload.token, expiresAt: Math.min(now, signedAt) + 900_000, formValues, replyText });
      return envelope;
    },
    resolvePrincipal(envelope) {
      const verifiedAt = verified.get(envelope)?.verifiedAt;
      const now = clock();
      requireCondition(verifiedAt !== undefined && verifiedAt <= now && now - verifiedAt <= 300_000, 'UNTRUSTED_PRINCIPAL');
      return Object.freeze({ guildId, userId: envelope.userId });
    },
    /** Intake adapter only. Consumption removes values from the retained proof before storage/delivery work. */
    takeCaseFormSubmission(envelope) {
      const record = verified.get(envelope), now = clock();
      requireCondition(envelope?.command === 'ticket.submit' && record?.formValues !== null && record?.formValues !== undefined &&
        record.verifiedAt <= now && now - record.verifiedAt <= 300_000, 'UNTRUSTED_CASE_FORM');
      const values = record.formValues; record.formValues = null; return values;
    },
    /** Reply command adapter only. Authored text never enters routing or generic receipts. */
    takeCaseReplyText(envelope) {
      const record = verified.get(envelope), now = clock();
      requireCondition(envelope?.command === 'ticket.reply' && typeof record?.replyText === 'string' &&
        record.verifiedAt <= now && now - record.verifiedAt <= 300_000, 'UNTRUSTED_CASE_REPLY');
      const text = record.replyText; record.replyText = null; return text;
    },
    /** Core response adapter only. The secret is not stored in the public envelope or database. */
    replyCredentials(envelope) {
      const record = verified.get(envelope);
      requireCondition(record && clock() >= record.verifiedAt && clock() < record.expiresAt, 'INTERACTION_REPLY_EXPIRED');
      return { applicationId, token: record.token };
    },
  });
}
