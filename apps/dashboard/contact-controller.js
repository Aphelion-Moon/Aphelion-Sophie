import { DashboardFailure } from './api.js';

const token = value => typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
function audience(value, identity) {
  if (value.state !== 'review' || !token(value.token) || value.openerId !== identity.userId || !Array.isArray(value.recipientIds) ||
    value.recipientIds.length < 1 || value.recipientIds.length > 20 || !value.recipientIds.every(id) || new Set(value.recipientIds).size !== value.recipientIds.length) throw new DashboardFailure('unavailable');
  return value;
}
function form(value, selected) {
  const f = value.form;
  if (value.token !== selected.token || !Number.isSafeInteger(value.version) || value.version < 1 || f?.caseType !== 'staff-contact' ||
    typeof f.title !== 'string' || f.title.length > 45 || !Array.isArray(f.fields) || f.fields.length < 1 || f.fields.length > 5 ||
    new Set(f.fields.map(field => field.id)).size !== f.fields.length || !f.fields.every(field => /^[a-z][a-z0-9_-]{0,31}$/.test(field.id) &&
      typeof field.label === 'string' && field.label.length <= 45 && typeof field.description === 'string' && field.description.length <= 100 && typeof field.required === 'boolean' &&
      (field.kind === 'select' ? Array.isArray(field.options) && field.options.length >= 1 && field.options.length <= 25 && field.options.every(option =>
        /^[a-z][a-z0-9_-]{0,31}$/.test(option.value) && typeof option.label === 'string' && option.label.length <= 100) :
        ['short', 'paragraph'].includes(field.kind) && Number.isInteger(field.maxLength) && field.maxLength >= 1 && field.maxLength <= 4000))) throw new DashboardFailure('unavailable');
  return value;
}
export function createContactController({ api, onChange, newRequestId }) {
  let state = { phase: 'loading', identity: null, busy: false, stage: 'select', recipients: '', selectionId: null, audience: null,
    form: null, values: [], confirmed: false, pending: null, submissionId: null, destination: null, dirty: false, error: null, notice: null }, generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  function clear() { Object.assign(state, { stage: 'select', recipients: '', selectionId: null, audience: null, form: null, values: [], confirmed: false,
    pending: null, submissionId: null, destination: null, dirty: false }); }
  async function run(work) {
    if (state.busy) return;
    const current = ++generation, active = () => current === generation; state.busy = true; state.error = null; emit();
    try {
      const identity = await api.session(); if (!active()) return;
      if (state.identity && (identity.guildId !== state.identity.guildId || identity.userId !== state.identity.userId)) {
        clear(); state.identity = identity; state.phase = 'ready'; state.notice = 'Your account changed. Review a new selection for this account.'; return;
      }
      state.identity = identity; if ((await api.contactAccess()).canCreate !== true) throw new DashboardFailure('denied');
      if (!active()) return; state.phase = 'ready'; await work(active);
    } catch (error) {
      if (!active()) return;
      if (['denied', 'missing'].includes(error.kind)) { clear(); state.identity = null; state.phase = 'denied'; state.error = 'Current Staff authority or the published form could not be verified.'; }
      else if (['invalid', 'conflict'].includes(error.kind)) {
        const operation = state.pending?.action; state.pending = null; state.confirmed = false;
        if (operation === 'submit' && error.kind === 'invalid') state.stage = 'form'; else clear();
        state.error = 'The request was rejected or its selection expired or changed. Review current recipients and form before trying again.';
      } else if (state.pending) state.error = 'The outcome is unknown. Retry the same request before starting another contact.';
      else { clear(); state.phase = 'unavailable'; state.error = 'Current access could not be checked. Private values were cleared. A sent contact may already be recorded; check the Staff queue before starting again.'; }
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  async function checkDestination(active) {
    const result = await api.contactDestination(state.submissionId); if (!active()) return;
    if (result.state === 'ready') {
      if (result.guildId !== state.identity.guildId || !id(result.channelId)) throw new DashboardFailure('unavailable');
    } else if (!['preparing', 'closed'].includes(result.state)) throw new DashboardFailure('unavailable');
    state.destination = result;
  }
  async function execute(active) {
    const { action, body } = state.pending, result = await api.contactChange(action, body); if (!active()) return;
    if (action === 'select') { state.audience = audience(result, state.identity); state.selectionId = body.requestId; state.stage = 'audience'; }
    else if (action === 'confirm') { state.form = form(result, state.audience); state.values = result.form.fields.map(field => ({ id: field.id, kind: field.kind === 'select' ? 'select' : 'text', value: field.kind === 'select' ? [] : '' })); state.stage = 'form'; }
    else if (action === 'cancel') { if (result.cancelled !== true) throw new DashboardFailure('unavailable'); clear(); state.notice = 'Selection cancelled. No contact was created.'; }
    else {
      if (result.recorded !== true || typeof result.duplicate !== 'boolean') throw new DashboardFailure('unavailable');
      state.submissionId = body.requestId; state.stage = 'submitted'; state.form = null; state.values = []; state.dirty = false;
      state.notice = 'Contact request recorded. Discord access must still be verified before a link is shown.';
    }
    state.pending = null; state.confirmed = false;
    if (action === 'submit') await checkDestination(active);
  }
  const request = (action, body) => run(async active => { state.pending = { action, body }; await execute(active); });
  return Object.freeze({ snapshot, start: () => run(async () => {}),
    editRecipients(value) { if (!state.busy && !state.pending && state.stage === 'select') { state.recipients = value; state.dirty = true; emit(); } },
    select() {
      if (state.pending || state.stage !== 'select') return;
      const recipientIds = state.recipients.trim().split(/[\s,]+/);
      if (recipientIds.length < 1 || recipientIds.length > 20 || !recipientIds.every(id) || new Set(recipientIds).size !== recipientIds.length) { state.error = 'Enter one to twenty distinct Discord member IDs.'; emit(); return; }
      return request('select', { requestId: newRequestId(), recipientIds });
    },
    confirm(value) { if (!state.busy && !state.pending) { state.confirmed = value === true; emit(); } },
    openForm() { if (state.stage === 'audience' && state.confirmed && !state.pending) return request('confirm', { formToken: state.audience.token, confirmed: true }); },
    editValue(fieldId, value) { if (state.busy || state.pending || state.stage !== 'form') return; const field = state.values.find(row => row.id === fieldId); if (field) { field.value = value; state.dirty = true; state.confirmed = false; emit(); } },
    reviewSubmission() { if (!state.busy && !state.pending && state.stage === 'form') { state.stage = 'review'; state.confirmed = false; emit(); } },
    back() { if (!state.busy && !state.pending && state.stage === 'review') { state.stage = 'form'; state.confirmed = false; emit(); } },
    submit() { if (state.stage === 'review' && state.confirmed && !state.pending) return request('submit', { formToken: state.audience.token, requestId: newRequestId(), values: structuredClone(state.values), confirmed: true }); },
    cancel() { if (!state.busy && !state.pending && state.audience && state.stage !== 'submitted') return request('cancel', { formToken: state.audience.token }); },
    retry() { if (state.pending) return run(execute); },
    checkAccess: () => run(async active => {
      if (state.pending) return;
      state.confirmed = false; if (state.stage === 'review') state.stage = 'form';
      if (state.submissionId) { state.destination = null; emit(); await checkDestination(active); }
      else if (state.selectionId) { const result = await api.contactReview(state.selectionId); if (active()) { const current = audience(result, state.identity);
        if (current.token !== state.audience.token || JSON.stringify(current.recipientIds) !== JSON.stringify(state.audience.recipientIds)) throw new DashboardFailure('conflict'); } }
    }),
    reset() { if (!state.busy && !state.pending && state.stage === 'submitted') { clear(); state.notice = null; emit(); } },
    suspend() { ++generation; clear(); state.busy = false; state.notice = 'Private selection and form values were cleared. A sent request may already be recorded; check the Staff queue before starting again.'; emit(); },
    async logout() { ++generation; clear(); state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const current = generation;
      try { await api.logout(); } catch { if (current === generation) state.error = 'Sign-out could not be confirmed.'; } finally { if (current === generation) { state.busy = false; emit(); } } },
  });
}
