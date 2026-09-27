import { DashboardFailure } from './api.js';

/** Keep the draft's original version until an explicit discard or successful save. */
export function createLabelsController({ api, onChange, newRequestId }) {
  let state = { phase: 'loading', identity: null, busy: false, channelId: null, page: null, draft: { priority: 'normal', tags: '' },
    baseVersion: null, dirty: false, pending: null, error: null, notice: null }, generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  const clear = () => { state.page = null; state.draft = { priority: 'normal', tags: '' }; state.baseVersion = null; state.dirty = false; state.pending = null; };
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, active = () => token === generation; state.busy = true; state.error = null; emit();
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
      if (['denied', 'missing'].includes(error.kind)) {
        clear(); state.channelId = null; state.error = 'Staff access to this case could not be verified.';
        state.phase = 'denied'; state.identity = null;
      } else if (['invalid', 'conflict'].includes(error.kind)) {
        state.pending = null; state.error = error.kind === 'conflict' ? 'The case changed or this request conflicted. Refresh access, then review the latest labels before saving.' :
          'Labels were rejected. Refresh access to correct the draft. Use up to eight distinct labels of 32 characters each.';
      } else state.error = state.pending ? 'The save could not be confirmed. Retry the same change to check its result.' : 'This operation could not be completed. Try again shortly.';
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  const validLabels = row => ['low', 'normal', 'high', 'urgent'].includes(row.priority) && Array.isArray(row.tags) && row.tags.length <= 8 &&
    row.tags.every(tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 32);
  async function load(active, before = null) {
    const page = await api.caseLabels(state.channelId, before); if (!active()) return;
    if (page.channelId !== state.channelId || !Number.isSafeInteger(page.version) || page.version < 0 || !validLabels(page) ||
      !Array.isArray(page.history) || page.history.length > 25 || !page.history.every(row => validLabels(row) && Number.isSafeInteger(row.version) && row.version > 0 &&
        /^[1-9][0-9]{0,19}$/.test(row.authorId) && Number.isSafeInteger(row.createdAt) && row.createdAt >= 0 && row.createdAt <= 8640000000000000) ||
      !(page.next === null || Number.isSafeInteger(page.next) && page.next > 0)) throw new DashboardFailure('unavailable');
    state.page = page;
    if (!state.dirty && !state.pending) { state.draft = { priority: page.priority, tags: page.tags.join(', ') }; state.baseVersion = page.version; }
  }
  async function save(active) {
    const result = await api.saveCaseLabels(state.pending); if (!active()) return;
    if (!Number.isSafeInteger(result.version) || result.version < 1 || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; state.dirty = false; state.notice = `Change recorded at case version ${result.version}. The latest labels are shown below.`; await load(active);
  }
  return Object.freeze({ snapshot,
    start: () => run(async () => {}),
    open(channelId) { if (!state.pending) return run(async active => { clear(); state.channelId = channelId; state.notice = null; emit(); await load(active); }); },
    edit(draft) { if (!state.busy && !state.pending && state.page) { state.draft = { priority: draft.priority, tags: draft.tags }; state.dirty = true; state.notice = null; emit(); } },
    save() {
      if (!state.page || state.pending || !state.dirty || state.page.version !== state.baseVersion) return;
      return run(async active => { state.pending = { channelId: state.channelId, requestId: newRequestId(), expectedVersion: state.baseVersion,
        priority: state.draft.priority, tags: state.draft.tags.trim() === '' ? [] : state.draft.tags.split(',').map(tag => tag.trim()) }; await save(active); });
    },
    retry() { if (state.pending) return run(save); },
    older() { if (state.page?.next && !state.pending) { const before = state.page.next; return run(active => load(active, before)); } },
    checkAccess: () => run(async active => { state.page = null; emit(); if (state.channelId) await load(active); }),
    suspend() { ++generation; clear(); state.channelId = null; state.busy = false; state.notice = 'Private labels and unsaved changes were cleared while this page was hidden.'; emit(); },
    async logout() {
      ++generation; clear(); state.channelId = null; state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const token = generation;
      try { await api.logout(); } catch { if (token === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (token === generation) { state.busy = false; emit(); } }
    },
  });
}
