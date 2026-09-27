import { DashboardFailure } from './api.js';

const nameValid = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483646;
const text = (value, size, multiline = false) => typeof value === 'string' && value.length > 0 && value.length <= size && value.trim().length > 0 &&
  value.isWellFormed() && !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value);
const documentValid = value => value && text(value.title,80) && text(value.text,4000,true) && text(value.source,300);
const empty = () => ({ title: '', text: '', source: '' });
const sameDocument = (a,b) => a === null || b === null ? a === b : a?.title === b?.title && a?.text === b?.text && a?.source === b?.source;
const recordValid = (row, name) => row && row.name === name && revision(row.revision) && id(row.authorId) &&
  typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)) &&
  (row.action === 'publish' ? documentValid(row.document) && hash(row.sha256) : row.action === 'withdraw' && row.document === null && row.sha256 === null);

/** Authored drafts/history and exact uncertain requests are memory-only, actor-bound state. */
export function createAnswersController({ api, onChange, newRequestId }) {
  const state = { phase: 'loading', identity: null, busy: false, list: null, after: null, name: null, current: null,
    history: null, before: null, draft: empty(), baseRevision: 0, dirty: false, review: null, checked: false, pending: null, error: null, notice: null };
  let generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  function clearSelection() { Object.assign(state, { name: null, current: null, history: null, before: null, draft: empty(), baseRevision: 0, dirty: false, review: null, checked: false, pending: null }); }
  function clear() { const uncertain = state.pending !== null; clearSelection(); state.list = null; state.after = null;
    if (uncertain) state.notice = 'A submitted change may still complete. Check this answer’s history before making another change.';
  }
  function bound(value) { if (value.actorId !== state.identity?.userId || value.guildId !== state.identity?.guildId) throw new DashboardFailure('denied'); }
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, context = { active: () => token === generation, stage: 'session' };
    state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!context.active()) return;
      if (state.identity && (state.identity.userId !== identity.userId || state.identity.guildId !== identity.guildId)) {
        clear(); state.identity = identity; state.phase = 'ready'; state.notice = 'Your account changed. Drafts and editorial history were cleared. Check any prior submission before editing again.'; return;
      }
      if (state.identity?.canEditAnswers && !identity.canEditAnswers) { clear(); state.notice = 'Editing access ended. Drafts and editorial history were cleared; any submitted change may still complete.'; }
      state.identity = identity; state.phase = 'ready'; context.stage = 'read'; await work(context);
    } catch (error) {
      if (!context.active()) return;
      state.review = null; state.checked = false;
      if (context.stage === 'send' && !['denied','missing'].includes(error.kind)) {
        if (['invalid','conflict'].includes(error.kind)) {
          const pending = state.pending; state.pending = null;
          if (pending?.document) { state.draft = pending.document; state.baseRevision = pending.expectedRevision; state.dirty = true; }
          state.error = 'The change was rejected or this answer changed. Refresh its history and review again. The library allows 100 names; revise an existing name if full.';
        } else state.error = 'The result could not be confirmed. Retry the same change to check its receipt; do not submit another copy.';
      } else if (context.stage === 'review' && ['invalid','conflict'].includes(error.kind)) {
        state.error = 'The answer changed or the draft is invalid. Refresh history and review the current text again.';
      } else { clear(); state.identity = null; state.phase = error.kind === 'denied' ? 'denied' : 'unavailable'; state.error = 'Access or answer data could not be verified. Drafts and editorial history were cleared.'; }
    } finally { if (context.active()) { state.busy = false; emit(); } }
  }
  async function list(context, after = state.after) {
    context.stage = 'read'; const page = await api.answers(after); if (!context.active()) return; bound(page);
    if (!Array.isArray(page.entries) || page.entries.length > 25 || !page.entries.every(row => nameValid(row.name) && revision(row.revision) && text(row.title,80) && hash(row.sha256)) ||
      page.entries.some((row,i) => (i ? page.entries[i-1].name : after ?? '') >= row.name) ||
      !(page.next === null || page.entries.length === 25 && page.next === page.entries.at(-1).name)) throw new DashboardFailure('unavailable');
    state.list = page; state.after = after;
  }
  async function selection(context, before = null) {
    if (!state.name) return; context.stage = 'read';
    if (!state.identity.canEditAnswers) {
      const row = await api.answer(state.name); if (!context.active()) return; bound(row);
      if (!recordValid(row,state.name) || row.action !== 'publish') throw new DashboardFailure('unavailable'); state.current = row; return;
    }
    const page = await api.answerHistory(state.name,before); if (!context.active()) return; bound(page);
    if (page.name !== state.name || !Array.isArray(page.entries) || page.entries.length > 10 || !page.entries.every(row => recordValid(row,state.name)) ||
      page.entries.some((row,i) => row.revision >= (i ? page.entries[i-1].revision : before ?? 2147483647)) ||
      !(page.nextBefore === null || page.entries.length === 10 && page.nextBefore === page.entries.at(-1).revision)) throw new DashboardFailure('unavailable');
    state.history = page; state.before = before;
    if (before === null) {
      state.current = page.entries[0] ?? null;
      if (!state.dirty && !state.pending) { state.draft = structuredClone(state.current?.document ?? empty()); state.baseRevision = state.current?.revision ?? 0; }
    }
  }
  async function submit(context) {
    if (!state.pending || !state.identity.canEditAnswers) return;
    context.stage = 'send'; const request = state.pending, result = await api.changeAnswer(request); if (!context.active()) return; bound(result);
    if (result.name !== request.name || result.revision !== request.expectedRevision + 1 || result.action !== request.action || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; state.dirty = false; state.review = null; state.checked = false;
    state.notice = `${result.action === 'publish' ? 'Publication' : 'Withdrawal'} recorded at revision ${result.revision}. Earlier text and authorship remain in history.`;
    await selection(context); if (context.active()) await list(context,null);
  }
  return Object.freeze({ snapshot,
    start: () => run(context => list(context,null)),
    open(name) {
      if (state.pending || state.dirty || !nameValid(name)) return;
      return run(async context => { clearSelection(); state.name = name; state.notice = null; emit(); await selection(context); });
    },
    edit(field,value) { if (!state.busy && !state.pending && state.name && state.identity?.canEditAnswers && ['title','text','source'].includes(field)) {
      state.draft[field] = value; state.dirty = true; state.review = null; state.checked = false; state.notice = null; emit();
    } },
    discard() { if (!state.pending) return run(async context => { state.dirty = false; state.review = null; state.checked = false; await selection(context); }); },
    review(action = 'publish') {
      if (!state.identity?.canEditAnswers || !state.name || state.pending || !['publish','withdraw'].includes(action) ||
        (action === 'publish' ? !documentValid(state.draft) : state.dirty || state.current?.action !== 'publish')) return;
      return run(async context => {
        state.review = null; state.checked = false; const base = state.baseRevision;
        await selection(context); if (!context.active() || !state.identity.canEditAnswers) return;
        context.stage = 'review'; const request = { name: state.name, expectedRevision: state.current?.revision ?? 0, action, document: action === 'publish' ? structuredClone(state.draft) : null };
        const result = await api.reviewAnswer(request); if (!context.active()) return; bound(result);
        if (result.name !== request.name || result.expectedRevision !== request.expectedRevision || result.action !== action || !sameDocument(result.document,request.document) ||
          !hash(result.reviewSha256) || result.preservesHistory !== true || result.audience !== 'current-guild-members' ||
          !(request.expectedRevision === 0 ? result.previous === null : recordValid(result.previous,state.name) && result.previous.revision === request.expectedRevision)) throw new DashboardFailure('unavailable');
        state.review = { ...request, previous: result.previous, reviewSha256: result.reviewSha256, changed: base !== request.expectedRevision };
      });
    },
    confirm(value) { if (!state.busy && state.review && !state.pending) { state.checked = value === true; emit(); } },
    cancelReview() { if (!state.busy && !state.pending) { state.review = null; state.checked = false; emit(); } },
    send() {
      if (!state.review || !state.checked || state.pending || !state.identity?.canEditAnswers) return;
      return run(async context => {
        if (!state.review || !state.identity.canEditAnswers) return;
        const { previous: _, changed: __, ...request } = state.review;
        state.pending = { ...request, requestId: newRequestId(), confirmed: true, approvedPublic: true };
        state.draft = empty(); state.dirty = false; state.review = null; state.checked = false; await submit(context);
      });
    },
    retry() { if (state.pending) return run(submit); },
    next() { if (state.list?.next && !state.pending) { const after = state.list.next; return run(context => list(context,after)); } },
    first() { if (!state.pending) return run(context => list(context,null)); },
    older() { if (state.history?.nextBefore && !state.pending) { const before = state.history.nextBefore; return run(async context => { state.review = null; state.checked = false; await selection(context,before); }); } },
    checkAccess: () => run(async context => { state.review = null; state.checked = false; state.history = null; state.current = null; state.list = null; emit();
      await list(context); if (context.active()) await selection(context); }),
    suspend() { ++generation; clear(); state.busy = false; state.notice ??= 'Unsaved text and editorial history were cleared while this page was hidden.'; emit(); },
    async logout() { ++generation; clear(); state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const token = generation;
      try { await api.logout(); } catch { if (generation === token) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (generation === token) { state.busy = false; emit(); } }
    },
  });
}
