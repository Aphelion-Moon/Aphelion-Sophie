import { requireCondition, requireInteger, requireRecord } from '../../contracts/validation.js';

/**
 * Bounded scene data for the Shuttle Activity's ASCII backdrops (P42). A scene is data only: fixed glyph and colour
 * grids, a closed list of effect kinds and a few state bindings. It carries no code, URLs, HTML or member data, and
 * nothing here grants access or changes a run; the server's run state only selects what is drawn.
 */
export const SCENE_SCHEMA_VERSION = 1;
export const SCENE_LAYOUTS = Object.freeze({
  // Landscape scenes fill the area beside the reading column (about 1.2:1), so nothing is drawn under the text.
  landscape: Object.freeze({ cols: 96, rows: 40 }),
  portrait: Object.freeze({ cols: 72, rows: 57 }),
});
/** One character per colour, used in colour masks. A space means the default dim colour. */
export const SCENE_COLOURS = Object.freeze({
  '.': 'dim', i: 'ivory', I: 'ivoryDim', o: 'olive', r: 'orange', a: 'amber', A: 'amberDim', c: 'cold', h: 'holo',
  H: 'holoDim', p: 'rose', d: 'dark', 1: 'stripe1', 2: 'stripe2', 3: 'stripe3', 4: 'stripe4', 5: 'stripe5', 6: 'stripe6',
  7: 'stripe7',
});
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
/** Glyphs a scene may use: printable ASCII plus a small set of box, block and mark characters. */
export const SCENE_GLYPHS = Object.freeze(new Set([...ASCII, ...'─│┌┐└┘├┤┬┴┼═║╔╗╚╝╟╢╪╱╲╭╮╯╰', ...'░▒▓█▀▄▌▐■□', ...'·•●◆»«≡']));
export const SCENE_STATE_KEYS = Object.freeze(['stopTitle', 'stopNumber', 'stopCount', 'section', 'sections', 'whitelist', 'doorOpen', 'beat', 'link']);
export const SCENE_WHITELIST_STATES = Object.freeze(['none', 'requested', 'confirmed']);
/** Whether the member has a run to show: 'some' once both stop number and stop count are known. */
export const SCENE_STOP_STATES = Object.freeze(['none', 'some']);
/** What the title screen's link panel may say about the member's Shuttle; 'none' until the server has answered. */
export const SCENE_LINK_STATES = Object.freeze(['none', 'ready', 'closed', 'channel', 'arrived', 'held', 'offline']);
/** A beat is a moment in the copy (a section) that a scene can stage; 'none' outside any known moment. */
const BEAT = /^[a-z][a-z0-9-]{0,31}$/;
const TEMPLATE = /\{([a-zA-Z]+)(?::([1-3]))?\}/g;
const NUMERIC_KEYS = Object.freeze(['stopNumber', 'stopCount', 'section', 'sections']);
const EFFECT_KINDS = Object.freeze(['blink', 'flicker', 'drift', 'scan', 'pulse', 'flap', 'text', 'sprite']);
const LIMITS = Object.freeze({ layers: 48, effects: 64, frames: 24, fps: 12, flashHz: 3, flickerArea: 0.03, path: 240, texts: 8, alt: 600, beats: 24,
  spriteFrames: 4, spriteRows: 8, spriteCols: 24 });
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const exactKeys = (value, required, optional = [], code = 'INVALID_SCENE_FIELDS') => {
  requireRecord(value, code);
  const keys = Object.keys(value);
  requireCondition(required.every(key => Object.hasOwn(value, key)) && keys.every(key => required.includes(key) || optional.includes(key)), code);
};
const boundedText = (value, max, code) => requireCondition(typeof value === 'string' && value.length > 0 && value.length <= max &&
  value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value), code);
const number = (value, min, max, code) => requireCondition(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, code);
const colourKey = (value, code = 'INVALID_SCENE_COLOUR') => requireCondition(typeof value === 'string' && value.length === 1 && Object.hasOwn(SCENE_COLOURS, value), code);
const glyphs = (text, code = 'INVALID_SCENE_GLYPH') => { for (const ch of text) requireCondition(SCENE_GLYPHS.has(ch), code); };

