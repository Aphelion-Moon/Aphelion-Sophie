import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { CASE_TYPES } from './index.js';

export const ORDINARY_CASE_TYPES = Object.freeze(CASE_TYPES.filter(type => type.id !== 'shuttle').map(type => type.id));
export const requireCaseIssueId = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'INVALID_CASE_ISSUE');
const prefix = 'sophie:case-issue:v1';

export function caseIssueReason(code) {
  if (['BOT_PERMISSION_MISSING', 'DISCORD_AUTHORIZATION_FAILED', 'CASE_CHANNEL_ACL_MISMATCH', 'OPERATION_DENIED', 'STAFF_MENTION_UNAVAILABLE'].includes(code)) return 'permissions';
  if (code === 'ATTEMPT_LIMIT') return 'attempts';
  if (['CASE_INTAKE_UNCERTAIN', 'CASE_REPLY_UNCERTAIN', 'DELIVERY_UNCERTAIN', 'CASE_PROVISION_UNCERTAIN'].includes(code)) return 'uncertain';
  return 'review';
}
export function parseCaseIssueReference(value) {
  const match = typeof value === 'string' && /^([a-f0-9]{32})\.([0-9]{1,10})$/.exec(value);
  requireCondition(match, 'INVALID_CASE_ISSUE'); const expectedRevision = Number(match[2]);
  requireInteger(expectedRevision, 0, 2_147_483_644); requireCondition(String(expectedRevision) === match[2], 'INVALID_CASE_ISSUE');
  return { issueId: match[1], expectedRevision };
}
export function parseCaseIssueControl(value) {
  const queue = /^sophie:case-issue:v1:queue:(first|[a-f0-9]{32})$/.exec(value);
  if (queue) return { command: 'ticket.issues', after: queue[1] === 'first' ? null : queue[1] };
  const action = /^sophie:case-issue:v1:recheck:([a-f0-9]{32}):([0-9]{1,10})$/.exec(value);
  requireCondition(action, 'INTERACTION_COMPONENT_UNSUPPORTED');
  return { command: 'ticket.issue.recheck', ...parseCaseIssueReference(`${action[1]}.${action[2]}`) };
}

