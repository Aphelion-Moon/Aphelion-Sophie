import { createDashboardApi } from './api.js';
import { mountDashboardShell } from './shell.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) });
const el = id => document.getElementById(id);
const make = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
const option = (value, label) => make('option', { value, textContent: label });
const CHANNEL = /^[1-9][0-9]{16,19}$/;
let editor = null, draft = null, saved = '', phase = 'loading', busy = false, pending = null;
const dirty = () => draft !== null && JSON.stringify(draft) !== saved;
const notice = value => { el('notice').textContent = value; };

function fail(error) {
  el('error').hidden = false;
  el('error').textContent = error.kind === 'conflict' ? 'Someone published a different layout. Your edits are still here. Reload the published layout before publishing again.' :
    error.kind === 'invalid' ? 'Check the channels and moments. Your edits are still here.' :
    error.kind === 'denied' ? 'Your editing access could not be confirmed. Sign in again to continue.' :
    'The change could not be confirmed. Your edits are still here. Publish again to check the same request.';
}
function arrivalProblem() {
  const ids = draft?.arrival.map(entry => entry.channelId) ?? [];
  if (ids.some(id => !CHANNEL.test(id))) return 'Enter each channel as its numeric ID (Developer Mode → Copy Channel ID).';
  if (new Set(ids).size !== ids.length) return 'Each channel can be listed once.';
  if (draft.arrival.some(entry => entry.note !== undefined && (entry.note.length > 120 || /[<>]/.test(entry.note)))) return 'Keep each note within 120 characters, without < or >.';
  return '';
}
function controls() {
  const problem = arrivalProblem();
  el('arrival-validation').textContent = problem;
  el('publish').disabled = busy || phase !== 'ready' || !dirty() || problem !== '';
  el('publish').textContent = pending ? 'Retry publishing' : 'Publish layout';
  el('add-channel').disabled = busy || phase !== 'ready' || pending !== null || (draft?.arrival.length ?? 0) >= 12;
  el('reload').disabled = busy || phase !== 'ready';
  for (const input of el('workspace').querySelectorAll('select, input, .arrival-list button')) input.disabled = busy || pending !== null;
  el('workspace').hidden = phase !== 'ready'; el('gate').hidden = phase === 'ready';
  el('logout').hidden = phase !== 'ready';
}
const changed = () => { notice('Unpublished changes'); controls(); };

/** The scene a stop uses in the draft, and the beats that scene can stage. */
const sceneOf = stage => draft.stops[stage.id]?.scene ?? stage.defaultScene;
const beatsOf = scene => editor.scenes.find(entry => entry.id === scene)?.beats ?? [];
const viewscreenTitle = id => editor.viewscreens.find(entry => entry.id === id)?.title ?? id;
function describeMoment(moment) {
  if (!moment) return 'plain scene';
  return `${moment.scene ? `${moment.scene}: ` : ''}${moment.beat === 'none' ? 'plain scene' : moment.beat}${moment.viewscreen ? ` + ${viewscreenTitle(moment.viewscreen)}` : ''}`;
}
function setStop(stageId, change) {
  const stop = { ...draft.stops[stageId] }; change(stop);
  if (stop.moments && !Object.keys(stop.moments).length) delete stop.moments;
  if (Object.keys(stop).length) draft.stops[stageId] = stop; else delete draft.stops[stageId];
}

