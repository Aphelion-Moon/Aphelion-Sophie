/** User-authored notes are rendered only with textContent. No Markdown, embeds or external requests. */
export function createNotesView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  el('open-channel').addEventListener('submit', event => { event.preventDefault(); controller.open(el('channel-id').value); });
  el('note-form').addEventListener('submit', event => { event.preventDefault(); controller.append(); });
  el('note-text').addEventListener('input', event => controller.edit(event.target.value));
  el('retry-save').addEventListener('click', () => controller.retry());
  el('older-notes').addEventListener('click', () => controller.older());
  el('refresh').addEventListener('click', () => controller.checkAccess());
  el('gate-retry').addEventListener('click', () => controller.checkAccess());
  el('logout').addEventListener('click', () => controller.logout());
  return { render(state) {
    const ready = state.phase === 'ready', pending = state.pending !== null;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Sign in with a permitted Staff account';
    el('logout').hidden = state.identity === null; text('error', state.error); text('notice', state.notice);
    el('record').hidden = !state.page; el('note-form').hidden = !state.page || pending;
    el('retry-save').hidden = !pending; el('retry-save').disabled = state.busy;
    for (const id of ['channel-id', 'open']) el(id).disabled = state.busy || pending;
    for (const id of ['refresh', 'logout', 'gate-retry']) el(id).disabled = state.busy;
    el('note-text').disabled = state.busy || pending; if (el('note-text').value !== state.draft) el('note-text').value = state.draft;
    el('save-note').disabled = state.busy || pending || !state.draft.trim();
    el('older-notes').hidden = !state.page?.next; el('older-notes').disabled = state.busy || pending;
    el('notes').replaceChildren();
    for (const note of state.page?.entries ?? []) {
      const article = document.createElement('article'), heading = document.createElement('h3'), body = document.createElement('p');
      heading.textContent = `Note ${note.number} · ${note.authorId} · ${new Date(note.createdAt).toISOString()}`;
      body.className = 'case-text'; body.textContent = note.text; article.append(heading, body); el('notes').append(article);
    }
    text('empty-notes', state.page && state.page.entries.length === 0 ? 'No Staff notes are recorded for this case.' : null);
    text('channel-label', state.page ? `Case channel ${state.page.channelId}` : null);
    if (!ready || state.channelId === null) el('channel-id').value = '';
    else if (!el('channel-id').value) el('channel-id').value = state.channelId;
  } };
}
