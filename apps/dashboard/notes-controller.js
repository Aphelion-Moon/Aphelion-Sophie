import { DashboardFailure } from './api.js';

/** Private in-memory draft and exact retry receipt. No note data enters browser storage. */
export function createNotesController({ api, onChange, newRequestId }) {
  let state = { phase: 'loading', identity: null, busy: false, channelId: null, page: null, draft: '', dirty: false, pending: null, error: null, notice: null };
  let generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  const clear = () => { state.page = null; state.draft = ''; state.dirty = false; state.pending = null; };
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, active = () => token === generation;
    state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!active()) return;
      if (state.identity && (identity.userId !== state.identity.userId || identity.guildId !== state.identity.guildId)) {
        clear(); state.channelId = null; state.notice = 'Your account changed. Open a case for this account.';
        state.identity = identity; state.phase = 'ready'; return;
      }
      state.identity = identity; state.phase = 'ready'; await work(active);
    } catch (error) {
      if (!active()) return;
      state.page = null;
      if (error.kind === 'denied' || error.kind === 'missing') {
        clear(); state.channelId = null; state.error = 'Staff access to this case could not be verified.';
        if (error.kind === 'denied') { state.phase = 'denied'; state.identity = null; }
      } else if (['invalid', 'conflict'].includes(error.kind)) {
        state.pending = null; state.error = 'The note was rejected. Refresh the case, check your text and try again.';
      } else state.error = state.pending ? 'The save could not be confirmed. Retry the same note to check its result.' :
        error.kind === 'invalid' ? 'Check the channel ID and note text.' : 'This operation could not be completed. Try again shortly.';
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  async function load(active, before = null) {
    const page = await api.caseNotes(state.channelId, before); if (!active()) return;
    if (page.channelId !== state.channelId || !Array.isArray(page.entries) || page.entries.length > 25 ||
      !page.entries.every(note => Number.isSafeInteger(note.number) && note.number > 0 && typeof note.text === 'string' && note.text.length <= 4000 &&
        /^[1-9][0-9]{0,19}$/.test(note.authorId) && Number.isSafeInteger(note.createdAt) && note.createdAt >= 0 && note.createdAt <= 8640000000000000) ||
      !(page.next === null || Number.isSafeInteger(page.next) && page.next > 0)) throw new DashboardFailure('unavailable');
    state.page = page;
  }
  async function save(active) {
    const result = await api.appendCaseNote(state.pending); if (!active()) return;
    if (!Number.isSafeInteger(result.number) || result.number < 1 || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; state.draft = ''; state.dirty = false; state.notice = `Note ${result.number} is saved.`; await load(active);
  }
  return Object.freeze({ snapshot,
    start: () => run(async () => {}),
    open(channelId) {
      if (state.pending) return;
      return run(async active => { clear(); state.channelId = channelId; state.notice = null; emit(); await load(active); });
    },
    edit(text) { if (!state.busy && !state.pending && state.page) { state.draft = text; state.dirty = text.length > 0; state.notice = null; emit(); } },
    append() {
      if (!state.page || state.pending || !state.draft.trim()) return;
      return run(async active => { state.pending = { channelId: state.channelId, requestId: newRequestId(), text: state.draft }; await save(active); });
    },
    retry() { if (state.pending) return run(save); },
    older() { if (state.page?.next && !state.pending) { const before = state.page.next; return run(active => load(active, before)); } },
    checkAccess: () => run(async active => { state.page = null; emit(); if (state.channelId) await load(active); }),
    suspend() { ++generation; clear(); state.channelId = null; state.busy = false; state.notice = 'Private notes and unsaved text were cleared while this page was hidden.'; emit(); },
    async logout() {
      ++generation; clear(); state.channelId = null; state.identity = null; state.phase = 'signed-out'; state.busy = true; emit();
      const token = generation;
      try { await api.logout(); } catch { if (token === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (token === generation) { state.busy = false; emit(); } }
    },
  });
}
