const holds = Object.freeze({ member_left: 'The member has left. The previous decision cannot be retried.',
  decision_expired: 'The member’s eligibility changed. Make a fresh moderation decision through /mute or /unmute.',
  moderator_unavailable: 'The original moderator’s authority is no longer current. Make a fresh moderation decision through /mute or /unmute.',
  no_action: 'There is no recorded mute or unmute decision for this member.' });
const reasons = Object.freeze({ ROLE_CONFIGURATION_INVALID: 'Check the configured roles.', ROLE_HIERARCHY_BLOCKED: 'Check Discord role ordering.',
  BOT_PERMISSION_MISSING: 'Check Sophie’s role permissions.', DISCORD_AUTHORIZATION_FAILED: 'Discord denied the role update.',
  OPERATION_DENIED: 'Moderator authority needs review.', MEMBER_ACTION_EPOCH_CHANGED: 'The earlier moderation decision has expired.',
  ATTEMPT_LIMIT: 'Automatic delivery attempts are exhausted.', DISCORD_RATE_LIMIT_INVALID: 'Discord delivery is paused for operator review.',
  RECONCILIATION_REVIEW_REQUIRED: 'The previous delivery needs review.' });

export function createModerationView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  let showingReview = false;
  el('open-member').addEventListener('submit', event => { event.preventDefault(); controller.open(el('member-id').value); });
  el('confirm-change').addEventListener('change', event => controller.confirm(event.target.checked));
  el('send-change').addEventListener('click', () => controller.submit());
  el('cancel-review').addEventListener('click', () => controller.cancel());
  el('retry-change').addEventListener('click', () => controller.retry());
  for (const id of ['refresh', 'gate-retry']) el(id).addEventListener('click', () => controller.checkAccess());
  el('logout').addEventListener('click', () => controller.logout());
  return { render(state) {
    const ready = state.phase === 'ready', pending = state.pending !== null, review = state.review !== null;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Sign in with a permitted moderator account';
    el('logout').hidden = state.identity === null; text('notice', state.notice); text('error', state.error);
    if (state.userId !== null || !state.busy) el('member-id').value = state.userId ?? '';
    for (const id of ['member-id', 'open']) el(id).disabled = state.busy || pending;
    for (const id of ['refresh', 'gate-retry', 'logout', 'retry-change']) el(id).disabled = state.busy;
    el('retry-change').hidden = !pending; el('record').hidden = state.page === null;
    text('member-details', state.page ? `Member ${state.page.userId}\nLatest decision: ${state.page.action === 'mute' ? 'Apply Muzzled' : state.page.action === 'unmute' ? 'Remove Muzzled' : 'None'}` : null);
    text('hold', state.page?.hold ? holds[state.page.hold] : null);
    text('empty', state.page && state.page.hold !== 'no_action' && !state.page.jobs.length ? 'No pending role delivery was found for this decision.' : null);
    el('jobs').replaceChildren(...(state.page?.jobs ?? []).map((job, index) => {
      const row = document.createElement('article'), title = document.createElement('h3'), detail = document.createElement('p');
      row.className = 'panel'; title.textContent = `Delivery ${index + 1}: ${job.status === 'parked' ? 'Needs review' : job.status === 'leased' ? 'Being checked' : 'Waiting'}`;
      detail.textContent = reasons[job.reason] ?? (job.status === 'parked' ? 'This delivery needs operator review before it can continue.' :
        'Sophie checks current roles before applying the recorded decision.');
      row.append(title, detail);
      if (job.retryAllowed) { const button = document.createElement('button'); button.textContent = 'Review retry'; button.disabled = state.busy || pending || review;
        button.addEventListener('click', () => controller.review(job.operationId)); row.append(button); }
      return row;
    }));
    el('review').hidden = !review || pending;
    text('review-details', review ? `Retry the reviewed role delivery for member ${state.review.userId}. The existing moderation decision stays in effect. Current authority and role state are checked again before delivery.` : null);
    el('confirm-change').checked = state.confirmed; el('confirm-change').disabled = state.busy;
    el('send-change').disabled = state.busy || !state.confirmed; el('cancel-review').disabled = state.busy;
    if (review && !pending && !showingReview) el('review').focus(); showingReview = review && !pending;
  } };
}