function region(value, grid, code = 'INVALID_SCENE_REGION') {
  requireCondition(Array.isArray(value) && value.length === 4 && value.every(Number.isSafeInteger), code);
  const [x, y, w, h] = value;
  requireCondition(x >= 0 && y >= 0 && w >= 1 && h >= 1 && x + w <= grid.cols && y + h <= grid.rows, code);
  return w * h;
}
function condition(when, beats = []) {
  if (when === undefined) return;
  exactKeys(when, [], ['whitelist', 'stop', 'beat', 'link'], 'INVALID_SCENE_CONDITION');
  requireCondition(Object.keys(when).length >= 1, 'INVALID_SCENE_CONDITION');
  for (const [key, allowed] of [['whitelist', SCENE_WHITELIST_STATES], ['stop', SCENE_STOP_STATES], ['beat', ['none', ...beats]], ['link', SCENE_LINK_STATES]]) {
    if (when[key] === undefined) continue;
    requireCondition(Array.isArray(when[key]) && when[key].length >= 1 && when[key].every(value => allowed.includes(value)), 'INVALID_SCENE_CONDITION');
  }
}

function layer(value, grid, ids, beats) {
  exactKeys(value, ['id', 'x', 'y', 'frames'], ['fps', 'when', 'opaque', 'slide']);
  requireCondition(ID.test(value.id) && !ids.has(value.id), 'INVALID_SCENE_ID'); ids.add(value.id);
  requireInteger(value.x, 0, grid.cols - 1); requireInteger(value.y, 0, grid.rows - 1);
  requireCondition(Array.isArray(value.frames) && value.frames.length >= 1 && value.frames.length <= LIMITS.frames, 'INVALID_SCENE_FRAMES');
  if (value.frames.length > 1) number(value.fps, 0.5, LIMITS.fps, 'INVALID_SCENE_FPS');
  else requireCondition(value.fps === undefined, 'INVALID_SCENE_FPS');
  for (const frame of value.frames) {
    exactKeys(frame, ['text', 'colours'], [], 'INVALID_SCENE_FRAMES');
    requireCondition(Array.isArray(frame.text) && frame.text.length >= 1 && value.y + frame.text.length <= grid.rows &&
      Array.isArray(frame.colours) && frame.colours.length === frame.text.length, 'INVALID_SCENE_SIZE');
    frame.text.forEach((row, index) => {
      requireCondition(typeof row === 'string' && typeof frame.colours[index] === 'string', 'INVALID_SCENE_SIZE');
      const chars = [...row], mask = [...frame.colours[index]];
      requireCondition(value.x + chars.length <= grid.cols && mask.length === chars.length, 'INVALID_SCENE_SIZE');
      glyphs(row);
      for (const key of mask) requireCondition(key === ' ' || Object.hasOwn(SCENE_COLOURS, key), 'INVALID_SCENE_COLOUR');
    });
  }
  condition(value.when, beats);
  if (value.opaque !== undefined) requireCondition(value.opaque === true, 'INVALID_SCENE_FIELDS');
  if (value.slide !== undefined) {
    exactKeys(value.slide, ['by', 'dx', 'clip'], [], 'INVALID_SCENE_SLIDE');
    requireCondition(value.slide.by === 'doorOpen' && Number.isSafeInteger(value.slide.dx) && Math.abs(value.slide.dx) <= grid.cols, 'INVALID_SCENE_SLIDE');
    region(value.slide.clip, grid, 'INVALID_SCENE_SLIDE');
  }
}

function frameSet(frames, maxRows, maxCols, code) {
  requireCondition(Array.isArray(frames) && frames.length >= 1 && frames.length <= LIMITS.spriteFrames, code);
  for (const frame of frames) {
    exactKeys(frame, ['text', 'colours'], [], code);
    requireCondition(Array.isArray(frame.text) && frame.text.length >= 1 && frame.text.length <= maxRows && Array.isArray(frame.colours) &&
      frame.colours.length === frame.text.length, code);
    frame.text.forEach((row, index) => {
      requireCondition(typeof row === 'string' && typeof frame.colours[index] === 'string' && [...row].length <= maxCols &&
        [...frame.colours[index]].length === [...row].length, code);
      glyphs(row);
      for (const key of frame.colours[index]) requireCondition(key === ' ' || Object.hasOwn(SCENE_COLOURS, key), 'INVALID_SCENE_COLOUR');
    });
  }
}
const point = (value, grid, margin, code) => requireCondition(Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger) &&
  value[0] >= -margin && value[0] <= grid.cols + margin && value[1] >= -margin && value[1] <= grid.rows + margin, code);

