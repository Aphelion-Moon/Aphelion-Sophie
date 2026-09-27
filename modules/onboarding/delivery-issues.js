import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';

const prefix = 'sophie:shuttle-issue:v1';



export function requireOnboardingIssueId(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'INVALID_SHUTTLE_ISSUE');
}

export function parseOnboardingRecoveryReference(value) {
  requireCondition(typeof value === 'string', 'INVALID_SHUTTLE_ISSUE');
  const match = /^([a-f0-9]{32})\.([0-9]{1,10})$/.exec(value);
  requireCondition(match !== null, 'INVALID_SHUTTLE_ISSUE');
  const expectedRevision = Number(match[2]); requireInteger(expectedRevision, 0, 2_147_483_645);
  requireCondition(String(expectedRevision) === match[2], 'INVALID_SHUTTLE_ISSUE');
  return { issueId: match[1], expectedRevision };
}

export function onboardingIssueReason(code) {
  if (['BOT_PERMISSION_MISSING', 'DISCORD_AUTHORIZATION_FAILED', 'OPERATION_DENIED'].includes(code)) return 'permissions';
  if (['ROLE_CONFIGURATION_INVALID', 'ROLE_HIERARCHY_BLOCKED'].includes(code)) return 'roles';
  if (code === 'ATTEMPT_LIMIT') return 'attempts';
  if (code === 'DISCORD_RATE_LIMIT_INVALID') return 'delivery';
  return 'review';
}

/** Opaque routing handles confer no authority. No arbitrary outbox operations are accepted. */
export function parseOnboardingIssueControl(value) {
  const queue = /^sophie:shuttle-issue:v1:queue:(first|[a-f0-9]{32})$/.exec(value);
  if (queue) return { command: 'shuttle.issues', after: queue[1] === 'first' ? null : queue[1] };
  const recheck = /^sophie:shuttle-issue:v1:recheck:([a-f0-9]{32}):([0-9]{1,10})$/.exec(value);
  requireCondition(recheck !== null, 'INTERACTION_COMPONENT_UNSUPPORTED');
  const revision = Number(recheck[2]); requireInteger(revision, 0, 2_147_483_646);
  requireCondition(String(revision) === recheck[2], 'INTERACTION_COMPONENT_UNSUPPORTED');
  return { command: 'shuttle.issue.recheck', issueId: recheck[1], expectedRevision: revision };
}