function renderStops() {
  el('stops').replaceChildren(...editor.stages.map(stage => {
    const scene = make('select', { id: `scene-${stage.id}` },
      option('', `Default (${stage.defaultScene})`), ...editor.scenes.map(entry => option(entry.id, entry.id)));
    scene.value = draft.stops[stage.id]?.scene ?? '';
    scene.addEventListener('change', () => {
      setStop(stage.id, stop => {
        if (scene.value) stop.scene = scene.value; else delete stop.scene;
        // A moment the new scene cannot stage would be refused on publish, so it returns to the default. Sections with a
        // scene of their own keep their moments.
        const beats = beatsOf(stop.scene ?? stage.defaultScene);
        for (const [key, moment] of Object.entries(stop.moments ?? {})) if (!moment.scene && moment.beat !== 'none' && !beats.includes(moment.beat)) delete stop.moments[key];
      });
      renderStops(); changed();
    });
    const defaults = editor.defaults.stages?.[stage.id] ?? {};
    const rows = stage.headings.map(heading => {
      const own = draft.stops[stage.id]?.moments?.[heading.key];
      // A section can be set in a scene of its own; its moment is then one that scene draws.
      const place = make('select', { ariaLabel: `Scene for ${heading.text}` }, option('', 'The stop\'s scene'),
        ...editor.scenes.map(entry => option(entry.id, entry.id)));
      place.value = own?.scene ?? '';
      const beat = make('select', { ariaLabel: `Moment for ${heading.text}` });
      const fillBeats = () => {
        const chosen = beat.value;
        beat.replaceChildren(option('', `Default (${describeMoment(defaults[heading.key])})`), option('none', 'Plain scene'),
          ...beatsOf(place.value || sceneOf(stage)).map(name => option(name, name)));
        beat.value = [...beat.options].some(item => item.value === chosen) ? chosen : (chosen ? 'none' : '');
      };
      beat.value = ''; fillBeats(); beat.value = own?.beat ?? ''; if (own && beat.value !== own.beat) beat.value = 'none';
      const screen = make('select', { ariaLabel: `Viewscreen for ${heading.text}` }, option('', 'No viewscreen'),
        ...editor.viewscreens.map(entry => option(entry.id, entry.title)));
      screen.value = own?.viewscreen ?? '';
      const show = () => { screen.hidden = place.hidden = beat.value === ''; };
      const update = () => {
        setStop(stage.id, stop => {
          const moments = { ...stop.moments };
          if (beat.value === '') delete moments[heading.key];
          else moments[heading.key] = { beat: beat.value, ...(screen.value ? { viewscreen: screen.value } : {}), ...(place.value ? { scene: place.value } : {}) };
          stop.moments = moments;
        });
        show(); changed();
      };
      beat.addEventListener('change', update); screen.addEventListener('change', update);
      place.addEventListener('change', () => { fillBeats(); update(); });
      show();
      return make('tr', {}, make('th', { scope: 'row', className: `heading-level-${heading.level}`, textContent: heading.text }),
        make('td', {}, beat), make('td', {}, place), make('td', {}, screen));
    });
    const table = rows.length ? make('table', { className: 'moment-table' },
      make('thead', {}, make('tr', {}, make('th', { scope: 'col', textContent: 'Section' }), make('th', { scope: 'col', textContent: 'Moment' }),
        make('th', { scope: 'col', textContent: 'Scene' }), make('th', { scope: 'col', textContent: 'Viewscreen' }))),
      make('tbody', {}, ...rows)) : make('p', { className: 'muted', textContent: 'This stop has no section headings.' });
    return make('fieldset', { className: 'activity-stop' }, make('legend', { textContent: stage.title }),
      make('label', { htmlFor: scene.id, textContent: 'Scene' }), scene, table);
  }));
}
function renderArrival() {
  el('arrival').replaceChildren(...draft.arrival.map((entry, index) => {
    const id = make('input', { value: entry.channelId, inputMode: 'numeric', maxLength: 20, ariaLabel: `Channel ID ${index + 1}`, placeholder: 'Channel ID' });
    const note = make('input', { value: entry.note ?? '', maxLength: 120, ariaLabel: `Note for channel ${index + 1}`, placeholder: 'Note (optional)' });
    id.addEventListener('input', () => { draft.arrival[index].channelId = id.value.trim(); changed(); });
    note.addEventListener('input', () => {
      if (note.value.trim()) draft.arrival[index].note = note.value; else delete draft.arrival[index].note;
      changed();
    });
    const up = make('button', { type: 'button', textContent: 'Move up', disabled: index === 0 });
    up.addEventListener('click', () => { draft.arrival.splice(index - 1, 0, ...draft.arrival.splice(index, 1)); renderArrival(); changed(); });
    const remove = make('button', { type: 'button', textContent: 'Remove' });
    remove.addEventListener('click', () => { draft.arrival.splice(index, 1); renderArrival(); changed(); });
    return make('li', { className: 'arrival-row' }, id, note, up, remove);
  }));
}
async function load() {
  editor = await api.activityLayout();
  draft = structuredClone(editor.document); saved = JSON.stringify(draft); pending = null;
  renderStops(); renderArrival();
  notice(editor.version ? `Published layout · version ${editor.version}` : 'Using the shipped layout. Nothing has been published yet.');
}
async function checkAccess() {
  try {
    const session = await api.session();
    if (!session.canEditActivity) { phase = 'denied'; el('gate-title').textContent = 'Editing permission is required'; }
    else if (phase !== 'ready') { phase = 'ready'; if (!editor) await load(); }
  } catch (error) {
    if (error.kind === 'denied' || phase !== 'ready') { phase = 'signed-out'; el('gate-title').textContent = 'Sign in to edit the Activity layout'; el('signin').hidden = false; }
    else fail(error);
  } finally { controls(); }
}
el('add-channel').addEventListener('click', () => { draft.arrival.push({ channelId: '' }); renderArrival(); changed(); el('arrival').lastElementChild?.querySelector('input')?.focus(); });
el('publish').addEventListener('click', async () => {
  if (busy || phase !== 'ready') return;
  pending ??= { requestId: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''),
    expectedVersion: editor.version, document: structuredClone(draft) };
  busy = true; controls(); el('error').hidden = true;
  try {
    const result = await api.publishActivityLayout(pending);
    editor.version = result.version; editor.document = structuredClone(pending.document); saved = JSON.stringify(pending.document); pending = null;
    notice(`Layout published · version ${result.version}. New page turns in the Activity use it.`);
  } catch (error) { if (['invalid', 'conflict', 'denied'].includes(error.kind)) pending = null; fail(error); }
  finally { busy = false; controls(); }
});
el('reload').addEventListener('click', async () => {
  if (dirty() && !window.confirm('Discard your unpublished changes and reload the published layout?')) return;
  busy = true; controls(); try { await load(); el('error').hidden = true; } catch (error) { fail(error); } finally { busy = false; controls(); }
});
el('gate-retry').addEventListener('click', checkAccess);
el('logout').addEventListener('click', async () => { try { await api.logout(); phase = 'signed-out'; el('signin').hidden = false; controls(); } catch (error) { fail(error); } });
mountDashboardShell({ window, document, controller: { start: checkAccess, checkAccess, snapshot: () => ({ phase, busy, dirty: dirty(), pending }) } });
