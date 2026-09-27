/** Public and unpublished copy is always literal text, never injected HTML or executable markup. */
export function createAnswersView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id,value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  let reviewShown = false;
  el('knowledge-search').addEventListener('submit', event => { event.preventDefault(); controller.lookup(el('knowledge-query').value); });
  el('open-answer').addEventListener('submit', event => { event.preventDefault(); controller.open(el('answer-name').value); });
  el('answer-form').addEventListener('submit', event => { event.preventDefault(); controller.review('publish'); });
  for (const field of ['title','text','source']) el(`answer-${field}`).addEventListener('input', event => controller.edit(field,event.target.value));
  for (const [button,action] of [['refresh','checkAccess'],['gate-retry','checkAccess'],['logout','logout'],['discard','discard'],
    ['retry-change','retry'],['next-answers','next'],['first-answers','first'],['older-history','older'],['latest-history','checkAccess'],['send-change','send']]) el(button).addEventListener('click', () => controller[action]());
  el('withdraw').addEventListener('click', () => controller.review('withdraw'));
  el('edit-answer').addEventListener('click', () => { controller.cancelReview(); el('answer-title').focus(); });
  el('confirm-answer').addEventListener('change', event => controller.confirm(event.target.checked));
  function documentText(prefix,value) {
    for (const field of ['title','text','source']) text(`${prefix}-${field}`,value?.[field]);
  }
  return { render(state) {
    const ready = state.phase === 'ready', editor = ready && state.identity?.canEditAnswers, pending = state.pending !== null;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    const lookup = ready && state.identity?.knowledgeAvailable;
    el('knowledge-lookup').hidden = !lookup;
    el('search-knowledge').disabled = state.busy || pending || state.dirty;
    el('knowledge-query').disabled = state.busy || pending || state.dirty;
    el('knowledge-query').value = lookup ? state.knowledgeQuery : '';
    el('knowledge-results').replaceChildren();
    text('knowledge-status', state.knowledgeSources ? state.knowledgeSources.length ? `Published sources matching “${state.knowledgeQuery}”. Check their authority and revision before relying on them.` : 'No current approved source matched. Try its title, an alias or different words.' : null);
    for (const source of state.knowledgeSources ?? []) {
      const article = document.createElement('article'), heading = document.createElement('h3'), link = document.createElement('a');
      link.href = source.url; link.rel = 'noopener noreferrer'; link.textContent = `${source.title} — ${source.heading}`; heading.append(link); article.append(heading);
      for (const content of [source.text, `Authority: ${source.authority} · Source revision: ${source.sourceRevision}`, `${source.attribution} · ${source.rights}`]) {
        const p = document.createElement('p'); p.className = 'case-text'; p.textContent = content; article.append(p);
      }
      el('knowledge-results').append(article);
    }
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : state.phase === 'unavailable' ? 'Access could not be verified' : 'Sign in with your community account';
    el('logout').hidden = state.identity === null; text('error',state.error); text('notice',state.notice);
    el('open-answer').hidden = !editor; el('member-hint').hidden = editor;
    for (const button of ['refresh','logout','gate-retry','edit-answer']) el(button).disabled = state.busy;
    for (const button of ['answer-name','open']) el(button).disabled = state.busy || pending || state.dirty;
    el('retry-change').hidden = !pending; el('retry-change').disabled = state.busy;
    el('answers').replaceChildren();
    for (const item of state.list?.entries ?? []) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'page-choice';
      button.textContent = `${item.title} · ${item.name} · revision ${item.revision}`;
      button.disabled = state.busy || pending || state.dirty; button.addEventListener('click', () => controller.open(item.name)); el('answers').append(button);
    }
    text('empty-answers',state.list && state.list.entries.length === 0 ? 'No published answers on this page.' : null);
    el('next-answers').hidden = !state.list?.next; el('first-answers').hidden = !state.after;
    for (const button of ['next-answers','first-answers']) el(button).disabled = state.busy || pending;
    el('selection').hidden = !state.name;
    text('selection-title',state.name ? `${state.name} · ${state.current ? `revision ${state.current.revision}` : 'new entry'}` : null);
    text('selection-status',state.name ? state.current?.action === 'publish' ? 'Published for current community members.' : state.current ? 'Withdrawn from member lookup. Earlier text remains in editorial history.' : 'This name has no recorded publication.' : null);
    documentText('current',state.current?.document);
    el('editor').hidden = !editor || !state.name || pending || !!state.review;
    for (const field of ['title','text','source']) { const input = el(`answer-${field}`); if (input.value !== state.draft[field]) input.value = state.draft[field]; input.disabled = state.busy; }
    el('review-answer').disabled = state.busy || !Object.values(state.draft).every(value => value.trim());
    el('withdraw').hidden = state.current?.action !== 'publish'; el('withdraw').disabled = state.busy || state.dirty;
    el('discard').hidden = !state.dirty; el('discard').disabled = state.busy;
    text('dirty-hint',state.dirty ? 'Unsaved edits stay on this page. Publish them or explicitly discard them before opening another answer.' : null);
    el('review').hidden = !state.review;
    el('review-heading').textContent = state.review?.action === 'withdraw' ? 'Review withdrawal' : 'Review public answer';
    text('review-target',state.review ? `${state.review.name} · next revision ${state.review.expectedRevision + 1}` : null);
    text('review-changed',state.review?.changed ? 'This answer changed while you were editing. Compare the previous revision with your proposed text before confirming.' : null);
    documentText('previous',state.review?.previous?.document); documentText('proposed',state.review?.document);
    el('proposed-copy').hidden = state.review?.action !== 'publish';
    text('withdrawal-hint',state.review?.action === 'withdraw' ? 'Withdraw this answer from new member lookup. Retain its earlier text and authorship; previously sent messages remain unchanged.' : null);
    el('confirm-label').textContent = state.review?.action === 'withdraw' ? 'I reviewed this withdrawal. Remove the answer from new lookup and keep its public-source history.' :
      'I reviewed the exact text and source. This is approved public human-authored copy, contains no ticket extracts, and may be read by community members.';
    el('confirm-answer').checked = state.checked; el('confirm-answer').disabled = state.busy;
    el('send-change').textContent = state.review?.action === 'withdraw' ? 'Confirm withdrawal' : 'Confirm publication'; el('send-change').disabled = state.busy || !state.checked || !state.review;
    el('history-panel').hidden = !editor || !state.history; el('history').replaceChildren();
    for (const row of state.history?.entries ?? []) {
      const article = document.createElement('article'), heading = document.createElement('h3');
      heading.textContent = `Revision ${row.revision} · ${row.action === 'publish' ? 'Published' : 'Withdrawn'} · editor ${row.authorId}`; article.append(heading);
      const date = document.createElement('p'); date.className = 'muted'; date.textContent = row.createdAt; article.append(date);
      if (row.document) for (const field of ['title','text','source']) { const p = document.createElement('p'); p.className = 'case-text'; p.textContent = row.document[field]; article.append(p); }
      el('history').append(article);
    }
    text('empty-history',state.history && !state.history.entries.length ? 'No revisions are recorded for this name.' : null);
    el('older-history').hidden = !state.history?.nextBefore; el('latest-history').hidden = !state.before;
    for (const button of ['older-history','latest-history']) el(button).disabled = state.busy || pending;
    if (!ready || state.name === null) el('answer-name').value = ''; else if (!el('answer-name').value) el('answer-name').value = state.name;
    if (state.review && !reviewShown) el('review-heading').focus(); reviewShown = !!state.review;
  } };
}
