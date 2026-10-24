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
export const SCENE_STATE_KEYS = Object.freeze(['stopTitle', 'stopNumber', 'stopCount', 'section', 'sections', 'whitelist', 'doorOpen', 'beat', 'link', 'crew', 'online', 'reached']);
export const SCENE_WHITELIST_STATES = Object.freeze(['none', 'requested', 'confirmed']);
/**
 * Regions a layout may name for the page's own controls, drawn into the art: the title menu and its window's title, and a
 * link (the memorial's name opens her art gallery, owner request of 24 October 2026).
 */
export const SCENE_SLOTS = Object.freeze(['menu', 'title', 'link']);
/** Whether the member has a run to show: 'some' once both stop number and stop count are known. */
export const SCENE_STOP_STATES = Object.freeze(['none', 'some']);
/** What the title screen's link panel may say about the member's Shuttle; 'none' until the server has answered. */
export const SCENE_LINK_STATES = Object.freeze(['none', 'ready', 'closed', 'channel', 'arrived', 'held', 'offline']);
/** A beat is a moment in the copy (a section) that a scene can stage; 'none' outside any known moment. */
const BEAT = /^[a-z][a-z0-9-]{0,31}$/;
const TEMPLATE = /\{([a-zA-Z]+)(?::([1-3]))?\}/g;
const NUMERIC_KEYS = Object.freeze(['stopNumber', 'stopCount', 'section', 'sections']);
const EFFECT_KINDS = Object.freeze(['blink', 'flicker', 'drift', 'scan', 'pulse', 'flap', 'text', 'sprite', 'dialogue', 'conveyor', 'cue']);
/** A sound cue a scene may play at a moment: an ID in the Activity's sound index (content checks it exists). */
const CUE_ID = /^(SC|DLG|AMB|UI)-\d{2}$/;
const LIMITS = Object.freeze({ layers: 64, effects: 96, frames: 24, fps: 12, flashHz: 3, flickerArea: 0.03, path: 240, texts: 8, alt: 600, beats: 24,
  spriteFrames: 4, spriteRows: 8, spriteCols: 24, exchanges: 6, lines: 6, line: 120, bubble: 40, items: 16, itemRows: 3, itemCols: 10, tag: 10 });
/** Server counts shown on station boards: digits, or -- when unknown. Never member data. */
const COUNT_KEYS = Object.freeze(['crew', 'online']);
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
  // after: the reader has reached one of these beats in this stop; until: none of them yet. Results of a section (a
  // banner hung, boxes ticked) stay with 'after'; a prop that is cleared away later stays only 'until' that beat.
  exactKeys(when, [], ['whitelist', 'stop', 'beat', 'link', 'after', 'until'], 'INVALID_SCENE_CONDITION');
  requireCondition(Object.keys(when).length >= 1, 'INVALID_SCENE_CONDITION');
  for (const [key, allowed] of [['whitelist', SCENE_WHITELIST_STATES], ['stop', SCENE_STOP_STATES], ['beat', ['none', ...beats]], ['link', SCENE_LINK_STATES],
    ['after', beats], ['until', beats]]) {
    if (when[key] === undefined) continue;
    requireCondition(Array.isArray(when[key]) && when[key].length >= 1 && when[key].every(value => allowed.includes(value)), 'INVALID_SCENE_CONDITION');
  }
}

