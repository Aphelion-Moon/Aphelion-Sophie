export function createContactView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  let renderedForm = null, lastStage = null;
  el('select-form').addEventListener('submit', event => { event.preventDefault(); controller.select(); });
  el('recipients').addEventListener('input', event => controller.editRecipients(event.target.value));
  el('answers-form').addEventListener('submit', event => { event.preventDefault(); controller.reviewSubmission(); });
  for (const [id, method] of [['open-form', 'openForm'], ['submit-contact', 'submit'], ['back', 'back'], ['retry', 'retry'], ['new-contact', 'reset'],
    ['cancel-audience', 'cancel'], ['cancel-form', 'cancel'], ['refresh', 'checkAccess'], ['gate-retry', 'checkAccess'], ['logout', 'logout']]) el(id).addEventListener('click', () => controller[method]());
  for (const id of ['confirm-audience', 'confirm-submit']) el(id).addEventListener('change', event => controller.confirm(event.target.checked));
  function renderFields(state) {
    const signature = state.form ? `${state.form.token}:${state.form.version}` : null;
    if (signature !== renderedForm) {
      el('fields').replaceChildren(); renderedForm = signature;
      for (const field of state.form?.form.fields ?? []) {
        const group = document.createElement('div'), label = document.createElement('label'), description = document.createElement('p');
        const input = document.createElement(field.kind === 'select' ? 'select' : field.kind === 'paragraph' ? 'textarea' : 'input');
        input.id = `contact-field-${field.id}`; label.htmlFor = input.id; label.textContent = field.label;
        description.id = `${input.id}-help`; description.textContent = field.description; input.setAttribute('aria-describedby', description.id);
        input.required = field.required;
        if (field.kind === 'select') {
          for (const option of [{ value: '', label: 'Choose an option' }, ...field.options]) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; input.append(node); }
        } else { input.maxLength = field.maxLength; if (field.kind === 'paragraph') input.rows = 5; else input.type = 'text'; }
        input.addEventListener(field.kind === 'select' ? 'change' : 'input', () => controller.editValue(field.id, field.kind === 'select' ? input.value ? [input.value] : [] : input.value));
        group.append(label, description, input); el('fields').append(group);
      }
    }
    for (const value of state.values) { const input = el(`contact-field-${value.id}`); if (input) { input.value = value.kind === 'select' ? value.value[0] ?? '' : value.value; input.disabled = state.busy || state.pending !== null; } }
  }
  return { render(state) {
    const ready = state.phase === 'ready', pending = state.pending !== null;
    el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading'; el('logout').hidden = state.identity === null;
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Sign in with a permitted Staff account';
    text('error', state.error); text('notice', state.notice); el('recipients').value = state.recipients;
    for (const [id, stage] of [['select-form', 'select'], ['audience', 'audience'], ['answers-form', 'form'], ['submission-review', 'review'], ['submitted', 'submitted']]) el(id).hidden = state.stage !== stage || pending;
    for (const id of ['recipients', 'select', 'open-form', 'cancel-audience', 'cancel-form', 'review-submit', 'submit-contact', 'back', 'confirm-audience', 'confirm-submit', 'new-contact']) el(id).disabled = state.busy || pending;
    for (const id of ['refresh', 'gate-retry', 'logout', 'retry']) el(id).disabled = state.busy;
    for (const id of ['confirm-audience', 'confirm-submit']) el(id).checked = state.confirmed;
    el('open-form').disabled ||= !state.confirmed; el('submit-contact').disabled ||= !state.confirmed; el('retry').hidden = !pending;
    const audience = state.audience ? `Creator: ${state.audience.openerId}\nSelected recipients: ${state.audience.recipientIds.join(', ')}\nResponders: Staff and Head Admins.` : '';
    text('audience-details', audience); text('submit-audience', audience); text('form-title', state.form?.form.title);
    text('form-version', state.form ? `Published form version ${state.form.version}. Answers are not saved until you confirm creation.` : ''); renderFields(state);
    el('answer-review').replaceChildren();
    if (state.stage === 'review') for (const field of state.form.form.fields) {
      const heading = document.createElement('h3'), answer = document.createElement('p'), value = state.values.find(row => row.id === field.id);
      heading.textContent = field.label; answer.className = 'case-text'; answer.textContent = value.kind === 'select' ? field.options.find(option => option.value === value.value[0])?.label ?? '(No selection)' : value.value || '(No answer)';
      el('answer-review').append(heading, answer);
    }
    const destination = state.destination;
    text('destination-status', state.stage === 'submitted' ? destination?.state === 'ready' ? 'The private channel and current permissions are verified.' : destination?.state === 'closed' ? 'This contact is closed or needs Staff review. Records are retained.' : 'The contact is recorded; its channel and permissions are still being prepared or checked. Use Refresh access to check again.' : '');
    el('destination').hidden = destination?.state !== 'ready'; el('destination').removeAttribute('href');
    if (destination?.state === 'ready') el('destination').href = `https://discord.com/channels/${destination.guildId}/${destination.channelId}`;
    if (state.stage !== lastStage && !pending && ['audience', 'review'].includes(state.stage)) el(state.stage === 'review' ? 'submission-review' : 'audience').focus();
    lastStage = state.stage;
  } };
}
