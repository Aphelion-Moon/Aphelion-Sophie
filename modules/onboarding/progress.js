import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { formatDuration, runTimingSummary, timingLine } from './timing.js';

const GRANT_STATES = Object.freeze({ ready: 'queued', leased: 'being delivered', parked: 'stopped', done: 'delivered', cancelled: 'cancelled' });
const yes = value => { requireCondition(typeof value === 'boolean', 'INVALID_SHUTTLE_PROGRESS'); return value ? 'yes' : 'no'; };
const stamp = ms => `<t:${Math.floor(ms / 1_000)}:R>`;

/**
 * Staff's `/whitelist progress` reply (owner request, 25 October 2026): the member's Discord state now, where their Shuttle
 * run is, and its focused reading time. Metadata only: no story copy, forms or ticket data. Mentions are suppressed by
 * the responder.
 */
export function shuttleProgressReply(view, text = defaultSystemText) {
  requireCondition(view !== null && typeof view === 'object', 'INVALID_SHUTTLE_PROGRESS');
  if (view.state !== 'ready') {
    requireKeys(view, ['state']);
    const messages = { disabled: text('onboarding.assistance.sophie_commands_are_currently_disabled_4b861d'),
      denied: text('onboarding.progress.denied'), unavailable: text('onboarding.progress.unavailable') };
    requireCondition(Object.hasOwn(messages, view.state), 'INVALID_SHUTTLE_PROGRESS');
    return { content: messages[view.state], embeds: [], components: [] };
  }
  requireKeys(view, ['state', 'userId', 'member', 'run', 'grant', 'now']); requireId(view.userId); requireInteger(view.now, 1);
  requireKeys(view.member, ['present', 'crew', 'muzzled', 'whitelist']);
  const lines = [text('onboarding.progress.member', { userId: view.userId, present: yes(view.member.present), crew: yes(view.member.crew),
    muzzled: yes(view.member.muzzled), whitelist: yes(view.member.whitelist) })];
  const run = view.run;
  if (run === null) lines.push(text('onboarding.progress.none'));
  else {
    requireKeys(run, ['current', 'activity', 'status', 'helpPaused', 'stop', 'stops', 'title', 'definitionVersion', 'timing']);
    requireInteger(run.stops, 0, 64); requireInteger(run.stop, 0, 63); requireInteger(run.definitionVersion, 1);
    requireCondition(['active', 'role_pending', 'complete'].includes(run.status) && (run.title === null || typeof run.title === 'string'), 'INVALID_SHUTTLE_PROGRESS');
    if (!run.current) lines.push(text('onboarding.progress.previous'));
    const place = { step: run.stop + 1, total: run.stops, title: (run.title ?? `Stop ${run.stop + 1}`).slice(0, 80) };
    if (run.status === 'active') lines.push(text(run.helpPaused ? 'onboarding.progress.paused' : 'onboarding.progress.reading', place));
    else if (run.status === 'role_pending') lines.push(text('onboarding.progress.pending', { state: grantState(view.grant) }));
    else lines.push(text('onboarding.progress.complete'));
    if (!run.activity) lines.push(text('onboarding.progress.channel'));
    else if (run.timing !== null) {
      const timing = run.timing;
      lines.push(text('onboarding.progress.moved', { boarded: stamp(timing.startedAtMs), moved: stamp(timing.lastActiveAtMs) }));
      const summary = runTimingSummary(timing, view.now);
      if (summary === null) lines.push(text('onboarding.progress.untimed'));
      else {
        lines.push(timingLine(text(run.status === 'active' ? 'onboarding.progress.so_far' : 'onboarding.progress.to_completion'), summary));
        lines.push(text('onboarding.progress.stops', { value: timing.stops.map(stop => `${stop.stop + 1}: ${formatDuration(stop.focusedMs)}`).join(' · ') }));
      }
    }
  }
  return { content: '', embeds: [{ title: text('onboarding.progress.title'), description: lines.join('\n').slice(0, 4_000) }], components: [] };
}

function grantState(grant) {
  if (grant === null) return 'no grant job found';
  requireKeys(grant, ['status', 'code']);
  requireCondition(Object.hasOwn(GRANT_STATES, grant.status) && (grant.code === null || /^[A-Z][A-Z0-9_]{1,63}$/u.test(grant.code)), 'INVALID_SHUTTLE_PROGRESS');
  return grant.code && grant.status !== 'done' ? `${GRANT_STATES[grant.status]} (${grant.code})` : GRANT_STATES[grant.status];
}