function layer(value, grid, ids, beats) {
  exactKeys(value, ['id', 'x', 'y', 'frames'], ['fps', 'when', 'opaque', 'slide', 'clock', 'once', 'front']);
  requireCondition(ID.test(value.id) && !ids.has(value.id), 'INVALID_SCENE_ID'); ids.add(value.id);
  requireInteger(value.x, 0, grid.cols - 1); requireInteger(value.y, 0, grid.rows - 1);
  requireCondition(Array.isArray(value.frames) && value.frames.length >= 1 && value.frames.length <= LIMITS.frames, 'INVALID_SCENE_FRAMES');
  // Slow loops are allowed (a monkey idling in step with a 95-second clown); only fast ones are bounded.
  if (value.frames.length > 1) number(value.fps, 0.2, LIMITS.fps, 'INVALID_SCENE_FPS');
  else requireCondition(value.fps === undefined, 'INVALID_SCENE_FPS');
  // An animation on the section's clock may play once and hold its last frame (the strike, the ticked checklist).
  if (value.clock !== undefined) requireCondition(value.clock === 'beat' && value.frames.length > 1, 'INVALID_SCENE_FPS');
  if (value.once !== undefined) requireCondition(value.once === true && value.clock === 'beat', 'INVALID_SCENE_FPS');
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
  // A standing object people walk behind: actors are never drawn over the cells it draws.
  if (value.front !== undefined) requireCondition(value.front === true, 'INVALID_SCENE_FIELDS');
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
    text: [['x', 'y', 'width', 'template', 'colour'], ['align']],
    sprite: [['frames', 'from', 'to', 'duration', 'every'], ['offset', 'fps', 'still', 'hold', 'clock', 'rest', 'clip', 'exit', 'once', 'delay', 'times']],
    dialogue: [['speakers', 'width', 'style', 'exchanges', 'line', 'pause', 'colours'], ['clock', 'delay', 'once', 'still', 'times']],
    cue: [['at', 'cue'], ['clock', 'every', 'times']],
    conveyor: [['y', 'from', 'to', 'gate', 'gateWidth', 'speed', 'spacing', 'items', 'tags', 'chute', 'readout'], []],
  }[value.kind];
  exactKeys(value, [...common, ...shapes[0]], [...shapes[1], 'when'], 'INVALID_SCENE_EFFECT');
  requireCondition(ID.test(value.id) && !ids.has(value.id), 'INVALID_SCENE_ID'); ids.add(value.id);
  condition(value.when, beats);
  // times: on the scene's clock (since the scene came on screen), something that comes round does so at most this often
  // (Ian barks three times in the lounge, owner review of revision 3, 24 October 2026).
  if (value.times !== undefined) { requireInteger(value.times, 1, 20); requireCondition(value.clock === 'scene' && value.once === undefined, 'INVALID_SCENE_EFFECT'); }
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
      number(value.duration, 1, 60, 'INVALID_SCENE_SPRITE');
      if (value.hold !== undefined) number(value.hold, 0.5, 600, 'INVALID_SCENE_SPRITE');
      // exit: after holding, the figure walks off to exit.to and is gone (people leave once their part is done).
      if (value.exit !== undefined) {
        exactKeys(value.exit, ['to', 'duration'], [], 'INVALID_SCENE_SPRITE');
        requireCondition(value.hold !== undefined, 'INVALID_SCENE_SPRITE');
        point(value.exit.to, grid, LIMITS.spriteCols, 'INVALID_SCENE_SPRITE'); number(value.exit.duration, 1, 60, 'INVALID_SCENE_SPRITE');
      }
      number(value.every, value.duration + (value.hold ?? 0) + (value.exit?.duration ?? 0), 600, 'INVALID_SCENE_SPRITE');
      if (value.clock !== undefined) requireCondition(['beat', 'scene'].includes(value.clock), 'INVALID_SCENE_SPRITE');
      // once: on the section's clock, the figure's walk happens a single time and never comes round again.
      if (value.once !== undefined) requireCondition(value.once === true && value.clock === 'beat', 'INVALID_SCENE_SPRITE');
      // delay: a once-only figure waits this long into the section before it appears (someone sits down after talking); a
      // figure that comes round a set number of times waits this long before its first walk.
      if (value.delay !== undefined) { requireCondition(value.once === true || value.times !== undefined, 'INVALID_SCENE_SPRITE'); number(value.delay, 0, 600, 'INVALID_SCENE_SPRITE'); }
      if (value.offset !== undefined) number(value.offset, 0, 600, 'INVALID_SCENE_SPRITE');
      if (value.still !== undefined) number(value.still, 0, 1, 'INVALID_SCENE_SPRITE');
      // clip: only this region shows the sprite (something outside a window stays behind the glass, not over its frame).
      if (value.clip !== undefined) region(value.clip, grid, 'INVALID_SCENE_SPRITE');
      // rest: the last frame is how the figure looks once it has arrived (sitting down), never part of its walk.
      if (value.rest !== undefined) requireCondition(value.rest === true && value.hold !== undefined && value.frames.length >= 2, 'INVALID_SCENE_SPRITE');
      const walking = value.frames.length - (value.rest ? 1 : 0);
      if (value.fps !== undefined) { number(value.fps, 0.5, LIMITS.fps, 'INVALID_SCENE_SPRITE'); requireCondition(walking > 1, 'INVALID_SCENE_SPRITE'); }
      else requireCondition(walking === 1, 'INVALID_SCENE_SPRITE');
      break;
    case 'dialogue': {
      // Two people talking: one line at a time in a speech (or LOOC) bubble above whoever is speaking.
      requireCondition(Array.isArray(value.speakers) && value.speakers.length === 2, 'INVALID_SCENE_DIALOGUE');
      value.speakers.forEach(at => point(at, grid, 0, 'INVALID_SCENE_DIALOGUE'));
      // emote: a sound someone makes (*BARK!*), shown as written, without quotation marks.
      requireInteger(value.width, 8, LIMITS.bubble); requireCondition(['say', 'looc', 'emote'].includes(value.style), 'INVALID_SCENE_DIALOGUE');
      requireCondition(Array.isArray(value.exchanges) && value.exchanges.length >= 1 && value.exchanges.length <= LIMITS.exchanges, 'INVALID_SCENE_DIALOGUE');
      for (const exchange of value.exchanges) {
        requireCondition(Array.isArray(exchange) && exchange.length >= 1 && exchange.length <= LIMITS.lines, 'INVALID_SCENE_DIALOGUE');
        for (const line of exchange) {
          requireCondition(Array.isArray(line) && line.length === 2 && [0, 1].includes(line[0]), 'INVALID_SCENE_DIALOGUE');
          boundedText(line[1], LIMITS.line, 'INVALID_SCENE_DIALOGUE'); glyphs(line[1]);
          requireCondition(line[1].split(' ').every(word => [...word].length <= value.width - 6), 'INVALID_SCENE_DIALOGUE');
        }
      }
      // A counted bubble (a bark each time Ian comes round) waits as long as his round takes.
      number(value.line, 1, 12, 'INVALID_SCENE_DIALOGUE'); number(value.pause, 0, value.times === undefined ? 30 : 600, 'INVALID_SCENE_DIALOGUE');
      requireCondition(typeof value.colours === 'string' && [...value.colours].length === 2, 'INVALID_SCENE_DIALOGUE');
      for (const key of value.colours) colourKey(key);
      if (value.clock !== undefined) requireCondition(['beat', 'scene'].includes(value.clock), 'INVALID_SCENE_DIALOGUE');
      if (value.delay !== undefined) number(value.delay, 0, 60, 'INVALID_SCENE_DIALOGUE');
      // once: the talk plays through a single time on the section's clock, then the bubbles stop.
      if (value.once !== undefined) requireCondition(value.once === true && value.clock === 'beat', 'INVALID_SCENE_DIALOGUE');
      // still: false keeps a later exchange out of the still frame, so motion off shows one bubble, not several.
      if (value.still !== undefined) requireCondition(value.still === false, 'INVALID_SCENE_DIALOGUE');
      break;
    }
    case 'cue':
      // A sound at a moment of the section (the THUMP, a shutter). Played by the client on the section's clock, once,
      // only with motion on. The content check confirms the cue exists in the sound index.
      // On the scene's own clock a cue may repeat every so often, in step with a belt, a passer-by or a loop.
      number(value.at, 0, 600, 'INVALID_SCENE_CUE'); requireCondition(typeof value.cue === 'string' && CUE_ID.test(value.cue), 'INVALID_SCENE_CUE');
      if (value.clock !== undefined) requireCondition(['beat', 'scene'].includes(value.clock), 'INVALID_SCENE_CUE');
      if (value.every !== undefined) number(value.every, 1, 600, 'INVALID_SCENE_CUE');
      if (value.times !== undefined) requireCondition(value.every !== undefined, 'INVALID_SCENE_CUE');
      break;
    case 'conveyor': {
      // Items riding a belt through a gate: each keeps its own art and tag, and a diverted item leaves for the chute.
      const code = 'INVALID_SCENE_CONVEYOR';
      requireInteger(value.y, 0, grid.rows - 1 - LIMITS.itemRows);
      for (const key of ['from', 'to', 'gate']) requireCondition(Number.isSafeInteger(value[key]) && value[key] >= -LIMITS.itemCols && value[key] <= grid.cols + LIMITS.itemCols, code);
      requireInteger(value.gateWidth, 1, 16); requireCondition(value.from < value.gate && value.gate + value.gateWidth < value.to, code);
      number(value.speed, 0.5, 12, code); requireInteger(value.spacing, 4, 40);
      requireCondition(Array.isArray(value.items) && value.items.length >= 1 && value.items.length <= LIMITS.items &&
        value.items.length * value.spacing >= value.to - value.from, code);
      for (const item of value.items) {
        exactKeys(item, ['art', 'weight', 'divert'], [], code);
        frameSet([item.art], LIMITS.itemRows, LIMITS.itemCols, code);
        requireCondition(typeof item.weight === 'string' && [...item.weight].length <= 8 && typeof item.divert === 'boolean', code); glyphs(item.weight);
      }
      requireRecord(value.tags, code);
      requireCondition(Object.hasOwn(value.tags, '*') && Object.keys(value.tags).every(key => key === '*' || beats.includes(key)), code);
      for (const entry of Object.values(value.tags)) {
        exactKeys(entry, ['before', 'after', 'beforeColour', 'afterColour'], [], code);
        for (const list of [entry.before, entry.after]) {
          requireCondition(Array.isArray(list) && list.length === value.items.length && list.every(tag => typeof tag === 'string' && [...tag].length <= LIMITS.tag), code);
          list.forEach(tag => glyphs(tag));
        }
        colourKey(entry.beforeColour); colourKey(entry.afterColour);
      }
      point(value.chute, grid, 0, code);
      exactKeys(value.readout, ['x', 'y', 'width', 'colour', 'deniedColour'], [], code);
      requireInteger(value.readout.x, 0, grid.cols - 1); requireInteger(value.readout.y, 0, grid.rows - 1);
      requireInteger(value.readout.width, 6, grid.cols - value.readout.x); colourKey(value.readout.colour); colourKey(value.readout.deniedColour);
      break;
    }
    case 'text': {
      requireInteger(value.x, 0, grid.cols - 1); requireInteger(value.y, 0, grid.rows - 1); requireInteger(value.width, 1, grid.cols - value.x);
      if (value.align !== undefined) requireCondition(['left', 'center', 'right'].includes(value.align), 'INVALID_SCENE_EFFECT');
      requireCondition(typeof value.template === 'string' && value.template.length <= 200, 'INVALID_SCENE_TEMPLATE');
      const fixed = value.template.replace(TEMPLATE, (_, key, pad) => {
        requireCondition(SCENE_STATE_KEYS.includes(key) && !['doorOpen', 'whitelist', 'beat', 'link', 'reached'].includes(key) && (pad === undefined || NUMERIC_KEYS.includes(key)), 'INVALID_SCENE_TEMPLATE');
        return '';
      });
      requireCondition(!/[{}]/.test(fixed), 'INVALID_SCENE_TEMPLATE'); glyphs(fixed); colourKey(value.colour); break;
    }
  }
}

