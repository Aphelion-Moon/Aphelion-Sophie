import { createDashboardApi } from './api.js';
import { mountDashboardShell } from './shell.js';
import { createMemoryList } from './ai-memories-view.js';

// "Sophie and you" (owner decision, 23 October 2026): one Yes or No for the whole server, notes, Sophie's memories, a copy
// of everything she keeps and deletion. The same use cases as the Discord panel (/sophie); the server re-checks every step.
const api = createDashboardApi({ fetch: window.fetch.bind(window) }), el = id => document.getElementById(id);
let phase = 'loading', busy = false, dirty = false, session = null, view = null;
const notice = text => { el('notice').textContent = text; };
const memoryList = createMemoryList({ api, document, perform, identity: () => session, saved: () => refresh() });
const states = {
  yes: 'You said yes. Sophie can talk with you, use your notes and remember things about you, in the channels where she takes part.',
  renew: 'Sophie’s notice has changed since you said yes. Read it below and say yes again to keep talking with her.',
  no: 'You said no. Sophie won’t read or reply to your messages, and nothing about you goes to her AI.',
  none: 'You haven’t chosen yet. Sophie only talks with members who say yes.',
  deleting: 'Your Sophie data is being deleted. Reload in a minute to see when it’s done.',
};
function clear() {
  view = null; el('workspace').hidden = true; memoryList.clear();
  for (const id of ['choice-state', 'retention-state']) el(id).textContent = '';
  el('processing-notice').textContent = ''; el('memory-notes').value = '';
}
function render(value) {
  const actor = session;
  if (!actor || value.actorId !== actor.userId || value.guildId !== actor.guildId || !Object.hasOwn(states, value.state)) { clear(); throw Error('AI_MEMBER_RESULT_INVALID'); }
  view = value; el('workspace').hidden = false;
  const deleting = value.state === 'deleting', canSayYes = value.optInAvailable === true && value.state !== 'yes' && !deleting;
  el('choice-state').textContent = states[value.state] + (canSayYes || value.state === 'yes' || deleting ? '' : ' Saying yes isn’t available right now.');
  el('notice-box').hidden = !canSayYes; el('processing-notice').textContent = canSayYes ? value.noticeText ?? '' : '';
  el('say-yes').hidden = !canSayYes; el('say-no').hidden = !['yes', 'renew'].includes(value.state);
  if (!dirty) el('memory-notes').value = value.notes.join('\n');
  for (const id of ['memory-notes', 'save-notes', 'toggle-retention', 'delete-data', 'forget-all']) el(id).disabled = deleting;
  el('forget-all').disabled = deleting || value.memories.count === 0;
  el('export-data').hidden = deleting;
  el('retention-state').textContent = value.retainOnLeave ? 'If you leave the server, your Sophie data is kept.' : 'If you leave the server, your Sophie data is deleted.';
  el('toggle-retention').textContent = value.retainOnLeave ? 'Delete my data if I leave' : 'Keep my data if I leave';
}
async function refresh() { render(await api.aiMe()); if (view.state !== 'deleting') await memoryList.load(); }
async function perform(work) {
  if (busy) return; busy = true; el('error').hidden = true;
  try { await work(); }
  catch (error) {
    if (error.kind === 'denied') { clear(); phase = 'denied'; }
    el('error').textContent = error.code === 'AI_NOTICE_STALE' || error.kind === 'conflict' ? 'That changed while you were looking. The page now shows the current version.'
      : error.kind === 'invalid' ? 'That couldn’t be saved. Use up to 8 lines of up to 200 characters each.'
        : error.kind === 'denied' ? 'Your access has changed. Sign in again.' : error.kind === 'connection' ? 'The server did not answer in time. Reload to check the current state.'
          : 'That couldn’t be confirmed. Reload to check the current state.';
    el('error').hidden = false; el('retry').hidden = false;
    if (error.kind === 'conflict' || error.code === 'AI_NOTICE_STALE') await refresh().catch(() => {});
  } finally { busy = false; }
}
async function load() {
  session = await api.session(); el('logout').hidden = false;
  if (!session.aiAvailable) throw Object.assign(Error(), { kind: 'denied' });
  await refresh(); phase = 'ready'; notice(''); el('retry').hidden = true;
}
el('memory-notes').addEventListener('input', () => { dirty = true; });
el('say-yes').addEventListener('click', () => perform(async () => {
  await api.aiMeChoice({ enabled: true, noticeRevision: view.noticeRevision, noticeBinding: view.noticeBinding }); await refresh(); notice('Thanks! Sophie can talk with you now.');
}));
el('say-no').addEventListener('click', () => perform(async () => {
  await api.aiMeChoice({ enabled: false, noticeRevision: null, noticeBinding: null }); await refresh(); notice('Done. Sophie won’t talk with you.');
}));
el('save-notes').addEventListener('click', () => perform(async () => {
  const notes = [...new Set(el('memory-notes').value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean))];
  await api.aiMeNotes({ notes }); dirty = false; await refresh(); notice('Your notes are saved for 90 days.');
}));
el('forget-all').addEventListener('click', () => perform(async () => {
  if (!window.confirm('Make Sophie forget everything she remembers about you? This can’t be undone.')) return;
  await api.aiMeForget({ confirmed: true }); await refresh(); notice('Sophie has forgotten what she remembered about you.');
}));
el('toggle-retention').addEventListener('click', () => perform(async () => {
  await api.aiMeRetention({ retainOnLeave: !view.retainOnLeave }); await refresh(); notice('Saved.');
}));
el('delete-data').addEventListener('click', () => perform(async () => {
  if (!window.confirm('Delete everything Sophie keeps about you? Sophie stops talking with you until you say yes again. This can’t be undone.')) return;
  await api.aiMeDelete({ confirmed: true }); dirty = false; await refresh(); notice('Your data is queued for deletion.');
}));
el('retry').addEventListener('click', () => phase === 'denied' ? location.reload() : perform(load));
el('logout').addEventListener('click', () => perform(async () => { await api.logout(); clear(); phase = 'denied'; }));
const controller = { snapshot: () => ({ phase, busy, dirty, pending: null }), start: () => perform(load), checkAccess: () => perform(async () => {
  const fresh = await api.session();
  if (fresh.userId !== session?.userId || fresh.guildId !== session?.guildId || !fresh.aiAvailable) { clear(); phase = 'denied'; notice('Access changed. Reload before continuing.'); }
}) };
mountDashboardShell({ window, document, controller });
