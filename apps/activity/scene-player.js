import { SCENE_COLOURS, SCENE_LAYOUTS, composeScene, sceneAlt, validateScene } from '../../modules/onboarding/scenes.js';
import { createSceneCanvas } from './scene-canvas.js';

/**
 * Plays one scene at a time in a host element (P42). It picks the landscape or portrait grid from the host's shape,
 * draws at no more than 12 frames a second, and holds a still frame when motion is off or playback is paused
 * (hidden page, picture-in-picture, heat warning). Run state only chooses what is drawn; the door opens on screen
 * only after the server has reported Whitelist as confirmed.
 *
 * Every platform hook is injected so the player can run under test or in Discord's frame.
 */
export function createScenePlayer({ host, canvas, altElement, palette, background, font, clock, scheduler, observeSize, pixelRatio = () => 1, fps = 12 }) {
  const painter = createSceneCanvas(canvas, { palette, background, font });
  const paused = new Set();
  let scene = null, layout = 'landscape', state = {}, motion = true, frameHandle = null, lastDraw = -Infinity;
  let confirmedAt = null, size = { width: 0, height: 0 };
  const DOOR_SECONDS = 1.8;

  function chooseLayout() {
    const next = size.height > 0 && size.width / size.height < 1.05 ? 'portrait' : 'landscape';
    const grid = SCENE_LAYOUTS[next];
    layout = next;
    painter.resize(size.width, size.height, grid.cols, grid.rows, pixelRatio());
  }
  function doorOpen(now) {
    if (state.whitelist !== 'confirmed' || confirmedAt === null) return 0;
    if (!motion) return 1;
    const x = Math.min(1, Math.max(0, (now - confirmedAt) / DOOR_SECONDS));
    return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  }
  function render(now) {
    if (!scene || !size.width) return;
    const frame = composeScene(scene, layout, { time: now, motion: motion && paused.size === 0, state: { ...state, doorOpen: doorOpen(now) } });
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

  const stopObserving = observeSize(host, (width, height) => { size = { width, height }; chooseLayout(); wake(); });

  return {
    /** Shows a validated scene. */
    setScene(next) { scene = validateScene(next); wake(); this.refreshAlt(); },
    /** Updates run state from the server: stop, section and Whitelist status. */
    setState(next) {
      const was = state.whitelist;
      state = { ...state, ...next };
      if (state.whitelist === 'confirmed' && was !== 'confirmed') confirmedAt = clock();
      if (state.whitelist !== 'confirmed') confirmedAt = null;
      wake(); this.refreshAlt();
    },
    setMotion(on) { motion = Boolean(on); wake(); },
    /** Pauses animation for a reason (hidden, pip, thermal); a still frame stays on screen. */
    setPaused(reason, on) { if (on) paused.add(reason); else paused.delete(reason); wake(); },
    refreshAlt() { if (scene && altElement) altElement.textContent = sceneAlt(scene, state); },
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
  return player;
}