/** Validates a scene document. Throws a stable ContractError code; returns the scene unchanged. */
export function validateScene(scene) {
  exactKeys(scene, ['schema', 'id', 'title', 'alt', 'provenance', 'layouts'], ['beats', 'link']);
  // A scene's one link: an https page the 'link' slot opens through Discord, with what it is for screen readers.
  if (scene.link !== undefined) {
    exactKeys(scene.link, ['url', 'label'], [], 'INVALID_SCENE_LINK');
    let url = null; try { url = new URL(scene.link.url); } catch { url = null; }
    requireCondition(url?.protocol === 'https:' && !url.username && !url.password && scene.link.url.length <= 300, 'INVALID_SCENE_LINK');
    boundedText(scene.link.label, 80, 'INVALID_SCENE_LINK');
  }
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
    exactKeys(layout, ['layers', 'effects'], ['slots'], 'INVALID_SCENE_LAYOUTS');
    // Named regions the page lays its own controls over (the title menu), in cells of this grid.
    if (layout.slots !== undefined) {
      requireCondition(layout.slots !== null && typeof layout.slots === 'object' && !Array.isArray(layout.slots), 'INVALID_SCENE_SLOTS');
      exactKeys(layout.slots, [], SCENE_SLOTS, 'INVALID_SCENE_SLOTS');
      for (const slot of Object.values(layout.slots)) region(slot, grid, 'INVALID_SCENE_SLOTS');
    }
    // Every layout of a scene with a link has its link slot, and only such a scene has one.
    requireCondition(Object.hasOwn(layout.slots ?? {}, 'link') === (scene.link !== undefined), 'INVALID_SCENE_LINK');
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
  const tally = value => Number.isSafeInteger(value) && value >= 0 && value <= 9_999_999 ? String(value) : '--';
  // The beats reached so far in this stop (by position in the copy, so Back un-reaches them).
  const reached = Object.freeze(Array.isArray(input.reached) ? [...new Set(input.reached.filter(value => typeof value === 'string' && BEAT.test(value)))].slice(0, LIMITS.beats) : []);
  return Object.freeze({ stopTitle: text(input.stopTitle, 48), stopNumber, stopCount,
    section: count(input.section), sections: count(input.sections), whitelist, doorOpen, stop: stopNumber >= 1 && stopCount >= 1 ? 'some' : 'none', beat, link, reached,
    ...Object.fromEntries(COUNT_KEYS.map(key => [key, tally(input[key])])) });
}

