import { DashboardFailure } from './api.js';

const messages = {
  denied: 'Your current access could not be verified. Sign in again if needed.',
  connection: 'The connection failed. Try again when the service is available.',
  conflict: 'The record or its access changed. Open the channel and review a new export.',
  invalid: 'Check the channel ID. This record may exceed the supported export size.',
  missing: 'This channel is unavailable.',
  unavailable: 'The service cannot verify this record right now. Try again later.',
};

/** Ephemeral reader state. Every operation rechecks identity; content never enters browser storage. */
export function createCaseController({ api, onChange, newRequestId, downloadFile }) {
  let state = { phase: 'loading', identity: null, busy: false, page: null, selection: null, review: null, pending: null, error: null, notice: null };
  let generation = 0;
  const snapshot = () => structuredClone(state);
  const emit = () => onChange(snapshot());
  const clear = () => { state.page = null; state.review = null; state.pending = null; };
  async function run(work) {
    if (state.busy) return;
    const current = ++generation;
    state.busy = true; state.error = null; state.notice = null; emit();
    const active = () => current === generation;
    try {
      const identity = await api.session();
      if (!active()) return;
      if (state.identity && (identity.userId !== state.identity.userId || identity.guildId !== state.identity.guildId)) {
        clear(); state.selection = null; state.identity = identity; state.phase = 'ready';
        state.notice = 'Your account changed. Open a channel for this account.'; return;
      }
      state.identity = identity; state.phase = 'ready';
      await work(active);
    } catch (error) {
      if (!active()) return;
      const pending = state.pending;
      clear();
      // A lost download response can follow a committed audit. Retry that exact request only.
      if (['connection', 'unavailable'].includes(error.kind)) state.pending = pending;
      if (error.kind === 'denied') { state.identity = null; state.selection = null; state.phase = 'denied'; }
      state.error = messages[error.kind] ?? messages.unavailable;
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  async function load(selection, active) {
    const page = selection.caseToken ? await api.transcript(selection) : await api.transcriptChannel(selection.channelId);
    if (!active()) return;
    if (page.channelId !== selection.channelId || !/^[a-f0-9]{48}$/.test(page.caseToken) || page.completeHistory !== false ||
        !Array.isArray(page.page?.observations) || !Array.isArray(page.page?.gaps)) throw new DashboardFailure('unavailable');
    state.selection = { ...selection, caseToken: page.caseToken }; state.page = page;
  }
  async function deliver(active) {
    const file = await api.exportDownload(state.pending);
    if (!active()) return;
    downloadFile(file); state.pending = null; state.review = null;
    state.notice = 'The download was handed to your browser. This does not confirm that the file was saved.';
  }
  return Object.freeze({ snapshot,
    start: () => run(async () => {}),
    open(channelId) {
      return run(async active => { clear(); state.selection = { channelId, after: null, gapsAfter: null }; emit(); await load(state.selection, active); });
    },
    next(kind) {
      if (!['observations', 'gaps'].includes(kind) || !state.page || state.pending) return;
      const key = kind === 'observations' ? 'after' : 'gapsAfter', cursor = kind === 'observations' ? state.page.next : state.page.gapsNext;
      if (cursor === null) return;
      const selection = { ...state.selection, [key]: cursor };
      return run(async active => { clear(); emit(); await load(selection, active); });
    },
    review() {
      if (!state.page || state.pending) return;
      const { caseToken, channelId } = state.page;
      return run(async active => {
        state.review = null;
        const review = await api.exportReview({ caseToken, channelId });
        if (!active()) return;
        if (review.caseToken !== caseToken || review.channelId !== channelId || review.completeHistory !== false ||
            !/^[a-f0-9]{64}$/.test(review.reviewHash)) throw new DashboardFailure('unavailable');
        state.review = review;
      });
    },
    confirm(confirmed) {
      if (confirmed !== true || !state.review || state.pending) return;
      const { caseToken, channelId, reviewHash } = state.review;
      return run(async active => {
        state.pending = { caseToken, channelId, reviewHash, requestId: newRequestId(), confirmed: true };
        state.review = null; await deliver(active);
      });
    },
    retry() { if (state.pending) return run(deliver); },
    cancelReview() { if (!state.busy) { state.review = null; emit(); } },
    checkAccess() {
      return run(async active => { const selection = state.selection; clear(); emit(); if (selection) await load(selection, active); });
    },
    suspend() { ++generation; clear(); state.busy = false; state.error = null; state.notice = null; emit(); },
    async logout() {
      ++generation; clear(); state.selection = null; state.identity = null; state.phase = 'signed-out'; state.busy = true; emit();
      const current = generation;
      try { await api.logout(); }
      catch { if (current === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry signing out.'; }
      finally { if (current === generation) { state.busy = false; emit(); } }
    },
  });
}
