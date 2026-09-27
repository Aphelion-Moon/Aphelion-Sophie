import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';
import { CASE_TYPES } from './index.js';
import { parseCaseVersion, requireCaseToken } from './references.js';
import { CASE_PRIORITIES } from './labels.js';

export const CASE_QUEUE_FILTERS = Object.freeze({ active: Object.freeze(['pending', 'open', 'closing']),
  closed: Object.freeze(['closed']), failed: Object.freeze(['failed']) });
export const CASE_ASSIGN_REASONS = Object.freeze(['handoff', 'coverage']);

export function requireCaseQueueFilter(filter) { requireCondition(Object.hasOwn(CASE_QUEUE_FILTERS, filter), 'INVALID_CASE_QUEUE_FILTER'); }

/** Tokens route to retained metadata; they never establish case access or authority. */
export function parseCaseStaffControl(value) {
  requireCondition(typeof value === 'string', 'INTERACTION_COMPONENT_UNSUPPORTED');
  const queue = /^sophie:case-queue:v1:(active|closed|failed):(first|[a-f0-9]{48})$/.exec(value);
  if (queue) return { command: 'ticket.queue', filter: queue[1], after: queue[2] === 'first' ? null : queue[2] };
  const action = /^sophie:case-staff:v1:(claim|unclaim):([a-f0-9]{48}):([0-9]{1,10})$/.exec(value);
  requireCondition(action !== null, 'INTERACTION_COMPONENT_UNSUPPORTED');
  return { command: `ticket.${action[1]}`, caseToken: action[2], expectedVersion: parseCaseVersion(action[3]) };
}

export function assignmentDescription({ assigneeId, assignmentStatus }, text = defaultSystemText) {
  requireCondition((assigneeId === null) === (assignmentStatus === null) && [null, 'current', 'needs_review'].includes(assignmentStatus), 'INVALID_CASE_ASSIGNMENT');
  if (assigneeId === null) return text("tickets.staff.unassigned_14d33b");
  requireId(assigneeId);
  return `<@${assigneeId}>${assignmentStatus === 'needs_review' ? text("tickets.staff.current_responder_authority_needs_review_313dc6") : ''}`;
}

/** Only bounded operational metadata is rendered; no form, message or note is accepted. */
export function caseQueueReply(view, text = defaultSystemText) {
  requireCondition(view && typeof view === 'object', 'INVALID_CASE_QUEUE');
  if (view.state !== 'ready') {
    requireKeys(view, ['state']);
    const messages = { disabled: text("tickets.staff.sophie_commands_are_currently_disabled_4b861d"), denied: text("tickets.staff.the_case_queue_requires_current_responder_per_d23751"),
      unavailable: text("tickets.staff.the_case_queue_could_not_be_confirmed_please__1a6950"), stale: text("tickets.staff.this_queue_position_is_no_longer_available_us_8f0706") };
    requireCondition(Object.hasOwn(messages, view.state), 'INVALID_CASE_QUEUE');
    return { content: messages[view.state], embeds: [], components: [] };
  }
  requireKeys(view, ['state', "guildId", "actorId", 'filter', 'entries', 'next']); requireId(view.guildId); requireId(view.actorId); requireCaseQueueFilter(view.filter);
  requireCondition(Array.isArray(view.entries) && view.entries.length <= 5, 'INVALID_CASE_QUEUE'); if (view.next !== null) requireCaseToken(view.next);
  const seen = new Set(), buttons = [];
  const embeds = view.entries.map((row, index) => {
    requireKeys(row, ['id', 'token', "userId", 'type', "caseState", 'version', "channelId", "assigneeId", "assignmentStatus",
      ...(Object.hasOwn(row, 'priority') ? ['priority'] : [])]);
    if (Object.hasOwn(row, 'priority')) requireCondition(CASE_PRIORITIES.includes(row.priority), 'INVALID_CASE_QUEUE');
    requireName(row.id); requireCaseToken(row.token); requireId(row.userId); requireInteger(row.version, 0, 2_147_483_646);
    if (row.channelId !== null) requireId(row.channelId);
    const type = CASE_TYPES.find(item => item.id === row.type);
    requireCondition(type && CASE_QUEUE_FILTERS[view.filter].includes(row.caseState) && !seen.has(row.token), 'INVALID_CASE_QUEUE'); seen.add(row.token);
    const assignment = assignmentDescription(row, text);
    if (row.version <= 2_147_483_644 && (row.assigneeId === view.actorId || (row.caseState === 'open' && row.assigneeId === null))) {
      const action = row.assigneeId === null ? 'claim' : 'unclaim';
      buttons.push({ type: 2, style: 2, label: `${action === 'claim' ? text("tickets.staff.claim_4ca41d") : text("tickets.staff.unclaim_d366e1")} ${index + 1}`,
        custom_id: `sophie:case-staff:v1:${action}:${row.token}:${row.version}` });
    }
    return { title: `${index + 1}. ${text(`tickets.type.${type.id}`)}`, description: text("tickets.staff.state_member_assigned_6531ac", { caseState: row.caseState, value: row.priority ? text("tickets.staff.manual_priority_c6af0e", { priority: row.priority }) : '', userId: row.userId, assignment: assignment }) +
      text("tickets.staff.reference_2ed3c5", { value: row.channelId === null ? '' : text("tickets.staff.channel_9874d9", { channelId: row.channelId }), id: row.id, version: row.version }) };
  });
  requireCondition(view.next === null || view.next === view.entries.at(-1)?.token, 'INVALID_CASE_QUEUE');
  const navigation = [{ type: 2, style: 1, label: text("tickets.staff.refresh_0e9161"), custom_id: `sophie:case-queue:v1:${view.filter}:first` }];
  if (view.next !== null) navigation.push({ type: 2, style: 2, label: text("tickets.staff.next_page_c08ac7"), custom_id: `sophie:case-queue:v1:${view.filter}:${view.next}` });
  return { content: view.entries.length ? text("tickets.staff.cases_oldest_first_use_ticket_status_for_deta_5155b6", { filter: view.filter }) :
    text("tickets.staff.no_cases_on_this_page_use_refresh_to_check_fr_7a674c", { filter: view.filter }), embeds,
  components: [...(buttons.length ? [{ type: 1, components: buttons }] : []), { type: 1, components: navigation }] };
}

export function caseStaffCommandOptions(reference) {
  return [{ type: 1, name: 'queue', description: 'List cases within your current responder permissions.', options: [
    { type: 3, name: 'state', description: 'Which cases to list.', choices: Object.keys(CASE_QUEUE_FILTERS).map(value => ({ name: value, value })) },
  ] }, ...['claim', 'unclaim'].map(action => ({ type: 1, name: action,
    description: action === 'claim' ? 'Take responsibility for an unassigned open case.' : 'Release your own case assignment.', options: [{ ...reference }] })),
  { type: 1, name: 'assign', description: 'Assign an open case to a current responder.', options: [
    { ...reference }, { type: 6, name: 'member', description: 'Current responder for this case type.', required: true },
    { type: 3, name: 'reason', description: 'Reason for this reassignment.', required: true, choices: CASE_ASSIGN_REASONS.map(value => ({ name: value, value })) },
  ] }];
}