function effect(value, grid, ids, beats) {
  requireRecord(value, 'INVALID_SCENE_EFFECT');
  requireCondition(EFFECT_KINDS.includes(value.kind), 'INVALID_SCENE_EFFECT');
  const common = ['kind', 'id'];
  const shapes = {
    blink: [['region', 'hz', 'on', 'off'], []],
    flicker: [['region', 'hz', 'chance', 'colour'], []],
    drift: [['region', 'seed', 'density', 'speed', 'glyphs', 'colours'], []],
    scan: [['region', 'speed', 'glyph', 'colour'], []],
    pulse: [['path', 'speed', 'glyph', 'colour'], ['trail', 'trailGlyph', 'trailColour']],
    flap: [['x', 'y', 'width', 'texts', 'period', 'flip', 'colour'], ['align']],
    text: [['x', 'y', 'width', 'template', 'colour'], []],
    sprite: [['frames', 'from', 'to', 'duration', 'every'], ['offset', 'fps', 'still']],
  }[value.kind];
  exactKeys(value, [...common, ...shapes[0]], [...shapes[1], 'when'], 'INVALID_SCENE_EFFECT');
  requireCondition(ID.test(value.id) && !ids.has(value.id), 'INVALID_SCENE_ID'); ids.add(value.id);
  condition(value.when, beats);
  const cells = grid.cols * grid.rows;
  switch (value.kind) {
    case 'blink':
      region(value.region, grid); number(value.hz, 0.1, LIMITS.flashHz, 'SCENE_FLASH_TOO_FAST');
      colourKey(value.on); colourKey(value.off); break;
    case 'flicker':
      requireCondition(region(value.region, grid) <= cells * LIMITS.flickerArea, 'SCENE_FLICKER_TOO_LARGE');
      number(value.hz, 0.1, LIMITS.flashHz, 'SCENE_FLASH_TOO_FAST'); number(value.chance, 0.01, 1, 'INVALID_SCENE_EFFECT');
      colourKey(value.colour); break;
    case 'drift':
      region(value.region, grid); requireInteger(value.seed, 1, 2 ** 31 - 1);
      number(value.density, 0.001, 0.2, 'INVALID_SCENE_EFFECT'); number(value.speed, 0, 4, 'INVALID_SCENE_EFFECT');
      requireCondition(typeof value.glyphs === 'string' && [...value.glyphs].length >= 1 && [...value.glyphs].length <= 8 &&
        typeof value.colours === 'string' && [...value.colours].length === [...value.glyphs].length, 'INVALID_SCENE_EFFECT');
      glyphs(value.glyphs); for (const key of value.colours) colourKey(key); break;
    case 'scan':
      region(value.region, grid); number(value.speed, 0.5, 12, 'INVALID_SCENE_EFFECT');
      requireCondition(typeof value.glyph === 'string' && [...value.glyph].length === 1, 'INVALID_SCENE_GLYPH'); glyphs(value.glyph);
      colourKey(value.colour); break;
    case 'pulse':
      requireCondition(Array.isArray(value.path) && value.path.length >= 2 && value.path.length <= LIMITS.path &&
        value.path.every(point => Array.isArray(point) && point.length === 2 && Number.isSafeInteger(point[0]) && Number.isSafeInteger(point[1]) &&
          point[0] >= 0 && point[0] < grid.cols && point[1] >= 0 && point[1] < grid.rows), 'INVALID_SCENE_PATH');
      number(value.speed, 0.5, 30, 'INVALID_SCENE_EFFECT');
      requireCondition(typeof value.glyph === 'string' && [...value.glyph].length === 1, 'INVALID_SCENE_GLYPH'); glyphs(value.glyph); colourKey(value.colour);
      if (value.trail !== undefined) {
        requireInteger(value.trail, 1, 8);
        requireCondition(typeof value.trailGlyph === 'string' && [...value.trailGlyph].length === 1, 'INVALID_SCENE_GLYPH');
        glyphs(value.trailGlyph); colourKey(value.trailColour);
      } else requireCondition(value.trailGlyph === undefined && value.trailColour === undefined, 'INVALID_SCENE_EFFECT');
      break;
    case 'flap':
      requireInteger(value.x, 0, grid.cols - 1); requireInteger(value.y, 0, grid.rows - 1); requireInteger(value.width, 1, grid.cols - value.x);
      requireCondition(Array.isArray(value.texts) && value.texts.length >= 1 && value.texts.length <= LIMITS.texts &&
        value.texts.every(text => typeof text === 'string' && [...text].length <= value.width), 'INVALID_SCENE_EFFECT');
      value.texts.forEach(text => glyphs(text));
      number(value.period, 2, 60, 'INVALID_SCENE_EFFECT'); number(value.flip, 0.1, 1, 'INVALID_SCENE_EFFECT'); colourKey(value.colour);
      if (value.align !== undefined) requireCondition(['left', 'right'].includes(value.align), 'INVALID_SCENE_EFFECT');
      break;
    case 'sprite':
      // A small figure that crosses the scene now and then: from -> to over duration seconds, once every 'every' seconds.
      frameSet(value.frames, LIMITS.spriteRows, LIMITS.spriteCols, 'INVALID_SCENE_SPRITE');
      point(value.from, grid, LIMITS.spriteCols, 'INVALID_SCENE_SPRITE'); point(value.to, grid, LIMITS.spriteCols, 'INVALID_SCENE_SPRITE');
      number(value.duration, 1, 60, 'INVALID_SCENE_SPRITE'); number(value.every, value.duration, 600, 'INVALID_SCENE_SPRITE');
      if (value.offset !== undefined) number(value.offset, 0, 600, 'INVALID_SCENE_SPRITE');
      if (value.still !== undefined) number(value.still, 0, 1, 'INVALID_SCENE_SPRITE');
      if (value.fps !== undefined) { number(value.fps, 0.5, LIMITS.fps, 'INVALID_SCENE_SPRITE'); requireCondition(value.frames.length > 1, 'INVALID_SCENE_SPRITE'); }
      else requireCondition(value.frames.length === 1, 'INVALID_SCENE_SPRITE');
      break;
    case 'text': {
      requireInteger(value.x, 0, grid.cols - 1); requireInteger(value.y, 0, grid.rows - 1); requireInteger(value.width, 1, grid.cols - value.x);
      requireCondition(typeof value.template === 'string' && value.template.length <= 200, 'INVALID_SCENE_TEMPLATE');
      const fixed = value.template.replace(TEMPLATE, (_, key, pad) => {
        requireCondition(SCENE_STATE_KEYS.includes(key) && !['doorOpen', 'whitelist', 'beat', 'link'].includes(key) && (pad === undefined || NUMERIC_KEYS.includes(key)), 'INVALID_SCENE_TEMPLATE');
        return '';
      });
      requireCondition(!/[{}]/.test(fixed), 'INVALID_SCENE_TEMPLATE'); glyphs(fixed); colourKey(value.colour); break;
    }
  }
}

