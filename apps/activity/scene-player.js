import { SCENE_COLOURS, SCENE_LAYOUTS, composeScene, sceneAlt, sceneCues, validateScene } from '../../modules/onboarding/scenes.js';
import { createSceneCanvas } from './scene-canvas.js';

/**
 * Plays one scene at a time in a host element (P42). It picks the landscape or portrait grid from the host's shape,
 * draws at no more than 12 frames a second, and holds a still frame when motion is off or playback is paused
 * (hidden page, picture-in-picture, heat warning). Run state only chooses what is drawn; the door opens on screen
 * only after the server has reported Whitelist as confirmed.
 *
 * Every platform hook is injected so the player can run under test or in Discord's frame.
 */
export function createScenePlayer({ host, canvas, altElement, palette, background, font, clock, scheduler, observeSize, pixelRatio = () => 1, fps = 12, onCue: cueHandler = null, onLayout: layoutHandler = null }) {
  const painter = createSceneCanvas(canvas, { palette, background, font });
  const paused = new Set();
  let scene = null, layout = 'landscape', state = {}, motion = true, frameHandle = null, lastDraw = -Infinity, geometry = null;
  let confirmedAt = null, beatAt = 0, cueClock = -1, cueTime = null, onCue = cueHandler, onLayout = layoutHandler, size = { width: 0, height: 0 };
  const DOOR_SECONDS = 1.8;

  function chooseLayout() {
    const next = size.height > 0 && size.width / size.height < 1.05 ? 'portrait' : 'landscape';
    const grid = SCENE_LAYOUTS[next];
    layout = next;
    geometry = painter.resize(size.width, size.height, grid.cols, grid.rows, pixelRatio());
  }
  // The page lays its own controls over a scene's slots, so it hears whenever the grid or the scene changes.
  const layoutChanged = () => { try { onLayout?.(); } catch { /* A page handler never stops playback. */ } };
  function doorOpen(now) {
    if (state.whitelist !== 'confirmed' || confirmedAt === null) return 0;
    if (!motion) return 1;
    const x = Math.min(1, Math.max(0, (now - confirmedAt) / DOOR_SECONDS));
    return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  }
  function render(now) {
    if (!scene || !size.width) return;
    // People who walk in and talk keep their own clock, from the moment the section (beat) or scene began.
    const beatTime = Math.max(0, now - beatAt), animating = motion && paused.size === 0;
    const frame = composeScene(scene, layout, { time: now, beatTime, motion: animating, state: { ...state, doorOpen: doorOpen(now) } });
    // A scene's sounds play as the section's clock passes them, only while animating; time spent paused skips them.
    if (onCue && animating && cueTime !== null) for (const cue of sceneCues(scene, layout, { from: cueTime, to: now, beatFrom: cueClock, beatTo: beatTime, state })) onCue(cue);
    cueClock = beatTime; cueTime = now;
    painter.draw(frame, SCENE_COLOURS);
    lastDraw = now;
  }
  function tick() {
    frameHandle = null;
    const now = clock();
    const animating = motion && paused.size === 0;
    const opening = state.whitelist === 'confirmed' && confirmedAt !== null && now - confirmedAt < DOOR_SECONDS && motion;
    if (now - lastDraw >= 1 / fps) render(now);
    if (animating || opening) frameHandle = scheduler.request(tick);
  }
  function wake() { painter.invalidate(); lastDraw = -Infinity; if (frameHandle === null) frameHandle = scheduler.request(tick); }

  const stopObserving = observeSize(host, (width, height) => { size = { width, height }; chooseLayout(); wake(); layoutChanged(); });

  return {
    /** Shows a validated scene. */
    setScene(next) { scene = validateScene(next); beatAt = clock(); cueClock = -1; cueTime = null; wake(); this.refreshAlt(); layoutChanged(); },
    /** A named slot of the scene on screen, in CSS pixels from the canvas's top-left corner; null when it has none. */
    slotRect(name) {
      const slot = scene?.layouts[layout]?.slots?.[name];
      if (!slot || !geometry) return null;
      const ratio = pixelRatio(), cellWidth = geometry.cellW / ratio, cellHeight = geometry.cellH / ratio, [x, y, w, h] = slot;
      return { left: x * cellWidth, top: y * cellHeight, width: w * cellWidth, height: h * cellHeight, cellWidth, cellHeight };
    },
    /** Where the page's slot positioning goes; null for none. */
    setLayoutHandler(handler) { onLayout = typeof handler === 'function' ? handler : null; },
    /** Updates run state from the server: stop, section and Whitelist status. */
    setState(next) {
      const was = state.whitelist, wasBeat = state.beat;
      state = { ...state, ...next };
      if (state.beat !== wasBeat) { beatAt = clock(); cueClock = -1; }
      if (state.whitelist === 'confirmed' && was !== 'confirmed') confirmedAt = clock();
      if (state.whitelist !== 'confirmed') confirmedAt = null;
      wake(); this.refreshAlt();
    },
    setMotion(on) { motion = Boolean(on); wake(); },
    /** Where the scene's own sound cues go (the soundboard); null plays none. */
    setCueHandler(handler) { onCue = typeof handler === 'function' ? handler : null; },
    /** Pauses animation for a reason (hidden, pip, thermal); a still frame stays on screen. */
    setPaused(reason, on) { if (on) paused.add(reason); else paused.delete(reason); wake(); },
    refreshAlt() { if (scene && altElement) altElement.textContent = sceneAlt(scene, state); },
    /** Call once the scene font has loaded, so glyphs are measured against it rather than a fallback. */
    fontReady() { painter.fontChanged(); wake(); },
    get layout() { return layout; },
    destroy() { if (frameHandle !== null) scheduler.cancel(frameHandle); frameHandle = null; stopObserving(); },
  };
}

/** Browser wiring for createScenePlayer: real clock, animation frames, resize observation and reduced motion. */
export function browserScenePlayer({ host, canvas, altElement, palette, background, font }) {
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const player = createScenePlayer({
    host, canvas, altElement, palette, background, font,
    clock: () => performance.now() / 1000,
    scheduler: { request: fn => requestAnimationFrame(fn), cancel: id => cancelAnimationFrame(id) },
    pixelRatio: () => Math.min(2, globalThis.devicePixelRatio || 1),
    observeSize(element, callback) {
      const observer = new ResizeObserver(([entry]) => callback(entry.contentRect.width, entry.contentRect.height));
      observer.observe(element);
      return () => observer.disconnect();
    },
  });
  player.setMotion(!reduce?.matches);
  reduce?.addEventListener?.('change', event => player.setMotion(!event.matches));
  document.addEventListener('visibilitychange', () => player.setPaused('hidden', document.hidden));
  document.fonts?.load?.('16px Cozette').then(() => player.fontReady(), () => {});
  return player;
}
