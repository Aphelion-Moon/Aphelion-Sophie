import { MANAGEMENT_ACTIONS, availableManagementActions } from './management-controller.js';

export function createManagementView({ document, controller }) {
  let showingReview = false;
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  function options(id, entries, selected) {
    const select = el(id), signature = JSON.stringify(entries);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...entries.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }));
      select.dataset.options = signature;
    }
    select.value = selected;
  }
  el('open-channel').addEventListener('submit', event => { event.preventDefault(); controller.open(el('channel-id').value); });
  el('queue-form').addEventListener('submit', event => { event.preventDefault(); controller.list(el('queue-filter').value); });
  el('queue-next').addEventListener('click', () => controller.next());
  el('action-form').addEventListener('submit', event => { event.preventDefault(); controller.review(); });
  el('action').addEventListener('change', () => controller.edit({ action: el('action').value, targetId: '', reason: MANAGEMENT_ACTIONS[el('action').value]?.[1][0] ?? '' }));
  const edit = () => controller.edit({ action: el('action').value, targetId: el('target-id').value, reason: el('reason').value });
  el('target-id').addEventListener('input', edit); el('reason').addEventListener('change', edit);
  el('confirm-change').addEventListener('change', event => controller.confirm(event.target.checked));
  el('send-change').addEventListener('click', () => controller.submit()); el('cancel-review').addEventListener('click', () => controller.cancel());
  el('retry-change').addEventListener('click', () => controller.retry());
  for (const id of ['refresh', 'gate-retry']) el(id).addEventListener('click', () => controller.checkAccess());
  el('logout').addEventListener('click', () => controller.logout());
  return { render(state) {
    const ready = state.phase === 'ready', pending = state.pending !== null, review = state.review !== null;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Sign in with a permitted Staff account';
    el('logout').hidden = state.identity === null; text('error', state.error); text('notice', state.notice);
    el('record').hidden = !state.page; el('action-form').hidden = !state.page || pending || review;
    el('review').hidden = !review || pending; el('retry-change').hidden = !pending;
    for (const id of ['channel-id', 'open', 'queue-filter', 'queue-load', 'queue-next', 'action', 'target-id', 'reason', 'review-action']) el(id).disabled = state.busy || pending;
    for (const id of ['refresh', 'logout', 'gate-retry', 'retry-change']) el(id).disabled = state.busy;
    el('confirm-change').checked = state.confirmed; el('confirm-change').disabled = state.busy;
    el('send-change').disabled = state.busy || !state.confirmed; el('cancel-review').disabled = state.busy;
    const page = state.page;
    text('case-details', page ? `Channel ${page.channelId}\nType: ${page.type}\nState: ${page.caseState} · Version ${page.version}\nRequester: ${page.userId}\nAssigned: ${page.assigneeId ?? 'Unassigned'}${page.assignmentStatus === 'needs_review' ? ' (authority needs review)' : ''}\nSelected additional participants: ${(page.participantIds ?? []).join(', ') || 'None'}\nLatest lifecycle request: ${page.action ?? 'None'} · ${page.actionStatus ?? 'No request'}` : null);
    const actions = availableManagementActions(page); options('action', actions.map(value => [value, MANAGEMENT_ACTIONS[value][0]]), state.draft.action);
    options('reason', (MANAGEMENT_ACTIONS[state.draft.action]?.[1] ?? []).map(value => [value, value]), state.draft.reason);
    el('target-field').hidden = !['assign', 'add-participant', 'remove-participant'].includes(state.draft.action);
    el('reason-field').hidden = !MANAGEMENT_ACTIONS[state.draft.action]?.[1].length;
    el('target-id').value = state.draft.targetId; el('review-action').disabled ||= actions.length === 0;
    text('review-details', state.review ? `${MANAGEMENT_ACTIONS[state.review.action][0]}\nChannel: ${state.review.channelId}\nReviewed version: ${state.review.expectedVersion}\nSelected member: ${state.review.targetId ?? 'None'}\nReason: ${state.review.reason ?? 'Not required'}` : null);
    text('review-impact', state.review ? state.review.action === 'add-participant' ? 'Adding this member grants access to retained case history after Discord permissions are verified. Confirm the exact member ID.' :
      state.review.action === 'remove-participant' ? 'Removal revokes this explicit invitation. Existing Staff/Head Admin authority may still permit access.' :
        ['close', 'reopen'].includes(state.review.action) ? 'This records an access-change request. Wait for the case state to confirm Discord permissions; closure retains case records.' :
          'Assignment records responsibility. It does not grant access to the case.' : null);
    el('queue-entries').replaceChildren();
    for (const row of state.queue?.entries ?? []) {
      const article = document.createElement('article'), title = document.createElement('h3'), button = document.createElement('button');
      title.textContent = `${row.type} · ${row.caseState} · ${row.id}`; button.textContent = row.channelId ? `Open channel ${row.channelId}` : 'Channel not ready';
      button.disabled = !row.channelId || state.busy || pending; button.addEventListener('click', () => controller.open(row.channelId)); article.append(title, button); el('queue-entries').append(article);
    }
    text('queue-empty', state.queue && !state.queue.entries.length ? 'No cases on this page.' : null); el('queue-next').hidden = !state.queue?.next;
    if (!ready || state.channelId === null) el('channel-id').value = ''; else if (!el('channel-id').value) el('channel-id').value = state.channelId;
    if (review && !pending && !showingReview) el('review').focus(); showingReview = review && !pending;
  } };
}
