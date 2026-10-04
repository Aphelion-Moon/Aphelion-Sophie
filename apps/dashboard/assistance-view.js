export function createAssistanceView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  const node = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element; };
  let showingReview = false;
  el('confirm-change').addEventListener('change', event => controller.confirm(event.target.checked));
  for (const [id, action] of [['send-change', 'submit'], ['cancel-review', 'cancel'], ['retry-change', 'retry'], ['next', 'next'],
    ['refresh', 'refresh'], ['gate-retry', 'refresh'], ['logout', 'logout']]) el(id).addEventListener('click', () => controller[action]());
  return { render(state) {
    const ready = state.phase === 'ready', pending = state.pending !== null, review = state.review !== null;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Sign in with a Staff account';
    el('logout').hidden = state.identity === null; text('notice', state.notice); text('error', state.error);
    for (const id of ['refresh', 'gate-retry', 'logout', 'retry-change']) el(id).disabled = state.busy;
    el('retry-change').hidden = !pending; el('next').disabled = state.busy || pending || review || !state.page?.next;
    text('empty', state.page && !state.page.entries.length ? 'No open assistance requests on this page.' : null);
    el('requests').replaceChildren(...(state.page?.entries ?? []).map(entry => {
      const row = node('article', ''), title = node('h2', `Member ${entry.userId}`), details = node('p',
        `Shuttle ${entry.caseState}${entry.channelId ? ` · Channel ${entry.channelId}` : ''}`), button = node('button', 'Review resolution');
      row.className = 'panel case-panel'; details.className = 'case-text'; button.disabled = state.busy || pending || review;
      button.addEventListener('click', () => controller.review(entry.requestId));
      row.append(title, details, node('p', entry.paused ? 'This request paused its Shuttle run. A current, eligible run can resume when help is resolved.' :
        'This request did not pause its Shuttle run.'), button); return row;
    }));
    el('review').hidden = !review || pending;
    text('review-details', review ? `Resolve help request ${state.review.requestId} for member ${state.review.userId}.${state.review.channelId ? ` Shuttle channel ${state.review.channelId}.` : ''}\n` +
      (state.review.paused ? 'Resume only if this is still the current eligible run. Historical requests can be resolved without resuming a run.' : 'Record that this assistance request is resolved.') +
      ' This does not advance progress, bypass Muzzled restrictions, or grant Whitelist.' : null);
    el('confirm-change').checked = state.confirmed; el('confirm-change').disabled = state.busy;
    el('send-change').disabled = state.busy || !state.confirmed; el('cancel-review').disabled = state.busy;
    if (review && !pending && !showingReview) el('review').focus(); showingReview = review && !pending;
  } };
}
