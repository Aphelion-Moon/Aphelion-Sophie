export function createLabelsView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  el('open-channel').addEventListener('submit', event => { event.preventDefault(); controller.open(el('channel-id').value); });
  el('label-form').addEventListener('submit', event => { event.preventDefault(); controller.save(); });
  const edit = () => controller.edit({ priority: el('priority').value, tags: el('tags').value });
  el('priority').addEventListener('change', edit); el('tags').addEventListener('input', edit);
  el('retry-save').addEventListener('click', () => controller.retry());
  el('older-labels').addEventListener('click', () => controller.older());
  el('discard-draft').addEventListener('click', () => controller.open(controller.snapshot().channelId));
  for (const id of ['refresh', 'gate-retry']) el(id).addEventListener('click', () => controller.checkAccess());
  el('logout').addEventListener('click', () => controller.logout());
  return { render(state) {
    const ready = state.phase === 'ready', pending = state.pending !== null, stale = state.page && state.page.version !== state.baseVersion;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Sign in with a permitted Staff account';
    el('logout').hidden = state.identity === null; text('error', state.error); text('notice', state.notice);
    el('record').hidden = !state.page; el('label-form').hidden = !state.page || pending;
    el('retry-save').hidden = !pending; el('retry-save').disabled = state.busy;
    for (const id of ['channel-id', 'open']) el(id).disabled = state.busy || pending;
    for (const id of ['refresh', 'logout', 'gate-retry']) el(id).disabled = state.busy;
    for (const id of ['priority', 'tags', 'discard-draft']) el(id).disabled = state.busy || pending;
    el('priority').value = state.draft.priority; if (el('tags').value !== state.draft.tags) el('tags').value = state.draft.tags;
    el('save-labels').disabled = state.busy || pending || !state.dirty || Boolean(stale);
    text('stale-draft', stale ? 'This case changed after you began editing. Discard the draft and reload before making a new change.' : null);
    el('older-labels').hidden = !state.page?.next; el('older-labels').disabled = state.busy || pending;
    text('current-labels', state.page ? `Case version ${state.page.version} · Manual priority: ${state.page.priority} · Tags: ${state.page.tags.join(', ') || 'None'}` : null);
    el('label-history').replaceChildren();
    for (const change of state.page?.history ?? []) {
      const article = document.createElement('article'), heading = document.createElement('h3'), body = document.createElement('p');
      heading.textContent = `Version ${change.version} · ${change.authorId} · ${new Date(change.createdAt).toISOString()}`;
      body.className = 'case-text'; body.textContent = `Priority: ${change.priority}\nTags: ${change.tags.join(', ') || 'None'}`;
      article.append(heading, body); el('label-history').append(article);
    }
    text('empty-history', state.page && state.page.history.length === 0 ? 'No manual label changes have been recorded.' : null);
    if (!ready || state.channelId === null) el('channel-id').value = '';
    else if (!el('channel-id').value) el('channel-id').value = state.channelId;
  } };
}
