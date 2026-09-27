import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';

const prefix = 'sophie:shuttle-help:v1';

/** Routing data only; every queue and resolution request is independently authorized. */
export function parseOnboardingHelpControl(value) {
  requireCondition(typeof value === 'string', 'INTERACTION_COMPONENT_UNSUPPORTED');
  const queue = /^sophie:shuttle-help:v1:queue:(first|[1-9][0-9]{0,19})$/.exec(value);
  if (queue) return { command: 'shuttle.queue', after: queue[1] === 'first' ? null : queue[1] };
  const resolve = /^sophie:shuttle-help:v1:resolve:([1-9][0-9]{0,19}):([0-9]{1,10})$/.exec(value);
  requireCondition(resolve !== null, 'INTERACTION_COMPONENT_UNSUPPORTED');
  const revision = Number(resolve[2]); requireInteger(revision, 0, 2_147_483_646);
  requireCondition(String(revision) === resolve[2], 'INTERACTION_COMPONENT_UNSUPPORTED');
  return { command: 'shuttle.help.resolve', requestId: resolve[1], expectedRevision: revision };
}

/** Bounded retained metadata, no forms, conversation excerpts, notes or arbitrary links. */
export function onboardingHelpQueueReply(view, text = defaultSystemText) {
  requireCondition(view !== null && typeof view === 'object', 'INVALID_SHUTTLE_QUEUE');
  if (view.state !== 'ready') {
    requireKeys(view, ['state']);
    const messages = { disabled: text("onboarding.assistance.sophie_commands_are_currently_disabled_4b861d"),
      denied: text("onboarding.assistance.the_shuttle_assistance_queue_requires_current_49567b"),
      unavailable: text("onboarding.assistance.the_shuttle_assistance_queue_could_not_be_con_6881e4") };
    requireCondition(Object.hasOwn(messages, view.state), 'INVALID_SHUTTLE_QUEUE');
    return { content: messages[view.state], embeds: [], components: [] };
  }
  requireKeys(view, ['state', "guildId", 'entries', 'next']); requireId(view.guildId);
  requireCondition(Array.isArray(view.entries) && view.entries.length <= 5, 'INVALID_SHUTTLE_QUEUE');
  if (view.next !== null) requireId(view.next);
  const ids = new Set(), buttons = [], embeds = [];
  view.entries.forEach((entry, index) => {
    requireKeys(entry, ["requestId", "userId", 'revision', "channelId", "caseState", 'paused']);
    requireId(entry.requestId); requireId(entry.userId); requireInteger(entry.revision, 0, 2_147_483_646);
    if (entry.channelId !== null) requireId(entry.channelId);
    requireCondition(['pending', 'open', 'closing', 'closed', 'failed'].includes(entry.caseState) && typeof entry.paused === 'boolean' &&
      !ids.has(entry.requestId), 'INVALID_SHUTTLE_QUEUE');
    ids.add(entry.requestId);
    embeds.push({ title: text("onboarding.assistance.request_595e03", { value: index + 1 }), description: text("onboarding.assistance.member_case_3af1bf", { userId: entry.userId, caseState: entry.caseState, value: entry.channelId === null ? '' : `: <#${entry.channelId}>`, value4: entry.paused ? text("onboarding.assistance.this_run_was_paused_for_assistance_86f137") : '' }) });
    buttons.push({ type: 2, style: 2, label: `${entry.paused ? text("onboarding.assistance.resolve_resume_08f7ac") : text("onboarding.assistance.resolve_c8f193")} ${index + 1}`,
      custom_id: `${prefix}:resolve:${entry.requestId}:${entry.revision}` });
  });
  requireCondition(view.next === null || view.next === view.entries.at(-1)?.requestId, 'INVALID_SHUTTLE_QUEUE');
  const navigation = [{ type: 2, style: 1, label: text("onboarding.assistance.refresh_0e9161"), custom_id: `${prefix}:queue:first` }];
  if (view.next !== null) navigation.push({ type: 2, style: 2, label: text("onboarding.assistance.next_page_c08ac7"), custom_id: `${prefix}:queue:${view.next}` });
  return { content: view.entries.length ? text("onboarding.assistance.shuttle_assistance_oldest_requests_first_sele_991cf7") :
    text("onboarding.assistance.no_outstanding_shuttle_assistance_requests_on_9ce264"), embeds,
  components: [...(buttons.length ? [{ type: 1, components: buttons }] : []), { type: 1, components: navigation }] };
}
