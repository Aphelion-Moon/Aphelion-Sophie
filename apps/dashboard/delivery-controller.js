import { DashboardFailure } from './api.js';

const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const issueId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
function validPage(page, guildId) {
  return page?.state === 'ready' && page.guildId === guildId && Array.isArray(page.entries) && page.entries.length <= 5 &&
    new Set(page.entries.map(row => row.issueId)).size === page.entries.length &&
    (page.next === null || issueId(page.next) && page.next === page.entries.at(-1)?.issueId) && page.entries.every(row =>
      issueId(row.issueId) && id(row.userId) && (row.channelId === null || id(row.channelId)) &&
      Number.isSafeInteger(row.revision) && row.revision >= 0 && row.revision <= 2_147_483_646 &&
      ['pending', 'open', 'closing', 'closed', 'failed'].includes(row.caseState) && typeof row.caseType === 'string' && /^[a-z-]{1,40}$/.test(row.caseType) &&
      ['case', 'intake', 'reply'].includes(row.kind) && ['permissions', 'attempts', 'uncertain', 'review'].includes(row.reason) &&
      [row.attempted, row.recheckable, row.needsMessageId].every(value => typeof value === 'boolean') &&
      (!row.needsMessageId || ['intake', 'reply'].includes(row.kind) && !row.recheckable) && (row.kind !== 'reply' || issueId(row.replyId)) &&
      (row.channelChoice === null || row.kind === 'case' && typeof row.channelChoice?.required === 'boolean' &&
        (!row.channelChoice.required || !row.recheckable) && Number.isSafeInteger(row.channelChoice.total) && row.channelChoice.total >= 2 &&
        Array.isArray(row.channelChoice.candidates) && row.channelChoice.candidates.length === Math.min(row.channelChoice.total, 5) &&
        new Set(row.channelChoice.candidates).size === row.channelChoice.candidates.length && row.channelChoice.candidates.every(id)));
}

export function createDeliveryController({ api, onChange, newRequestId }) {
  let state = { phase: 'loading', identity: null, busy: false, page: null, after: null, review: null,
    confirmed: false, pending: null, dirty: false, error: null, notice: null }, generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  const clearReview = () => { state.review = null; state.confirmed = false; state.dirty = false; };
  const clear = () => { state.page = null; state.after = null; state.pending = null; clearReview(); };
  async function load(active) {
    const page = await api.caseDelivery(state.after); if (!active()) return;
    if (!validPage(page, state.identity.guildId)) throw new DashboardFailure('unavailable'); state.page = page;
  }
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, active = () => token === generation; state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!active()) return;
      if (identity.canRecoverCases !== true) throw new DashboardFailure('denied');
      if (state.identity && (state.identity.userId !== identity.userId || state.identity.guildId !== identity.guildId)) {
        clear(); state.identity = identity; state.phase = 'ready'; state.notice = 'Your account changed. Refresh the queue before reviewing a repair.'; return;
      }
      state.identity = identity; state.phase = 'ready'; await work(active);
    } catch (error) {
      if (!active()) return;
      state.page = null; clearReview();
      if (['denied', 'missing'].includes(error.kind)) {
        clear(); state.identity = null; state.phase = 'denied'; state.error = 'Current Staff access could not be verified.';
      } else if (['invalid', 'conflict'].includes(error.kind)) {
        state.pending = null; state.after = null; state.error = 'This repair or queue position is no longer current. Refresh and review it again.';
      } else state.error = state.pending ? 'The result could not be confirmed. Retry the same request to check its result.' : 'Delivery issues could not be checked. Try again shortly.';
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  async function submit(active) {
    const result = await api.changeCaseDelivery(state.pending); if (!active()) return;
    if (result.recorded !== true || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; clearReview(); state.after = null;
    state.notice = 'Repair recorded. Sophie will check current access and the delivery result. Delivery is not yet confirmed.'; await load(active);
  }
  return Object.freeze({ snapshot,
    start: () => run(load),
    refresh() { return run(async active => { state.page = null; state.after = null; if (!state.pending) clearReview(); emit(); await load(active); }); },
    next() {
      if (state.pending || state.review || !state.page?.next) return;
      const after = state.page.next; return run(async active => { state.after = after; state.page = null; await load(active); });
    },
    review(selected, action, resultId = null) {
      if (state.busy || state.pending) return;
      const entry = state.page?.entries.find(row => row.issueId === selected); if (!entry || entry.revision > 2_147_483_644) return;
      if (!(action === 'recheck' && entry.recheckable && resultId === null || action === 'adopt_message' && entry.needsMessageId && id(resultId) ||
        action === 'select_channel' && entry.channelChoice?.required && entry.channelChoice.total <= 500 && entry.channelChoice.candidates.includes(resultId))) {
        state.error = 'Select an available repair and, when needed, a valid exact message ID.'; emit(); return;
      }
      state.review = { entry: structuredClone(entry), action, resultId }; state.confirmed = false; state.dirty = true; state.error = null; state.notice = null; emit();
    },
    confirm(value) { if (state.review && !state.busy && !state.pending) { state.confirmed = value === true; emit(); } },
    cancel() { if (!state.busy && !state.pending) { clearReview(); emit(); } },
    submit() { if (state.review && state.confirmed && !state.pending) return run(async active => {
      const { entry, action, resultId } = state.review;
      state.pending = { issueId: entry.issueId, expectedRevision: entry.revision, action, resultId, requestId: newRequestId(), confirmed: true };
      await submit(active);
    }); },
    retry() { if (state.pending) return run(submit); },
    checkAccess() { return run(async active => { state.page = null; if (!state.pending) clearReview(); emit(); await load(active); }); },
    suspend() { ++generation; clear(); state.phase = 'loading'; state.busy = false; state.notice = 'Delivery details and reviews were cleared while this page was hidden.'; emit(); },
    async logout() {
      ++generation; clear(); state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const token = generation;
      try { await api.logout(); } catch { if (token === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (token === generation) { state.busy = false; emit(); } }
    },
  });
}
