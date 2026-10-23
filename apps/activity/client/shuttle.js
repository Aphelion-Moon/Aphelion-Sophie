import { ANNOUNCEMENTS, CHUNK_LIMIT, CODEX, KEYS, READ_CPS, REVEAL_MAX_MS, TEXT, TIPS, TYPE_CPS, canResetJourney, cueEvent, pageProgress, cueSheet, dialogueControls, linkState, momentFor,
  presence, revealPoints, sceneStateFor, soundscape, speechMs, titleMenu, transmissionChunks, windowUser } from './presenter.js';
import { parseMarkdown, plainText, renderMarkdown } from './markdown.js';

const SETTINGS_KEY = 'shuttle.settings.v1';
const DEFAULT_SETTINGS = Object.freeze({ levels: { master: 100, music: 60, ambience: 70, radio: 80, effects: 80 }, sound: 'on', motion: 'system',
  text: 'typed', speed: 'normal', size: 'normal' });
const POLL_MS = 5_000, POLL_LIMIT_MS = 10 * 60_000, RETRY_AFTER_MS = 120_000;
// Text ticks, at most this often, sound only while Sophie speaks: briefly at each stage and page (owner feedback,
// 22 October 2026). The rest of the copy types out quietly.
const TICK_MS = 110, TRAIL_MS = 1_500, WIPE_MS = 400, BANNER_MS = 4_500, TIP_MS = 12_000, CLOWN_MS = 6_000, LOG_LIMIT = 80, SWIPE_PX = 60;
const KONAMI = Object.freeze(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']);
const SHEETS = Object.freeze(['settings', 'credits', 'codex', 'log', 'keys']);
/** Block elements the click-to-continue mark may sit inside, so it ends the last line of text. */
const BLOCKS = new Set(['P', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'DIV', 'SECTION', 'H1', 'H2', 'H3']);

/**
 * The Shuttle Activity's front end (P43): a title screen, Sophie's radio transmissions over the stop scenes, and the
 * arrival door. Every platform piece is passed in, so the same code runs in Discord's frame and in a local preview.
 * The server decides every state; this only shows it. The door opens only when the server reports Whitelist confirmed,
 * and arrival channels are only those core reported the member can see.
 */
export function createShuttle({ document, api, connect, player, loadScene, sound, storage, timers, viewscreens = null, reducedMotion = () => false,
  random = Math.random }) {
  const $ = id => document.getElementById(id);
  const root = $('shuttle');
  let view = 'splash', described = null, run = null, chunks = [''], chunk = 0, busy = false, started = false, linked = false;
  let discord = null, typing = null, poll = null, pendingSince = null, toastTimer = null, speechTimer = null, trailTimer = null, talking = false;
  let currentScene = null, cues = [], cueHandlers = {}, sectionScreen = null, statusScreen = null, showRadio = false, bannerTimer = null, transitTimer = null, tipTimer = null;
  let tip = Math.floor(random() * TIPS.length), konamiAt = 0, log = [], swipe = null, lastSwipe = -Infinity;
  // Text-synced moments reached on the page being read, and which page that is.
  let revealed = new Set(), revealPage = null;
  let settings = loadSettings();

  function loadSettings() {
    try {
      const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null');
      if (saved && typeof saved === 'object') return { ...DEFAULT_SETTINGS, ...saved, levels: { ...DEFAULT_SETTINGS.levels, ...saved.levels } };
    } catch { /* Private window or blocked storage: defaults. */ }
    return structuredClone(DEFAULT_SETTINGS);
  }
  function saveSettings() { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Not essential. */ } }
  const motionOn = () => settings.motion === 'system' ? !reducedMotion() : settings.motion === 'on';
  function applySettings() {
    for (const [group, value] of Object.entries(settings.levels)) {
      if (group === 'master') { sound.setMaster(value / 100); continue; }
      for (const target of group === 'effects' ? ['interface', 'scenes'] : [group]) sound.setLevel(target, value / 100);
    }
    sound.setMuted(settings.sound === 'off');
    const motion = motionOn();
    player.setMotion(motion); root.dataset.motion = motion ? 'on' : 'off'; root.dataset.textSize = settings.size;
  }

  function show(next) {
    view = next; root.dataset.view = next;
    for (const id of ['splash', 'title', 'radio']) $(id).hidden = id !== next;
    $('radio-menu').hidden = next !== 'radio';
    if (next !== 'radio') setStatus(null);
    if (next === 'radio') { timers.clear(tipTimer); tipTimer = null; }
    placeSlot();
  }
  /** Puts the splash prompt and the menu over the hangar's menu slot; without one they keep a corner of the stage. */
  function placeSlot() {
    const slot = $('slot'), canvas = $('scene'), rect = player.slotRect?.('menu') ?? null;
    if (!slot?.style) return;
    if (!rect || !canvas) {
      slot.dataset.fallback = '';
      for (const key of ['left', 'top', 'width', 'height']) slot.style[key] = '';
      // No window in the art, so no window title either.
      if ($('window-title')) $('window-title').hidden = true;
      return;
    }
    delete slot.dataset.fallback;
    slot.style.left = `${(canvas.offsetLeft ?? 0) + rect.left}px`; slot.style.top = `${(canvas.offsetTop ?? 0) + rect.top}px`;
    slot.style.width = `${rect.width}px`; slot.style.height = `${rect.height}px`;
    slot.style.setProperty?.('--cell', `${rect.cellHeight}px`);
    // The window's title, on the window's top edge.
    const title = $('window-title'), edge = player.slotRect?.('title') ?? null;
    if (!title?.style) return;
    title.hidden = edge === null;
    if (!edge) return;
    title.style.left = `${(canvas.offsetLeft ?? 0) + edge.left}px`; title.style.top = `${(canvas.offsetTop ?? 0) + edge.top}px`;
    title.style.width = `${edge.width}px`; title.style.height = `${edge.height}px`;
    title.style.setProperty?.('--cell', `${edge.cellHeight}px`);
  }
  /** The terminal greets the member by their Discord username (crew, when Discord did not say). Text only. */
  function setUser(name) {
    const element = $('window-user');
    if (element) element.textContent = windowUser(name);
  }
  function signal(state) {
    const element = $('signal'); element.dataset.state = state;
    element.textContent = state === 'linked' ? TEXT.linked : state === 'lost' ? TEXT.offline : TEXT.linking;
  }
  function toast(text, ms = 4_000) {
    const element = $('toast'); element.textContent = text; element.hidden = false;
    timers.clear(toastTimer); toastTimer = timers.after(ms, () => { element.hidden = true; });
  }
  function showTip() { for (const element of document.querySelectorAll('[data-tip]')) element.textContent = `${TEXT.tip}: ${TIPS[tip % TIPS.length]}`; }
  function rotateTips() {
    showTip(); timers.clear(tipTimer);
    tipTimer = timers.every(TIP_MS, () => { tip++; showTip(); });
  }
  async function scene(id, state) {
    try { player.setScene(await loadScene(id)); currentScene = id; } catch { /* Keep the last scene; the copy still shows. */ }
    player.setState(state);
  }
  /** A short static wipe between two scenes; the swap happens behind it. None with motion off. */
  function swapScene(id, loaded, state) {
    const swap = () => { if (loaded) { try { player.setScene(loaded); currentScene = id; } catch { /* Keep the last scene. */ } } player.setState(state()); };
    if (!loaded || id === currentScene || !motionOn()) { swap(); return; }
    const stage = $('stage'); stage.dataset.wipe = 'on';
    timers.after(WIPE_MS / 2, swap); timers.after(WIPE_MS, () => { delete stage.dataset.wipe; });
  }
  function banner(text) {
    if (!text) return;
    const element = $('banner'); element.textContent = text; element.hidden = false;
    timers.clear(bannerTimer); bannerTimer = timers.after(BANNER_MS, () => { element.hidden = true; });
  }

  // Cue sheets: sounds, scene changes and Sophie's radio filter in one after another ------------------------------------
  function runCues(steps, handlers = {}) {
    cancelCues(); cueHandlers = handlers;
    for (const step of steps) {
      const entry = { step, handle: null };
      entry.handle = timers.after(step.at, () => { cues = cues.filter(item => item !== entry); perform(step); });
      cues.push(entry);
    }
  }
  function cancelCues() { for (const entry of cues) timers.clear(entry.handle); cues = []; }
  function perform(step) {
    if (step.action === 'play') sound.play(step.value);
    else if (step.action === 'ambience') sound.ambience(step.value, step.fades);
    else if (step.action === 'music') sound.music(step.value, step.fades);
    else if (step.action === 'transit') showTransit(step.value);
    else if (step.action === 'speak') speakBriefly(step.value);
    else cueHandlers[step.action]?.();
  }
  /** Skipping ahead: the scene, the sound beds, Sophie and the text arrive now; one-shot sounds and the ride are dropped. */
  function flushCues() {
    const rest = cues; cancelCues(); hideTransit();
    for (const { step } of rest) if (step.action !== 'play' && step.action !== 'transit') perform(step);
  }
  const revealing = () => cues.some(entry => entry.step.action === 'reveal' || entry.step.action === 'transition');
  function showTransit(ms) {
    if (!run) return;
    $('transit-text').textContent = `${TEXT.transit} · Stop ${run.stop + 1}/${run.stops.length}`;
    $('transit').hidden = false;
    timers.clear(transitTimer); transitTimer = timers.after(ms, hideTransit);
  }
  function hideTransit() { timers.clear(transitTimer); transitTimer = null; $('transit').hidden = true; }

  // Title screen ---------------------------------------------------------------------------------------------------
  async function showTitle() {
    stopPolling(); stopTyping(); cancelCues(); hideTransit(); speaking(false); show('title'); run = null;
    const state = described?.state === 'run' ? sceneStateFor(described.run) : { whitelist: described?.whitelist ?? 'none', stopNumber: 0, stopCount: 0, beat: 'none' };
    await scene('hangar-viewport', { ...state, link: linkState(described) });
    runCues(cueSheet('title'));
    renderMenu(); rotateTips(); discord?.setPresence(presence(null));
  }
  function renderMenu() {
    const menu = titleMenu(described, { log: log.length > 0 }), list = $('menu');
    list.replaceChildren(...menu.items.map((item, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `menu-item${index === 0 && !SHEETS.includes(item.id) ? ' primary' : ''}`;
      // The terminal numbers its choices; the number is a key (1 to 9), not part of the name a screen reader says.
      const key = document.createElement('span'); key.className = 'menu-key'; key.setAttribute('aria-hidden', 'true'); key.textContent = `[${index + 1}]`;
      button.append(key, item.label); button.dataset.action = item.id;
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
    if (SHEETS.includes(id)) { sound.play('UI-02'); openSheet(id); return; }
    if (id === 'board') {
      sound.play('UI-02');
      await guarded(async () => { const { run: next } = await api.board(); log = []; await enterRun(next); });
      return;
    }
    if ((id === 'resume' || id === 'arrival') && described?.run) { sound.play('UI-02'); await enterRun(described.run); }
  }

  // Sophie's radio -------------------------------------------------------------------------------------------------
  function sceneFor(next) {
    return next.status === 'pending' || next.status === 'boarded' ? 'pressure-door' : next.stops[next.stop]?.scene ?? 'departure-lounge';
  }
  const momentNow = () => run?.status === 'reading' ? momentFor(chunks, chunk, run.moments ?? {}, revealed) : { beat: 'none', viewscreen: null, scene: null };
  /** The scene for what is on screen now: the section's own scene, if it has one, or the stop's. */
  const sceneNow = () => momentNow().scene ?? sceneFor(run);
  /** A page that opens a section with a scene of its own changes scene behind the usual wipe. */
  async function followScene() {
    const id = sceneNow();
    if (id === currentScene) return;
    let loaded = null; try { loaded = await loadScene(id); } catch { return; }
    if (sceneNow() !== id) return;
    // The new place sounds like itself and announces itself, as a new stop does.
    swapScene(id, loaded, stateNow); banner(ANNOUNCEMENTS[id]);
    sound.ambience(soundscape('run', run, id).ambience, { fadeIn: 2, previousFadeOut: 1.5 });
  }
  const stateNow = () => sceneStateFor(run, chunk, chunks, momentNow().beat, run.moments ?? {}, revealed);
  const pageNow = () => run ? `${run.stop}:${run.status}:${chunk}` : null;
  /**
   * A text-synced moment: the scene stages it when the reader reaches its phrase, as a visual novel stages an event on
   * the line that describes it. Only for the page that asked; a page already left stages nothing.
   */
  function reveal(key, page) {
    if (page !== pageNow() || revealed.has(key)) return;
    revealed.add(key); player.setState(stateNow()); followScene();
  }
  /**
   * Shows a run from the server. A new stop, clearance or arrival plays its cue sheet: the scene changes behind a wipe
   * (after the ride between stops, when motion is on), the sound beds cross-fade, then Sophie comes in with the text.
   */
  async function enterRun(next, { atEnd = false } = {}) {
    const previous = run; run = next;
    chunks = transmissionChunks(run.pages, CHUNK_LIMIT, run.moments ?? {}); chunk = atEnd ? chunks.length - 1 : 0;
    const event = cueEvent(previous, run), sceneId = sceneNow();
    show('radio'); discord?.setPresence(presence(run));
    if (run.status === 'pending') startPolling(); else stopPolling();
    preloadAhead();
    if (event === null) { await scene(sceneId, stateNow()); renderTransmission(); return; }
    sectionScreen = null; showRadio = false; holdTransmission();
    const loaded = loadScene(sceneId).catch(() => null);
    const transit = event === 'stop' && previous?.status === 'reading' && run.stop > previous.stop && motionOn();
    runCues(cueSheet(event, run, { transit, speech: speechFor(), scene: sceneId }), {
      transition: async () => { swapScene(sceneId, await loaded, stateNow); if (event === 'stop') banner(ANNOUNCEMENTS[sceneId]); },
      reveal: renderTransmission,
    });
  }
  function preloadAhead() {
    const following = run.stops[run.stop + 1];
    if (run.status === 'reading') loadScene(following?.scene ?? 'pressure-door').catch(() => {});
    for (const moment of Object.values(run.moments ?? {})) if (moment.scene) loadScene(moment.scene).catch(() => {});
    if (following) { const { ambience } = soundscape('run', { ...run, stop: run.stop + 1 }); if (ambience) sound.preload([ambience]); }
    if (run.stop >= run.stops.length - 1) sound.preload(['SC-04', 'SC-05', 'AMB-06', 'MUS-02']);
    for (const id of new Set([sceneNow(), following?.scene, ...Object.values(run.moments ?? {}).map(moment => moment.scene)])) if (id) preloadSceneSounds(id);
  }
  /** A scene's own sounds (the THUMP, the shutter) come with it, so the first one plays on its moment. */
  function preloadSceneSounds(id) {
    loadScene(id).then(loaded => sound.preload([...new Set(Object.values(loaded.layouts)
      .flatMap(layout => layout.effects.filter(fx => fx.kind === 'cue').map(fx => fx.cue)))])).catch(() => {});
  }
  function transmissionText() {
    if (run.status === 'reading') return chunks[chunk];
    if (run.status === 'pending') {
      return `${pendingSince !== null && timers.now() - pendingSince > RETRY_AFTER_MS ? `${TEXT.pending}\n\n${TEXT.pendingLong}` : TEXT.pending}\n\n-# ${TEXT.hop}`;
    }
    if (run.status === 'boarded') return run.whitelist === 'confirmed' ? (run.mode === 'refresh' ? TEXT.refreshed : TEXT.confirmed) : TEXT.pending;
    return TEXT.paused;
  }
  function header() {
    $('radio-stop').textContent = run.status === 'reading' ? `Stop ${run.stop + 1}/${run.stops.length} · ${run.stops[run.stop].title}` : run.status === 'boarded' ? 'Arrived' : 'Clearance';
  }
  /** The radio before Sophie comes in: the stop is known, the text is still on its way. */
  function holdTransmission() {
    stopTyping();
    const waiting = document.createElement('p'); waiting.className = 'receiving'; waiting.textContent = TEXT.receiving;
    $('radio-text').replaceChildren(waiting); $('radio-live').textContent = ''; $('radio-page').textContent = ''; $('radio-progress').textContent = '';
    $('arrival').hidden = true; setStatus(null);
    header(); renderControls();
  }
  function renderTransmission() {
    stopTyping();
    // A new page starts with none of its text-synced moments reached.
    if (pageNow() !== revealPage) { revealPage = pageNow(); revealed = new Set(); }
    const moment = momentNow(), text = transmissionText(), tree = parseMarkdown(text), box = $('radio-text'), channels = run.channels ?? {};
    box.replaceChildren(renderMarkdown(document, tree, { onLink: href => discord?.openLink(href), channels, onChannel: openChannel }));
    box.scrollTop = 0;
    const plain = plainText(tree, channels), page = pageNow();
    $('radio-live').textContent = plain;
    const points = run.status === 'reading' ? revealPoints(chunks[chunk], plain, run.moments ?? {}).filter(point => !revealed.has(point.key)) : [];
    header();
    const progress = pageProgress(chunk, chunks.length, run.status === 'reading');
    $('radio-page').textContent = progress.counter; $('radio-progress').textContent = progress.dots;
    player.setState(stateNow());
    followScene();
    renderArrival();
    // A new section's extra material replaces the radio in the status window; V switches back for that section.
    if (moment.viewscreen !== sectionScreen) { sectionScreen = moment.viewscreen; showRadio = false; }
    setStatus(showRadio ? null : moment.viewscreen);
    if (run.status === 'reading') remember();
    renderControls();
    if (run.status === 'reading' && settings.text === 'typed') typewrite(box, points, page);
    else {
      // Shown all at once: each phrase is staged after the time it takes to read up to it.
      for (const point of points) timers.after(Math.min(REVEAL_MAX_MS, (point.at / READ_CPS) * 1000), () => reveal(point.key, page));
      markDone(box);
    }
  }
  /** The click-to-continue mark: the page has finished typing. Decorative; the live region already has the text. */
  function markDone(box) {
    const mark = document.createElement('span'); mark.className = 'ctc'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '▼';
    let host = box;
    while (host.lastElementChild && BLOCKS.has(host.lastElementChild.tagName)) host = host.lastElementChild;
    host.append(mark);
  }
  /** After confirmation: the channels core reported the member can now see, as links into Discord. */
  function renderArrival() {
    const section = $('arrival'), arrived = run.status === 'boarded' && run.whitelist === 'confirmed';
    section.hidden = !arrived;
    if (!arrived) return;
    $('arrival-heading').textContent = TEXT.arrival;
    const list = (run.arrival ?? []).map(channel => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'arrival-card';
      const name = document.createElement('span'); name.className = 'arrival-name'; name.textContent = `#${channel.name}`; button.append(name);
      if (channel.note) { const note = document.createElement('span'); note.className = 'arrival-note'; note.textContent = channel.note; button.append(note); }
      button.addEventListener('click', () => openChannel(channel));
      const item = document.createElement('li'); item.append(button); return item;
    });
    if (!list.length) { const none = document.createElement('li'); none.className = 'arrival-none'; none.textContent = TEXT.arrivalNone; list.push(none); }
    $('arrival-list').replaceChildren(...list);
  }
  async function openChannel(channel) {
    sound.play('UI-02');
    const opened = discord?.guildId ? await discord.openLink(`https://discord.com/channels/${discord.guildId}/${channel.id}`) : false;
    if (!opened) toast(TEXT.findChannel.replace('{name}', `#${channel.name}`));
  }
  function renderControls() {
    const controls = dialogueControls(run, chunk, chunks.length);
    const back = $('radio-back'), forward = $('radio-forward');
    back.disabled = busy || !controls.back.enabled; back.hidden = run.status !== 'reading';
    forward.disabled = busy || !controls.forward.enabled;
    forward.querySelector('span').textContent = controls.forward.label;
  }
  /**
   * Sophie's radio: the static, the RX lamp and voice meter, the text ticks and the music ducking under her. When she
   * stops, the meter shrinks over the same trail-off as the static, then stands by.
   */
  function speaking(on) {
    timers.clear(speechTimer); speechTimer = null; timers.clear(trailTimer); trailTimer = null;
    const was = talking; talking = on;
    root.dataset.speaking = on ? 'on' : was ? 'trailing' : 'off'; $('status-state').textContent = on || was ? TEXT.transmitting : TEXT.standby;
    if (!on && was) trailTimer = timers.after(TRAIL_MS, () => { root.dataset.speaking = 'off'; $('status-state').textContent = TEXT.standby; });
    sound.radio(on); sound.duck(on);
  }
  function speakBriefly(ms) { speaking(true); speechTimer = timers.after(ms, () => speaking(false)); }
  function typewrite(box, points = [], page = pageNow()) {
    const walker = document.createTreeWalker(box, 4), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const texts = nodes.map(node => node.data), cps = TYPE_CPS[settings.speed] ?? TYPE_CPS.normal;
    nodes.forEach(node => { node.data = ''; });
    let index = 0, offset = 0, lastTick = 0, last = timers.now(), typed = 0, next = 0;
    // Text-synced moments fire as the typing reaches their phrase; skipping the typing reaches them all.
    const reach = upTo => { while (next < points.length && points[next].at <= upTo) reveal(points[next++].key, page); };
    const finish = () => { nodes.forEach((node, i) => { node.data = texts[i]; }); timers.cancelFrame(typing?.frame); typing = null; reach(Infinity); markDone(box); };
    const step = () => {
      const now = timers.now();
      let budget = Math.max(1, Math.round((now - last) * cps / 1000)); last = now;
      while (budget > 0 && index < nodes.length) {
        const take = Math.min(budget, texts[index].length - offset);
        offset += take; budget -= take; typed += take; nodes[index].data = texts[index].slice(0, offset);
        if (offset >= texts[index].length) { index++; offset = 0; }
      }
      if (talking && now - lastTick > TICK_MS) { sound.play('DLG-01'); lastTick = now; }
      reach(typed);
      if (index >= nodes.length) { typing = null; reach(Infinity); markDone(box); return; }
      typing.frame = timers.frame(step);
    };
    typing = { finish, frame: timers.frame(step) };
  }
  function stopTyping() { typing?.finish(); }
  /** The station log keeps each transmission of this run once, for re-reading from the title screen. */
  function remember() {
    const key = `${run.stop}:${chunk}`;
    if (log.some(entry => entry.key === key)) return;
    log.push({ key, title: `Stop ${run.stop + 1} · ${run.stops[run.stop].title}`, text: chunks[chunk] });
    if (log.length > LOG_LIMIT) log.shift();
  }

  /** A page within a stop: the page sound, then Sophie briefly with the new text. */
  function turnPage(next) {
    chunk = next; stopTyping();
    runCues(cueSheet('page', run, { speech: speechFor() }), { reveal: renderTransmission });
  }
  /** Sophie speaks for a time tied to what is on screen: half its typing time at the member's speed, 2 to 6 seconds. */
  const speechFor = () => speechMs(transmissionText(), settings.text === 'instant' ? 'normal' : settings.speed);
  async function forward() {
    if (!run || busy) return;
    if (revealing()) { flushCues(); return; }
    if (typing) { stopTyping(); return; }
    const { forward: control } = dialogueControls(run, chunk, chunks.length);
    if (!control.enabled) return;
    if (control.action === 'next-chunk') { turnPage(chunk + 1); return; }
    if (control.action === 'check') { await check(true); return; }
    if (control.action === 'menu') { $('radio-menu').click(); return; }
    sound.play('DLG-04'); sound.play('UI-02');
    await act('advance');
  }
  async function back() {
    if (!run || busy) return;
    if (revealing()) flushCues();
    if (typing) stopTyping();
    const { back: control } = dialogueControls(run, chunk, chunks.length);
    if (!control.enabled) return;
    if (control.action === 'previous-chunk') { turnPage(chunk - 1); return; }
    sound.play('UI-03');
    await act('back');
  }
  async function act(action) {
    await guarded(async () => {
      const before = run, { run: next } = await api.act(action, run.version);
      if (next.status === 'pending' && before.status !== 'pending') pendingSince = timers.now();
      await enterRun(next, { atEnd: action === 'back' });
    });
  }

  // Status window: Sophie's radio standing by, or the art and links of the section being read --------------------------
  function setStatus(id) {
    if (id !== null && id === statusScreen) return;
    statusScreen = id;
    if (id === null || !viewscreens) { $('viewscreen').hidden = true; renderStandby(); return; }
    openViewscreen(id);
  }
  /** Standing by: Sophie's radio, or at the last stop and on arrival the member's own boarding pass when core sent it. */
  function renderStandby() {
    const pass = view === 'radio' && run?.pass && (run.status !== 'reading' || run.stop === run.stops.length - 1) ? run.pass : null;
    $('status-radio').hidden = pass !== null; $('status-pass').hidden = pass === null;
    if (!pass) return;
    $('pass-name').textContent = pass.name;
    $('pass-since').textContent = pass.joined
      ? TEXT.aboardSince.replace('{date}', new Date(`${pass.joined}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })) : '';
    $('pass-access').textContent = TEXT.passAccess[run.whitelist] ?? TEXT.passAccess.none;
    $('status-pass').dataset.access = run.whitelist;
  }
  async function openViewscreen(id, { quiet = false } = {}) {
    let screen;
    try { screen = await viewscreens.load(id); } catch { statusScreen = null; return; }
    if (statusScreen !== id) return;
    $('viewscreen-title').textContent = screen.title; $('viewscreen-alt').textContent = screen.alt;
    $('viewscreen-links').replaceChildren(...screen.links.map(link => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'viewscreen-link';
      const label = document.createElement('span'); label.textContent = link.label;
      const host = document.createElement('span'); host.className = 'viewscreen-host'; host.textContent = new URL(link.url).host;
      button.append(label, host); button.addEventListener('click', () => { sound.play('UI-02'); discord?.openLink(link.url); });
      const item = document.createElement('li'); item.append(button); return item;
    }));
    $('status-radio').hidden = true; $('status-pass').hidden = true; $('viewscreen').hidden = false;
    paintScreen(screen);
    if (!quiet) sound.play('SC-03');
  }
  /** The art fills what the fixed status window leaves after the title and links. */
  function paintScreen(screen) {
    const box = $('viewscreen-box'); box.hidden = true;
    const room = $('status-body').clientHeight - $('viewscreen').getBoundingClientRect().height - 6;
    box.hidden = false;
    viewscreens.paint(screen, { maxHeight: Math.max(48, room) });
  }
  function toggleStatus() {
    const { viewscreen } = momentNow();
    if (!viewscreen) return;
    showRadio = !showRadio; sound.play(showRadio ? 'UI-03' : 'UI-02');
    setStatus(showRadio ? null : viewscreen);
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
    // Only the buttons change; re-rendering would type the same transmission out again.
    if (!on && run && view === 'radio') renderControls();
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

  // Sheets, easter eggs and input ----------------------------------------------------------------------------------
  let sheetReturn = null;
  /**
   * A sheet opens at its top with its panel focused, not its first control: focusing the Glossary's only button (Close,
   * at the bottom) scrolled phones to the end of the list (owner's mobile audit, 24 October 2026). Tab still reaches the
   * close button in the header first.
   */
  function openSheet(id) {
    sheetReturn = document.activeElement; $(id).hidden = false;
    if (id === 'settings') syncSettingsForm();
    if (id === 'log') renderLog();
    const panel = $(id).querySelector('.sheet-panel'), body = $(id).querySelector('.sheet-body');
    if (body) body.scrollTop = 0;
    panel?.focus?.({ preventScroll: true });
  }
  function closeSheets() {
    let closed = false;
    for (const id of SHEETS) if (!$(id).hidden) { $(id).hidden = true; closed = true; }
    if (closed) { sound.play('UI-03'); sheetReturn?.focus?.(); }
    return closed;
  }
  function renderLog() {
    const entries = log.map(entry => {
      const item = document.createElement('li'), title = document.createElement('h3');
      title.className = 'log-title'; title.textContent = entry.title;
      item.append(title, renderMarkdown(document, parseMarkdown(entry.text), { onLink: href => discord?.openLink(href) }));
      return item;
    });
    if (!entries.length) { const none = document.createElement('li'); none.textContent = TEXT.logEmpty; entries.push(none); }
    $('log-list').replaceChildren(...entries);
  }
  function definitions(list, pairs) {
    $(list).replaceChildren(...pairs.flatMap(([term, text]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = term; dd.textContent = text; return [dt, dd];
    }));
  }
  function konami(key) {
    const got = key.length === 1 ? key.toLowerCase() : key;
    konamiAt = got === KONAMI[konamiAt] ? konamiAt + 1 : got === 'ArrowUp' ? (konamiAt === 2 ? 2 : 1) : 0;
    if (konamiAt < KONAMI.length) return;
    konamiAt = 0;
    if (!motionOn()) { toast(TEXT.honk, 2_000); return; }
    const car = $('clown'); car.hidden = false;
    timers.after(CLOWN_MS, () => { car.hidden = true; });
  }
  // Reset journey asks once, then clears the run on the second press; opening Settings again starts unasked.
  let resetArmed = false;
  function syncReset(note = '') {
    const button = $('reset-journey'), can = canResetJourney(described);
    button.disabled = !can || busy; button.textContent = resetArmed && can ? TEXT.resetConfirm : TEXT.resetJourney;
    $('reset-note').textContent = note || (resetArmed && can ? TEXT.resetAsk : can ? '' : TEXT.resetNone);
  }
  async function resetJourney() {
    if (busy || !canResetJourney(described)) return;
    if (!resetArmed) { resetArmed = true; sound.play('UI-02'); syncReset(); return; }
    resetArmed = false;
    await guarded(async () => {
      const { reset } = await api.reset();
      described = await api.describe(); log = [];
      syncReset(reset ? TEXT.resetDone : TEXT.resetNone);
      if (view === 'radio') { closeSheets(); await showTitle(); } else renderMenu();
    });
    syncReset($('reset-note').textContent);
  }
  function syncSettingsForm() {
    resetArmed = false; syncReset();
    for (const input of $('settings').querySelectorAll('input[data-level]')) input.value = String(settings.levels[input.dataset.level]);
    for (const name of ['sound', 'motion', 'text', 'speed', 'size']) {
      for (const input of $('settings').querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === settings[name];
    }
  }
  function bindSettings() {
    for (const input of $('settings').querySelectorAll('input[data-level]')) {
      input.addEventListener('input', () => { settings.levels[input.dataset.level] = Number(input.value); applySettings(); saveSettings(); });
    }
    for (const name of ['sound', 'motion', 'text', 'speed', 'size']) {
      for (const input of $('settings').querySelectorAll(`input[name="${name}"]`)) {
        input.addEventListener('change', () => { if (!input.checked) return; settings[name] = input.value; applySettings(); saveSettings(); sound.play('UI-05'); });
      }
    }
    $('reset-journey').addEventListener('click', () => { void resetJourney(); });
    for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', closeSheets);
    // A tap on the dimmed backdrop around a sheet closes it, as on a phone's own sheets.
    for (const id of SHEETS) $(id).addEventListener('click', event => { if (event.target === event.currentTarget) closeSheets(); });
    for (const link of document.querySelectorAll('a[data-external]')) {
      link.addEventListener('click', event => { event.preventDefault(); discord?.openLink(link.href); });
    }
  }
  async function begin() {
    if (started) return;
    started = true;
    try { await sound.unlock(); } catch { /* Sound stays off; the Shuttle still works. */ }
    sound.preload(['UI-01', 'UI-02', 'UI-03', 'DLG-01', 'DLG-02', 'DLG-03', 'DLG-04', 'SC-01', 'SC-02', 'SC-03']);
    sound.play('UI-02');
    if (described?.state === 'run' && ['pending', 'boarded'].includes(described.run.status)) await enterRun(described.run);
    else await showTitle();
  }
  function bindInput() {
    root.addEventListener('pointerdown', () => { if (view === 'splash') begin(); });
    $('radio-forward').addEventListener('click', forward);
    $('radio-back').addEventListener('click', back);
    $('radio-text').addEventListener('click', event => {
      if (event.target.closest('a, button') || timers.now() - lastSwipe < 400) return;
      if (revealing()) flushCues(); else if (typing) stopTyping();
    });
    $('transit').addEventListener('click', flushCues);
    $('radio-menu').addEventListener('click', async () => { sound.play('UI-03'); try { described = await api.describe(); } catch { /* Keep the last state. */ } await showTitle(); });
    // Swipe left for the next page, right for the previous one (touch and pen; a mouse uses the buttons).
    $('radio').addEventListener('pointerdown', event => { swipe = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY }; });
    $('radio').addEventListener('pointerup', event => {
      if (!swipe) return;
      const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y; swipe = null;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx) / 2 || event.target.closest('button, a')) return;
      lastSwipe = timers.now();
      if (dx < 0) forward(); else back();
    });
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      konami(event.key);
      // The key that leaves the splash must not also press the title menu's first item.
      if (view === 'splash') { event.preventDefault(); begin(); return; }
      if (event.key === 'Escape') { if (!closeSheets() && view === 'radio') $('radio-menu').click(); return; }
      if (SHEETS.some(id => !$(id).hidden)) return;
      if (event.key === '?') { sound.play('UI-02'); openSheet('keys'); return; }
      const onControl = event.target.closest?.('button, a, input');
      if (['l', 'L'].includes(event.key) && log.length) { sound.play('UI-02'); openSheet('log'); return; }
      if (view === 'radio' && !onControl) {
        if (['ArrowRight', 'Enter', ' '].includes(event.key)) { event.preventDefault(); forward(); }
        if (['ArrowLeft', 'Backspace'].includes(event.key)) { event.preventDefault(); back(); }
        if (['v', 'V'].includes(event.key)) toggleStatus();
      }
      if (view === 'title' && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        const items = [...$('menu').querySelectorAll('button')], at = items.indexOf(document.activeElement);
        items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); event.preventDefault();
      }
      // The terminal's numbers: 1 to 9 pick that choice.
      if (view === 'title' && /^[1-9]$/.test(event.key)) {
        const item = $('menu').querySelectorAll('button')[Number(event.key) - 1];
        if (item) { event.preventDefault(); item.focus(); item.click(); }
      }
    });
    document.addEventListener('visibilitychange', () => sound.setHidden(document.hidden));
    // A resized or rotated window repaints the status window's art to its new room.
    let resizing = null;
    globalThis.addEventListener?.('resize', () => {
      timers.clear(resizing);
      resizing = timers.after(200, () => { if (statusScreen && viewscreens) viewscreens.load(statusScreen).then(paintScreen, () => {}); });
    });
  }

  return Object.freeze({
    async start() {
      bindSettings(); bindInput(); applySettings(); signal('linking'); showTip();
      // Scenes play their own moments (the THUMP, the shutter) through the soundboard; a missing sound plays nothing.
      player.setCueHandler?.(cue => sound.play(cue));
      // The menu lives in the hangar's art: it follows the scene's slot whenever the grid or the scene changes.
      player.setLayoutHandler?.(placeSlot);
      definitions('codex-list', CODEX); definitions('keys-list', KEYS);
      $('press-text').textContent = TEXT.pressStart; $('status-title').textContent = TEXT.radio; $('status-state').textContent = TEXT.standby;
      $('transit-skip').textContent = TEXT.skip; $('pass-kicker').textContent = TEXT.pass;
      await scene('hangar-viewport', { whitelist: 'none', link: 'none' });
      try {
        discord = await connect({ onLayout: mode => player.setPaused('pip', mode === 1), onThermal: state => player.setPaused('heat', state >= 2) });
        setUser(discord?.name);
        if (discord === null) { described = { state: 'outside' }; signal('lost'); }
        else { described = await api.describe(); linked = true; signal('linked'); }
      } catch (error) {
        described = { state: error?.word === 'closed' ? 'closed' : error?.word === 'signin' || error?.word === 'denied' ? 'signin' : 'failed' }; signal('lost');
      }
      if (view === 'title') await showTitle();
      else if (view === 'splash') player.setState({ ...(described?.state === 'run' ? sceneStateFor(described.run) : {}), link: linkState(described) });
    },
    setSignal: online => signal(online ? (linked ? 'linked' : 'linking') : 'lost'),
    get view() { return view; },
  });
}
