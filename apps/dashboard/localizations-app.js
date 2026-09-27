import { createDashboardApi } from './api.js';
import { mountDashboardShell } from './shell.js';
import { renderMarkdown } from './markdown.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) });
const el = id => document.getElementById(id);
let catalogue = [], wording = {}, saved = {}, revision = 0, selected = null, phase = 'loading', busy = false, pending = null;
const dirty = () => JSON.stringify(wording) !== JSON.stringify(saved);
const placeholders = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]).sort().join(',');
const invalid = (entry, value) => !value.trim() ? 'Enter some wording, or use the default.' :
  value.length > entry.max ? `Keep this message within ${entry.max} characters.` :
    placeholders(value) !== placeholders(entry.source) ? 'Keep all listed placeholders in the wording.' : '';
const notice = value => { el('notice').textContent = value; };
function fail(error) {
  el('error').hidden = false;
  el('error').textContent = error.kind === 'conflict' ? 'Someone changed the wording. Your edits are still here. Reload the saved wording before applying again.' :
    error.kind === 'invalid' ? 'Check the length and placeholders. Your edits are still here.' :
    error.kind === 'denied' ? 'Your editing access could not be confirmed. Sign in again to continue.' :
    'The change could not be confirmed. Your edits are still here. Apply again to check the same request.';
}
function controls() {
  el('save').disabled = busy || !dirty() || phase !== 'ready' || catalogue.some(entry => invalid(entry, wording[entry.id] ?? entry.source));
  el('save').textContent = pending ? 'Retry applying wording' : 'Apply wording';
  for (const id of ['wording', 'restore', 'reload']) el(id).disabled = busy || phase !== 'ready' || (pending !== null && id !== 'reload');
  el('workspace').hidden = phase !== 'ready'; el('gate').hidden = phase === 'ready';
  el('logout').hidden = phase !== 'ready';
}
function preview() {
  if (!selected) return;
  const value = wording[selected.id] ?? selected.source;
  const example = value.replace(/\{(\w+)\}/g, (_, key) => ({ step: '1', total: '5', title: 'Welcome aboard', screen: '1', screens: '2' })[key] ?? `[${key}]`);
  el('preview').replaceChildren(selected.format === 'plain' ? document.createTextNode(example) : renderMarkdown(document, example));
  el('limit').textContent = `${value.length} / ${selected.max} characters`;
  el('wording-validation').textContent = invalid(selected, value);
  el('wording').setAttribute('aria-invalid', String(Boolean(invalid(selected, value))));
}
function choose() {
  selected = catalogue.find(entry => entry.id === el('message').value);
  el('wording-editor').hidden = !selected;
  if (!selected) return;
  el('message-title').textContent = `${selected.group} message`;
  el('wording').value = wording[selected.id] ?? selected.source; el('wording').maxLength = selected.max;
  el('original').textContent = selected.source;
  const parameters = [...selected.source.matchAll(/\{\w+\}/g)].map(match => match[0]);
  el('parameters').textContent = parameters.length ? `Keep these placeholders: ${parameters.join(', ')}. They are filled in automatically.` : '';
  preview();
}
function filter() {
  const previous = selected?.id, query = el('search').value.toLowerCase(), group = el('group').value;
  const entries = catalogue.filter(entry => (!group || entry.group === group) && `${entry.id} ${wording[entry.id] ?? entry.source}`.toLowerCase().includes(query));
  el('message').replaceChildren(...entries.map(entry => {
    const option = document.createElement('option'); option.value = entry.id; option.textContent = `${entry.source.replaceAll('\n', ' ').slice(0,100)}${entry.source.length > 100 ? '…' : ''}`; return option;
  }));
  if (entries.some(entry => entry.id === previous)) el('message').value = previous;
  else if (entries.length) el('message').value = entries[0].id;
  choose();
}
async function load() {
  const result = await api.systemWording(); catalogue = result.catalogue; revision = result.revision;
  wording = structuredClone(result.wording); saved = structuredClone(wording); pending = null;
  el('group').replaceChildren(...['', ...new Set(catalogue.map(entry => entry.group))].map(group => {
    const option = document.createElement('option'); option.value = group; option.textContent = group || 'All categories'; return option;
  }));
  filter(); notice(`Saved wording · revision ${revision}`);
}
async function checkAccess() {
  try {
    const session = await api.session();
    if (!session.canEditOnboarding) { phase = 'denied'; el('gate-title').textContent = 'Editing permission is required'; }
    else if (phase !== 'ready') { phase = 'ready'; if (!catalogue.length) await load(); }
  } catch (error) {
    if (error.kind === 'denied' || phase !== 'ready') { phase = 'signed-out'; el('gate-title').textContent = 'Sign in to edit system wording'; el('signin').hidden = false; }
    else fail(error);
  } finally { controls(); }
}
el('wording').addEventListener('input', () => {
  if (!selected || busy || pending) return;
  if (el('wording').value === selected.source) delete wording[selected.id]; else wording[selected.id] = el('wording').value;
  preview(); controls(); notice('Unsaved wording');
});
el('restore').addEventListener('click', () => { if (selected) { delete wording[selected.id]; choose(); controls(); notice('Default restored in your draft. Apply wording to save it.'); } });
el('search').addEventListener('input', filter); el('group').addEventListener('change', filter); el('message').addEventListener('change', choose);
el('save').addEventListener('click', async () => {
  if (busy || phase !== 'ready') return;
  pending ??= { requestId: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''), expectedRevision: revision, wording: structuredClone(wording) };
  busy = true; controls(); el('error').hidden = true;
  try { const result = await api.saveSystemWording(pending); revision = result.revision; saved = structuredClone(wording); pending = null; notice(`Wording applied · revision ${revision}`); }
  catch (error) { if (['invalid', 'conflict', 'denied'].includes(error.kind)) pending = null; fail(error); }
  finally { busy = false; controls(); }
});
el('reload').addEventListener('click', async () => {
  if (dirty() && !window.confirm('Discard your unsaved wording and reload the saved version?')) return;
  busy = true; controls(); try { await load(); el('error').hidden = true; } catch (error) { fail(error); } finally { busy = false; controls(); }
});
el('gate-retry').addEventListener('click', checkAccess);
el('logout').addEventListener('click', async () => { try { await api.logout(); phase = 'signed-out'; el('signin').hidden = false; controls(); } catch (error) { fail(error); } });
mountDashboardShell({ window, document, controller: { start: checkAccess, checkAccess, snapshot: () => ({ phase, busy, dirty: dirty(), pending }) } });