/** Private bounded operational metadata; no questions, answers, conversation or notes. */
export function caseIssueQueueReply(view, text = defaultSystemText) {
const reasons = Object.freeze({ permissions: text("tickets.delivery_issues.current_discord_permissions_or_authority_need_251ab3"),
  attempts: text("tickets.delivery_issues.automatic_attempts_reached_their_limit_1246d3"), uncertain: text("tickets.delivery_issues.an_earlier_delivery_has_an_uncertain_result_f4906c"), review: text("tickets.delivery_issues.delivery_needs_review_5c8aad") });

  requireCondition(view !== null && typeof view === 'object', 'INVALID_CASE_ISSUE_QUEUE');
  if (view.state !== 'ready') {
    requireKeys(view, ['state']); const messages = { disabled: text("tickets.delivery_issues.sophie_commands_are_currently_disabled_4b861d"),
      denied: text("tickets.delivery_issues.ticket_delivery_review_requires_current_respo_c50cba"), stale: text("tickets.delivery_issues.this_queue_position_is_unavailable_use_ticket_3a109f"),
      unavailable: text("tickets.delivery_issues.ticket_delivery_issues_could_not_be_confirmed_a34b98") };
    requireCondition(Object.hasOwn(messages, view.state), 'INVALID_CASE_ISSUE_QUEUE');
    return { content: messages[view.state], embeds: [], components: [] };
  }
  requireKeys(view, ['state', "guildId", 'entries', 'next']); requireId(view.guildId);
  requireCondition(Array.isArray(view.entries) && view.entries.length <= 5, 'INVALID_CASE_ISSUE_QUEUE');
  if (view.next !== null) requireCaseIssueId(view.next);
  const ids = new Set(), embeds = [], buttons = [];
  for (const [index, entry] of view.entries.entries()) {
    requireKeys(entry, ["issueId", "userId", 'revision', "channelId", "caseState", "caseType", 'kind', 'reason', 'attempted', 'recheckable', "needsMessageId", "channelChoice", ...(entry.kind === 'reply' ? ["replyId"] : [])]);
    requireCaseIssueId(entry.issueId); requireId(entry.userId); requireInteger(entry.revision, 0, 2_147_483_646);
    if (entry.channelId !== null) requireId(entry.channelId);
    requireCondition(ORDINARY_CASE_TYPES.includes(entry.caseType) && ['pending', 'open', 'closing', 'closed', 'failed'].includes(entry.caseState) &&
      ['case', 'intake', 'reply'].includes(entry.kind) && Object.hasOwn(reasons, entry.reason) && !ids.has(entry.issueId) &&
      [entry.attempted, entry.recheckable, entry.needsMessageId].every(value => typeof value === 'boolean') &&
      (!entry.needsMessageId || (['intake','reply'].includes(entry.kind) && !entry.recheckable)), 'INVALID_CASE_ISSUE_QUEUE'); ids.add(entry.issueId);
    let guidance = '';
    if (entry.kind === 'reply') { requireCaseIssueId(entry.replyId); guidance = text("tickets.delivery_issues.reply_marker_sophie_staff_reply_v_bdb390", { replyId: entry.replyId }); }
    if (entry.channelChoice !== null) {
      const choice = entry.channelChoice; requireKeys(choice, ['required', 'candidates', 'total']); requireInteger(choice.total, 2, 2_147_483_646);
      requireCondition(entry.kind === 'case' && typeof choice.required === 'boolean' && (!choice.required || !entry.recheckable) &&
        Array.isArray(choice.candidates) && choice.candidates.length === Math.min(choice.total, 5) && new Set(choice.candidates).size === choice.candidates.length, 'INVALID_CASE_ISSUE_QUEUE');
      choice.candidates.forEach(requireId);
      guidance += text("tickets.delivery_issues.retained_candidates_b0f696", { total: choice.total, value: choice.candidates.map(id => `<#${id}>`).join(', '), value3: choice.total > 5 ? text("tickets.delivery_issues.first_five_shown_26e030") : '' });
      if (choice.required) guidance += choice.total > 500 ? text("tickets.delivery_issues.the_channel_selection_limit_requires_operator_a87d8b") :
        text("tickets.delivery_issues.choose_the_intended_channel_with_ticket_choos_125f64", { issueId: entry.issueId, revision: entry.revision });
    }
    if (entry.needsMessageId) guidance += text("tickets.delivery_issues.identify_the_matching_sophie_message_in_this__a2cb01", { issueId: entry.issueId, revision: entry.revision });
    else if (!entry.recheckable && !entry.channelChoice?.required) guidance += text("tickets.delivery_issues.review_the_case_and_configuration_before_rech_6ec36b");
    embeds.push({ title: `${index + 1}. ${entry.kind === 'case' ? text("tickets.delivery_issues.private_case_provisioning_febdd1") : entry.kind === 'reply' ? text("tickets.delivery_issues.human_staff_reply_delivery_5041ac") : text("tickets.delivery_issues.ticket_answer_delivery_40b9df")}`,
      description: text("tickets.delivery_issues.member_case_c5d312", { label: text(`tickets.type.${entry.caseType}`), userId: entry.userId, caseState: entry.caseState, value: entry.channelId === null ? '' : `: <#${entry.channelId}>`, value5: reasons[entry.reason], value6: entry.attempted ? text("tickets.delivery_issues.an_earlier_change_may_have_reached_discord_d76b59") : '', guidance: guidance }) });
    buttons.push({ type: 2, style: 2, label: text("tickets.delivery_issues.recheck_7ff5c2", { value: index + 1 }), disabled: !entry.recheckable || entry.revision > 2_147_483_644,
      custom_id: `${prefix}:recheck:${entry.issueId}:${entry.revision}` });
  }
  requireCondition(view.next === null || view.next === view.entries.at(-1)?.issueId, 'INVALID_CASE_ISSUE_QUEUE');
  const navigation = [{ type: 2, style: 1, label: text("tickets.delivery_issues.refresh_0e9161"), custom_id: `${prefix}:queue:first` }];
  if (view.next !== null) navigation.push({ type: 2, style: 2, label: text("tickets.delivery_issues.next_page_c08ac7"), custom_id: `${prefix}:queue:${view.next}` });
  return { content: view.entries.length ? text("tickets.delivery_issues.parked_ticket_deliveries_you_can_manage_reche_4aee0e") :
    text("tickets.delivery_issues.no_parked_ticket_deliveries_you_can_manage_on_1987b4"),
  embeds, components: [...(buttons.length ? [{ type: 1, components: buttons }] : []), { type: 1, components: navigation }] };
}
