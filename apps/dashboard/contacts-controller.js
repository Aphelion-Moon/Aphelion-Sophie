import { DashboardFailure } from './api.js';

const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const token = value => typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);
export function createContactsController({ api, onChange }) {
  let state = { phase: 'loading', identity: null, busy: false, page: null, after: null, selected: null, destination: null, focusDestination: false, error: null, notice: null }, generation = 0;
  const snapshot = () => structuredClone(state), emit = () => onChange(snapshot());
  const clear = () => { state.page = null; state.after = null; state.selected = null; state.destination = null; state.focusDestination = false; };
  async function run(work) {
    if (state.busy) return;
    const current = ++generation, active = () => current === generation; state.busy = true; state.error = null; state.destination = null; state.focusDestination = false; emit();
    try {
      const identity = await api.session(); if (!active()) return;
      if (state.identity && (identity.guildId !== state.identity.guildId || identity.userId !== state.identity.userId)) {
        clear(); state.identity = identity; state.phase = 'ready'; state.notice = 'Your account changed. Refresh contacts for this account.'; return;
      }
      state.identity = identity; state.phase = 'ready'; await work(active);
    } catch (error) {
      if (!active()) return; clear();
      if (['denied', 'missing'].includes(error.kind)) { state.phase = 'denied'; state.error = 'The contact or your current membership could not be verified. Refresh to check available contacts.'; }
      else { state.phase = 'unavailable'; state.error = 'Contact access could not be confirmed. Private details and links were cleared; try again shortly.'; }
    } finally { if (active()) { state.busy = false; emit(); } }
  }
  const sameActor = value => value.guildId === state.identity.guildId && value.actorId === state.identity.userId;
  async function load(active, after) {
    state.page = null; emit(); const page = await api.receivedContacts(after); if (!active()) return;
    if (!sameActor(page) || page.state !== 'queue' || !Array.isArray(page.items) || page.items.length > 5 ||
      !page.items.every(row => token(row.token) && id(row.openerId) && Number.isSafeInteger(row.createdAt) && row.createdAt >= 0 && row.createdAt <= 8640000000000000 && ['open', 'closed', 'preparing'].includes(row.access)) ||
      new Set(page.items.map(row => row.token)).size !== page.items.length || !(page.next === null || token(page.next))) throw new DashboardFailure('unavailable');
    state.page = page; state.after = after;
    if (!page.items.some(row => row.token === state.selected)) state.selected = null;
  }
  async function destination(active, caseToken) {
    const value = await api.receivedContactDestination(caseToken); if (!active()) return;
    if (!sameActor(value) || !['ready', 'preparing'].includes(value.state) ||
      (value.state === 'ready' ? !id(value.channelId) || !['open', 'closed'].includes(value.access) : value.caseToken !== caseToken)) throw new DashboardFailure('unavailable');
    state.selected = caseToken; state.destination = value;
  }
  const refresh = () => run(async active => {
    const selected = state.selected; await load(active, state.after);
    if (active() && selected && state.selected === selected) await destination(active, selected);
  });
  return Object.freeze({ snapshot, start: refresh, checkAccess: refresh,
    reload: () => run(async active => { clear(); state.notice = null; await load(active, null); }),
    next() { if (state.page?.next) { const after = state.page.next; return run(async active => { state.selected = null; await load(active, after); }); } },
    open(caseToken) { if (state.page?.items.some(row => row.token === caseToken)) return run(async active => { await destination(active, caseToken); if (active()) state.focusDestination = true; }); },
    suspend() { ++generation; clear(); state.busy = false; state.notice = 'Private contact metadata and links were cleared while this page was hidden.'; emit(); },
    async logout() { ++generation; clear(); state.identity = null; state.phase = 'signed-out'; state.busy = true; emit(); const current = generation;
      try { await api.logout(); } catch { if (generation === current) state.error = 'Sign-out could not be confirmed.'; } finally { if (generation === current) { state.busy = false; emit(); } } },
  });
}
