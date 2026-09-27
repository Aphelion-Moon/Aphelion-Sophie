/** Retained values are text nodes only. Server HTML is never inserted into the reader. */
export function createCaseView({ document, controller }) {
  const element = id => document.getElementById(id);
  let reviewHash = null, identity = null;
  element('open-channel').addEventListener('submit', event => { event.preventDefault(); controller.open(element('channel-id').value.trim()); });
  for (const [id, work] of [['logout', () => controller.logout()], ['gate-retry', () => controller.checkAccess()],
    ['refresh', () => controller.checkAccess()], ['next-observations', () => controller.next('observations')], ['next-gaps', () => controller.next('gaps')],
    ['review-export', () => controller.review()], ['cancel-export', () => controller.cancelReview()], ['retry-download', () => controller.retry()],
    ['download', () => controller.confirm(element('export-confirmed').checked)]]) element(id).addEventListener('click', work);
  element('export-confirmed').addEventListener('change', () => { element('download').disabled = !element('export-confirmed').checked || controller.snapshot().busy; });
  const text = (id, value) => { element(id).textContent = value ?? ''; };
  function entries(id, values) {
    element(id).replaceChildren();
    if (!values.length) { const empty = document.createElement('p'); empty.textContent = 'No entries on this page.'; element(id).append(empty); }
    for (const value of values) { const pre = document.createElement('pre'); pre.className = 'screen-text'; pre.textContent = JSON.stringify(value, null, 2); element(id).append(pre); }
  }
  return Object.freeze({ render(state) {
    const nextIdentity = state.identity ? `${state.identity.guildId}:${state.identity.userId}` : null;
    if (identity !== nextIdentity) element('channel-id').value = '';
    identity = nextIdentity;
    element('workspace').hidden = state.phase !== 'ready'; element('gate').hidden = state.phase === 'ready';
    element('signin').hidden = state.phase === 'loading'; element('logout').hidden = !state.identity;
    text('gate-title', state.phase === 'loading' ? 'Loading your workspace…' : 'Sign in to read a case');
    text('error', state.error); element('error').hidden = !state.error;
    text('notice', state.notice); element('notice').hidden = !state.notice;
    for (const id of ['open', 'refresh', 'gate-retry', 'logout', 'review-export', 'cancel-export', 'retry-download', 'channel-id', 'export-confirmed']) element(id).disabled = state.busy;
    element('retry-download').hidden = !state.pending;
    element('record').hidden = !state.page;
    text('channel-label', state.page ? `Channel ${state.page.channelId}` : '');
    text('capture', state.page ? `Current capture: ${state.page.captureAvailable ? 'available' : 'unavailable or unverified'}. Reconnection does not establish complete history.` : '');
    entries('observations', state.page?.page.observations ?? []); entries('gaps', state.page?.page.gaps ?? []);
    element('next-observations').disabled = state.busy || !state.page?.next || !!state.pending;
    element('next-gaps').disabled = state.busy || !state.page?.gapsNext || !!state.pending;
    element('review-export').disabled = state.busy || !!state.pending;
    element('export-review').hidden = !state.review;
    const changedReview = reviewHash !== (state.review?.reviewHash ?? null);
    if (changedReview) element('export-confirmed').checked = false;
    reviewHash = state.review?.reviewHash ?? null;
    text('export-counts', state.review ? `${state.review.observations} observations · ${state.review.gaps} gaps · ${state.review.bytes} bytes · Policy version ${state.review.policyVersion}` : '');
    text('export-hash', state.review ? `SHA-256: ${state.review.sha256}` : '');
    element('download').disabled = state.busy || !state.review || !element('export-confirmed').checked;
    if (changedReview && state.review) element('export-heading').focus();
  } });
}
