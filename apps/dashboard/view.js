import { screensOf } from './controller.js';
import { renderMarkdown } from './markdown.js';

/** Persistent form controls and local static previews; no HTML evaluation or remote embeds. */
export function createGuidanceView({ document, controller }) {
  const byId = id => document.getElementById(id), listen = (id, event, callback) => byId(id).addEventListener(event, callback);
  const node = (tag, text = '', className = '') => { const result = document.createElement(tag); result.textContent = text; if (className) result.className = className; return result; };
  const setText = (id, text) => { byId(id).textContent = text; };
  const hidden = (id, value) => { byId(id).hidden = value; };
  const disabled = (id, value) => { byId(id).disabled = value; };
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
  const setting = document => document?.helpPauses ? 'Staff help pauses progress.' : 'Staff help does not pause progress.';
  let state, reviewKey = null, selectedKey = null, conflictKey = null, historyKey = null, returnFocus = null, restoreFocus = false;
  let choices = [];
  let screenIndex = 0, screenStep = null, screenChoices = [], previewText = null;
  function screenPreview(text) {
    const card = node('div', '', 'screen-text'); card.append(renderMarkdown(document, text)); return card;
  }
  function resizeChoices(count) {
    if (choices.length === count) return;
    byId('pages').replaceChildren();
    choices = Array.from({ length: count }, (_, index) => {
      const button = node('button', '', 'page-choice'), number = node('span', String(index + 1).padStart(2, '0'), 'page-index');
      const labels = node('span'), title = node('span', '', 'page-label'), caption = node('span', '', 'page-caption');
      labels.append(title, caption); button.append(number, labels); button.addEventListener('click', () => controller.selectPage(index));
      byId('pages').append(button); return { button, title, caption };
    });
  }
  function copyColumn(title, guidance) {
    const column = node('section', '', 'comparison-column'); column.append(node('h3', title));
    if (!guidance) { column.append(node('p', 'No published copy.', 'muted')); return column; }
    column.append(node('p', setting(guidance), 'muted'));
    guidance.stages.forEach((page, index) => { const article = node('article', '', 'copy-page');
      article.append(node('h4', `${index + 1}. ${page.title || 'Untitled page'}`), node('p', page.body || '(No guidance yet.)')); column.append(article); });
    return column;
  }
  function comparison(leftTitle, left, rightTitle, right) {
    const result = node('div', '', 'comparison'); result.append(copyColumn(leftTitle, left), copyColumn(rightTitle, right)); return result;
  }
  function impacts(impact) {
    const result = node('div', '', 'impact');
    for (const [key, label] of [['active', 'active runs'], ['rolePending', 'pending role grants'], ['complete', 'retained completed runs']]) {
      const item = node('p'); item.append(node('strong', String(impact[key])), document.createTextNode(` ${label}`)); result.append(item);
    }
    return result;
  }
  function dialog(id, open) {
    const element = byId(id);
    if (open && !element.open) {
      element.showModal();
      if (id === 'conflict-dialog') { byId('conflict-title').focus({ preventScroll: true }); element.scrollTop = 0; }
    } else if (!open && element.open) { element.close(); restoreFocus = true; }
  }
  function renderReview(review) {
    const key = review ? JSON.stringify(review) : null;
    if (key !== reviewKey) {
      reviewKey = key; byId('review-content').replaceChildren(); byId('confirm-publish').checked = false;
      if (review) {
        const body = byId('review-content');
        if (!review.valid) {
          body.append(node('p', 'This draft is not ready to publish. Each step needs a unique identity, title and guidance within the allowed lengths. Check the saved copy before reviewing again.', 'error-box'));
        } else {
          setText('review-title', `Review version ${review.publication.version}`); setText('publish', `Publish version ${review.publication.version}`);
          body.append(node('p', `Publishing uses saved draft revision ${review.draft.revision}. New runs will use version ${review.publication.version}; existing runs keep their current version and progress.`, 'review-note'));
          const sourceComparison = node('details'); sourceComparison.append(node('summary', 'Compare source copy with the current publication'));
          sourceComparison.append(comparison(review.currentPublishedVersion === null ? 'Current publication' : `Current publication · v${review.currentPublishedVersion}`,
            review.previous, `Proposed · v${review.publication.version}`, review.publication)); body.append(sourceComparison);
          body.append(node('h3', 'Screen preview'), node('p', 'Separate screens use Next/Back before acknowledgement. Older copy without explicit screens keeps its original layout. Discord may render some formatting differently.', 'muted'));
          for (const [index, page] of review.pages.entries()) {
            const details = node('details'); details.open = index === 0; details.append(node('summary', `${index + 1}. ${page.title} · ${page.segments.length} screen${page.segments.length === 1 ? '' : 's'}`));
            for (const [segment, text] of page.segments.entries()) details.append(node('p', `Screen ${segment + 1} of ${page.segments.length}`, 'small-label'), screenPreview(text));
            body.append(details);
          }
        }
      }
    }
    hidden('publish-confirmation', !review?.valid); disabled('confirm-publish', state.busy || !!state.pending || state.stale);
    disabled('publish', !review?.valid || !byId('confirm-publish').checked || state.busy || !!state.pending || state.stale);
    disabled('review-close', state.busy || !!state.pending);
    dialog('review-dialog', !!review);
  }
  function renderSelected(selected) {
    const key = selected ? JSON.stringify(selected) + state.dirty : null;
    if (key !== selectedKey) {
      selectedKey = key; byId('selected-content').replaceChildren(); byId('confirm-withdraw').checked = false;
      if (selected) {
        const body = byId('selected-content'), published = selected.kind === 'publications';
        setText('selected-title', published ? `${selected.withdrawing ? 'Withdraw' : 'Publication'} version ${selected.version}` : `Draft revision ${selected.draft.revision}`);
        if (selected.withdrawing) {
          body.append(node('p', `Withdrawing version ${selected.version} blocks its unfinished runs and pending role grants. Existing Whitelist access and retained history remain. Screen cleanup is queued and may finish later.`, 'review-note'));
          body.append(impacts(selected.impact));
          body.append(node('p', selected.newRunVersionAfterWithdrawal === null ? 'No published version would remain for new runs.' :
            `After withdrawal, new runs will select version ${selected.newRunVersionAfterWithdrawal}.`, 'error-box'));
          body.append(node('p', 'These counts describe runs, not distinct members. They can change before the withdrawal is recorded.', 'muted'));
          setText('withdraw', `Withdraw version ${selected.version}`);
          if (byId('history-dialog').open) byId('selected-close').focus();
        } else {
          const meta = published ? selected : selected.draft;
          body.append(node('p', `${published ? `${selected.status} · ` : ''}${date(meta.createdAt)} · Author ${meta.authorId ?? 'unavailable'}`, 'muted'));
          body.append(copyColumn('Retained copy', published ? selected.publication : selected.draft.document));
          if (state.dirty) body.append(node('p', 'Save your current edits before using another copy or reviewing a withdrawal.', 'review-note'));
        }
      }
    }
    hidden('selected-actions', !!selected?.withdrawing); hidden('withdraw-review', selected?.kind !== 'publications' || selected?.status !== 'published');
    hidden('withdraw-confirmation', !selected?.withdrawing);
    for (const id of ['use-selected', 'withdraw-review']) disabled(id, state.busy || !!state.pending || state.stale || state.dirty);
    disabled('confirm-withdraw', state.busy || !!state.pending || state.stale);
    disabled('withdraw', !selected?.withdrawing || !byId('confirm-withdraw').checked || state.busy || !!state.pending || state.stale);
    disabled('selected-close', state.busy || !!state.pending); dialog('history-dialog', !!selected);
  }
  function renderConflict(conflict) {
    const key = conflict ? JSON.stringify(conflict) : null;
    if (key !== conflictKey) { conflictKey = key; byId('conflict-content').replaceChildren();
      if (conflict) byId('conflict-content').append(comparison('Your unsaved copy', conflict.local,
        `Latest saved copy · revision ${conflict.overview.draft?.revision ?? 0}`, conflict.remote));
    }
    dialog('conflict-dialog', !!conflict);
  }
  function renderHistory(history) {
    const key = JSON.stringify(history);
    if (key !== historyKey) {
      historyKey = key; const list = byId('history-list'); list.replaceChildren();
      if (!history.entries.length) list.append(node('p', 'No records in this view yet.', 'muted'));
      for (const record of history.entries) {
        const row = node('article', '', 'history-record'), copy = node('div'), published = history.kind === 'publications';
        copy.append(node('strong', published ? `Version ${record.version}` : `Revision ${record.revision}`));
        if (published) copy.append(node('span', record.status, 'badge'));
        copy.append(node('p', `${date(record.createdAt)} · Author ${record.authorId ?? 'unavailable'}`));
        const button = node('button', published && !record.contentAvailable ? 'Copy unavailable' : 'Inspect');
        button.dataset.available = String(!published || record.contentAvailable); button.setAttribute('aria-label', `Inspect ${published ? 'version' : 'revision'} ${record.version ?? record.revision}`);
        button.addEventListener('click', () => { returnFocus = button; controller.inspect(history.kind, record.version ?? record.revision); }); row.append(copy, button); list.append(row);
      }
    }
    for (const button of byId('history-list').querySelectorAll('button')) button.disabled = state.busy || !!state.pending || button.dataset.available === 'false';
    for (const [id, kind] of [['publications-filter', 'publications'], ['drafts-filter', 'drafts']]) {
      byId(id).setAttribute('aria-pressed', String(kind === history.kind)); disabled(id, state.busy || !!state.pending);
    }
    disabled('older', state.busy || !!state.pending || history.nextBefore === null); disabled('newer', state.busy || !!state.pending || history.back.length === 0);
  }
  function render(next) {
    state = next;
    hidden('notice', !(state.accessNotice || state.notice)); setText('notice', state.accessNotice || state.notice);
    const message = state.pending && !state.busy ? 'The result is uncertain. Retry the same request to check whether it was recorded.' : state.error;
    hidden('error-box', !message); setText('error', message); hidden('retry', !state.pending); hidden('reload-error', !!state.pending || state.phase !== 'ready');
    for (const id of ['retry', 'reload-error', 'gate-retry', 'logout']) disabled(id, state.busy);
    hidden('logout', !state.identity); hidden('gate', state.phase === 'ready'); hidden('workspace', state.phase !== 'ready');
    hidden('signin', !['signed-out', 'denied'].includes(state.phase)); hidden('gate-retry', !state.error && state.phase !== 'denied');
    const gates = { loading: ['Opening the workspace…', 'Loading your workspace.'],
      'signed-out': ['Welcome to the service desk', 'Sign in with Discord to manage Onboarding guidance. Your current guild permissions determine access.'],
      denied: ['Editing access is unavailable', 'Your session or current editing permission could not be verified. You can check again or sign in.'] };
    if (gates[state.phase]) { setText('gate-title', gates[state.phase][0]); setText('gate-description', gates[state.phase][1]); }
    if (state.phase === 'ready') {
      hidden('editor', state.section !== 'editor'); hidden('history', state.section !== 'history');
      byId('editor-tab').setAttribute('aria-current', state.section === 'editor' ? 'page' : 'false'); byId('history-tab').setAttribute('aria-current', state.section === 'history' ? 'page' : 'false');
      disabled('history-tab', state.busy || !!state.pending); disabled('editor-tab', state.busy);
      setText('account', `Discord account ${state.identity.userId}`);
      setText('draft-status', state.overview.draft ? `Draft revision ${state.overview.draft.revision}${state.dirty ? ' · unsaved changes' : ' · saved'}` : 'No saved draft yet');
      setText('publication-status', state.overview.currentPublishedVersion === null ? 'No version published for new runs' : `New runs: version ${state.overview.currentPublishedVersion}`);
      const page = state.document.stages[state.page], count = state.document.stages.length;
      const locked = state.busy || !!state.pending || state.stale || !!state.conflict || !!state.pendingEdit;
      const screens = screensOf(page);
      if (screenStep !== page.id) { screenStep = page.id; screenIndex = 0; }
      screenIndex = Math.min(screenIndex, screens.length - 1);
      if (screenChoices.length !== screens.length) {
        byId('screens').replaceChildren(); screenChoices = screens.map((_, index) => {
          const button = node('button', `Screen ${index + 1}`);
          button.addEventListener('click', () => { screenIndex = index; render(state); });
          byId('screens').append(button); return button;
        });
      }
      screenChoices.forEach((button, index) => { button.setAttribute('aria-pressed', String(index === screenIndex)); button.disabled = locked; });
      disabled('add-screen', locked || screens.length >= 5 || page.body.length > 4_998);
      disabled('remove-screen', locked || screens.length <= 1);
      disabled('screen-earlier', locked || screenIndex === 0); disabled('screen-later', locked || screenIndex === screens.length - 1);
      disabled('preview-back', screenIndex === 0); disabled('preview-next', screenIndex === screens.length - 1);
      setText('screen-status', `Screen ${screenIndex + 1} of ${screens.length}`);
      setText('screen-acknowledgement', screenIndex === screens.length - 1 ? 'Final screen · acknowledgement available here' : 'Next screen · acknowledgement follows the final screen');
      hidden('legacy-screens', !!page.screens);
      if (previewText !== screens[screenIndex]) { previewText = screens[screenIndex]; byId('screen-preview').replaceChildren(renderMarkdown(document, previewText || 'Your screen preview appears here.')); }
      resizeChoices(count); setText('journey-count', `${count} ${count === 1 ? 'step' : 'steps'}. One welcome.`);
      setText('page-number', `STEP ${String(state.page + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`); setText('page-heading', page.title || 'Untitled step');
      setText('page-completion', page.title.trim() && page.body.trim() ? 'Text entered' : 'Needs text');
      for (const [id, value] of [['page-title', page.title], ['page-body', screens[screenIndex]]]) { if (byId(id).value !== value) byId(id).value = value; byId(id).readOnly = locked; }
      byId('page-body').maxLength = Math.min(1_800, 5_000 - (screens.join('\n\n').length - screens[screenIndex].length));
      setText('title-count', `${page.title.length} / 80`); setText('body-count', `${screens[screenIndex].length} / 1,800 · step ${page.body.length} / 5,000`);
      byId('help-pauses').checked = state.document.helpPauses; disabled('help-pauses', locked);
      disabled('add-page', locked || count >= 20); disabled('remove-page', locked || count <= 1);
      disabled('move-up', locked || state.page === 0); disabled('move-down', locked || state.page === count - 1);
      for (const [index, choice] of choices.entries()) {
        choice.button.disabled = state.busy || !!state.pending || !!state.pendingEdit;
        const stage = state.document.stages[index]; choice.title.textContent = stage.title || 'Untitled page';
        choice.caption.textContent = stage.body.trim() ? 'Text entered' : 'Needs guidance';
        choice.button.setAttribute('aria-current', index === state.page ? 'step' : 'false'); choice.button.setAttribute('aria-label', `Page ${index + 1}: ${stage.title || 'Untitled page'}`);
      }
      disabled('save', locked || (!state.dirty && !!state.overview.draft)); disabled('review', locked || state.dirty || !state.overview.draft);
      disabled('reload', state.busy || !!state.pending);
      setText('save-hint', state.pending ? 'Checking a previous request' : state.busy ? 'Working…' : state.stale ? 'Reload before continuing' : state.dirty ? 'Changes are only in this tab' : state.overview.draft ? 'Saved copy ready for review' : 'Save a first draft to review it');
      renderHistory(state.history);
    } else {
      // Hidden fields must not retain guidance after permission loss or sign-out.
      byId('page-title').value = ''; byId('page-body').value = ''; byId('history-list').replaceChildren(); historyKey = null;
      byId('screen-preview').replaceChildren(); byId('screens').replaceChildren(); screenChoices = []; screenStep = null; previewText = null;
      byId('help-pauses').checked = false; setText('title-count', ''); setText('body-count', '');
      setText('page-heading', ''); setText('journey-count', 'Your journey'); resizeChoices(0);
      setText('draft-status', ''); setText('publication-status', ''); setText('account', '');
    }
    renderReview(state.review); renderSelected(state.selected); renderConflict(state.conflict);
    setText('change-message', state.pendingEdit?.message ?? '');
    disabled('confirm-change', state.busy); disabled('cancel-change', state.busy);
    dialog('change-dialog', !!state.pendingEdit);
    if (restoreFocus && !state.busy) {
      restoreFocus = false;
      const usable = element => element?.isConnected && !element.disabled && element.getClientRects().length > 0;
      const target = state.phase !== 'ready' ? byId('signin') : state.pending ? byId('retry') :
        usable(returnFocus) ? returnFocus : byId(state.section === 'history' ? 'history-tab' : 'page-title');
      if (usable(target)) target.focus({ preventScroll: true }); returnFocus = null;
    }
  }
  listen('page-title', 'input', event => controller.updatePage(state.page, 'title', event.target.value));
  listen('page-body', 'input', event => controller.updateScreen(state.page, screenIndex, event.target.value));
  listen('add-screen', 'click', () => { controller.addScreen(state.page); screenIndex = screensOf(state.document.stages[state.page]).length - 1; render(state); byId('page-body').focus(); });
  listen('remove-screen', 'click', event => { returnFocus = event.currentTarget; controller.removeScreen(state.page, screenIndex); });
  for (const [id, direction] of [['screen-earlier', -1], ['screen-later', 1]]) listen(id, 'click', () => {
    const target = screenIndex + direction; controller.moveScreen(state.page, screenIndex, direction); screenIndex = target; render(state);
  });
  listen('preview-back', 'click', () => { screenIndex--; render(state); });
  listen('preview-next', 'click', () => { screenIndex++; render(state); });
  listen('help-pauses', 'change', event => controller.updateHelp(event.target.checked));
  listen('add-page', 'click', () => { controller.addPage(); byId('page-title').focus(); });
  listen('move-up', 'click', () => { controller.movePage(-1); byId('page-title').focus(); });
  listen('move-down', 'click', () => { controller.movePage(1); byId('page-title').focus(); });
  listen('remove-page', 'click', event => { returnFocus = event.currentTarget; controller.removePage(); });
  listen('confirm-change', 'click', () => controller.confirmEdit());
  listen('cancel-change', 'click', () => controller.cancelEdit());
  listen('change-dialog', 'cancel', event => { event.preventDefault(); if (!state.busy) controller.cancelEdit(); });
  for (const [id, action] of [['save', 'save'], ['review', 'review'], ['publish', 'publish'], ['retry', 'retry'], ['reload', 'reload'], ['reload-error', 'reload'],
    ['gate-retry', 'reload'], ['logout', 'logout'], ['editor-tab', 'showEditor'], ['review-close', 'closeReview'], ['selected-close', 'closeReview'],
    ['use-selected', 'useSelected'], ['withdraw-review', 'reviewWithdrawal'], ['withdraw', 'withdraw']]) listen(id, 'click', event => {
      if (['review', 'reload'].includes(action)) returnFocus = event.currentTarget; controller[action]();
    });
  listen('history-tab', 'click', () => controller.history());
  listen('publications-filter', 'click', () => controller.history('publications')); listen('drafts-filter', 'click', () => controller.history('drafts'));
  listen('older', 'click', () => controller.history(state.history.kind, state.history.nextBefore, 'older'));
  listen('newer', 'click', () => controller.history(state.history.kind, state.history.back.at(-1), 'newer'));
  listen('keep-local', 'click', () => controller.resolveConflict('local')); listen('keep-remote', 'click', () => controller.resolveConflict('remote'));
  listen('confirm-publish', 'change', () => renderReview(state.review)); listen('confirm-withdraw', 'change', () => renderSelected(state.selected));
  for (const id of ['review-dialog', 'history-dialog', 'conflict-dialog']) listen(id, 'cancel', event => {
    event.preventDefault(); if (id !== 'conflict-dialog' && !state.busy && !state.pending) controller.closeReview();
  });
  return Object.freeze({ render });
}
