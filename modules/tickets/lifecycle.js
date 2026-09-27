import { defaultSystemText } from '../../contracts/system-messages.js';
import { caseParticipantCommandOption, MAX_CASE_PARTICIPANTS } from './participants.js';
import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';
import { CASE_TYPES } from './index.js';
import { assignmentDescription, caseStaffCommandOptions } from './staff.js';
import { caseIntakeCommandOptions } from './intake.js';
import { caseContactCommandOptions } from './contacts.js';
import { caseLabelCommandOption, requireCaseLabels } from './labels.js';
import { caseReplyCommandOption } from './replies.js';
import { answerReplyCommandOption } from './answer-replies.js';
export { parseCaseReference } from './references.js';

export const CASE_ACTION_REASONS = Object.freeze({
  close: Object.freeze(['resolved', 'duplicate', 'withdrawn']),
  reopen: Object.freeze(['follow-up', 'closed-in-error']),
});

export function requireCaseActionReason(action, reason) {
  requireCondition(Object.hasOwn(CASE_ACTION_REASONS, action) && CASE_ACTION_REASONS[action].includes(reason), 'INVALID_CASE_REASON');
}

export function caseStatusView(record) {
  return { state: 'ready', id: record.id, type: record.type, caseState: record.state, version: record.version,
    userId: record.userId, channelId: record.channelId, action: record.action, actionStatus: record.actionStatus,
    assigneeId: record.assigneeId, assignmentStatus: record.assignmentStatus,
    ...(record.priority === undefined ? {} : { priority: record.priority, tags: record.tags }),
    ...(record.plan?.audience ? { participantIds: record.plan.audience.participants.map(grant => grant.userId) } : {}) };
}

/** Operational metadata only. No case messages, forms, notes or attachment previews. */
export function caseStatusReply(view, text = defaultSystemText) {
  requireCondition(view && typeof view === 'object', 'INVALID_CASE_VIEW');
  if (view.state !== 'ready') {
    requireKeys(view, ['state']);
    const messages = { disabled: text("tickets.lifecycle.sophie_commands_are_currently_disabled_4b861d"), denied: text("tickets.lifecycle.current_responder_permissions_are_required_fo_5ebf09"),
      unavailable: text("tickets.lifecycle.the_case_status_could_not_be_confirmed_staff__c511b4") };
    requireCondition(Object.hasOwn(messages, view.state), 'INVALID_CASE_VIEW');
    return { content: messages[view.state], embeds: [], components: [] };
  }
  requireKeys(view, ['state', 'id', 'type', "caseState", 'version', "userId", "channelId", 'action', "actionStatus", "assigneeId", "assignmentStatus",
    ...(Object.hasOwn(view, 'priority') ? ['priority', 'tags'] : []),
    ...(Object.hasOwn(view, "participantIds") ? ["participantIds"] : [])]);
  requireName(view.id); requireId(view.userId); requireInteger(view.version, 0, 2_147_483_646);
  if (view.channelId !== null) requireId(view.channelId);
  const type = CASE_TYPES.find(item => item.id === view.type);
  const states = { pending: text("tickets.lifecycle.preparing_or_awaiting_review_2a83e1"), open: text("tickets.lifecycle.open_ed077f"), closing: text("tickets.lifecycle.closing_permissions_not_yet_confirmed_897cba"), closed: text("tickets.lifecycle.closed_c21ead"), failed: text("tickets.lifecycle.access_unavailable_58b151") };
  requireCondition(type && Object.hasOwn(states, view.caseState) && [null, 'close', 'reopen'].includes(view.action) &&
    [null, 'pending', 'confirmed', 'revoked', 'ineligible', 'superseded'].includes(view.actionStatus), 'INVALID_CASE_VIEW');
  const reference = `${view.id}@${view.version}`;
  if (Object.hasOwn(view, 'priority')) requireCaseLabels(view);
  const labels = Object.hasOwn(view, 'priority') ? text("tickets.lifecycle.manual_priority_tags_8d67aa", { priority: view.priority, value: view.tags.map(tag => '`' + tag + '`').join(', ') || text("tickets.lifecycle.none_dc937b") }) : '';
  let participants = '';
  if (Object.hasOwn(view, "participantIds")) {
    requireCondition(Array.isArray(view.participantIds) && view.participantIds.length <= MAX_CASE_PARTICIPANTS &&
      new Set(view.participantIds).size === view.participantIds.length, 'INVALID_CASE_VIEW'); view.participantIds.forEach(requireId);
    participants = text("tickets.lifecycle.selected_additional_participants_a2d0d0", { value: view.participantIds.map(id => `<@${id}>`).join(', ') || text("tickets.lifecycle.none_dc937b") });
  }
  const controls = view.channelId === null ? text("tickets.lifecycle.channel_provisioning_must_be_reviewed_before__73c1dc") :
    view.version >= 2_147_483_645 ? text("tickets.lifecycle.this_case_needs_operator_review_8f494e") :
    ['closed', 'failed'].includes(view.caseState) ? text("tickets.lifecycle.to_reopen_use_ticket_reopen_case_reason_follo_ee01e5", { reference: reference }) :
      text("tickets.lifecycle.to_close_use_ticket_close_case_reason_resolve_f2abd0", { reference: reference });
  return { content: text("tickets.lifecycle.case_management_retained_records_7ed923"), embeds: [{ title: text(`tickets.type.${type.id}`),
    description: text("tickets.lifecycle.state_member_assigned_reference_2baad5", { value: states[view.caseState], userId: view.userId, value3: assignmentDescription(view, text), labels: labels, participants: participants, value6: view.channelId === null ? '' : text("tickets.lifecycle.channel_9874d9", { channelId: view.channelId }), reference: reference, value8: view.actionStatus === 'revoked' || view.actionStatus === 'ineligible' ? text("tickets.lifecycle.the_last_reopening_request_was_not_authorised_2c6e42") : '', controls: controls }) }], components: [] };
}

/** Reviewed registration data only; loading this module never contacts Discord. */
export function ticketCommandDefinition() {
  const reference = { type: 3, name: 'case', description: 'The case ID and version shown by /ticket status.', required: true, max_length: 107 };
  return { type: 1, name: 'ticket', description: 'Open a private request or manage an authorized case.',
    integration_types: [0], contexts: [0], options: [
      ...caseIntakeCommandOptions(), ...caseContactCommandOptions(),
      { type: 1, name: 'status', description: 'Inspect a case, or the current case channel.', options: [
        { type: 3, name: 'case', description: 'Case ID; omit inside its channel.', max_length: 96 },
      ] },
      ...['close', 'reopen'].map(action => ({ type: 1, name: action,
        description: action === 'close' ? 'Request read-only closure and retain the case.' : 'Request reopening under current permissions.',
        options: [{ ...reference }, { type: 3, name: 'reason', description: 'Reason for this action.', required: true,
          choices: CASE_ACTION_REASONS[action].map(value => ({ name: value, value })) }] })),
      ...caseStaffCommandOptions(reference), caseParticipantCommandOption(reference), caseLabelCommandOption(reference), caseReplyCommandOption(reference), answerReplyCommandOption(reference),
    ] };
}