/** A private, bounded operational view: no session copy, messages, forms or notes. */
export function onboardingIssueQueueReply(view, text = defaultSystemText) {
const reasons = Object.freeze({
  permissions: text("onboarding.delivery_issues.discord_permissions_or_current_authority_need_3be2b0"),
  roles: text("onboarding.delivery_issues.the_configured_roles_or_their_hierarchy_need__7196d4"),
  attempts: text("onboarding.delivery_issues.automatic_attempts_reached_their_limit_1246d3"),
  delivery: text("onboarding.delivery_issues.the_delivery_service_requires_operator_review_243c18"),
  review: text("onboarding.delivery_issues.delivery_requires_review_e6c0dc"),
});
const kinds = Object.freeze({ grant: text("onboarding.delivery_issues.whitelist_delivery_0252b3"), reconcile: text("onboarding.delivery_issues.whitelist_reconciliation_0de098"),
  case: text("onboarding.delivery_issues.private_case_provisioning_febdd1"), screen: text("onboarding.delivery_issues.shuttle_screen_delivery_c74de0"), alert: text("onboarding.delivery_issues.staff_notice_delivery_8becae") });

  requireCondition(view !== null && typeof view === 'object', 'INVALID_SHUTTLE_ISSUE_QUEUE');
  if (view.state !== 'ready') {
    requireKeys(view, ['state']);
    const messages = { disabled: text("onboarding.delivery_issues.sophie_commands_are_currently_disabled_4b861d"),
      denied: text("onboarding.delivery_issues.shuttle_delivery_review_requires_current_staf_7ee5dc"),
      unavailable: text("onboarding.delivery_issues.shuttle_delivery_issues_could_not_be_confirme_506892") };
    requireCondition(Object.hasOwn(messages, view.state), 'INVALID_SHUTTLE_ISSUE_QUEUE');
    return { content: messages[view.state], embeds: [], components: [] };
  }
  requireKeys(view, ['state', "guildId", 'entries', 'next']); requireId(view.guildId);
  requireCondition(Array.isArray(view.entries) && view.entries.length <= 5, 'INVALID_SHUTTLE_ISSUE_QUEUE');
  if (view.next !== null) requireOnboardingIssueId(view.next);
  const ids = new Set(), buttons = [], embeds = [];
  view.entries.forEach((entry, index) => {
    requireKeys(entry, ["issueId", "userId", 'revision', "channelId", "caseState", 'kind', 'reason', 'attempted', 'recheckable', "needsMessageId", "channelChoice"]);
    requireOnboardingIssueId(entry.issueId); requireId(entry.userId); requireInteger(entry.revision, 0, 2_147_483_646);
    if (entry.channelId !== null) requireId(entry.channelId);
    requireCondition(['pending', 'open', 'closing', 'closed', 'failed'].includes(entry.caseState) &&
      Object.hasOwn(kinds, entry.kind) && Object.hasOwn(reasons, entry.reason) &&
      typeof entry.attempted === 'boolean' && typeof entry.recheckable === 'boolean' && typeof entry.needsMessageId === 'boolean' &&
      (!entry.needsMessageId || (['screen', 'alert'].includes(entry.kind) && !entry.recheckable)) && !ids.has(entry.issueId), 'INVALID_SHUTTLE_ISSUE_QUEUE');
    ids.add(entry.issueId);
    let choiceGuidance = '';
    if (entry.channelChoice !== null) {
      const choice = entry.channelChoice;
      requireKeys(choice, ['required', 'candidates', 'total']); requireInteger(choice.total, 2, 2_147_483_646);
      requireCondition(entry.kind === 'case' && typeof choice.required === 'boolean' && (!choice.required || !entry.recheckable) &&
        Array.isArray(choice.candidates) && choice.candidates.length === Math.min(choice.total, 5) &&
        new Set(choice.candidates).size === choice.candidates.length, 'INVALID_SHUTTLE_ISSUE_QUEUE');
      choice.candidates.forEach(requireId);
      choiceGuidance = text("onboarding.delivery_issues.retained_candidates_b0f696", { total: choice.total, value: choice.candidates.map(id => `<#${id}>`).join(', '), value3: choice.total > 5 ? text("onboarding.delivery_issues.first_five_shown_26e030") : '' });
      if (choice.required) choiceGuidance += choice.total > 500 ? text("onboarding.delivery_issues.this_case_exceeds_the_channel_selection_limit_8df042") :
        text("onboarding.delivery_issues.choose_the_intended_channel_with_shuttle_choo_0753fa", { issueId: entry.issueId, revision: entry.revision });
    }
    const guidance = entry.needsMessageId ? text("onboarding.delivery_issues.identify_the_matching_sophie_message_in_this__65739f", { issueId: entry.issueId, revision: entry.revision }) : entry.channelChoice?.required ? '' :
      entry.recheckable ? '' : text("onboarding.delivery_issues.this_item_needs_configuration_or_case_review__344da9");
    embeds.push({ title: `${index + 1}. ${kinds[entry.kind]}`,
      description: text("onboarding.delivery_issues.member_case_357b34", { userId: entry.userId, caseState: entry.caseState, value: entry.channelId === null ? '' : `: <#${entry.channelId}>`, value4: reasons[entry.reason], value5: entry.attempted ? text("onboarding.delivery_issues.an_earlier_change_may_have_reached_discord_d76b59") : '', guidance: guidance, choiceGuidance: choiceGuidance }) });
    buttons.push({ type: 2, style: 2, label: text("onboarding.delivery_issues.recheck_7ff5c2", { value: index + 1 }), disabled: !entry.recheckable || entry.revision === 2_147_483_646,
      custom_id: `${prefix}:recheck:${entry.issueId}:${entry.revision}` });
  });
  requireCondition(view.next === null || view.next === view.entries.at(-1)?.issueId, 'INVALID_SHUTTLE_ISSUE_QUEUE');
  const navigation = [{ type: 2, style: 1, label: text("onboarding.delivery_issues.refresh_0e9161"), custom_id: `${prefix}:queue:first` }];
  if (view.next !== null) navigation.push({ type: 2, style: 2, label: text("onboarding.delivery_issues.next_page_c08ac7"), custom_id: `${prefix}:queue:${view.next}` });
  return { content: view.entries.length ? text("onboarding.delivery_issues.parked_shuttle_deliveries_oldest_issues_first_e9b934") :
    text("onboarding.delivery_issues.no_parked_shuttle_deliveries_on_this_page_use_bde598"),
  embeds, components: [...(buttons.length ? [{ type: 1, components: buttons }] : []), { type: 1, components: navigation }] };
}
