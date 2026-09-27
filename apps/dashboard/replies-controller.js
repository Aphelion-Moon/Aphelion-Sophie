import { DashboardFailure } from './api.js';

const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const replyId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const textValid = value => typeof value === 'string' && value.length > 0 && value.length <= 4000 && value.trim().length > 0 &&
  value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const states = ['pending', 'confirmed', 'cancelled', 'withdrawn'];
const answerName = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value);
const answerReference = value => value && answerName(value.name) && Number.isInteger(value.revision) && value.revision > 0 && value.revision <= 2147483646 && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
const sameAnswer = (left, right) => left?.name === right?.name && left?.revision === right?.revision && left?.sha256 === right?.sha256;

/** Human drafts and exact retries stay in memory. Refresh never silently renews a review. */
export function createRepliesController({ api, onChange, newRequestId }) {
  const state = { phase: 'loading', identity: null, busy: false, channelId: null, page: null, before: null,
    draft: '', answer: null, baseVersion: null, dirty: false, review: null, checked: false, pending: null, error: null, notice: null };
  let generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  function clear() { state.page = null; state.before = null; state.draft = ''; state.answer = null; state.baseVersion = null; state.dirty = false; state.review = null; state.checked = false; state.pending = null; }
  function clearPrivate() {
    const uncertain = state.pending !== null; clear(); state.channelId = null;
    if (uncertain) state.notice = 'A previously submitted reply may still complete. Check its history before composing another copy.';
  }
  const sameActor = value => value.actorId === state.identity?.userId && value.guildId === state.identity?.guildId;
  async function run(work) {
    if (state.busy) return;
    const token = ++generation, context = { active: () => token === generation, stage: 'session' };
    state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!context.active()) return;
      if (state.identity && (state.identity.userId !== identity.userId || state.identity.guildId !== identity.guildId)) {
        clearPrivate(); state.identity = identity; state.phase = 'ready';
        state.notice = 'Your account changed. Private reply data was cleared. Check any previous submission before composing another.'; return;
      }
      state.identity = identity; state.phase = 'ready'; context.stage = 'work'; await work(context);
    } catch (error) {
      if (!context.active()) return;
      if (context.stage === 'answer' && ['invalid','missing','conflict'].includes(error.kind)) {
        state.answer = null; state.draft = ''; state.dirty = false; state.review = null; state.checked = false;
        state.error = 'That approved answer is unavailable or changed. Select a current publication and review it again.'; return;
      }
      state.page = null; state.review = null; state.checked = false;
      if (context.stage !== 'send' || ['denied','missing'].includes(error.kind)) {
        clearPrivate();
        state.phase = ['denied','missing'].includes(error.kind) ? 'denied' : 'unavailable';
        if (context.stage === 'session' || state.phase === 'denied') state.identity = null;
        state.error = error.kind === 'invalid' ? 'Check the main ticket channel ID.' : 'Staff access could not be verified. Private reply data was cleared.';
      } else if (['invalid','conflict'].includes(error.kind)) {
        state.draft = state.pending?.text ?? ''; state.baseVersion = state.pending?.expectedVersion ?? null;
        state.answer = state.pending?.answer ?? null;
        state.dirty = state.draft.length > 0; state.pending = null;
        state.error = 'The reply was rejected or the case or selected answer changed. Refresh access, then review your draft again.';
      } else state.error = error.status === 429 ? 'Reply queue or cooldown limit reached. Retry the same reply later.' :
        'Submission could not be confirmed. Retry the same reply to check its result; do not compose another copy.';
    } finally { if (context.active()) { state.busy = false; emit(); } }
  }
  async function load(context, before = state.before) {
    context.stage = 'read'; const page = await api.caseReplies(state.channelId, before); if (!context.active()) return;
    if (!sameActor(page)) throw new DashboardFailure('denied');
    const validEntry = row => (row.answer == null || answerReference(row.answer)) && replyId(row.id) && id(row.authorId) && textValid(row.text) && time(row.createdAt) && states.includes(row.state) &&
      (row.messageId === null || id(row.messageId)) && (row.state === 'pending' ? ['pending','uncertain','needs_review','withdrawing'].includes(row.delivery) : row.delivery === row.state) &&
      (!['confirmed','withdrawn'].includes(row.state) || row.messageId !== null) && (row.state !== 'cancelled' || row.messageId === null) &&
      (row.delivery !== 'uncertain' || row.messageId === null);
    if (page.channelId !== state.channelId || !Number.isSafeInteger(page.version) || page.version < 0 || page.version > 2147483646 ||
      typeof page.canReply !== 'boolean' || !Array.isArray(page.entries) || page.entries.length > 25 ||
      !page.entries.every(validEntry) || new Set(page.entries.map(row => row.id)).size !== page.entries.length ||
      !(page.next === null || page.entries.length === 25 && replyId(page.next?.id) && time(page.next.createdAt) &&
        page.next.id === page.entries.at(-1).id && page.next.createdAt === page.entries.at(-1).createdAt)) throw new DashboardFailure('unavailable');
    state.page = page; state.before = before;
    if (!state.dirty && !state.pending) state.baseVersion = page.version;
    if (!page.canReply && !state.pending) {
      if (state.dirty) state.notice = 'The case is closed. Its unsubmitted draft was cleared.';
      state.draft = ''; state.answer = null; state.dirty = false; state.review = null; state.checked = false;
    }
  }
  async function submit(context) {
    context.stage = 'send'; const result = await api.requestCaseReply(state.pending); if (!context.active()) return;
    if (!sameActor(result)) throw new DashboardFailure('denied');
    if (!replyId(result.id) || !states.includes(result.state) || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
    state.pending = null; state.draft = ''; state.answer = null; state.dirty = false; state.review = null; state.checked = false;
    state.notice = { pending: 'Reply request recorded. Delivery is pending.', confirmed: 'Reply delivery was confirmed.',
      cancelled: 'This reply request was cancelled before sending.', withdrawn: 'This reply was withdrawn from Discord. Its request and audit remain retained.' }[result.state];
    await load(context, null);
  }
  async function published(context, name) {
    context.stage = 'answer'; const value = await api.answer(name); if (!context.active()) return null;
    if (!sameActor(value)) throw new DashboardFailure('denied');
    if (!answerReference(value) || value.name !== name || value.action !== 'publish' || !textValid(value.document?.text)) throw new DashboardFailure('unavailable');
    return value;
  }
  return Object.freeze({ snapshot,
    start: () => run(async () => {}),
    open(channelId) { if (!state.pending) return run(async context => { clear(); state.channelId = channelId; state.notice = null; emit(); await load(context, null); }); },
    selectAnswer(name) {
      if (!state.page?.canReply || state.pending || state.dirty || state.busy) return;
      if (!answerName(name)) { state.error = 'Enter an approved answer name from Public answers.'; emit(); return; }
      return run(async context => {
        await load(context, null); if (!context.active() || !state.page?.canReply) return;
        const value = await published(context, name); if (!context.active()) return;
        state.answer = { name: value.name, revision: value.revision, sha256: value.sha256 }; state.draft = value.document.text;
        state.dirty = true; state.review = null; state.checked = false; state.notice = 'Approved text selected. Review the reply and case before sending.';
      });
    },
    clearAnswer() { if (!state.busy && !state.pending && state.answer) {
      state.answer = null; state.draft = ''; state.dirty = false; state.review = null; state.checked = false; state.notice = null; emit();
    } },
    edit(value) { if (!state.busy && !state.pending && !state.answer && state.page?.canReply) {
      state.draft = value; state.dirty = value.length > 0; state.review = null; state.checked = false; state.notice = null; emit();
    } },
    review() {
      if (!state.page?.canReply || state.pending || !textValid(state.draft)) return;
      return run(async context => {
        state.review = null; state.checked = false; await load(context, null); if (!context.active() || !state.page?.canReply) return;
        if (state.answer) {
          const latest = await published(context, state.answer.name); if (!context.active()) return;
          if (!sameAnswer(latest, state.answer) || latest.document.text !== state.draft) throw new DashboardFailure('conflict');
        }
        state.review = { text: state.draft, answer: state.answer && { ...state.answer }, channelId: state.channelId, version: state.page.version, changed: state.page.version !== state.baseVersion };
      });
    },
    confirm(value) { if (!state.busy && state.review && !state.pending) { state.checked = value === true; emit(); } },
    cancelReview() { if (!state.busy && !state.pending) { state.review = null; state.checked = false; emit(); } },
    send() {
      if (!state.review || !state.checked || state.pending || !state.page?.canReply || state.review.text !== state.draft || state.review.version !== state.page.version) return;
      return run(async context => {
        state.pending = { channelId: state.review.channelId, requestId: newRequestId(), expectedVersion: state.review.version, text: state.review.text, confirmed: true,
          ...(state.review.answer ? { answer: { ...state.review.answer } } : {}) };
        state.draft = ''; state.answer = null; state.dirty = false; state.review = null; state.checked = false; await submit(context);
      });
    },
    retry() { if (state.pending) return run(async context => { await load(context); if (context.active()) await submit(context); }); },
    older() { if (state.page?.next && !state.pending) { const before = state.page.next; return run(async context => { state.review = null; state.checked = false; await load(context, before); }); } },
    latest() { if (!state.pending && state.channelId) return run(async context => { state.review = null; state.checked = false; await load(context, null); }); },
    checkAccess: () => run(async context => { state.review = null; state.checked = false; state.page = null; emit(); if (state.channelId) await load(context); }),
    suspend() { ++generation; const uncertain = state.pending !== null; clearPrivate(); state.busy = false;
      if (!uncertain) state.notice = 'Private replies and unsaved text were cleared while this page was hidden.'; emit(); },
    async logout() {
      ++generation; clearPrivate(); state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const token = generation;
      try { await api.logout(); } catch { if (token === generation) state.error = 'Sign-out could not be confirmed. Sign in again to retry.'; }
      finally { if (token === generation) { state.busy = false; emit(); } }
    },
  });
}
