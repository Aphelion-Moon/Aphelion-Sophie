/** Shared authored-configuration workflow. Domain controllers provide fixed profiles; these are not editable schemas. */
const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createAuthoringController({ api, onChange, newRequestId, profile }) {
  let state = { phase: 'loading', busy: false, identity: null, overview: null, document: null, baseline: null,
    resource: profile.resources?.[0] ?? null, resourceChoice: null, pendingEdit: null, dirty: false, stale: false, page: 0, section: 'editor', notice: '', error: '', pending: null, review: null,
    selected: null, conflict: null, accessNotice: '', history: { kind: 'publications', entries: [], before: null, nextBefore: null, back: [] } };
  let accessPending = null;
  const emit = () => onChange(copy(state));
  const clearCopy = phase => { state = { ...state, phase, overview: null, document: null, baseline: null,
    resourceChoice: null, pendingEdit: null, dirty: false, stale: false, page: 0, section: 'editor', notice: '', pending: null, review: null, selected: null, conflict: null,
    accessNotice: '', history: { kind: 'publications', entries: [], before: null, nextBefore: null, back: [] } }; };
  function failure(error) {
    if (error.kind === 'denied') { clearCopy(state.identity ? 'denied' : 'signed-out'); state.error = 'Your sign-in or editing permission could not be verified.'; }
    else if (error.kind === 'conflict') { state.stale = true; state.review = null; state.selected = null; state.error = 'Another change was recorded. Compare with the latest draft before continuing.'; }
    else if (error.kind === 'invalid') state.error = profile.invalidMessage;
    else if (error.kind === 'missing') state.error = 'That revision is unavailable. Reload the latest saved copy.';
    else { state.stale = true; state.error = 'The service could not be reached. Your edits remain in this tab.'; }
  }
  async function task(work, allowLostAccess = false) {
    if (state.busy) return;
    const wasReady = state.phase === 'ready';
    state.busy = true; state.error = ''; emit();
    const account = state.identity;
    try { await accessPending; if (allowLostAccess || !wasReady || (state.phase === 'ready' &&
      account?.userId === state.identity?.userId && account?.guildId === state.identity?.guildId)) await work(); } catch (error) { failure(error); }
    finally { state.busy = false; emit(); }
  }
  function installOverview(overview) {
    state.overview = overview; state.document = copy(overview.draft?.document ?? profile.emptyDraft(state.resource, overview)); state.baseline = copy(state.document);
    state.page = Math.min(state.page, Math.max(0, profile.pageCount(state.document) - 1)); state.dirty = false; state.stale = false; state.review = null; state.selected = null; state.conflict = null; state.phase = 'ready';
  }
  async function identity() {
    const next = await api.session();
    if (state.identity && (state.identity.userId !== next.userId || state.identity.guildId !== next.guildId)) clearCopy('loading');
    state.identity = next;
    if (!next[profile.capability]) { clearCopy('denied'); return false; } return true;
  }
  const mutable = () => state.phase === 'ready' && !state.busy && !state.pending && !state.stale && !state.conflict && !state.resourceChoice && !state.pendingEdit;
  async function mutation(kind, payload) {
    state.pending = { kind, payload: copy(payload) }; emit();
    let receipt;
    try { receipt = await api[kind](payload); }
    catch (error) {
      if (['denied', 'conflict', 'invalid', 'missing'].includes(error.kind)) state.pending = null;
      else state.error = 'The result is uncertain. Retry the same request to check whether it was recorded.';
      if (state.pending) { state.stale = true; state.review = null; state.selected = null; emit(); return; } throw error;
    }
    state.pending = null; state.review = null; state.selected = null;
    state.notice = profile.mutationNotice ? profile.mutationNotice(kind, receipt) : kind === 'save' ? `Draft revision ${receipt.revision} was recorded.` : kind === 'publish' ?
      `Publication of version ${receipt.version} was recorded.` : profile.withdrawNotice(receipt);
    state.stale = true;
    if (kind === 'save') { state.document = copy(payload.document); state.baseline = copy(payload.document); state.dirty = false; }
    installOverview(await api.draft(state.resource));
    if (state.section === 'history') {
      const result = await api.history(state.resource, state.history.kind); state.history = { ...result, kind: state.history.kind, before: null, back: [] };
    }
  }
  function installEdit(document) {
    state.document = copy(document); state.page = Math.min(state.page, Math.max(0, profile.pageCount(document) - 1));
    state.dirty = !same(state.document, state.baseline); state.review = null; state.notice = '';
  }
  async function loadResource(resource) {
    const overview = await api.draft(resource); state.resource = resource; installOverview(overview);
    state.page = 0; state.section = 'editor'; state.notice = ''; state.resourceChoice = null; state.pendingEdit = null;
    state.history = { kind: 'publications', entries: [], before: null, nextBefore: null, back: [] };
  }
  const controller = {
    snapshot: () => copy(state),
    start: () => task(async () => { if (await identity()) installOverview(await api.draft(state.resource)); }),
    checkAccess: () => {
      if (state.busy || accessPending) return accessPending;
      if (state.phase !== 'ready') return task(async () => { if (await identity()) installOverview(await api.draft(state.resource)); });
      accessPending = (async () => {
        try {
          if (await identity() && state.phase !== 'ready') installOverview(await api.draft(state.resource));
          state.accessNotice = '';
        } catch (error) {
          if (error.kind === 'denied') failure(error);
          else state.accessNotice = 'Connection interrupted. You can keep editing; saving still requires current access.';
        } finally { accessPending = null; emit(); }
      })();
      return accessPending;
    },
    edit(change, confirmation = null) {
      if (!mutable()) return; const document = copy(state.document); change(document);
      if (confirmation) state.pendingEdit = { document, message: confirmation };
      else installEdit(document); emit();
    },
    confirmEdit() { if (!state.pendingEdit || state.busy) return; installEdit(state.pendingEdit.document); state.pendingEdit = null; emit(); },
    cancelEdit() { if (state.busy) return; state.pendingEdit = null; emit(); },
    selectPage(index) { if (!state.document || state.busy || state.pending || state.pendingEdit || !Number.isInteger(index) || index < 0 || index >= profile.pageCount(state.document)) return; state.page = index; emit(); },
    selectResource(resource) {
      if (!mutable() || !profile.resources?.includes(resource) || resource === state.resource) return;
      if (state.dirty) { state.resourceChoice = resource; emit(); return; }
      return task(() => loadResource(resource));
    },
    confirmResource() { if (!state.resourceChoice || state.busy) return; const resource = state.resourceChoice; state.resourceChoice = null; return task(() => loadResource(resource)); },
    cancelResource() { if (state.busy) return; state.resourceChoice = null; emit(); },
    save: () => {
      if (!mutable() || (!state.dirty && state.overview?.draft)) return;
      return task(() => mutation('save', { ...profile.scope(state.resource), requestId: newRequestId(), expectedRevision: state.overview?.draft?.revision ?? 0, document: copy(state.document) }));
    },
    retry: () => { if (!state.pending || state.busy) return; const { kind, payload } = copy(state.pending); return task(() => mutation(kind, payload)); },
    reload: () => {
      if (state.pending) return;
      return task(async () => {
        const local = state.dirty ? copy(state.document) : null;
        if (!await identity()) return;
        const overview = await api.draft(state.resource);
        if (local && state.document) {
          state.conflict = { local, remote: copy(overview.draft?.document ?? profile.emptyDraft(state.resource, overview)), overview };
          state.stale = true; state.review = null; state.selected = null;
        } else installOverview(overview);
      });
    },
    resolveConflict(choice) {
      if (!state.conflict || state.busy || !['local', 'remote'].includes(choice)) return;
      const { local, overview } = state.conflict; installOverview(overview);
      if (choice === 'local') installEdit(local);
      state.notice = choice === 'local' ? 'Your copy is ready to save against the latest revision.' : 'The latest saved draft is loaded.'; emit();
    },
    review: () => {
      if (!mutable() || state.dirty || !state.overview?.draft) return;
      return task(async () => {
        const result = await api.review(state.resource, state.overview.draft.revision);
        if (result.currentRevision !== state.overview.draft.revision || result.draft.sha256 !== state.overview.draft.sha256) {
          state.stale = true; state.error = 'The saved draft changed. Reload it before publishing.'; return;
        }
        const previous = profile.currentVersion(result) === null ? null : await api.publication(state.resource, profile.currentVersion(result));
        state.review = { ...result, previous: previous ? profile.comparisonOf(previous) : null };
      });
    },
    closeReview() { if (state.pending || state.busy) return; state.review = null; state.selected = null; emit(); },
    publish: () => {
      if (!mutable() || state.dirty || !state.review?.valid) return;
      const review = copy(state.review);
      return task(() => mutation('publish', { ...profile.scope(state.resource), requestId: newRequestId(), expectedRevision: review.draft.revision,
        expectedHash: review.draft.sha256, expectedLatestVersion: review.latest?.version ?? 0, expectedLatestStatus: review.latest?.status ?? 'none' }));
    },
    history: (kind = state.history.kind, before = null, direction = 'first') => task(async () => {
      if (state.phase !== 'ready' || state.pending || !['publications', 'drafts'].includes(kind)) return;
      const result = await api.history(state.resource, kind, before), back = direction === 'older' ? [...state.history.back, state.history.before].slice(-100) :
        direction === 'newer' ? state.history.back.slice(0, -1) : [];
      state.section = 'history'; state.history = { ...result, kind, before, back };
    }),
    showEditor() { if (state.busy) return; state.section = 'editor'; emit(); },
    inspect: (kind, version) => task(async () => {
      if (state.phase !== 'ready' || state.pending) return;
      state.selected = kind === 'drafts' ? { kind, ...(await api.draft(state.resource, version)) } : { kind: 'publications', ...(await api.publication(state.resource, version)), withdrawing: false };
    }),
    useSelected() {
      if (!mutable() || state.dirty || !state.selected) return;
      const document = state.selected.kind === 'drafts' ? state.selected.draft.document : profile.draftOf(state.selected);
      installEdit(document); state.selected = null; state.section = 'editor'; state.notice = 'Historical copy is loaded in this tab. Save it to create a new draft revision.'; emit();
    },
    reviewWithdrawal() { if (!mutable() || state.dirty || state.selected?.kind !== 'publications' || state.selected.status !== 'published') return; state.selected.withdrawing = true; emit(); },
    withdraw: () => {
      if (!mutable() || state.dirty || !state.selected?.withdrawing || state.selected.status !== 'published') return;
      const selected = copy(state.selected);
      return task(() => mutation('withdraw', { ...profile.scope(state.resource), requestId: newRequestId(), version: selected.version, expectedHash: selected.sha256, confirm: true }));
    },
    logout: () => task(async () => { await api.logout(); clearCopy('signed-out'); state.identity = null; state.notice = 'You have signed out.'; state.error = ''; }, true),
  };
  return Object.freeze(controller);
}
