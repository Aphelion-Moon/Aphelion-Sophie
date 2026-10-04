import { DashboardFailure } from './api.js';

const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
function validPage(page, guildId) {
  return page?.state === 'ready' && page.guildId === guildId && Array.isArray(page.entries) && page.entries.length <= 5 &&
    new Set(page.entries.map(row => row.requestId)).size === page.entries.length &&
    (page.next === null || id(page.next) && page.next === page.entries.at(-1)?.requestId) && page.entries.every(row =>
      id(row.requestId) && id(row.userId) && (row.channelId === null || id(row.channelId)) &&
      Number.isSafeInteger(row.revision) && row.revision >= 0 && row.revision <= 2_147_483_646 && typeof row.paused === 'boolean' &&
      ['pending', 'open', 'closing', 'closed', 'failed'].includes(row.caseState));
}

export function createAssistanceController({ api, onChange, newRequestId }) {
  let state = { phase: 'loading', identity: null, busy: false, page: null, after: null, review: null,
    confirmed: false, pending: null, dirty: false, error: null, notice: null }, generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  const clearReview = () => { state.review = null; state.confirmed = false; state.dirty = false; };
  const clear = () => { state.page = null; state.after = null; state.pending = null; clearReview(); };
  async function load(active) {
    const page = await api.onboardingHelp(state.after); if (!active()) return;
    if (!validPage(page, state.identity.guildId)) throw new DashboardFailure('unavailable'); state.page = page;
  }
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, active = () => token === generation; state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!active()) return;
      if (identity.canManageOnboarding !== true) throw new DashboardFailure('denied');
      if (state.identity && (state.identity.userId !== identity.userId || state.identity.guildId !== identity.guildId)) {
        clear(); state.identity = identity; state.phase = 'ready'; state.notice = 'Your account changed. Refresh the queue before reviewing a request.'; return;
      }
      state.identity = identity; state.phase = 'ready'; await work(active);
    } catch (error) {
      if (!active()) return;
      state.page = null; clearReview();
      if (['denied', 'missing'].includes(error.kind)) {
        clear(); state.identity = null; state.phase = 'denied'; state.error = 'Current Staff access could not be verified.';
      } else if (['invalid', 'conflict'].includes(error.kind)) {
        state.pending = null; state.after = null; state.error = 'This request changed or the member cannot resume. Check current eligibility, then refresh and review again.';
      } else state.error = state.pending ? 'The result could not be confirmed. Retry the same request to check its result.' : 'Assistance requests could not be checked. Try again shortly.';
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  async function submit(active) {
    const result = await api.resolveOnboardingHelp(state.pending); if (!active()) return;
    if (result.recorded !== true || typeof result.duplicate !== 'boolean' || typeof result.resumed !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; clearReview(); state.after = null;
    state.notice = result.resumed ? 'Help resolved and the current Shuttle run resumed. Progress and Whitelist eligibility were not advanced.' :
      'Help resolved. No paused run was resumed and no progress or role was granted.';
    await load(active);
  }
  return Object.freeze({ snapshot,
    start: () => run(load),
    refresh() { return run(async active => { state.page = null; state.after = null; if (!state.pending) clearReview(); emit(); await load(active); }); },
    next() {
      if (state.pending || state.review || !state.page?.next) return;
      const after = state.page.next; return run(async active => { state.after = after; state.page = null; await load(active); });
    },
    review(requestId) {
      if (state.busy || state.pending) return;
      const entry = state.page?.entries.find(row => row.requestId === requestId); if (!entry) return;
      state.review = structuredClone(entry); state.confirmed = false; state.dirty = true; state.error = null; state.notice = null; emit();
    },
    confirm(value) { if (state.review && !state.busy && !state.pending) { state.confirmed = value === true; emit(); } },
    cancel() { if (!state.busy && !state.pending) { clearReview(); emit(); } },
    submit() { if (state.review && state.confirmed && !state.pending) return run(async active => {
      state.pending = { helpId: state.review.requestId, expectedRevision: state.review.revision, requestId: newRequestId(), confirmed: true };
      await submit(active);
    }); },
    retry() { if (state.pending) return run(submit); },
    checkAccess() { return run(async active => { state.page = null; if (!state.pending) clearReview(); emit(); await load(active); }); },
    suspend() { ++generation; clear(); state.phase = 'loading'; state.busy = false; state.notice = 'Assistance details and reviews were cleared while this page was hidden.'; emit(); },
    async logout() {
      ++generation; clear(); state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const token = generation;
      try { await api.logout(); } catch { if (token === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (token === generation) { state.busy = false; emit(); } }
    },
  });
}
