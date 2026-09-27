export function createContactsView({ document, controller }) {
  const el = id => document.getElementById(id), text = (id, value) => { el(id).textContent = value ?? ''; el(id).hidden = !value; };
  for (const [id, method] of [['refresh', 'reload'], ['gate-retry', 'reload'], ['next', 'next'], ['logout', 'logout'], ['recheck', 'checkAccess']]) el(id).addEventListener('click', () => controller[method]());
  return { render(state) {
    const ready = state.phase === 'ready'; el('workspace').hidden = !ready; el('gate').hidden = ready; el('signin').hidden = state.phase === 'loading';
    el('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Contacts unavailable';
    el('logout').hidden = state.identity === null;
    for (const id of ['refresh', 'gate-retry', 'logout', 'next', 'recheck']) el(id).disabled = state.busy;
    text('error', state.error); text('notice', state.notice); el('contact-list').replaceChildren();
    for (const [index, item] of (state.page?.items ?? []).entries()) {
      const section = document.createElement('section'), title = document.createElement('h2'), details = document.createElement('p'), button = document.createElement('button');
      section.className = 'panel case-panel'; title.textContent = `Contact ${index + 1}`; details.className = 'case-text';
      details.textContent = `Creator: ${item.openerId}\nCreated: ${new Date(item.createdAt).toISOString()}\nState: ${item.access === 'closed' ? 'Closed · read-only' : item.access === 'preparing' ? 'Access being checked' : 'Open'}`;
      button.textContent = `Check contact ${index + 1}`; button.disabled = state.busy; button.addEventListener('click', () => controller.open(item.token));
      section.append(title, details, button); el('contact-list').append(section);
    }
    el('next').hidden = !state.page?.next; text('empty', state.page && !state.page.items.length ? 'No currently available Staff contacts on this page.' : null);
    const destination = state.destination; el('destination-panel').hidden = !destination;
    text('destination-status', destination ? destination.state === 'preparing' ? 'This contact is waiting for its current permissions to be verified. Check again shortly.' :
      destination.access === 'closed' ? 'The private channel is verified. This contact is closed and available to read.' : 'The private channel and your current invitation are verified.' : null);
    el('destination').hidden = destination?.state !== 'ready'; el('destination').removeAttribute('href');
    if (destination?.state === 'ready') el('destination').href = `https://discord.com/channels/${destination.guildId}/${destination.channelId}`;
    if (state.focusDestination && !state.busy && destination) el('destination-panel').focus();
  } };
}