/** Validates a scene document. Throws a stable ContractError code; returns the scene unchanged. */
export function validateScene(scene) {
  exactKeys(scene, ['schema', 'id', 'title', 'alt', 'provenance', 'layouts'], ['beats']);
  requireCondition(scene.schema === SCENE_SCHEMA_VERSION, 'UNSUPPORTED_SCENE_SCHEMA');
  requireCondition(ID.test(scene.id), 'INVALID_SCENE_ID');
  boundedText(scene.title, 80, 'INVALID_SCENE_TITLE');
  const beats = scene.beats ?? [];
  requireCondition(Array.isArray(beats) && beats.length <= LIMITS.beats && beats.every(beat => typeof beat === 'string' && BEAT.test(beat) && beat !== 'none') &&
    new Set(beats).size === beats.length, 'INVALID_SCENE_BEATS');
  requireCondition(Array.isArray(scene.alt) && scene.alt.length >= 1 && scene.alt.length <= 4, 'INVALID_SCENE_ALT');
  scene.alt.forEach((entry, index) => {
    exactKeys(entry, ['text'], ['when'], 'INVALID_SCENE_ALT');
    boundedText(entry.text, LIMITS.alt, 'INVALID_SCENE_ALT');
    condition(entry.when, beats);
    requireCondition((entry.when === undefined) === (index === scene.alt.length - 1), 'INVALID_SCENE_ALT');
  });
  exactKeys(scene.provenance, ['author', 'created', 'decision', 'generator', 'rights'], [], 'INVALID_SCENE_PROVENANCE');
  for (const key of ['author', 'decision', 'generator', 'rights']) boundedText(scene.provenance[key], 300, 'INVALID_SCENE_PROVENANCE');
  requireCondition(DATE.test(scene.provenance.created), 'INVALID_SCENE_PROVENANCE');
  exactKeys(scene.layouts, Object.keys(SCENE_LAYOUTS), [], 'INVALID_SCENE_LAYOUTS');
  for (const [name, grid] of Object.entries(SCENE_LAYOUTS)) {
    const layout = scene.layouts[name];
    exactKeys(layout, ['layers', 'effects'], [], 'INVALID_SCENE_LAYOUTS');
    requireCondition(Array.isArray(layout.layers) && layout.layers.length >= 1 && layout.layers.length <= LIMITS.layers, 'INVALID_SCENE_LAYERS');
    requireCondition(Array.isArray(layout.effects) && layout.effects.length <= LIMITS.effects, 'INVALID_SCENE_EFFECT');
    const ids = new Set();
    for (const item of layout.layers) layer(item, grid, ids, beats);
    for (const item of layout.effects) effect(item, grid, ids, beats);
  }
  return scene;
}