function hash(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// A beat the scene does not stage draws the plain scene.
const forScene = (scene, s) => s.beat === 'none' || (scene.beats ?? []).includes(s.beat) ? s : { ...s, beat: 'none' };
const matches = (when, state) => !when || (['whitelist', 'stop', 'beat', 'link'].every(key => !when[key] || when[key].includes(state[key])) &&
  (!when.after || when.after.some(beat => state.reached.includes(beat))) && (!when.until || !when.until.some(beat => state.reached.includes(beat))));
/** Words wrapped into lines no wider than width. */
function wrap(text, width) {
  const lines = [];
  for (const word of text.split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && [...last].length + 1 + [...word].length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/**
 * Composes one frame. With motion off, time is ignored and every effect shows its still state. beatTime is the time
 * since the current section began; effects on the beat clock (people who walk in and talk) use it instead of time.
 * sceneTime is the time since the scene came on screen, for effects on the scene clock (Ian's three rounds).
 * Returns rows of glyphs and rows of colour keys, each exactly cols long.
 */
export function composeScene(scene, layoutName, { time = 0, beatTime = time, sceneTime = time, state = {}, motion = true } = {}) {
  const grid = SCENE_LAYOUTS[layoutName];
  requireCondition(grid !== undefined, 'INVALID_SCENE_LAYOUT');
  requireCondition(typeof time === 'number' && Number.isFinite(time) && time >= 0, 'INVALID_SCENE_TIME');
  requireCondition(typeof beatTime === 'number' && Number.isFinite(beatTime) && beatTime >= 0, 'INVALID_SCENE_TIME');
  requireCondition(typeof sceneTime === 'number' && Number.isFinite(sceneTime) && sceneTime >= 0, 'INVALID_SCENE_TIME');
  const s = forScene(scene, sceneState(state)), t = motion ? time : 0, bt = motion ? beatTime : 0, st = motion ? sceneTime : 0;
  const clockOf = fx => fx.clock === 'beat' ? bt : fx.clock === 'scene' ? st : t;
  const layout = scene.layouts[layoutName];
  const glyph = Array.from({ length: grid.rows }, () => Array(grid.cols).fill(' '));
  const colour = Array.from({ length: grid.rows }, () => Array(grid.cols).fill('.'));
  const put = (x, y, ch, key) => { if (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows) { glyph[y][x] = ch; colour[y][x] = key; } };
  // Standing objects (front layers) hide whoever walks past behind them: actors and belt items skip their cells.
  // Speech bubbles still draw over everything.
  const front = Array.from({ length: grid.rows }, () => new Uint8Array(grid.cols));
  const putActor = (x, y, ch, key) => { if (x >= 0 && y >= 0 && x < grid.cols && y < grid.rows && !front[y][x]) put(x, y, ch, key); };

  for (const item of layout.layers) {
    if (!matches(item.when, s)) continue;
    // A once-only animation rests on its last frame with motion off: the strike has happened, the boxes are ticked.
    const index = item.frames.length === 1 ? 0 : !motion ? (item.once ? item.frames.length - 1 : 0)
      : item.once ? Math.min(item.frames.length - 1, Math.floor(clockOf(item) * item.fps)) : Math.floor(clockOf(item) * item.fps) % item.frames.length;
    const frame = item.frames[index];
    const dx = item.slide ? Math.round(item.slide.dx * s.doorOpen) : 0;
    const clip = item.slide?.clip;
    frame.text.forEach((row, r) => {
      const chars = [...row], mask = [...frame.colours[r]];
      chars.forEach((ch, c) => {
        if (ch === ' ' && !item.opaque) return;
        const x = item.x + c + dx, y = item.y + r;
        if (clip && (x < clip[0] || x >= clip[0] + clip[2] || y < clip[1] || y >= clip[1] + clip[3])) return;
        put(x, y, ch, mask[c] === ' ' ? '.' : mask[c]);
        if (item.front && x >= 0 && y >= 0 && x < grid.cols && y < grid.rows) front[y][x] = 1;
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
        const value = [...fx.template.replace(TEMPLATE, (_, key, pad) => pad ? String(s[key]).padStart(Number(pad), '0') : String(s[key]))].slice(0, fx.width);
        const shift = fx.align === 'center' ? Math.floor((fx.width - value.length) / 2) : fx.align === 'right' ? fx.width - value.length : 0;
        value.forEach((ch, i) => put(fx.x + shift + i, fx.y, ch, fx.colour));
        break;
      }
      case 'dialogue': {
        // One line at a time, the bubble cleared behind its words; with motion off, the opening line stays.
        // A delay lets someone walk in before they speak; with motion off the opening line shows at once.
        if (!motion && fx.still === false) break;
        const clock = motion ? clockOf(fx) - (fx.delay ?? 0) : 0, lengths = fx.exchanges.map(exchange => exchange.length * fx.line + fx.pause);
        if (clock < 0) break;
        const total = lengths.reduce((a, b) => a + b, 0);
        if (motion && (fx.once ? clock >= total : fx.times !== undefined && clock >= fx.times * total)) break;
        let at = motion ? clock % total : 0, exchange = 0;
        while (at >= lengths[exchange]) { at -= lengths[exchange]; exchange++; }
        const index = Math.floor(at / fx.line);
        if (index >= fx.exchanges[exchange].length) break;
        const [speaker, words] = fx.exchanges[exchange][index], [ax, ay] = fx.speakers[speaker];
        const text = fx.style === 'looc' ? `(( ${words} ))` : fx.style === 'emote' ? words : `"${words}"`;
        const lines = wrap(text, fx.width), width = Math.max(...lines.map(line => [...line].length));
        const x0 = Math.max(0, Math.min(grid.cols - width - 2, ax - Math.floor(width / 2))), y0 = Math.max(0, ay - lines.length - 1);
        for (let y = y0; y < y0 + lines.length; y++) for (let x = x0; x < x0 + width + 2; x++) put(x, y, ' ', '.');
        lines.forEach((line, r) => [...line].forEach((ch, c) => put(x0 + 1 + c, y0 + r, ch, fx.colours[speaker])));
        put(Math.max(x0 + 1, Math.min(x0 + width, ax)), y0 + lines.length, speaker === 0 ? '╲' : '╱', fx.colours[speaker]);
        break;
      }
      case 'conveyor': {
        const n = fx.items.length, loop = n * fx.spacing, tags = fx.tags[s.beat] ?? fx.tags['*'], exit = fx.gate + fx.gateWidth;
        let reading = null;
        fx.items.forEach((item, i) => {
          const x = fx.from + (((t * fx.speed + i * fx.spacing) % loop) + loop) % loop;
          if (x > fx.to) return;
          const rows = item.art.text.map(row => [...row]), width = Math.max(...rows.map(row => row.length)), centre = Math.floor(x) + Math.floor(width / 2);
          if (centre >= fx.gate && centre < exit) reading = item;
          let ix = Math.floor(x), iy = fx.y + 1, tagged = true;
          if (ix >= exit && item.divert) {
            // Denied: off the belt along a straight line into the chute, at the belt's speed, without a tag.
            const travel = x - exit, [cx, cy] = fx.chute, length = Math.hypot(cx - exit, cy - iy);
            if (travel >= length) return;
            ix = Math.round(exit + (cx - exit) * travel / length); iy = Math.round(iy + (cy - iy) * travel / length); tagged = false;
          }
          // Out of sight inside the gate and behind its two pillars.
          const visible = col => col < fx.gate - 1 || col > exit;
          rows.forEach((row, r) => row.forEach((ch, c) => {
            if (ch !== ' ' && visible(ix + c)) putActor(ix + c, iy + r, ch, [...item.art.colours[r]][c] === ' ' ? '.' : [...item.art.colours[r]][c]);
          }));
          // The tag changes column by column as the item comes out of the gate: what has come out wears the after tag.
          const before = [...tags.before[i]], after = [...tags.after[i]];
          if (tagged) for (let c = 0; c < Math.max(before.length, after.length); c++) {
            const col = ix + c, out = col > exit, side = out ? after : before;
            if (c < side.length && visible(col)) putActor(col, iy - 1, side[c], out ? tags.afterColour : tags.beforeColour);
          }
        });
        const { x: rx, y: ry, width: rw } = fx.readout;
        const shown = reading === null ? '- - -' : reading.divert ? 'DENIED' : reading.weight;
        [...shown.padEnd(rw)].slice(0, rw).forEach((ch, c) => put(rx + c, ry, ch, reading?.divert ? fx.readout.deniedColour : fx.readout.colour));
        break;
      }
      case 'sprite': {
        // With motion off a sprite is hidden (a figure caught mid-crossing would look like part of the room), unless it
        // names a still position (bags on a belt) or holds at its destination (people who walk in and stay to talk).
        // Someone who leaves after their part is not in the still frame either, unless they name a still position.
        if (!motion && fx.still === undefined && (fx.hold === undefined || fx.exit !== undefined)) break;
        const hold = fx.hold ?? 0, leave = fx.exit?.duration ?? 0, elapsed = clockOf(fx) + (fx.offset ?? 0) - (fx.delay ?? 0);
        if (motion && (fx.once || fx.times !== undefined) && elapsed < 0) break;
        if (motion && fx.times !== undefined && Math.floor(elapsed / fx.every) >= fx.times) break;
        const phase = motion ? (fx.once ? elapsed : elapsed % fx.every) : fx.still !== undefined ? fx.still * fx.duration : fx.duration;
        if (phase >= fx.duration + hold + leave) break;
        // In: from -> to. Then holding at 'to' (resting pose if any). Then out: to -> exit.to, walking again.
        const leaving = phase >= fx.duration + hold, arrived = phase >= fx.duration && !leaving;
        const walking = fx.frames.length - (fx.rest ? 1 : 0);
        const [a, b, progress] = leaving ? [fx.to, fx.exit.to, (phase - fx.duration - hold) / leave] : [fx.from, fx.to, Math.min(1, phase / fx.duration)];
        const frame = arrived && fx.rest ? fx.frames.at(-1) : fx.frames[motion && fx.fps && !arrived ? Math.floor(t * fx.fps) % walking : 0];
        const x0 = Math.round(a[0] + (b[0] - a[0]) * progress), y0 = Math.round(a[1] + (b[1] - a[1]) * progress);
        const [cx, cy, cw, ch] = fx.clip ?? [0, 0, grid.cols, grid.rows];
        frame.text.forEach((row, r) => [...row].forEach((glyph, c) => {
          const x = x0 + c, y = y0 + r;
          if (glyph !== ' ' && x >= cx && x < cx + cw && y >= cy && y < cy + ch) putActor(x, y, glyph, [...frame.colours[r]][c] === ' ' ? '.' : [...frame.colours[r]][c]);
        }));
        break;
      }
    }
  }
  return { cols: grid.cols, rows: grid.rows, glyphs: glyph.map(row => row.join('')), colours: colour.map(row => row.join('')) };
}

/**
 * The sound cues a scene plays between two readings of its clocks, for the staged state: the page's clock (from, to),
 * the section's clock (beatFrom, beatTo) and the time since the scene came on screen (sceneFrom, sceneTo), each from
 * exclusive to inclusive. A cue fires as its clock passes its moment (and every 'every' seconds after, when it repeats,
 * up to 'times' in all). With motion off nothing is played.
 */
export function sceneCues(scene, layoutName, { from = 0, to = 0, beatFrom = 0, beatTo = 0, sceneFrom = from, sceneTo = to, state = {}, motion = true }) {
  const layout = scene.layouts[layoutName];
  requireCondition(layout !== undefined, 'INVALID_SCENE_LAYOUT');
  if (!motion) return [];
  const s = forScene(scene, sceneState(state));
  const passes = (fx, a, b) => {
    if (!(b > a)) return false;
    if (!fx.every) return fx.at > a && fx.at <= b;
    const round = Math.max(0, Math.floor((a - fx.at) / fx.every) + 1), next = fx.at + round * fx.every;
    return (fx.at > a && fx.at <= b) || (next > a && next <= b && (fx.times === undefined || round < fx.times));
  };
  const clocks = { beat: [beatFrom, beatTo], scene: [sceneFrom, sceneTo] };
  return layout.effects.filter(fx => fx.kind === 'cue' && matches(fx.when, s) && passes(fx, ...(clocks[fx.clock] ?? [from, to]))).map(fx => fx.cue);
}

/** The alt text for the current state: the first entry whose condition matches. */
export function sceneAlt(scene, state = {}) {
  const s = forScene(scene, sceneState(state));
  return scene.alt.find(entry => matches(entry.when, s)).text;
}
