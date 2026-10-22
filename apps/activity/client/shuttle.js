import { TEXT, dialogueControls, presence, sceneStateFor, soundscape, titleMenu, transmissionChunks } from './presenter.js';
import { parseMarkdown, plainText, renderMarkdown } from './markdown.js';

const SETTINGS_KEY = 'shuttle.settings.v1';
const DEFAULT_SETTINGS = Object.freeze({ levels: { music: 60, ambience: 70, radio: 80, effects: 80 }, sound: 'on', motion: 'system', text: 'typed', size: 'normal' });
const TYPE_CPS = 90, POLL_MS = 5_000, POLL_LIMIT_MS = 10 * 60_000, RETRY_AFTER_MS = 120_000;

/**
 * The Shuttle Activity's front end (P43): a title screen, Sophie's radio transmissions over the stop scenes, and the
 * arrival door. Every platform piece is passed in, so the same code runs in Discord's frame and in a local preview.
 * The server decides every state; this only shows it. The door opens only when the server reports Whitelist confirmed.
 */
export function createShuttle({ document, api, connect, player, loadScene, sound, storage, timers, reducedMotion = () => false }) {
  const $ = id => document.getElementById(id);
  const root = $('shuttle');
  let view = 'splash', described = null, run = null, chunks = [''], chunk = 0, busy = false, started = false, linked = false;
  let discord = null, typing = null, poll = null, pendingSince = null, toastTimer = null;
  let settings = loadSettings();

  function loadSettings() {
    try { const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null'); if (saved && typeof saved === 'object') return { ...DEFAULT_SETTINGS, ...saved, levels: { ...DEFAULT_SETTINGS.levels, ...saved.levels } }; }
    catch { /* Private window or blocked storage: defaults. */ }
    return structuredClone(DEFAULT_SETTINGS);
  }
  function saveSettings() { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Not essential. */ } }
  function applySettings() {
    for (const [group, value] of Object.entries(settings.levels)) {
      for (const target of group === 'effects' ? ['interface', 'scenes'] : [group]) sound.setLevel(target, value / 100);
    }
    sound.setMuted(settings.sound === 'off');
    const motion = settings.motion === 'system' ? !reducedMotion() : settings.motion === 'on';
    player.setMotion(motion); root.dataset.motion = motion ? 'on' : 'off'; root.dataset.textSize = settings.size;
  }

  function show(next) {
    view = next; root.dataset.view = next;
    for (const id of ['splash', 'title', 'radio']) $(id).hidden = id !== next;
  }
  function signal(state) {
    const element = $('signal'); element.dataset.state = state;
    element.textContent = state === 'linked' ? TEXT.linked : state === 'lost' ? TEXT.offline : TEXT.linking;
  }
  function toast(text, ms = 4_000) {
    const element = $('toast'); element.textContent = text; element.hidden = false;
    timers.clear(toastTimer); toastTimer = timers.after(ms, () => { element.hidden = true; });
  }
  async function scene(id, state) {
    try { player.setScene(await loadScene(id)); } catch { /* Keep the last scene; the copy still shows. */ }
    player.setState(state);
  }

  // Title screen ---------------------------------------------------------------------------------------------------
  async function showTitle() {
    stopPolling(); stopTyping(); show('title');
    const state = described?.state === 'run' ? sceneStateFor(described.run) : { whitelist: described?.whitelist ?? 'none', stopNumber: 0, stopCount: 0 };
    await scene('hangar-viewport', state);
    const sounds = soundscape('title'); sound.ambience(sounds.ambience); sound.music(sounds.music); sound.radio(false);
    renderMenu(); discord?.setPresence(presence(null));
  }
  function renderMenu() {
    const menu = titleMenu(described), list = $('menu');
    list.replaceChildren(...menu.items.map((item, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `menu-item${index === 0 && !['settings', 'credits'].includes(item.id) ? ' primary' : ''}`;
      button.textContent = item.label; button.dataset.action = item.id;
      button.addEventListener('click', () => choose(item.id));
      button.addEventListener('focus', () => sound.play('UI-01'));
      const entry = document.createElement('li'); entry.append(button); return entry;
    }));
    const notice = $('notice'), waiting = !described && started;
    notice.hidden = !(menu.notice || waiting); notice.textContent = menu.notice ?? (waiting ? TEXT.linking : '');
    if (view === 'title') list.querySelector('button')?.focus({ preventScroll: true });
  }
  async function choose(id) {
    if (busy) return;
    if (id === 'settings' || id === 'credits') { sound.play('UI-02'); openSheet(id); return; }
    if (id === 'board') {
      sound.play('UI-02');
      await guarded(async () => { const { run: next } = await api.board(); sound.play('SC-01'); await enterRun(next); });
      return;
    }
    if ((id === 'resume' || id === 'arrival') && described?.run) { sound.play('UI-02'); sound.play('SC-01'); await enterRun(described.run); }
  }

  // Sophie's radio -------------------------------------------------------------------------------------------------
  function sceneFor(next) {
    return next.status === 'pending' || next.status === 'boarded' ? 'pressure-door' : next.stops[next.stop]?.scene ?? 'departure-lounge';
  }
  async function enterRun(next, { atEnd = false } = {}) {
    const previous = run; run = next;
    chunks = transmissionChunks(run.pages); chunk = atEnd ? chunks.length - 1 : 0;
    show('radio');
    await scene(sceneFor(run), sceneStateFor(run, chunk, chunks.length));
    const sounds = soundscape('run', run); sound.music(sounds.music); sound.ambience(sounds.ambience); sound.radio(run.status === 'reading');
    if (!previous || previous.stop !== run.stop || previous.status !== run.status) sound.play('DLG-03');
    renderTransmission(); discord?.setPresence(presence(run));
    if (run.status === 'pending') startPolling(); else stopPolling();
    if (run.status === 'boarded' && run.whitelist === 'confirmed' && previous?.status !== 'boarded') {
      sound.play('SC-05'); timers.after(500, () => sound.play('SC-04'));
    }
  }
  function transmissionText() {
    if (run.status === 'reading') return chunks[chunk];
    if (run.status === 'pending') return pendingSince !== null && timers.now() - pendingSince > RETRY_AFTER_MS ? `${TEXT.pending}\n\n${TEXT.pendingLong}` : TEXT.pending;
    if (run.status === 'boarded') return run.whitelist === 'confirmed' ? (run.mode === 'refresh' ? TEXT.refreshed : TEXT.confirmed) : TEXT.pending;
    return TEXT.paused;
  }
  function renderTransmission() {
    stopTyping();
    const text = transmissionText(), tree = parseMarkdown(text), box = $('radio-text');
    box.replaceChildren(renderMarkdown(document, tree, { onLink: href => discord?.openLink(href) }));
    box.scrollTop = 0;
    $('radio-live').textContent = plainText(tree);
    $('radio-stop').textContent = run.status === 'reading' ? `Stop ${run.stop + 1}/${run.stops.length} · ${run.stops[run.stop].title}` : run.status === 'boarded' ? 'Arrived' : 'Clearance';
    $('radio-progress').textContent = run.status === 'reading' && chunks.length > 1 ? chunks.map((_, index) => index === chunk ? '■' : index < chunk ? '▪' : '□').join(' ') : '';
    player.setState(sceneStateFor(run, chunk, chunks.length));
    const controls = dialogueControls(run, chunk, chunks.length);
    const back = $('radio-back'), forward = $('radio-forward');
    back.disabled = busy || !controls.back.enabled; back.hidden = run.status !== 'reading';
    forward.disabled = busy || !controls.forward.enabled;
    forward.querySelector('span').textContent = controls.forward.label;
    if (run.status === 'reading' && settings.text === 'typed') typewrite(box);
  }
  function typewrite(box) {
    const walker = document.createTreeWalker(box, 4), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const texts = nodes.map(node => node.data);
    nodes.forEach(node => { node.data = ''; });
    let index = 0, offset = 0, lastTick = 0, last = timers.now();
    const finish = () => { nodes.forEach((node, i) => { node.data = texts[i]; }); timers.cancelFrame(typing?.frame); typing = null; };
    const step = () => {
      const now = timers.now();
      let budget = Math.max(1, Math.round((now - last) * TYPE_CPS / 1000)); last = now;
      while (budget > 0 && index < nodes.length) {
        const take = Math.min(budget, texts[index].length - offset);
        offset += take; budget -= take; nodes[index].data = texts[index].slice(0, offset);
        if (offset >= texts[index].length) { index++; offset = 0; }
      }
      if (now - lastTick > 70) { sound.play('DLG-01'); lastTick = now; }
      if (index >= nodes.length) { typing = null; return; }
      typing.frame = timers.frame(step);
    };
    typing = { finish, frame: timers.frame(step) };
  }
  function stopTyping() { typing?.finish(); }

  async function forward() {
    if (!run || busy) return;
    if (typing) { stopTyping(); return; }
    const { forward: control } = dialogueControls(run, chunk, chunks.length);
    if (!control.enabled) return;
    if (control.action === 'next-chunk') { chunk++; sound.play('DLG-02'); renderTransmission(); return; }
    if (control.action === 'check') { await check(true); return; }
    if (control.action === 'menu') { $('radio-menu').click(); return; }
    sound.play('DLG-04'); sound.play('UI-02');
    await act('advance');
  }
  async function back() {
    if (!run || busy) return;
    if (typing) stopTyping();
    const { back: control } = dialogueControls(run, chunk, chunks.length);
    if (!control.enabled) return;
    sound.play('UI-03');
    if (control.action === 'previous-chunk') { chunk--; renderTransmission(); return; }
    await act('back');
  }
  async function act(action) {
    await guarded(async () => {
      const before = run, { run: next } = await api.act(action, run.version);
      if (next.stop !== before.stop) sound.play('SC-01');
      if (next.status === 'pending' && before.status !== 'pending') pendingSince = timers.now();
      await enterRun(next, { atEnd: action === 'back' });
    });
  }

  // Clearance ------------------------------------------------------------------------------------------------------
  function startPolling() {
    if (poll !== null) return;
    pendingSince ??= timers.now();
    poll = timers.every(POLL_MS, () => { if (timers.now() - pendingSince > POLL_LIMIT_MS) stopPolling(); else check(false); });
  }
  function stopPolling() { if (poll !== null) timers.clear(poll); poll = null; }
  async function check(asked) {
    if (busy && asked) return;
    try {
      const latest = await api.describe();
      described = latest;
      if (latest.state === 'run' && latest.run.status === 'pending' && asked && timers.now() - pendingSince > RETRY_AFTER_MS) {
        await act('retry'); return;
      }
      if (latest.state === 'run') {
        if (latest.run.status !== run?.status || latest.run.whitelist !== run?.whitelist) await enterRun(latest.run);
        else if (asked) { sound.play('SC-06'); renderTransmission(); }
        return;
      }
      stopPolling(); await showTitle();
    } catch (error) { if (asked) failed(error); }
  }

  // Errors and guards ----------------------------------------------------------------------------------------------
  async function guarded(work) {
    busy = true; setBusy(true);
    try { await work(); } catch (error) { await failed(error); } finally { busy = false; setBusy(false); }
  }
  function setBusy(on) {
    for (const id of ['radio-back', 'radio-forward']) { const button = $(id); if (on) button.disabled = true; }
    if (!on && run && view === 'radio') renderTransmission();
  }
  async function failed(error) {
    const word = error?.word ?? 'failed';
    sound.play('UI-04');
    if (word === 'offline' || word === 'retry') { toast(TEXT.offline); return; }
    if (word === 'signin') { described = { state: 'signin' }; await showTitle(); return; }
    if (word === 'stale') toast(TEXT.stale);
    else if (word === 'failed' || word === 'invalid') toast(TEXT.failed);
    try { described = await api.describe(); } catch { described ??= { state: 'failed' }; }
    if (described.state === 'run' && view === 'radio') await enterRun(described.run); else await showTitle();
  }

  // Sheets and input -----------------------------------------------------------------------------------------------
  let sheetReturn = null;
  function openSheet(id) {
    sheetReturn = document.activeElement; $(id).hidden = false;
    if (id === 'settings') syncSettingsForm();
    $(id).querySelector('input, button, a')?.focus();
  }
  function closeSheets() {
    let closed = false;
    for (const id of ['settings', 'credits']) if (!$(id).hidden) { $(id).hidden = true; closed = true; }
    if (closed) { sound.play('UI-03'); sheetReturn?.focus?.(); }
    return closed;
  }
  function syncSettingsForm() {
    for (const input of $('settings').querySelectorAll('input[data-level]')) input.value = String(settings.levels[input.dataset.level]);
    for (const name of ['sound', 'motion', 'text', 'size']) {
      for (const input of $('settings').querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === settings[name];
    }
  }
  function bindSettings() {
    for (const input of $('settings').querySelectorAll('input[data-level]')) {
      input.addEventListener('input', () => { settings.levels[input.dataset.level] = Number(input.value); applySettings(); saveSettings(); });
    }
    for (const name of ['sound', 'motion', 'text', 'size']) {
      for (const input of $('settings').querySelectorAll(`input[name="${name}"]`)) {
        input.addEventListener('change', () => { if (!input.checked) return; settings[name] = input.value; applySettings(); saveSettings(); sound.play('UI-05'); });
      }
    }
    for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', closeSheets);
    for (const link of document.querySelectorAll('a[data-external]')) {
      link.addEventListener('click', event => { event.preventDefault(); discord?.openLink(link.href); });
    }
  }
  async function begin() {
    if (started) return;
    started = true;
    try { await sound.unlock(); } catch { /* Sound stays off; the Shuttle still works. */ }
    sound.preload(['UI-01', 'UI-02', 'UI-03', 'DLG-01', 'DLG-02', 'DLG-03', 'DLG-04', 'SC-01']);
    sound.play('UI-02');
    if (described?.state === 'run' && ['pending', 'boarded'].includes(described.run.status)) await enterRun(described.run);
    else await showTitle();
  }
  function bindInput() {
    $('splash').parentElement.addEventListener('pointerdown', () => { if (view === 'splash') begin(); });
    $('radio-forward').addEventListener('click', forward);
    $('radio-back').addEventListener('click', back);
    $('radio-text').addEventListener('click', event => { if (!event.target.closest('a') && typing) stopTyping(); });
    $('radio-menu').addEventListener('click', async () => { sound.play('UI-03'); try { described = await api.describe(); } catch { /* Keep the last state. */ } await showTitle(); });
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (view === 'splash') { begin(); return; }
      if (event.key === 'Escape') { if (!closeSheets() && view === 'radio') $('radio-menu').click(); return; }
      if (!$('settings').hidden || !$('credits').hidden) return;
      const onControl = event.target.closest?.('button, a, input');
      if (view === 'radio' && !onControl) {
        if (['ArrowRight', 'Enter', ' '].includes(event.key)) { event.preventDefault(); forward(); }
        if (['ArrowLeft', 'Backspace'].includes(event.key)) { event.preventDefault(); back(); }
      }
      if (view === 'title' && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        const items = [...$('menu').querySelectorAll('button')], at = items.indexOf(document.activeElement);
        items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); event.preventDefault();
      }
    });
    document.addEventListener('visibilitychange', () => sound.setHidden(document.hidden));
  }

  return Object.freeze({
    async start() {
      bindSettings(); bindInput(); applySettings(); signal('linking');
      $('press-text').textContent = TEXT.pressStart;
      await scene('hangar-viewport', { whitelist: 'none' });
      try {
        discord = await connect({ onLayout: mode => player.setPaused('pip', mode === 1), onThermal: state => player.setPaused('heat', state >= 2) });
        if (discord === null) { described = { state: 'outside' }; signal('lost'); }
        else { described = await api.describe(); linked = true; signal('linked'); }
      } catch (error) {
        described = { state: error?.word === 'closed' ? 'closed' : error?.word === 'signin' || error?.word === 'denied' ? 'signin' : 'failed' }; signal('lost');
      }
      if (view === 'title') await showTitle();
      else if (view === 'splash' && described?.state === 'run') player.setState(sceneStateFor(described.run));
    },
    setSignal: online => signal(online ? (linked ? 'linked' : 'linking') : 'lost'),
    get view() { return view; },
  });
}
