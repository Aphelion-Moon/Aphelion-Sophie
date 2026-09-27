/** Retained and draft text stays literal in the browser; Discord alone renders submitted Markdown. */
export function createRepliesView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  let reviewShown = false;
  el('open-channel').addEventListener('submit', event => { event.preventDefault(); controller.open(el('channel-id').value); });
  el('reply-form').addEventListener('submit', event => { event.preventDefault(); controller.review(); });
  el('reply-text').addEventListener('input', event => controller.edit(event.target.value));
  el('select-answer').addEventListener('click', () => controller.selectAnswer(el('answer-name').value));
  el('clear-answer').addEventListener('click', () => controller.clearAnswer());
  el('confirm-reply').addEventListener('change', event => controller.confirm(event.target.checked));
  el('send-reply').addEventListener('click', () => controller.send());
  el('edit-reply').addEventListener('click', () => { controller.cancelReview(); el('reply-text').focus(); });
  el('retry-reply').addEventListener('click', () => controller.retry());
  el('older-replies').addEventListener('click', () => controller.older());
  el('latest-replies').addEventListener('click', () => controller.latest());
  el('refresh').addEventListener('click', () => controller.checkAccess());
  el('gate-retry').addEventListener('click', () => controller.checkAccess());
  el('logout').addEventListener('click', () => controller.logout());
  const labels = { pending: 'Delivery pending', uncertain: 'Send outcome uncertain — operator review required', needs_review: 'Delivery needs operator review',
    withdrawing: 'Withdrawing the Discord message', confirmed: 'Delivery confirmed', cancelled: 'Cancelled before sending', withdrawn: 'Discord message withdrawn; record retained' };
  return { render(state) {
    const ready = state.phase === 'ready', pending = state.pending !== null;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : state.phase === 'unavailable' ? 'Access could not be verified' : 'Sign in with a permitted Staff account';
    el('logout').hidden = state.identity === null; text('error', state.error); text('notice', state.notice);
    el('record').hidden = !state.page; el('reply-form').hidden = !state.page?.canReply || pending || state.review !== null;
    el('review').hidden = state.review === null; el('retry-reply').hidden = !pending; el('retry-reply').disabled = state.busy;
    for (const name of ['channel-id','open']) el(name).disabled = state.busy || pending;
    for (const name of ['refresh','logout','gate-retry','edit-reply']) el(name).disabled = state.busy;
    el('reply-text').disabled = state.busy || pending; if (el('reply-text').value !== state.draft) el('reply-text').value = state.draft;
    el('reply-text').readOnly = state.answer !== null;
    for (const name of ['answer-name','select-answer']) el(name).disabled = state.busy || pending || state.dirty;
    el('clear-answer').hidden = state.answer === null; el('clear-answer').disabled = state.busy || pending;
    text('selected-answer', state.answer ? `Approved answer: ${state.answer.name}, revision ${state.answer.revision}. Clear it to write a different reply.` : null);
    text('review-answer', state.review?.answer ? `Approved answer: ${state.review.answer.name}, revision ${state.review.answer.revision}` : null);
    if (!ready || state.channelId === null) el('answer-name').value = '';
    el('review-reply').disabled = state.busy || pending || !state.draft.trim();
    el('confirm-reply').checked = state.checked; el('confirm-reply').disabled = state.busy;
    el('send-reply').disabled = state.busy || !state.checked || !state.review;
    el('older-replies').hidden = !state.page?.next; el('older-replies').disabled = state.busy || pending;
    el('latest-replies').hidden = !state.before; el('latest-replies').disabled = state.busy || pending;
    text('review-text', state.review?.text); text('review-channel', state.review ? `Reply to case channel ${state.review.channelId}` : null);
    text('review-changed', state.review?.changed ? 'This case changed after you began drafting. Recheck the case and its readers before confirming.' : null);
    text('closed-case', state.page && !state.page.canReply ? 'This case is closed. Reply history is read-only.' : null);
    el('replies').replaceChildren();
    for (const reply of state.page?.entries ?? []) {
      const article = document.createElement('article'), heading = document.createElement('h3'), status = document.createElement('p'), body = document.createElement('p');
      heading.textContent = `Staff ${reply.authorId} · ${new Date(reply.createdAt).toISOString()}`;
      status.textContent = labels[reply.delivery]; status.className = 'muted'; body.className = 'case-text'; body.textContent = reply.text;
      article.append(heading, status, body);
      if (reply.answer) { const source = document.createElement('p'); source.textContent = `Approved answer: ${reply.answer.name}, revision ${reply.answer.revision}`; article.append(source); }
      el('replies').append(article);
    }
    text('empty-replies', state.page && state.page.entries.length === 0 ? 'No Staff reply requests are recorded for this case.' : null);
    text('channel-label', state.page ? `Case channel ${state.page.channelId}` : null);
    if (!ready || state.channelId === null) el('channel-id').value = '';
    else if (!el('channel-id').value) el('channel-id').value = state.channelId;
    if (state.review && !reviewShown) el('review-heading').focus();
    reviewShown = state.review !== null;
  } };
}
