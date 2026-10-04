const reasons = Object.freeze({ permissions: 'Current permissions or authority need review.', attempts: 'Automatic attempts reached their limit.',
  roles: 'Current role configuration or hierarchy needs review.', delivery: 'Discord delivery needs review.',
  uncertain: 'An earlier delivery has an uncertain result.', review: 'This delivery needs review.' });
const kinds = Object.freeze({ case: 'Private case provisioning', intake: 'Ticket answer delivery', reply: 'Staff reply delivery',
  grant: 'Whitelist delivery', reconcile: 'Whitelist reconciliation', screen: 'Shuttle screen delivery', alert: 'Shuttle help alert delivery' });

export function createDeliveryView({ document, controller, scope = 'case' }) {
  const shuttle = scope === 'shuttle', caseName = entry => shuttle ? 'Shuttle' : entry.caseType.replaceAll('-', ' ');
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
    text('empty', state.page && !state.page.entries.length ? 'No parked deliveries you can manage on this page.' : null);
    el('issues').replaceChildren(...(state.page?.entries ?? []).map(entry => {
      const row = node('article', ''), title = node('h2', kinds[entry.kind]), details = node('p',
        `Member ${entry.userId} · ${caseName(entry)} · ${entry.caseState}${entry.channelId ? ` · Channel ${entry.channelId}` : ''}`);
      row.className = 'panel case-panel'; details.className = 'case-text'; row.append(title, details, node('p', reasons[entry.reason]));
      if (entry.attempted) row.append(node('p', 'An earlier change may already have reached Discord.'));
      const disabled = state.busy || pending || review || entry.revision > (shuttle ? 2_147_483_645 : 2_147_483_644);
      const button = (label, action, resultId = null) => { const b = node('button', label); b.disabled = disabled;
        b.addEventListener('click', () => controller.review(entry.issueId, action, resultId)); return b; };
      if (entry.recheckable) row.append(button('Review recheck', 'recheck'));
      if (entry.needsMessageId) {
        row.append(node('p', 'Identify the matching Sophie message in this case. The message will be verified before its ID is retained.'));
        if (entry.kind === 'reply') { const marker = node('p', `Reply marker: sophie:staff-reply:v1:${entry.replyId}`); marker.className = 'case-text'; row.append(marker); }
        const form = node('form', ''), label = node('label', 'Exact Sophie message ID'), input = node('input', ''), submit = node('button', 'Review message');
        input.id = `message-${entry.issueId}`; label.htmlFor = input.id; input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 20;
        input.pattern = '[1-9][0-9]{0,19}'; input.required = true; input.autocomplete = 'off'; input.disabled = disabled; submit.disabled = disabled;
        form.className = 'actions'; form.append(label, input, submit); form.addEventListener('submit', event => {
          event.preventDefault(); controller.review(entry.issueId, 'adopt_message', input.value);
        }); row.append(form);
      }
      if (entry.channelChoice?.required) {
        row.append(node('p', `Choose the intended channel from ${entry.channelChoice.total} retained candidates. Sophie must seal the others before confirming access.`));
        if (entry.channelChoice.total <= 500) {
          const choices = node('div', ''); choices.className = 'actions';
          choices.append(...entry.channelChoice.candidates.map(candidate => button(`Review channel ${candidate}`, 'select_channel', candidate))); row.append(choices);
          if (entry.channelChoice.total > 5) row.append(node('p', `Only the first five candidates are shown. For another retained candidate, use /${shuttle ? 'whitelist' : 'ticket'} choose with issue ${entry.issueId}.${entry.revision} in Discord.`));
        } else row.append(node('p', 'The candidate limit requires operator review.'));
      } else if (!entry.needsMessageId && !entry.recheckable) row.append(node('p', 'Review the case and configuration before requesting another check.'));
      return row;
    }));
    el('review').hidden = !review || pending;
    const selected = state.review;
    text('review-details', selected ? `${kinds[selected.entry.kind]} for member ${selected.entry.userId}, ${caseName(selected.entry)}.${selected.entry.channelId ? ` Case channel ${selected.entry.channelId}.` : ''}\n` +
      (selected.action === 'recheck' ? 'Request a fresh check of this parked delivery.' : selected.action === 'adopt_message' ?
        `Verify and retain Sophie message ${selected.resultId}. This does not confirm that delivery is complete.` :
        `Select retained channel ${selected.resultId}. Other candidates must be sealed before delivery can continue.`) : null);
    el('confirm-change').checked = state.confirmed; el('confirm-change').disabled = state.busy;
    el('send-change').disabled = state.busy || !state.confirmed; el('cancel-review').disabled = state.busy;
    if (review && !pending && !showingReview) el('review').focus(); showingReview = review && !pending;
  } };
}
