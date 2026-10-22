import { SCENE_COLOURS } from '../../../modules/onboarding/scenes.js';
import { validateViewscreen } from '../../../modules/onboarding/activity-media.js';
import { createSceneCanvas } from '../scene-canvas.js';

/** A viewscreen's art as a scene frame: rows padded to the widest one, blank colour cells drawn dim. */
export function viewscreenFrame(screen) {
  const rows = screen.art.text.map(row => [...row]), keys = screen.art.colours.map(row => [...row].map(key => key === ' ' ? '.' : key));
  const cols = Math.max(1, ...rows.map(row => row.length));
  const pad = (row, fill) => [...row, ...Array(cols - row.length).fill(fill)].join('');
  return { cols, rows: rows.length, glyphs: rows.map(row => pad(row, ' ')), colours: keys.map(row => pad(row, '.')) };
}

/**
 * Viewscreens for the Shuttle Activity (P43): validated art drawn on one canvas, each cell twice as tall as it is wide,
 * as wide as the panel allows. Loading is injected; nothing here fetches.
 */
export function createViewscreens({ canvas, palette, background, load, pixelRatio = () => 1 }) {
  const painter = createSceneCanvas(canvas, { palette, background });
  const cache = new Map();
  return Object.freeze({
    load(id) {
      if (!cache.has(id)) cache.set(id, load(id).then(validateViewscreen).catch(error => { cache.delete(id); throw error; }));
      return cache.get(id);
    },
    paint(screen) {
      const frame = viewscreenFrame(screen), width = canvas.parentElement?.clientWidth || 320;
      const cell = Math.max(4, Math.floor(Math.min(width, 520) / frame.cols));
      painter.resize(cell * frame.cols, cell * 2 * frame.rows, frame.cols, frame.rows, pixelRatio());
      painter.draw(frame, SCENE_COLOURS);
    },
  });
}