const FOLD = Object.freeze({ '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '≠': '!=' });
/** Normalises run state for drawing. Unknown glyphs become '?'; nothing here is trusted for authority. */
export function sceneState(input = {}) {
  requireRecord(input, 'INVALID_SCENE_STATE');
  const text = (value, max) => [...String(value ?? '')].map(ch => FOLD[ch] ?? ch).join('').split('').map(ch => SCENE_GLYPHS.has(ch) ? ch : '?').join('').slice(0, max);
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 99 ? value : 0;
  const whitelist = SCENE_WHITELIST_STATES.includes(input.whitelist) ? input.whitelist : 'none';
  // Nothing may look open before Whitelist is confirmed, whatever the caller's animation says.
  const doorOpen = whitelist === 'confirmed' && typeof input.doorOpen === 'number' && Number.isFinite(input.doorOpen) ? Math.min(1, Math.max(0, input.doorOpen)) : 0;
  const stopNumber = count(input.stopNumber), stopCount = count(input.stopCount);
  const beat = typeof input.beat === 'string' && BEAT.test(input.beat) ? input.beat : 'none';
  const link = SCENE_LINK_STATES.includes(input.link) ? input.link : 'none';
  return Object.freeze({ stopTitle: text(input.stopTitle, 48), stopNumber, stopCount,
    section: count(input.section), sections: count(input.sections), whitelist, doorOpen, stop: stopNumber >= 1 && stopCount >= 1 ? 'some' : 'none', beat, link });
}

function hash(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// A beat the scene does not stage draws the plain scene.
const forScene = (scene, s) => s.beat === 'none' || (scene.beats ?? []).includes(s.beat) ? s : { ...s, beat: 'none' };
const matches = (when, state) => !when || ['whitelist', 'stop', 'beat', 'link'].every(key => !when[key] || when[key].includes(state[key]));

/**
 * Composes one frame. With motion off, time is ignored and every effect shows its still state.
 * Returns rows of glyphs and rows of colour keys, each exactly cols long.
 */
export function composeScene(scene, layoutName, { time = 0, state = {}, motion = true } = {}) {
  const grid = SCENE_LAYOUTS[layoutName];
  requireCondition(grid !== undefined, 'INVALID_SCENE_LAYOUT');
  requireCondition(typeof time === 'number' && Number.isFinite(time) && time >= 0, 'INVALID_SCENE_TIME');
  const s = forScene(scene, sceneState(state)), t = motion ? time : 0;
  const layout = scene.layouts[layoutName];
  const glyph = Array.from({ length: grid.rows }, () => Array(grid.cols).fill(' '));
  const colour = Array.from({ length: grid.rows }, () => Array(grid.cols).fill('.'));
  const put = (x, y, ch, key) => { if (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows) { glyph[y][x] = ch; colour[y][x] = key; } };

  for (const item of layout.layers) {
    if (!matches(item.when, s)) continue;
    const frame = item.frames.length > 1 && motion ? item.frames[Math.floor(t * item.fps) % item.frames.length] : item.frames[0];
    const dx = item.slide ? Math.round(item.slide.dx * s.doorOpen) : 0;
    const clip = item.slide?.clip;
    frame.text.forEach((row, r) => {
      const chars = [...row], mask = [...frame.colours[r]];
      chars.forEach((ch, c) => {
        if (ch === ' ' && !item.opaque) return;
        const x = item.x + c + dx, y = item.y + r;
        if (clip && (x < clip[0] || x >= clip[0] + clip[2] || y < clip[1] || y >= clip[1] + clip[3])) return;
        put(x, y, ch, mask[c] === ' ' ? '.' : mask[c]);
      });
    });
  }

  for (const fx of layout.effects) {
    if (!matches(fx.when, s)) continue;
    switch (fx.kind) {
      case 'blink': {
        const on = !motion || Math.floor(t * fx.hz * 2) % 2 === 0;
        const [x0, y0, w, h] = fx.region;
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (glyph[y][x] !== ' ') colour[y][x] = on ? fx.on : fx.off;
        break;
      }
      case 'flicker': {
        if (!motion || hash(fx.region[0] * 31 + fx.region[1], Math.floor(t * fx.hz)) >= fx.chance) break;
        const [x0, y0, w, h] = fx.region;
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (glyph[y][x] !== ' ') colour[y][x] = fx.colour;
        break;
      }
      case 'drift': {
        const [x0, y0, w, h] = fx.region, set = [...fx.glyphs], keys = [...fx.colours];
        const count = Math.max(1, Math.round(w * h * fx.density));
        for (let i = 0; i < count; i++) {
          const pick = hash(fx.seed, i * 7 + 1), sx = hash(fx.seed, i * 7 + 2) * w, sy = Math.floor(hash(fx.seed, i * 7 + 3) * h);
          const speed = fx.speed * (0.3 + hash(fx.seed, i * 7 + 4));
          const x = x0 + Math.floor((((sx - t * speed) % w) + w) % w), y = y0 + sy;
          const g = Math.min(set.length - 1, Math.floor(pick * set.length));
          if (glyph[y][x] === ' ') put(x, y, set[g], keys[g]);
        }
        break;
      }
      case 'scan': {
        const [x0, y0, w, h] = fx.region, y = y0 + (motion ? Math.floor(t * fx.speed) % h : 0);
        for (let x = x0; x < x0 + w; x++) if (glyph[y][x] === ' ') put(x, y, fx.glyph, fx.colour);
        break;
      }
      case 'pulse': {
        const n = fx.path.length, head = motion ? Math.floor(t * fx.speed) % n : 0;
        for (let k = fx.trail ?? 0; k >= 1; k--) { const [x, y] = fx.path[(head - k + n) % n]; put(x, y, fx.trailGlyph, fx.trailColour); }
        const [x, y] = fx.path[head]; put(x, y, fx.glyph, fx.colour);
        break;
      }
      case 'flap': {
        const index = motion ? Math.floor(t / fx.period) % fx.texts.length : 0;
        const flipping = motion && (t % fx.period) < fx.flip;
        const text = [...(fx.align === 'left' ? fx.texts[index].padEnd(fx.width) : fx.texts[index].padStart(fx.width))];
        text.forEach((ch, i) => {
          const shown = flipping && ch !== ' ' ? String.fromCharCode(65 + Math.floor(hash(fx.x * 97 + i, Math.floor(t * 24)) * 26)) : ch;
          put(fx.x + i, fx.y, shown, fx.colour);
        });
        break;
      }
      case 'text': {
        const value = fx.template.replace(TEMPLATE, (_, key, pad) => pad ? String(s[key]).padStart(Number(pad), '0') : String(s[key])).slice(0, fx.width);
        [...value].forEach((ch, i) => put(fx.x + i, fx.y, ch, fx.colour));
        break;
      }
      case 'sprite': {
        // With motion off a sprite is hidden (a figure caught mid-crossing would look like part of the room), unless it
        // names a still position: things that belong in the room, like bags on a belt, stay where they would rest.
        if (!motion && fx.still === undefined) break;
        const phase = motion ? (t + (fx.offset ?? 0)) % fx.every : fx.still * fx.duration;
        if (phase >= fx.duration) break;
        const progress = phase / fx.duration, frame = fx.frames[motion && fx.fps ? Math.floor(t * fx.fps) % fx.frames.length : 0];
        const x0 = Math.round(fx.from[0] + (fx.to[0] - fx.from[0]) * progress), y0 = Math.round(fx.from[1] + (fx.to[1] - fx.from[1]) * progress);
        frame.text.forEach((row, r) => [...row].forEach((ch, c) => {
          if (ch !== ' ') put(x0 + c, y0 + r, ch, [...frame.colours[r]][c] === ' ' ? '.' : [...frame.colours[r]][c]);
        }));
        break;
      }
    }
  }
  return { cols: grid.cols, rows: grid.rows, glyphs: glyph.map(row => row.join('')), colours: colour.map(row => row.join('')) };
}

/** The alt text for the current state: the first entry whose condition matches. */
export function sceneAlt(scene, state = {}) {
  const s = forScene(scene, sceneState(state));
  return scene.alt.find(entry => matches(entry.when, s)).text;
}
