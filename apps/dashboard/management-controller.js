import { DashboardFailure } from './api.js';

export const MANAGEMENT_ACTIONS = Object.freeze({ close: ['Request closure', ['resolved', 'duplicate', 'withdrawn']],
  reopen: ['Request reopening', ['follow-up', 'closed-in-error']], claim: ['Claim case', []], unclaim: ['Release my assignment', []],
  assign: ['Assign responder', ['handoff', 'coverage']], 'add-participant': ['Add participant', ['requested-help', 'case-context']],
  'remove-participant': ['Remove participant', ['no-longer-needed', 'added-in-error']] });
export function availableManagementActions(page) {
  if (!page) return [];
  const actions = [];
  if (['open', 'closing', 'pending'].includes(page.caseState)) actions.push('close');
  if (['closed', 'failed'].includes(page.caseState)) actions.push('reopen');
  if (page.caseState === 'open') { if (page.assigneeId === null) actions.push('claim'); actions.push('assign', 'add-participant'); }
  if (page.assigneeId === page.actorId) actions.push('unclaim');
  if (page.participantIds?.length) actions.push('remove-participant');
  return actions;
}
export function createManagementController({ api, onChange, newRequestId }) {
  let state = { phase: 'loading', identity: null, busy: false, channelId: null, page: null, queue: null, filter: 'active',
    draft: { action: '', targetId: '', reason: '' }, review: null, confirmed: false, pending: null, dirty: false, error: null, notice: null }, generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  const clearReview = () => { state.review = null; state.confirmed = false; };
  const clear = () => { state.page = null; state.queue = null; state.draft = { action: '', targetId: '', reason: '' }; state.pending = null; state.dirty = false; clearReview(); };
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, active = () => token === generation; state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!active()) return;
      if (state.identity && (identity.userId !== state.identity.userId || identity.guildId !== state.identity.guildId)) {
        clear(); state.channelId = null; state.notice = 'Your account changed. Open a case for this account.'; state.identity = identity; state.phase = 'ready'; return;
      }
      state.identity = identity; state.phase = 'ready'; await work(active);
    } catch (error) {
      if (!active()) return;
      state.page = null; state.queue = null;
      if (['denied', 'missing'].includes(error.kind)) {
        clear(); state.channelId = null; state.phase = 'denied'; state.identity = null; state.error = 'Current Staff authority could not be verified for this request.';
      } else if (['invalid', 'conflict'].includes(error.kind)) {
        state.pending = null; clearReview(); state.error = 'The change was rejected or the case changed. Refresh access and review a new request.';
      } else state.error = state.pending ? 'The request could not be confirmed. Retry the same request before making another change.' : 'This operation could not be completed. Try again shortly.';
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
  async function load(active) {
    const page = await api.managedCase(state.channelId); if (!active()) return;
    if (page.state !== 'ready' || page.channelId !== state.channelId || page.actorId !== state.identity.userId || !id(page.userId) ||
      !Number.isSafeInteger(page.version) || page.version < 0 || !['open', 'closed', 'closing', 'pending', 'failed'].includes(page.caseState) ||
      !(page.assigneeId === null || id(page.assigneeId)) || ![null, 'current', 'needs_review'].includes(page.assignmentStatus) ||
      typeof page.type !== 'string' || page.type.length > 40 || !Array.isArray(page.participantIds ?? []) || (page.participantIds ?? []).length > 20 ||
      !(page.participantIds ?? []).every(id)) throw new DashboardFailure('unavailable');
    state.page = page;
    if (!state.pending) {
      const actions = availableManagementActions(page);
      if (!state.dirty || !actions.includes(state.draft.action)) {
        const action = actions[0] ?? ''; state.draft = { action, targetId: '', reason: MANAGEMENT_ACTIONS[action]?.[1][0] ?? '' }; state.dirty = false;
      }
      clearReview();
    }
  }
  async function queue(active, filter, after = null) {
    const page = await api.caseQueue(filter, after); if (!active()) return;
    if (page.guildId !== state.identity.guildId || page.actorId !== state.identity.userId || page.filter !== filter || !Array.isArray(page.entries) || page.entries.length > 5 ||
      !page.entries.every(row => typeof row.id === 'string' && row.id.length <= 96 && typeof row.type === 'string' && row.type.length <= 40 &&
        typeof row.caseState === 'string' && row.caseState.length <= 20 && (row.channelId === null || id(row.channelId)) &&
        /^[a-f0-9]{48}$/.test(row.token)) || !(page.next === null || /^[a-f0-9]{48}$/.test(page.next))) throw new DashboardFailure('unavailable');
    state.queue = page; state.filter = filter;
  }
  async function submit(active) {
    const result = await api.changeCase(state.pending); if (!active()) return;
    if (result.recorded !== true || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; state.dirty = false; clearReview(); state.notice = 'Request recorded. The current case state is shown below. Discord access changes may still be pending.';
    await load(active);
  }
  return Object.freeze({ snapshot,
    start: () => run(async () => {}),
    list(filter = state.filter, after = null) { if (!state.pending) return run(active => queue(active, filter, after)); },
    next() { if (state.queue?.next && !state.pending) return run(active => queue(active, state.filter, state.queue.next)); },
    open(channelId) { if (!state.pending) return run(async active => { clear(); state.channelId = channelId; state.notice = null; emit(); await load(active); }); },
    edit(draft) {
      if (state.busy || state.pending || !state.page) return;
      clearReview(); state.draft = { ...draft }; state.dirty = true; state.notice = null; emit();
    },
    review() {
      if (state.busy || state.pending || !state.page || !availableManagementActions(state.page).includes(state.draft.action)) return;
      const { action, targetId, reason } = state.draft, targetRequired = ['assign', 'add-participant', 'remove-participant'].includes(action);
      if (targetRequired && !id(targetId) || MANAGEMENT_ACTIONS[action][1].length && !MANAGEMENT_ACTIONS[action][1].includes(reason)) {
        state.error = 'Choose a valid member ID and reason.'; emit(); return;
      }
      state.error = null; state.review = { channelId: state.channelId, expectedVersion: state.page.version, action,
        targetId: targetRequired ? targetId : null, reason: MANAGEMENT_ACTIONS[action][1].length ? reason : null };
      state.confirmed = false; state.dirty = true; emit();
    },
    confirm(value) { if (state.review && !state.busy && !state.pending) { state.confirmed = value === true; emit(); } },
    cancel() { if (!state.busy && !state.pending) { clearReview(); emit(); } },
    submit() { if (state.review && state.confirmed && !state.pending) return run(async active => { state.pending = { ...state.review, requestId: newRequestId(), confirmed: true }; await submit(active); }); },
    retry() { if (state.pending) return run(submit); },
    checkAccess: () => run(async active => { state.page = null; state.queue = null; if (!state.pending) clearReview(); emit(); if (state.channelId) await load(active); }),
    suspend() { ++generation; clear(); state.channelId = null; state.busy = false; state.notice = 'Private case details and pending reviews were cleared while this page was hidden.'; emit(); },
    async logout() {
      ++generation; clear(); state.channelId = null; state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const token = generation;
      try { await api.logout(); } catch { if (token === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (token === generation) { state.busy = false; emit(); } }
    },
  });
}
