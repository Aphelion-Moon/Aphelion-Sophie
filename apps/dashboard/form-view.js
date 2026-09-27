import { FORM_CATEGORIES } from './form-controller.js';

/** Static authored configuration only. All copy is text; previews cannot accept or submit answers. */
export function createFormView({ document, controller }) {
  const byId = id => document.getElementById(id), listen = (id, event, action) => byId(id).addEventListener(event, action);
  const node = (tag, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; };
  const text = (id, value) => { byId(id).textContent = value; }, hide = (id, value) => { byId(id).hidden = value; }, disable = (id, value) => { byId(id).disabled = value; };
  const value = (id, next) => { if (byId(id).value !== String(next)) byId(id).value = next; };
  const label = category => FORM_CATEGORIES.find(([id]) => id === category)?.[1] ?? 'Form';
  const date = input => new Date(input).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const kinds = { short: 'Short text', paragraph: 'Paragraph', select: 'Single choice' };
  let state, questionKey = null, optionKey = null, historyKey = null, reviewKey = null, selectedKey = null, conflictKey = null;
  let questions = [], options = [], returnFocus = null, restoreFocus = false, invalidLimit = false;
  for (const [id, name] of FORM_CATEGORIES) { const option = node('option', name); option.value = id; byId('category').append(option); }
  const locked = () => state.busy || !!state.pending || state.stale || !!state.conflict || !!state.resourceChoice || !!state.pendingEdit;

  function copyColumn(title, form) {
    const column = node('section', '', 'comparison-column'); column.append(node('h3', title));
    if (!form) { column.append(node('p', 'No current form.', 'muted')); return column; }
    column.append(node('h4', form.title || 'Untitled form'));
    if (!form.fields.length) column.append(node('p', 'No questions yet.', 'muted'));
    form.fields.forEach((field, index) => {
      const article = node('article', '', 'copy-page'); article.append(node('h4', `${index + 1}. ${field.label || 'Untitled question'}`));
      article.append(node('p', `${kinds[field.kind]} · ${field.required ? 'Required' : 'Optional'}${field.kind === 'select' ? '' : ` · Up to ${field.maxLength} characters`}`, 'muted'));
      if (field.description) article.append(node('p', field.description));
      if (field.kind === 'select') { const list = node('ol'); for (const option of field.options) list.append(node('li', option.label || '(Empty choice)')); article.append(list); }
      column.append(article);
    });
    return column;
  }
  function comparison(leftName, left, rightName, right) { const element = node('div', '', 'comparison'); element.append(copyColumn(leftName, left), copyColumn(rightName, right)); return element; }
  function dialog(id, open) {
    const element = byId(id);
    if (open && !element.open) { element.showModal(); if (id === 'conflict-dialog') byId('conflict-title').focus({ preventScroll: true }); element.scrollTop = 0; }
    else if (!open && element.open) { element.close(); restoreFocus = true; }
  }
  function renderReview(review) {
    const key = review ? JSON.stringify(review) : null;
    if (key !== reviewKey) {
      reviewKey = key; byId('review-content').replaceChildren(); byId('confirm-publish').checked = false;
      if (review) {
        text('review-title', `Review ${label(state.resource)} · version ${review.nextVersion}`);
        if (!review.valid) byId('review-content').append(node('p', 'This draft needs a title and one to five complete questions. Each single-choice question needs at least one named choice. Close this review to finish the draft.', 'error-box'));
        else {
          text('publish', `Publish version ${review.nextVersion}`);
          byId('review-content').append(node('p', `This publishes saved draft revision ${review.draft.revision}. New requests use version ${review.nextVersion}. Open forms keep their pinned version, subject to expiry or withdrawal. Previously submitted answers remain unchanged.`, 'review-note'));
          byId('review-content').append(comparison(review.newRequestVersion === null ? 'Current form · entry unavailable' : `Current form · v${review.newRequestVersion}`,
            review.previous, `Proposed form · v${review.nextVersion}`, review.form));
          byId('review-content').append(node('h3', 'Question layout preview'), node('p', 'Labels, guidance and input limits follow the published form. Discord supplies its own visual layout. No answers can be entered here.', 'muted'));
          const preview = node('section', '', 'form-preview'); preview.append(node('h4', review.preview.title));
          for (const item of review.preview.components) {
            const field = node('div', '', 'preview-question'), component = item.component;
            field.append(node('strong', item.label), node('p', component.required ? 'Required' : 'Optional', 'small-label'));
            if (item.description) field.append(node('p', item.description, 'muted'));
            if (component.type === 3) { const list = node('ul'); component.options.forEach(option => list.append(node('li', option.label))); field.append(list); }
            else field.append(node('div', `${component.style === 2 ? 'Paragraph' : 'Short text'} · up to ${component.max_length} characters`, 'preview-input'));
            preview.append(field);
          }
          byId('review-content').append(preview);
        }
      }
    }
    hide('publish-confirmation', !review?.valid); disable('confirm-publish', locked());
    disable('publish', !review?.valid || !byId('confirm-publish').checked || locked()); disable('review-close', state.busy || !!state.pending);
    dialog('review-dialog', !!review);
  }
  function renderSelected(selected) {
    const key = selected ? JSON.stringify(selected) + state.dirty : null;
    if (key !== selectedKey) {
      selectedKey = key; byId('selected-content').replaceChildren(); byId('confirm-withdraw').checked = false;
      if (selected) {
        const published = selected.kind === 'publications', meta = published ? selected : selected.draft;
        text('selected-title', `${selected.withdrawing ? 'Withdraw version' : published ? 'Publication version' : 'Draft revision'} ${meta.version ?? meta.revision}`);
        if (selected.withdrawing) {
          byId('selected-content').append(node('p', 'Unsubmitted open forms pinned to this version will stop accepting answers. Published history and previously submitted answers remain retained.', 'review-note'),
            node('p', selected.newRequestVersionAfterWithdrawal === null ? 'New entry for this category will be unavailable. An older published version will not be selected automatically.' :
              `New requests will continue using version ${selected.newRequestVersionAfterWithdrawal}.`, 'error-box'), node('p', 'Another publication may change availability before this action is recorded. Reloaded status will show the current version.', 'muted'));
          text('withdraw', `Withdraw version ${selected.version}`);
        } else {
          byId('selected-content').append(node('p', `${published ? `${selected.status} · ` : ''}${date(meta.createdAt)} · Author ${meta.authorId}`, 'muted'),
            copyColumn('Retained questions', published ? selected.form : selected.draft.document));
          if (state.dirty) byId('selected-content').append(node('p', 'Save or compare your edits before using historical copy or withdrawing a version.', 'review-note'));
        }
      }
    }
    hide('selected-actions', !!selected?.withdrawing); hide('withdraw-review', selected?.kind !== 'publications' || selected?.status !== 'published'); hide('withdraw-confirmation', !selected?.withdrawing);
    for (const id of ['use-selected', 'withdraw-review']) disable(id, locked() || state.dirty);
    disable('confirm-withdraw', locked()); disable('withdraw', !selected?.withdrawing || !byId('confirm-withdraw').checked || locked());
    disable('selected-close', state.busy || !!state.pending); dialog('history-dialog', !!selected);
  }
  function renderHistory(history) {
    const key = JSON.stringify(history);
    if (key !== historyKey) {
      historyKey = key; byId('history-list').replaceChildren();
      if (!history.entries.length) byId('history-list').append(node('p', 'No retained records in this view yet.', 'muted'));
      for (const record of history.entries) {
        const published = history.kind === 'publications', row = node('div', '', 'history-record'), information = node('div');
        information.append(node('strong', `${published ? 'Version' : 'Revision'} ${record.version ?? record.revision}`));
        if (published) information.append(node('span', record.status, 'small-label'));
        information.append(node('p', `${date(record.createdAt)} · Author ${record.authorId}`));
        const button = node('button', 'Inspect'); button.setAttribute('aria-label', `Inspect ${published ? 'version' : 'revision'} ${record.version ?? record.revision}`);
        button.addEventListener('click', () => { returnFocus = button; controller.inspect(history.kind, record.version ?? record.revision); }); row.append(information, button); byId('history-list').append(row);
      }
    }
    for (const button of byId('history-list').querySelectorAll('button')) button.disabled = state.busy || !!state.pending;
    for (const [id, kind] of [['publications-filter', 'publications'], ['drafts-filter', 'drafts']]) { byId(id).setAttribute('aria-pressed', String(history.kind === kind)); disable(id, state.busy || !!state.pending); }
    disable('older', state.busy || !!state.pending || history.nextBefore === null); disable('newer', state.busy || !!state.pending || !history.back.length);
  }
  function renderQuestions(form) {
    const key = JSON.stringify([state.resource, form.fields.map(field => field.id)]);
    if (key !== questionKey) {
      questionKey = key; byId('questions').replaceChildren();
      questions = form.fields.map((field, index) => {
        const button = node('button', '', 'page-choice'), name = node('span'), caption = node('span', '', 'page-caption'), content = node('span');
        content.append(name, caption); button.append(node('span', String(index + 1).padStart(2, '0'), 'page-index'), content);
        button.addEventListener('click', () => controller.selectPage(index)); byId('questions').append(button); return { button, name, caption };
      });
    }
    questions.forEach((choice, index) => { const field = form.fields[index]; choice.name.textContent = field.label || 'Untitled question'; choice.caption.textContent = kinds[field.kind];
      choice.button.setAttribute('aria-label', `Question ${index + 1}: ${field.label || 'Untitled question'}`); choice.button.setAttribute('aria-current', state.page === index ? 'step' : 'false'); choice.button.disabled = invalidLimit; });
  }
  function renderOptions(field) {
    const key = field?.kind === 'select' ? JSON.stringify([state.resource, field.id, field.options.map(option => option.value)]) : null;
    if (key !== optionKey) {
      optionKey = key; byId('options').replaceChildren(); options = [];
      if (key) options = field.options.map((option, index) => {
        const row = node('div', '', 'option-row'), input = node('input'), label = node('label', `Choice ${index + 1}`), actions = node('div', '', 'actions');
        input.id = `option-${index}`; input.type = 'text'; input.maxLength = 100; input.autocomplete = 'off'; label.htmlFor = input.id;
        input.addEventListener('input', event => controller.updateOption(state.page, index, event.target.value));
        const buttons = [['↑', 'Move choice up', -1], ['↓', 'Move choice down', 1], ['Remove', 'Remove choice', 0]].map(([caption, name, direction]) => {
          const button = node('button', caption); button.setAttribute('aria-label', `${name} ${index + 1}`);
          button.addEventListener('click', () => { if (direction) controller.moveOption(state.page, index, direction); else controller.removeOption(state.page, index);
            options[Math.max(0, Math.min(options.length - 1, index + direction))]?.input.focus(); }); actions.append(button); return button;
        });
        const control = node('div'); control.append(label, input); row.append(control, actions); byId('options').append(row); return { input, buttons };
      });
    }
    options.forEach((option, index) => { if (option.input.value !== field.options[index].label) option.input.value = field.options[index].label; option.input.readOnly = locked();
      option.buttons.forEach((button, action) => { button.disabled = locked() || action === 0 && index === 0 || action === 1 && index === options.length - 1; }); });
  }
  function render(next) {
    state = next; hide('notice', !(state.accessNotice || state.notice)); text('notice', state.accessNotice || state.notice);
    const error = state.pending && !state.busy ? 'The result is uncertain. Retry the same request to check whether it was recorded.' : state.error;
    hide('error-box', !error); text('error', error); hide('retry', !state.pending); hide('reload-error', !!state.pending || state.phase !== 'ready');
    hide('logout', !state.identity); hide('gate', state.phase === 'ready'); hide('workspace', state.phase !== 'ready');
    hide('signin', !['denied', 'signed-out'].includes(state.phase)); hide('gate-retry', !state.error && state.phase !== 'denied');
    for (const id of ['retry', 'reload-error', 'gate-retry', 'logout']) disable(id, state.busy);
    const gates = { loading: ['Opening the workspace…', 'Loading your workspace.'],
      'signed-out': ['Welcome to the service desk', 'Sign in with Discord to manage ticket forms. Current guild permissions determine access.'],
      denied: ['Form-editing access is unavailable', 'Your session or current form-editing permission could not be verified. You can check again or sign in.'] };
    if (gates[state.phase]) { text('gate-title', gates[state.phase][0]); text('gate-description', gates[state.phase][1]); }
    if (state.phase === 'ready') {
      value('category', state.resource); disable('category', locked() || invalidLimit);
      text('category-note', state.resource === 'head-admin-contact' ? 'Head Admin contact is handled by lead ops. Editing these questions does not grant access to its cases.' : 'Questions for this category. Save a draft, then review it before publishing.');
      text('account', `Discord account ${state.identity.userId}`); text('history-heading', `${label(state.resource)} history`);
      text('draft-status', state.overview.draft ? `Draft revision ${state.overview.draft.revision} · ${state.dirty ? 'unsaved changes' : 'saved'}` : `No saved draft yet${state.dirty ? ' · unsaved changes' : ''}`);
      text('publication-status', state.overview.newRequestVersion === null ? 'New entry unavailable · no current form' : `New requests: version ${state.overview.newRequestVersion}`);
      hide('editor', state.section !== 'editor'); hide('history', state.section !== 'history');
      for (const [id, section] of [['editor-tab', 'editor'], ['history-tab', 'history']]) { byId(id).setAttribute('aria-current', state.section === section ? 'page' : 'false'); disable(id, state.busy || !!state.pending || invalidLimit); }
      const form = state.document, field = form.fields[state.page]; renderQuestions(form);
      value('form-title', form.title); byId('form-title').readOnly = locked(); text('form-title-count', `${form.title.length} / 45`);
      hide('empty-fields', !!field); hide('field-editor', !field); disable('add-question', locked() || invalidLimit || form.fields.length >= 5);
      if (field) {
        text('field-number', `QUESTION ${state.page + 1} / ${form.fields.length}`); text('field-heading', field.label || 'Untitled question');
        value('field-label', field.label); value('field-description', field.description); value('field-kind', field.kind);
        if (!invalidLimit) value('field-limit', field.maxLength ?? '');
        for (const id of ['field-label', 'field-description', 'field-limit']) byId(id).readOnly = locked();
        disable('field-kind', locked() || invalidLimit); disable('field-required', locked()); byId('field-required').checked = field.required;
        disable('move-up', locked() || invalidLimit || state.page === 0); disable('move-down', locked() || invalidLimit || state.page === form.fields.length - 1);
        disable('remove-question', locked() || invalidLimit); hide('text-limit', field.kind === 'select'); hide('choices-section', field.kind !== 'select');
        renderOptions(field); disable('add-option', locked() || field.kind !== 'select' || field.options.length >= 25);
      } else { text('field-heading', ''); for (const id of ['field-label', 'field-description', 'field-limit']) value(id, ''); renderOptions(null); }
      disable('save', locked() || invalidLimit || !state.dirty && !!state.overview.draft); disable('review', locked() || invalidLimit || state.dirty || !state.overview.draft);
      disable('reload', state.busy || !!state.pending || invalidLimit); disable('reload-error', state.busy || !!state.pending || invalidLimit);
      text('save-hint', invalidLimit ? 'Enter a character limit from 1 to 4,000' : state.pending ? 'Checking a previous request' : state.busy ? 'Working…' : state.stale ? 'Reload before continuing' : state.dirty ? 'Changes are only in this tab' : state.overview.draft ? 'Saved copy ready for review' : 'Save a first draft to review it');
      renderHistory(state.history);
    } else {
      invalidLimit = false; for (const id of ['form-title', 'field-label', 'field-description', 'field-limit']) value(id, '');
      for (const id of ['questions', 'options', 'history-list']) byId(id).replaceChildren(); questions = []; options = []; questionKey = null; optionKey = null; historyKey = null;
      for (const id of ['account', 'field-heading', 'field-number', 'form-title-count', 'draft-status', 'publication-status']) text(id, '');
      byId('field-required').checked = false;
    }
    renderReview(state.review); renderSelected(state.selected);
    const conflict = state.conflict ? JSON.stringify(state.conflict) : null;
    if (conflict !== conflictKey) { conflictKey = conflict; byId('conflict-content').replaceChildren(); if (state.conflict) byId('conflict-content').append(comparison('Your copy', state.conflict.local, 'Latest saved copy', state.conflict.remote)); }
    for (const id of ['keep-remote', 'keep-local', 'cancel-change', 'confirm-change']) disable(id, state.busy);
    dialog('conflict-dialog', !!state.conflict);
    text('change-title', state.resourceChoice ? 'Switch support category?' : 'Review this change');
    text('change-message', state.resourceChoice ? `Switch to ${label(state.resourceChoice)} and discard the unsaved changes in this tab? Saved revisions remain retained.` : state.pendingEdit?.message ?? '');
    text('confirm-change', state.resourceChoice ? 'Discard edits and switch' : 'Confirm change'); dialog('change-dialog', !!state.resourceChoice || !!state.pendingEdit);
    if (restoreFocus && !state.busy) {
      restoreFocus = false; const usable = element => element?.isConnected && !element.disabled && element.getClientRects().length > 0;
      const target = state.phase !== 'ready' ? byId('signin') : state.pending ? byId('retry') : usable(returnFocus) ? returnFocus : byId(state.section === 'history' ? 'history-tab' : 'form-title');
      if (usable(target)) target.focus({ preventScroll: true }); returnFocus = null;
    }
  }
  listen('category', 'change', event => { returnFocus = byId('category'); controller.selectResource(event.target.value); });
  listen('form-title', 'input', event => controller.updateTitle(event.target.value));
  listen('field-label', 'input', event => controller.updateField(state.page, 'label', event.target.value));
  listen('field-description', 'input', event => controller.updateField(state.page, 'description', event.target.value));
  listen('field-required', 'change', event => controller.updateField(state.page, 'required', event.target.checked));
  listen('field-limit', 'input', event => { const parsed = Number(event.target.value); invalidLimit = event.target.value === '' || !Number.isInteger(parsed) || parsed < 1 || parsed > 4_000;
    if (invalidLimit) render(state); else controller.updateField(state.page, 'maxLength', parsed); });
  listen('field-kind', 'change', event => { returnFocus = byId('field-kind'); controller.changeKind(state.page, event.target.value); });
  listen('add-question', 'click', () => { controller.addField(); byId('field-label').focus(); });
  listen('remove-question', 'click', () => { returnFocus = byId('form-title'); controller.removeField(state.page); });
  listen('move-up', 'click', () => controller.moveField(state.page, -1)); listen('move-down', 'click', () => controller.moveField(state.page, 1));
  listen('add-option', 'click', () => { controller.addOption(state.page); options.at(-1)?.input.focus(); });
  for (const [id, action] of [['save', 'save'], ['review', 'review'], ['publish', 'publish'], ['retry', 'retry'], ['reload', 'reload'], ['reload-error', 'reload'],
    ['gate-retry', 'reload'], ['logout', 'logout'], ['editor-tab', 'showEditor'], ['review-close', 'closeReview'], ['selected-close', 'closeReview'],
    ['use-selected', 'useSelected'], ['withdraw-review', 'reviewWithdrawal'], ['withdraw', 'withdraw']]) listen(id, 'click', event => { if (['review', 'reload'].includes(action)) returnFocus = event.currentTarget; controller[action](); });
  listen('history-tab', 'click', () => controller.history()); listen('publications-filter', 'click', () => controller.history('publications')); listen('drafts-filter', 'click', () => controller.history('drafts'));
  listen('older', 'click', () => controller.history(state.history.kind, state.history.nextBefore, 'older')); listen('newer', 'click', () => controller.history(state.history.kind, state.history.back.at(-1), 'newer'));
  listen('keep-local', 'click', () => controller.resolveConflict('local')); listen('keep-remote', 'click', () => controller.resolveConflict('remote'));
  listen('confirm-publish', 'change', () => renderReview(state.review)); listen('confirm-withdraw', 'change', () => renderSelected(state.selected));
  listen('cancel-change', 'click', () => state.resourceChoice ? controller.cancelResource() : controller.cancelEdit());
  listen('confirm-change', 'click', () => state.resourceChoice ? controller.confirmResource() : controller.confirmEdit());
  for (const id of ['review-dialog', 'history-dialog', 'conflict-dialog', 'change-dialog']) listen(id, 'cancel', event => {
    event.preventDefault(); if (state.busy || state.pending || id === 'conflict-dialog') return;
    if (id === 'change-dialog') { if (state.resourceChoice) controller.cancelResource(); else controller.cancelEdit(); } else controller.closeReview();
  });
  return Object.freeze({ render });
}
