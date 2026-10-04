import { DashboardFailure } from './api.js';

const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const operation = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function createModerationController({ api, onChange, newRequestId }) {
  let state = { phase: 'loading', identity: null, busy: false, userId: null, page: null, review: null,
    confirmed: false, pending: null, dirty: false, error: null, notice: null }, generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  const clearReview = () => { state.review = null; state.confirmed = false; state.dirty = false; };
  const clear = () => { state.page = null; state.userId = null; state.pending = null; clearReview(); };
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, active = () => token === generation; state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!active()) return;
      if (identity.canRecoverModeration !== true) throw new DashboardFailure('denied');
      if (state.identity && (state.identity.userId !== identity.userId || state.identity.guildId !== identity.guildId)) {
        clear(); state.identity = identity; state.phase = 'ready'; state.notice = 'Your account changed. Select a member again.'; return;
      }
      state.identity = identity; state.phase = 'ready'; await work(active);
    } catch (error) {
      if (!active()) return;
      state.page = null;
      if (['denied', 'missing'].includes(error.kind)) {
        clear(); state.identity = null; state.phase = 'denied'; state.error = 'Current moderation authority could not be verified.';
      } else if (['invalid', 'conflict'].includes(error.kind)) {
        state.pending = null; clearReview(); state.error = 'This review is no longer current. Refresh and review the member again.';
      } else {
        clearReview(); state.error = state.pending ? 'The retry could not be confirmed. Retry the same request to check its result.' : 'The current role delivery could not be checked. Try again shortly.';
      }
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  async function load(active) {
    const page = await api.reviewModeration(state.userId); if (!active()) return;
    if (page.guildId !== state.identity.guildId || page.actorId !== state.identity.userId || page.userId !== state.userId ||
      !integer(page.eligibilityEpoch) || ![null, 'member_left', 'decision_expired', 'moderator_unavailable', 'no_action'].includes(page.hold) ||
      !((page.action === null && page.actionRevision === null) || (['mute', 'unmute'].includes(page.action) && integer(page.actionRevision) && page.actionRevision > 0)) ||
      !Array.isArray(page.jobs) || page.jobs.length > 20 || new Set(page.jobs.map(job => job.operationId)).size !== page.jobs.length ||
      !page.jobs.every(job => operation(job.operationId) && integer(job.fence) && ['ready', 'leased', 'parked'].includes(job.status) &&
        (job.reason === null || typeof job.reason === 'string' && /^[A-Z_]{1,64}$/.test(job.reason)) && typeof job.retryAllowed === 'boolean' &&
        (!job.retryAllowed || page.hold === null && page.action !== null && job.status === 'parked'))) throw new DashboardFailure('unavailable');
    state.page = page;
  }
  async function submit(active) {
    const result = await api.retryModeration(state.pending); if (!active()) return;
    if (result.recorded !== true || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; clearReview(); state.notice = 'Retry recorded. Sophie will inspect current roles before continuing. Delivery is not yet confirmed.';
    await load(active);
  }
  return Object.freeze({ snapshot,
    start: () => run(async () => {}),
    open(userId) {
      if (state.pending || state.busy) return;
      if (!id(userId)) { state.error = 'Enter a valid member ID.'; emit(); return; }
      return run(async active => { clear(); state.userId = userId; state.notice = null; await load(active); });
    },
    review(operationId) {
      if (state.busy || state.pending || !state.page) return;
      const job = state.page.jobs.find(row => row.operationId === operationId); if (!job?.retryAllowed) return;
      state.review = { userId: state.userId, operationId, expectedFence: job.fence,
        expectedActionRevision: state.page.actionRevision, expectedEligibilityEpoch: state.page.eligibilityEpoch };
      state.confirmed = false; state.dirty = true; state.notice = null; emit();
    },
    confirm(value) { if (state.review && !state.busy && !state.pending) { state.confirmed = value === true; emit(); } },
    cancel() { if (!state.busy && !state.pending) { clearReview(); emit(); } },
    submit() { if (state.review && state.confirmed && !state.pending) return run(async active => {
      state.pending = { ...state.review, requestId: newRequestId(), confirmed: true }; await submit(active);
    }); },
    retry() { if (state.pending) return run(submit); },
    checkAccess() { return run(async active => { state.page = null; if (!state.pending) clearReview(); emit(); if (state.userId) await load(active); }); },
    suspend() { ++generation; clear(); state.busy = false; state.notice = 'Member details and reviews were cleared while this page was hidden.'; emit(); },
    async logout() {
      ++generation; clear(); state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const token = generation;
      try { await api.logout(); } catch { if (token === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (token === generation) { state.busy = false; emit(); } }
    },
  });
}
