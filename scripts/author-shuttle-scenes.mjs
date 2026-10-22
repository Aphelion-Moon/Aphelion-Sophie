// Draws the Shuttle Activity's ASCII scenes and writes them as bounded scene data (owner decision of 21 October 2026:
// the coding agent makes the Activity's art). The Activity reads only the JSON this writes; this script is the
// drawing tool. Output is deterministic. Usage: node scripts/author-shuttle-scenes.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { SCENE_LAYOUTS, validateScene } from '../modules/onboarding/scenes.js';

const outputDir = new URL('../content/shuttle-activity/scenes/', import.meta.url);
const PROVENANCE = Object.freeze({
  author: 'Made by the coding agent (Claude) at owner direction',
  created: '2026-10-21',
  decision: 'docs/decisions/0001-owner-policy.md (The Shuttle becomes an Activity, D2)',
  generator: 'scripts/author-shuttle-scenes.mjs',
  rights: 'Machine-made art; it may not attract copyright in every jurisdiction. Published with the repository.',
});
const ADV = 0.6; // a monospace cell is about 0.6 of its height wide

function hash(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A drawing surface of glyphs and colour keys. A space is transparent in the layer it becomes. */
class Art {
  constructor(cols, rows) { this.cols = cols; this.rows = rows; this.g = Array.from({ length: rows }, () => Array(cols).fill(' ')); this.k = Array.from({ length: rows }, () => Array(cols).fill(' ')); }
  put(x, y, ch, key) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) { this.g[y][x] = ch; this.k[y][x] = key; } }
  get(x, y) { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < this.cols && y < this.rows ? this.g[y][x] : null; }
  text(x, y, s, key) { [...s].forEach((ch, i) => this.put(x + i, y, ch, key)); }
  hline(x0, x1, y, ch, key) { for (let x = x0; x <= x1; x++) this.put(x, y, ch, key); }
  vline(x, y0, y1, ch, key) { for (let y = y0; y <= y1; y++) this.put(x, y, ch, key); }
  box(x0, y0, x1, y1, key, set = '┌┐└┘─│') {
    this.hline(x0 + 1, x1 - 1, y0, set[4], key); this.hline(x0 + 1, x1 - 1, y1, set[4], key);
    this.vline(x0, y0 + 1, y1 - 1, set[5], key); this.vline(x1, y0 + 1, y1 - 1, set[5], key);
    this.put(x0, y0, set[0], key); this.put(x1, y0, set[1], key); this.put(x0, y1, set[2], key); this.put(x1, y1, set[3], key);
  }
  fill(x0, y0, x1, y1, ch, key) { for (let y = y0; y <= y1; y++) this.hline(x0, x1, y, ch, key); }
  /** Bounding box of the drawn cells: [left, top, right, bottom], inclusive. */
  bounds() {
    let l = this.cols, t = this.rows, r = -1, b = -1;
    this.g.forEach((row, y) => row.forEach((ch, x) => { if (ch !== ' ') { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); } }));
    return r < 0 ? [0, 0, 0, 0] : [l, t, r, b];
  }
  /** The cells inside a box as one frame. Opaque layers paint the box's blanks, so the box is the layer's footprint. */
  crop([l, t, r, b], trimEnds) {
    const text = [], colours = [];
    for (let y = t; y <= b; y++) {
      let row = this.g[y].slice(l, r + 1).join(''), keys = this.k[y].slice(l, r + 1).join('');
      if (trimEnds) { row = row.trimEnd(); keys = keys.slice(0, row.length); }
      text.push(row); colours.push(keys);
    }
    return { text, colours };
  }
}
function layer(id, art, extra = {}) {
  const box = art.bounds();
  return { id, x: box[0], y: box[1], frames: [art.crop(box, !extra.opaque)], ...extra };
}
function framesLayer(id, arts, fps) {
  const boxes = arts.map(a => a.bounds());
  const box = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
  return { id, x: box[0], y: box[1], fps, frames: arts.map(a => a.crop(box, true)) };
}

// ---------- shared drawing ----------
const FONT = {
  A: [' ### ', '#   #', '#####', '#   #', '#   #'], P: ['#### ', '#   #', '#### ', '#    ', '#    '],
  H: ['#   #', '#   #', '#####', '#   #', '#   #'], E: ['#####', '#    ', '#### ', '#    ', '#####'],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'], I: ['###', ' # ', ' # ', ' # ', '###'],
  O: [' ### ', '#   #', '#   #', '#   #', ' ### '], N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
};
function logo(a, x, y) {
  const word = 'APHELION';
  let cx = x;
  for (const L of word) { const gl = FONT[L]; for (let r = 0; r < 5; r++) for (let c = 0; c < gl[r].length; c++) if (gl[r][c] === '#') a.put(cx + c + 1, y + r + 1, '░', 'A'); cx += gl[0].length + 1; }
  cx = x;
  for (const L of word) { const gl = FONT[L]; for (let r = 0; r < 5; r++) for (let c = 0; c < gl[r].length; c++) if (gl[r][c] === '#') a.put(cx + c, y + r, hash(cx + c, y + r) < 0.13 ? '▓' : '█', 'a'); cx += gl[0].length + 1; }
  for (let r = 0; r < 5; r++) { const px = x + 20 + r; if (['█', '▓'].includes(a.get(px, y + r))) a.put(px, y + r, '╲', 'h'); }
}
function stripes(a, x, y, rows) {
  for (let r = 0; r < rows; r++) for (let i = 0; i < 7; i++) { const xx = x + i * 2 + (rows - 1 - r); a.put(xx, y + r, '█', String(i + 1)); a.put(xx + 1, y + r, '█', String(i + 1)); }
}
function sun(a, sx, sy, R) {
  const ramp = ' .:-=+*#%@', rx = Math.ceil(R / ADV) + 1, ry = Math.ceil(R) + 1;
  for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
    const d = Math.hypot(dx * ADV, dy); let i = Math.max(0, 1 - d / R); i *= i;
    if (i < 0.05) continue;
    const idx = Math.min(9, Math.floor(i * 10));
    a.put(sx + dx, sy + dy, ramp[idx], idx >= 7 ? 'a' : idx >= 4 ? 'r' : 'A');
  }
}

/** Multi-line art at (x, y). keys is one colour per line, or one string per line; spaces stay transparent. */
function prop(a, x, y, lines, keys) {
  lines.forEach((line, r) => [...line].forEach((ch, c) => {
    if (ch === ' ') return;
    const row = Array.isArray(keys) ? keys[r] : keys, key = row.length > 1 ? (row[c] ?? row.at(-1)) : row;
    a.put(x + c, y + r, ch, key === ' ' ? '.' : key);
  }));
}
/** A sprite frame from lines and per-line colour rows (or one colour). */
function spriteFrame(lines, keys) {
  return { text: lines, colours: lines.map((line, r) => {
    const row = Array.isArray(keys) ? keys[r] : keys;
    return [...line].map((ch, c) => ch === ' ' ? ' ' : row.length > 1 ? (row[c] ?? row.at(-1)) : row).join('');
  }) };
}
/** Old wall plating: panel seams, rivets and a little grime, drawn only into empty cells. */
function wallPanels(a, x0, y0, x1, y1, seed, step = 12, reserved = []) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (a.get(x, y) !== ' ' || reserved.some(([l, t, r, b]) => x >= l && x <= r && y >= t && y <= b)) continue;
    if ((x - x0) % step === 0) a.put(x, y, (y - y0) % 6 === 0 ? 'o' : '│', (y - y0) % 6 === 0 ? '.' : 'd');
    else if (hash(x * 13 + seed, y * 7) < 0.035) a.put(x, y, hash(x, y + seed) < 0.5 ? '.' : '·', 'd');
  }
}
/**
 * A reinforced window: a heavy frame, mullions and a transom, a faint grille, and stars drifting only behind the glass.
 * Returns the glass panes as regions.
 */
function reinforcedWindow(a, effects, id, x0, y0, x1, y1, panes, seed) {
  for (let y = y0; y <= y1; y++) { a.put(x0, y, '▓', 'o'); a.put(x0 + 1, y, '▒', 'd'); a.put(x1 - 1, y, '▒', 'd'); a.put(x1, y, '▓', 'o'); }
  a.hline(x0, x1, y0, '▓', 'o'); a.hline(x0 + 1, x1 - 1, y0 + 1, '▒', 'd'); a.hline(x0, x1, y1, '▓', 'o'); a.hline(x0 + 1, x1 - 1, y1 - 1, '▒', 'd');
  const gx0 = x0 + 2, gx1 = x1 - 2, gy0 = y0 + 2, gy1 = y1 - 2, mid = Math.round((gy0 + gy1) / 2);
  const cuts = Array.from({ length: panes - 1 }, (_, i) => Math.round(gx0 + (gx1 - gx0 + 1) * (i + 1) / panes));
  for (const x of cuts) a.vline(x, y0 + 1, y1 - 1, '║', 'o');
  a.hline(gx0, gx1, mid, '═', 'o'); for (const x of cuts) a.put(x, mid, '╪', 'o');
  a.put(x0 + 3, y0, 'o', 'I'); a.put(x1 - 3, y0, 'o', 'I'); a.put(x0 + 3, y1, 'o', 'I'); a.put(x1 - 3, y1, 'o', 'I');
  // The grille: a faint lattice in the glass, as on a station's reinforced windows.
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) if (a.get(x, y) === ' ' && (x - gx0) % 4 === 0 && (y - gy0) % 2 === 1) a.put(x, y, '+', 'd');
  const bounds = [gx0, ...cuts.map(x => x + 1)], ends = [...cuts.map(x => x - 1), gx1];
  bounds.forEach((bx, i) => {
    for (const [ry0, ry1] of [[gy0, mid - 1], [mid + 1, gy1]]) {
      if (ry1 < ry0 || ends[i] < bx) continue;
      effects.push({ kind: 'drift', id: `${id}-stars-${i}-${ry0}`, region: [bx, ry0, ends[i] - bx + 1, ry1 - ry0 + 1], seed: seed + i * 3 + ry0, density: 0.07, speed: 0.7, glyphs: ".·'", colours: '..I' });
    }
  });
  return { gx0, gx1, gy0, gy1, mid, cuts };
}
const WET_SIGN = [['  .-.', ' /WET\\', '/FLOOR\\'], ['  aaa', ' arrra', 'arrrrra']];
const CORGI = [
  spriteFrame(['  __/\\/\\', '(______ o>', " ' '  ' '"], ['  rrrrrr', 'rrrrrrrrir', ' rr   rr']),
  spriteFrame(['  __/\\/\\', '(______ o>', "  ' '  ' "], ['  rrrrrr', 'rrrrrrrrir', '  rr   rr']),
];
const CARP = [
  spriteFrame(['  __', '}<(((o>', '  ~~'], ['  hh', 'hhhhhhi', '  HH']),
  spriteFrame(['  __', '}<(((o>', '   ~~'], ['  hh', 'hhhhhhi', '   HH']),
];
/** A sprite frame facing the other way: rows reversed and paired brackets swapped, so a fish swims head first. */
function mirrorFrame(frame) {
  const swap = { '(': ')', ')': '(', '<': '>', '>': '<', '{': '}', '}': '{', '[': ']', ']': '[', '/': '\\', '\\': '/' };
  const width = Math.max(...frame.text.map(row => [...row].length));
  const flip = (row, fill) => [...row.padEnd(width, fill)].reverse().map(ch => swap[ch] ?? ch).join('').replace(/\s+$/, '');
  const text = frame.text.map(row => flip(row, ' '));
  return { text, colours: frame.colours.map((row, r) => [...row.padEnd(width, ' ')].reverse().join('').slice(0, [...text[r]].length)) };
}
// Carp swim right to left across every window, so they face left.
const CARP_LEFT = CARP.map(mirrorFrame);

// ---------- scene: hangar viewport (title screen) ----------
/**
 * Aphelion station: a ring on cross spokes round a lit hub, solar arrays on both sides, an antenna with a beacon on top
 * and a docking collar below. Worn pale metal, amber windows, cyan new work, a magenta beacon. Drawn from its left half
 * and mirrored, so it is exactly symmetric; every line piece meets its neighbour at the cell edge.
 */
const STATION_LEFT = [
  ['                 ', '●'],
  ['                 ', '│'],
  ['         ╭───────', '┼'],
  ['     ╭───╯ □ □ □ ', '│'],
  ['     │           ', '│'],
  ['▓▓▓▓─┤        ╭──', '┴'],
  ['▓▓▓▓─┼────────┤  ', '●'],
  ['▓▓▓▓─┤        ╰──', '┬'],
  ['     │           ', '│'],
  ['     ╰───╮ □ □ □ ', '│'],
  ['         ╰───────', '┼'],
  ['                 ', '│'],
  ['              ═══', '╪'],
];
const MIRROR = { '╭': '╮', '╮': '╭', '╰': '╯', '╯': '╰', '┤': '├', '├': '┤', '╱': '╲', '╲': '╱', '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[' };
const STATION = STATION_LEFT.map(([left, mid]) => left + mid + [...left].reverse().map(ch => MIRROR[ch] ?? ch).join(''));
function station(a, effects, x0, y0) {
  STATION.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ' ') return;
    const key = ch === '▓' ? 'H' : ch === '□' ? (hash(c, r) < 0.35 ? 'h' : 'a') : ch === '●' ? (r === 0 ? 'p' : 'c') : '─┼┤├┴┬'.includes(ch) && (r === 6 || c === 17) ? 'o' : 'I';
    a.put(x0 + c, y0 + r, ch, key);
  }));
  // Hub ring and the hub's spoke joints are new cyan work.
  for (const [c, r] of [[14, 5], [15, 5], [16, 5], [18, 5], [19, 5], [20, 5], [14, 7], [15, 7], [16, 7], [18, 7], [19, 7], [20, 7], [14, 6], [20, 6]]) {
    if (a.get(x0 + c, y0 + r) !== ' ') a.put(x0 + c, y0 + r, a.get(x0 + c, y0 + r), 'h');
  }
  effects.push({ kind: 'blink', id: 'station-beacon', region: [x0 + 17, y0, 1, 1], hz: 0.8, on: 'p', off: 'd' });
  effects.push({ kind: 'blink', id: 'station-core', region: [x0 + 17, y0 + 6, 1, 1], hz: 0.4, on: 'c', off: 'h' });
  [[11, 3], [15, 3], [21, 9], [25, 9]].forEach(([c, r], i) => effects.push({ kind: 'blink', id: `station-window-${i + 1}`, region: [x0 + c, y0 + r, 1, 1], hz: 0.3 + i * 0.12, on: 'a', off: 'A' }));
  return { width: [...STATION[0]].length, height: STATION.length };
}
function hangar(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const conTop = port ? Math.round(h * 0.82) : Math.round(h * 0.76);
  // The station sits at the right; the shuttle's orbit ends at its solar array.
  const stationWidth = [...STATION[0]].length, sx0 = w - stationWidth - 1, sy0 = port ? 13 : 11, cy = sy0 + 6;
  const ra = port ? Math.round((sx0 - 2) / 2) : 19, cx = sx0 - 1 - ra, rb = port ? 3.5 : 5.5;
  for (let th = 0; th < Math.PI * 2; th += 0.01) {
    const x = Math.round(cx + ra * Math.cos(th)), y = Math.round(cy - rb * Math.sin(th));
    if (base.get(x, y) === ' ' && ((x + y) & 1)) base.put(x, y, '·', 'H');
  }
  sun(base, Math.round(cx - ra * 0.55), Math.round(cy), port ? 3.2 : 4.4);
  station(base, effects, sx0, sy0);
  // The name plate reads across the antenna: the station's name on one side, its state on the other.
  const plate = port ? 'APHELION' : 'APHELION STATION', state = '· WAKING', mast = sx0 + 17;
  base.text(mast - 2 - plate.length, sy0, plate, 'p'); base.text(mast + 2, sy0, state, 'h');
  const path = [];
  for (let k = 0; k <= 80; k++) {
    const th = Math.PI * (1 - k / 80), p = [Math.round(cx + ra * Math.cos(th)), Math.round(cy - rb * Math.sin(th))];
    if (!path.length || path.at(-1)[0] !== p[0] || path.at(-1)[1] !== p[1]) path.push(p);
  }
  effects.push({ kind: 'pulse', id: 'shuttle', path, speed: path.length / 14, glyph: '>', colour: 'c', trail: 6, trailGlyph: '·', trailColour: 'h' });
  const lx = port ? 3 : 4, ly = port ? 4 : 5;
  stripes(base, lx, ly, 5); logo(base, lx + 19, ly); base.text(lx + 19, ly + 7, 'T H E   S H U T T L E', 'i');
  // Stars drift only where nothing is drawn; these regions also keep them out of the logo and the bolted-on panel.
  // In portrait the link panel floats in open space above the console, so the title menu never covers it.
  const logoRight = lx + 19 + 46, panelTop = port ? Math.round(h * 0.45) : conTop - 6, panelBottom = panelTop + 6, pwid = 26;
  const pleft = port ? w - pwid - 3 : Math.min(w - pwid - 2, Math.round(w * 0.31) + 25);
  // The station keeps its own box clear of drifting stars.
  const starRegions = [[0, 0, w, ly], [logoRight, ly, w - logoRight, Math.min(8, sy0 - ly)], [0, ly + 8, sx0, panelTop - ly - 8], [0, panelTop, pleft, panelBottom - panelTop]];
  if (sy0 > ly + 8) starRegions.push([sx0, ly + 8, w - sx0, sy0 - ly - 8]);
  if (pleft + pwid + 1 < w) starRegions.push([pleft + pwid + 1, panelTop, w - pleft - pwid - 1, panelBottom - panelTop]);
  if (conTop - panelBottom > 1) starRegions.push([0, panelBottom + 1, w, conTop - panelBottom - 1]);
  starRegions.forEach((region, i) => effects.push({ kind: 'drift', id: `stars-${i + 1}`, region, seed: 11 + i, density: 0.028, speed: 1.2, glyphs: ".·'+", colours: '..Ih' }));

  // Console: old painted metal with a new panel bolted on.
  base.fill(0, conTop + 1, w - 1, h - 1, ' ', ' ');
  for (let y = conTop + 1; y < h; y++) for (let x = 0; x < w; x++) { const r = hash(x * 7 + 1, y * 13 + 5); if (r < 0.05) base.put(x, y, r < 0.025 ? '.' : "'", 'd'); }
  base.hline(0, w - 1, conTop, '_', 'o');
  for (let x = 9; x < w; x += 19) { base.vline(x, conTop + 1, h - 1, '|', 'd'); base.put(x, conTop + 1, 'o', 'o'); }
  const sx = port ? 4 : Math.round(w * 0.31), sy = conTop + 2;
  base.text(sx, sy, '+------------------+', 'o'); base.text(sx, sy + 4, '+------------------+', 'o');
  for (let r = 1; r <= 3; r++) { base.put(sx, sy + r, '|', 'o'); base.put(sx + 19, sy + r, '|', 'o'); }
  effects.push({ kind: 'flap', id: 'console-status', x: sx + 2, y: sy + 1, width: 16, texts: ['SYS 07   NOMINAL', 'SM ENGINE     OK', 'SINGULO     CALM', 'CARP NEARBY:   2', 'HONK LEVEL:  LOW'], period: 7, flip: 0.4, colour: 'a', align: 'left' });
  base.text(sx + 2, sy + 3, 'O2 ████░  87', 'a');
  const waves = [];
  for (let f = 0; f < 12; f++) {
    const art = new Art(w, h);
    for (let i = 0; i < 16; i++) { const v = Math.sin(i * 0.7 + f * 0.52) + 0.45 * Math.sin(i * 1.9 - f * 0.31); art.put(sx + 2 + i, sy + 2, v > 0.9 ? "'" : v > 0.2 ? '-' : v > -0.5 ? '.' : '_', 'a'); }
    waves.push(art);
  }
  layers.push(framesLayer('screen-wave', waves, 6));
  const x0 = sx + 23, sw = ['[|]', '[|]', '[ ]', '[|]', '[ ]'];
  for (let i = 0; i < 5; i++) {
    base.put(x0 + i * 4 + 1, sy, '•', 'a'); base.text(x0 + i * 4, sy + 1, sw[i], 'I');
    effects.push({ kind: 'blink', id: `lamp-${i + 1}`, region: [x0 + i * 4 + 1, sy, 1, 1], hz: [0.6, 1.1, 0.8, 1.3, 0.7][i], on: 'a', off: 'A' });
  }
  base.text(x0, sy + 3, '(o)   (o)   (o)', 'o');
  // A cyan seam fills a crack in the old metal: straight runs with a step across every third row, drawn from line pieces
  // that meet at the cell edges so it reads as one unbroken line (a diagonal piece cannot meet a vertical one).
  for (let y = conTop + 1, x = sx + 20; y < h; y++) {
    if ((y - conTop) % 3 === 0 && y < h - 1) { base.put(x, y, '└', 'h'); base.put(x + 1, y, '┐', 'h'); x++; } else base.put(x, y, '│', 'h');
  }
  const pw = pwid, px = port ? pleft : Math.min(w - pw - 2, x0 + 2), py = panelTop;
  base.fill(px, py, px + pw, panelBottom, ' ', ' ');
  base.box(px, py, px + pw, panelBottom, 'h'); base.put(px + 4, panelBottom, '╪', 'h'); base.put(px + pw - 4, panelBottom, '╪', 'h');
  base.text(px + 2, py + 1, 'SHUTTLE LINK', 'c'); base.text(px + pw - 7, py + 1, '• LIVE', 'h');
  effects.push({ kind: 'blink', id: 'link-live', region: [px + pw - 7, py + 1, 1, 1], hz: 0.6, on: 'h', off: 'H' });
  // The panel tells the truth about the member's Shuttle: what the server last said, never a guess.
  effects.push({ kind: 'text', id: 'link-stop', x: px + 2, y: py + 2, width: pw - 3, template: '» STOP {stopNumber:2} / {stopCount:2}', colour: 'c', when: { stop: ['some'], link: ['ready', 'none', 'offline'] } });
  for (const [state, label, key, stop] of [['ready', '» READY TO BOARD', 'c', ['none']], ['none', '» LINKING...', 'H', ['none']], ['offline', '» NO SIGNAL', 'p', ['none']],
    ['closed', '» NOT BOARDING YET', 'a', null], ['channel', '» FINISH IN CHANNEL', 'a', null], ['held', '» BOARDING HELD', 'a', null], ['arrived', '» ARRIVED', 'c', null]]) {
    const art = new Art(w, h); art.text(px + 2, py + 2, label, key);
    layers.push(layer(`link-${state}`, art, { when: { link: [state], ...(stop ? { stop } : {}) } }));
  }
  effects.push({ kind: 'sprite', id: 'carp-hangar', frames: CARP_LEFT, from: [w + 2, port ? 36 : 16], to: [-10, port ? 39 : 21], duration: port ? 10 : 16, every: 60, offset: 18, fps: 2 });
  effects.push({ kind: 'scan', id: 'link-scan', region: [px + 2, py + 3, pw - 3, 1], speed: 1, glyph: '·', colour: 'H' });
  base.text(px + 2, py + 4, 'WHITELIST', 'h');
  for (const [state, label, key] of [['none', 'NOT REQUESTED', 'c'], ['requested', 'REQUESTED', 'a'], ['confirmed', 'CONFIRMED', 'c']]) {
    const art = new Art(w, h); art.text(px + pw - 1 - label.length, py + 4, label, key);
    layers.push(layer(`link-whitelist-${state}`, art, { when: { whitelist: [state] } }));
  }
  const cxl = px + pw - 6, by = Math.min(h - 1, conTop + 5);
  for (let y = panelBottom + 1; y < by; y++) base.put(cxl, y, '│', 'h');
  base.put(cxl, by, '╰', 'h'); base.text(cxl + 1, by, '──', 'h'); base.text(cxl + 3, by, '[≡]', 'o'); base.put(cxl + 4, by, '≡', 'h');
  const cable = []; for (let y = panelBottom + 1; y < by; y++) cable.push([cxl, y]); cable.push([cxl, by], [cxl + 1, by], [cxl + 2, by]);
  effects.push({ kind: 'pulse', id: 'cable-pulse', path: cable, speed: 4, glyph: '•', colour: 'c' });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: departure lounge ----------
const LOUNGE_BEATS = ['adult', 'pride', 'voluntary', 'amenities', 'expectations', 'meridian', 'wolfgate'];
const except = (all, ...out) => ['none', ...all.filter(beat => !out.includes(beat))];
function lounge(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [], reserved = [];
  const reserve = (x0, y0, x1, y1) => reserved.push([x0, y0, x1, y1]);
  tubes(base, w);
  effects.push({ kind: 'flicker', id: 'tube-flicker', region: [54, 1, 10, 1], hz: 2.5, chance: 0.3, colour: 'd' });
  // Departures board, with the flavour rows that make it a working terminal.
  const bw = port ? 46 : 40, bx = Math.floor(w / 2 - bw / 2), by = 3;
  base.box(bx, by, bx + bw - 1, by + 8, 'o', '╔╗╚╝═║'); reserve(bx - 1, by - 1, bx + bw, by + 12);
  base.put(bx + 4, by - 1, '│', 'd'); base.put(bx + bw - 5, by - 1, '│', 'd'); base.put(bx - 1, by, 'o', 'o'); base.put(bx + bw, by, 'o', 'o');
  base.text(bx + 2, by + 1, 'DEPARTURES', 'a'); base.text(bx + bw - 15, by + 1, 'SHUTTLE LINE', 'A');
  base.hline(bx + 1, bx + bw - 2, by + 2, '─', 'd');
  effects.push({ kind: 'text', id: 'board-current', x: bx + 2, y: by + 3, width: bw - 14, template: '{stopNumber:2}  {stopTitle}', colour: 'a' });
  effects.push({ kind: 'flap', id: 'board-status', x: bx + bw - 12, y: by + 3, width: 10, texts: ['BOARDING'], period: 6, flip: 0.5, colour: 'a' });
  effects.push({ kind: 'blink', id: 'board-blink', region: [bx + bw - 12, by + 3, 10, 1], hz: 0.7, on: 'a', off: 'A' });
  const servers = ['meridian', 'wolfgate'];
  const rows = [
    ['02', 'MINING SHUTTLE', ['DELAYED', 'CARP!'], 7],
    ['03', 'EMERGENCY SHUTTLE', ['CALLED', 'RECALLED'], 9],
    ['04', 'CARGO SHUTTLE', ['LOADING', 'DEPARTED', 'LOADING'], 11],
    ['05', 'CLOWN CAR', ['HONK', 'HONK!'], 5],
  ];
  const usual = new Art(w, h), ours = new Art(w, h);
  rows.forEach(([number, place, statuses, period], r) => {
    const y = by + 4 + r;
    base.text(bx + 2, y, number, 'A');
    (r < 2 ? usual : base).text(bx + 6, y, place, 'A');
    effects.push({ kind: 'flap', id: `board-row-${number}`, x: bx + bw - 12, y, width: 10, texts: statuses, period, flip: 0.4, colour: 'A',
      ...(r < 2 ? { when: { beat: except(LOUNGE_BEATS, ...servers) } } : {}) });
  });
  // About our servers: the board lists them in place of the first two flavour rows.
  ours.text(bx + 6, by + 4, 'MERIDIAN RIFT  · SS 13', 'a'); ours.text(bx + 6, by + 5, 'WOLFGATE       · SS 14', 'a');
  layers.push(layer('board-usual', usual, { when: { beat: except(LOUNGE_BEATS, ...servers) } }), layer('board-ours', ours, { when: { beat: servers } }));
  effects.push({ kind: 'flap', id: 'board-meridian', x: bx + bw - 12, y: by + 4, width: 10, texts: ['ONLINE'], period: 30, flip: 0.5, colour: 'c', when: { beat: servers } });
  effects.push({ kind: 'flap', id: 'board-wolfgate', x: bx + bw - 12, y: by + 5, width: 10, texts: ['IN DEV'], period: 30, flip: 0.5, colour: 'h', when: { beat: servers } });
  // The new strip, on fresh brackets.
  const sy = by + 10, sw = bw - 2, sx0 = bx + 1;
  base.put(bx + 6, by + 8, '╪', 'h'); base.put(bx + bw - 7, by + 8, '╪', 'h'); base.put(bx + 6, by + 9, '│', 'H'); base.put(bx + bw - 7, by + 9, '│', 'H');
  base.box(sx0, sy, sx0 + sw - 1, sy + 2, 'h');
  effects.push({ kind: 'text', id: 'strip', x: sx0 + 2, y: sy + 1, width: sw - 4, template: '» {stopTitle} · SECTION {section}/{sections}', colour: 'c', align: 'center' });
  // Pride: the strip's brackets string up a stripe banner.
  const pride = new Art(w, h);
  for (let x = bx + 7; x < bx + bw - 7; x++) pride.put(x, by + 9, '▄', String(1 + Math.floor((x - bx - 7) / ((bw - 14) / 7)) % 7));
  layers.push(layer('pride-banner', pride, { when: { beat: ['pride'] } }));

  // Help desk terminal: its screen follows the section Sophie is reading.
  const desk = (x, y) => {
    reserve(x, y, x + 18, y + 6); base.fill(x, y, x + 18, y + 6, ' ', ' '); base.box(x, y, x + 18, y + 4, 'o'); base.text(x + 4, y, ' HELP DESK ', 'A');
    // The stand is centred under the screen: odd widths share the box's centre column.
    base.text(x + 5, y + 5, '/       \\', 'd'); base.text(x + 4, y + 6, '/_________\\', 'd');
    const screens = [['none', 'ASK ANYTHING', 'STAFF ON CALL'], ['adult', 'AGE CHECK', '18+ ONLY'], ['pride', 'ALL ABOARD', 'BE YOURSELF'],
      ['voluntary', 'BOARDING IS', 'VOLUNTARY'], ['amenities', 'NEED HELP?', '#open-a-ticket'], ['expectations', 'READ THE WIKI', 'RULES FIRST'],
      ['meridian', 'MERIDIAN RIFT', 'SS 13 SERVER'], ['wolfgate', 'WOLFGATE', 'SS 14 · SOON']];
    for (const [beat, top, bottom] of screens) {
      const art = new Art(w, h); art.text(x + 2, y + 1, top, 'c'); art.text(x + 2, y + 2, bottom, beat === 'none' ? 'h' : 'a');
      art.text(x + 2, y + 3, '>_', 'H');
      layers.push(layer(`desk-${beat}`, art, { when: { beat: [beat] } }));
    }
    effects.push({ kind: 'blink', id: 'desk-cursor', region: [x + 3, y + 3, 1, 1], hz: 1, on: 'h', off: 'H' });
  };
  // Wall fittings: APC, air alarm and fire alarm (the one to pull if you smell fire).
  const fittings = (x, y, compact = false) => {
    reserve(x, y, x + (compact ? 9 : 18), y + 2);
    prop(base, x, y, ['┌───┐', '│APC│', '└─┬─┘'], ['ooooo', 'oIIIo', 'ooooo']); base.put(x + 2, y + 3, '│', 'd');
    effects.push({ kind: 'blink', id: 'apc-light', region: [x + 2, y + 1, 1, 1], hz: 0.5, on: '4', off: 'I' });
    if (!compact) { prop(base, x + 7, y, ['[ • ]', ' AIR '], ['o4o', 'ddddd']); base.put(x + 9, y, '•', '4'); }
    const fx = x + (compact ? 6 : 14);
    prop(base, fx, y, ['[!]', 'FIRE'], ['oro', 'dddd']);
    effects.push({ kind: 'blink', id: 'fire-alarm', region: [fx + 1, y, 1, 1], hz: 2, on: 'r', off: 'A', when: { beat: ['amenities'] } });
  };
  // EXIT, unlit until Sophie reminds you nobody is forcing you aboard.
  const exitSign = (x, y) => {
    reserve(x, y, x + 9, y);
    base.text(x, y, '[ EXIT » ]', 'd');
    const lit = new Art(w, h); lit.text(x, y, '[ EXIT » ]', '4'); layers.push(layer('exit-lit', lit, { when: { beat: ['voluntary'] } }));
  };
  // A station poster nobody reads: do not feed the carp.
  const poster = (x, y) => {
    reserve(x, y, x + 11, y + 5);
    base.box(x, y, x + 11, y + 5, 'A');
    for (const [text, row] of [['DO NOT', 1], ['FEED THE', 2], ['CARP', 3]]) base.text(x + 1 + Math.floor((10 - text.length) / 2), y + row, text, 'r');
    prop(base, x + 4, y + 4, ['}<o>'], 'h');
  };

  if (!port) {
    // A reinforced window onto real space, a gas giant in the corner.
    reserve(2, 3, 24, 14);
    const win = reinforcedWindow(base, effects, 'window', 2, 3, 24, 14, 2, 5);
    prop(base, win.gx1 - 6, 10, ['  .--.', ' (::::)', '(::::::'], ['  IIII', ' AAAAAA', 'AAAAAAA']);
    const gx = w - 25, nx = w - 23, ny = 6;
    reserve(gx, 2, w - 1, ny + 2);
    for (let y = 2; y < ny; y++) { base.put(nx + 3, y, '│', 'H'); base.put(nx + 13, y, '│', 'H'); }
    ['+-----------------+', '|    GATE   03    |', '+-----------------+'].forEach((line, r) => [...line].forEach((ch, j) => {
      if (ch === ' ') return;
      if ('-+|'.includes(ch) && hash(gx + j, 4 + r) < 0.18) return;
      base.put(gx + j, 4 + r, ch, /[A-Z0-9]/.test(ch) ? 'r' : 'A');
    }));
    const adult = new Art(w, h); adult.text(gx + 20, 5, '18+', 'p');
    layers.push(layer('gate-adult', adult, { when: { beat: ['adult'] } }));
    effects.push({ kind: 'blink', id: 'gate-adult-blink', region: [gx + 20, 5, 3, 1], hz: 1, on: 'p', off: 'A', when: { beat: ['adult'] } });
    base.fill(nx, ny, nx + 16, ny + 2, ' ', ' '); base.box(nx, ny, nx + 16, ny + 2, 'h'); base.text(nx + 2, ny + 1, 'SHUTTLE', 'c'); base.text(nx + 11, ny + 1, '»»»', 'H');
    effects.push({ kind: 'pulse', id: 'sign-chase', path: [[nx + 11, ny + 1], [nx + 12, ny + 1], [nx + 13, ny + 1]], speed: 4, glyph: '»', colour: 'c' });
    // The help desk stands on the floor now that the whole room is in view.
    exitSign(w - 26, 11); poster(w - 14, 10); fittings(3, 15);
  } else {
    reserve(1, 3, 11, 13); reserve(w - 12, 3, w - 2, 13);
    reinforcedWindow(base, effects, 'window-left', 1, 3, 11, 13, 1, 5);
    reinforcedWindow(base, effects, 'window-right', w - 12, 3, w - 2, 13, 1, 9);
    fittings(1, 14, true); exitSign(w - 11, 15);
  }
  // Trim rail and the worn lower wall.
  const railY = port ? 17 : 18;
  for (let x = 0; x < w; x++) if (base.get(x, railY) === ' ') base.put(x, railY, '═', 'o');
  wallPanels(base, 0, 2, w - 1, railY - 1, 3, 12, reserved);

  // Seats: worn benches, one of them hiding a fluffy tail.
  const seatY = port ? 19 : 20, sxs = port ? 4 : 14, ex = port ? w - 6 : w - 14;
  for (let x = sxs; x <= ex - 4; x += 6) { base.text(x, seatY, ' ___ ', 'o'); base.text(x, seatY + 1, '|___|', '.'); base.text(x, seatY + 2, ' | | ', 'd'); }
  const tail = new Art(w, h); prop(tail, sxs + 6 * 4 + 4, seatY - 1, ['~@'], ['rr']);
  layers.push(layer('pride-tail', tail, { when: { beat: ['pride'] } }));

  // Floor: perspective tiles, scuffs, cracked tiles and the usual station litter.
  const vx = w / 2, vy = 12;
  for (let y = seatY + 3; y < h; y++) {
    for (let k = -7; k <= 7; k++) base.put(Math.round(vx + k * (y - vy) * 1.5), y, k < 0 ? '/' : k > 0 ? '\\' : '|', 'd');
    if ((y - seatY) % 3 === 0) for (let x = 0; x < w; x += 2) if (base.get(x, y) === ' ') base.put(x, y, '_', 'd');
  }
  for (let y = seatY + 3; y < h; y++) for (let x = 0; x < w; x++) {
    if (base.get(x, y) !== ' ') continue;
    const r = hash(x * 5 + 17, y * 11);
    if (r < 0.018) base.put(x, y, '·', 'd'); else if (r < 0.021) base.put(x, y, 'x', 'd');
  }
  const floorProps = port
    ? [[6, 24, ...WET_SIGN], [44, 40, ['_\\/_'], 'a'], [14, 48, [' ,-.', '[▄▄▄]'], [' ddd', 'rrrrr']], [56, 32, ['[u]'], 'r'], [30, 52, ["-'  -'"], 'I']]
    : [[6, 25, ...WET_SIGN], [54, 36, ['_\\/_'], 'a'], [60, 27, [' ,-.', '[▄▄▄]'], [' ddd', 'rrrrr']],
      [34, 31, ['[u]'], 'r'], [42, 37, ["-'  -'"], 'I'], [22, 37, ['[≡]'], 'H'], [12, 32, ['≡≡≡≡'], 'd']];
  for (const [x, y, lines, keys] of floorProps) {
    for (let r = 0; r < lines.length; r++) for (let c = 0; c < [...lines[r]].length; c++) base.put(x + c, y + r, ' ', ' ');
    prop(base, x, y, lines, keys);
  }
  if (port) desk(48, 41); else desk(w - 22, 26);
  effects.push({ kind: 'drift', id: 'dust', region: [port ? 4 : 14, seatY - 4, port ? w - 8 : w - 28, 3], seed: 9, density: 0.02, speed: 0.3, glyphs: '·', colours: 'I' });
  // Ian makes his rounds.
  effects.push({ kind: 'sprite', id: 'ian', frames: CORGI, from: [-12, port ? 44 : 34], to: [w + 2, port ? 44 : 34], duration: port ? 10 : 14, every: 75, offset: 40, fps: 4 });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: pressure door and new laboratory ----------
const DOOR_BEATS = ['watch-step', 'feedback', 'be-safe', 'ready', 'get-whitelisted'];
const VENDING = [['┌───────┐', '│ SPACE │', '│ COLA  │', '│▒▒▒ ▒▒▒│', '│ [___] │', '└───────┘'], ['ooooooooo', 'o ppppp o', 'o pppp  o', 'orrr ccco', 'o ddddd o', 'ooooooooo']];
const PLANT = [['\\\\|//', ' \\|/', ' [_]'], ['44444', ' 444', ' ooo']];
// The janitor mops; the mop head swings from one side to the other.
const JANITOR = [
  [['  o', ' /|\\_', ' / \\ \\', '     ~~'], ['  i', ' ppp', ' I I o', '     cc']],
  [['  o', ' /|\\_', ' / \\ |', '    ~~~'], ['  i', ' ppp', ' I I o', '    ccc']],
];
// Two crew by the door wave arrivals in, one arm and then the other.
const GREETER = [[['\\o ', ' |\\', '/ \\'], ['hi ', ' hh', 'I I']], [[' o/', '/| ', '/ \\'], [' ih', 'hh ', 'I I']]];
function door(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), light = new Art(w, h), effects = [], layers = [];
  const dw = port ? 30 : 28, cx = Math.round(w / 2), dx0 = cx - dw / 2, dx1 = cx + dw / 2;
  // Landscape leaves the lower half of the room for the arrivals deck, all of it in view.
  const dy0 = 4, dy1 = port ? Math.round(h * 0.47) : 22, cyl = Math.round((dy0 + dy1) / 2);
  for (let y = dy0 - 1; y <= dy1; y++) for (const x of [dx0 - 2, dx0 - 1, dx1 + 1, dx1 + 2]) base.put(x, y, x === dx0 - 1 || x === dx1 + 1 ? '▒' : '▓', x === dx0 - 1 || x === dx1 + 1 ? '.' : 'o');
  base.hline(dx0 - 2, dx1 + 2, dy0 - 1, '▓', 'o'); base.hline(dx0 - 2, dx1 + 2, dy0, '▒', '.');
  const sten = port ? ' DOOR 07 · KEEP CLEAR ' : ' PRESSURE DOOR 07 · KEEP CLEAR ';
  const s0 = cx - Math.floor(sten.length / 2);
  // Worn stencil: some letters are faded rather than missing, so the sign stays readable.
  [...sten].forEach((ch, j) => base.put(s0 + j, dy0 - 1, ch, ch !== ' ' && hash(s0 + j, 9) < 0.12 ? 'A' : 'r'));
  base.text(cx - 1, dy0 - 3, '( )', 'o');
  const lampIdle = new Art(w, h); lampIdle.put(cx, dy0 - 3, '●', 'A');
  layers.push(layer('lamp-idle', lampIdle, { when: { whitelist: ['none'] } }));
  const lampWait = new Art(w, h); lampWait.put(cx, dy0 - 3, '●', 'a');
  layers.push(layer('lamp-waiting', lampWait, { when: { whitelist: ['requested'] } }));
  effects.push({ kind: 'blink', id: 'lamp-blink', region: [cx, dy0 - 3, 1, 1], hz: 1, on: 'a', off: 'A', when: { whitelist: ['requested'] } });
  const lampOpen = new Art(w, h); lampOpen.put(cx, dy0 - 3, '●', 'h');
  layers.push(layer('lamp-confirmed', lampOpen, { when: { whitelist: ['confirmed'] } }));
  // The welcome banner over the door, with bunting along the top of the wall either side of it.
  const banner = '[ WELCOME TO APHELION ]', bx0 = cx - Math.floor(banner.length / 2);
  for (let x = 1; x < w - 1; x++) if (x < bx0 - 1 || x > bx0 + banner.length) base.put(x, 0, x % 2 ? 'v' : '·', x % 2 ? String(1 + (Math.floor(x / 2) % 7)) : 'd');
  base.text(bx0, 0, banner, 'h'); base.text(bx0 + 2, 0, 'WELCOME TO APHELION', 'a');

  const ramp = ' .:-=+*#%@';
  for (let y = dy0 + 1; y < dy1; y++) for (let x = dx0; x <= dx1; x++) {
    const d = Math.hypot((x - cx) * ADV, (y - cyl) * 1.1), I = Math.min(1, Math.max(0, (1 - d / (dw * 0.38)) * 0.9 + 0.2));
    if (I < 0.04) continue;
    const idx = Math.min(9, Math.floor(I * 10)); light.put(x, y, ramp[idx], idx >= 4 ? 'c' : 'I');
  }
  const wy = dy1 - 4;
  light.text(dx0 + 4, wy, '┬' + '─'.repeat(dw - 9) + '┬', 'h'); light.put(dx0 + 4, wy + 1, '│', 'H'); light.put(dx1 - 4, wy + 1, '│', 'H');
  light.text(cx - 3, wy - 4, '┌────┐', 'h'); light.text(cx - 3, wy - 3, '│ ▒▒ │', 'h'); light.text(cx - 3, wy - 2, '└─┬┬─┘', 'h'); light.text(cx - 1, wy - 1, '││', 'H');
  layers.push(layer('laboratory', light, { when: { whitelist: ['confirmed'] } }));

  const half = dw / 2, hy = dy1 - 6;
  for (const right of [false, true]) {
    const leaf = new Art(w, h);
    // The right leaf is one column wider so the two meet the frame on both sides with no gap.
    for (let y = dy0 + 1; y < dy1; y++) for (let c = 0; c < half + (right ? 1 : 0); c++) {
      const x = right ? cx + c : dx0 + c;
      let ch = '▒', key = 'd';
      if (right ? c === 0 : c === half - 1) { ch = '│'; key = 'o'; }
      else if (y >= hy && y <= hy + 2) { if ((c + y) % 4 < 2) { ch = right ? '\\' : '/'; key = 'r'; } }
      else if (y === dy0 + 4 && !right && c === half - 3) { ch = '0'; key = 'I'; }
      else if (y === dy0 + 4 && right && c === 2) { ch = '7'; key = 'I'; }
      else if ((y - dy0) % 5 === 0 && (c === 1 || c === half - 2)) { ch = 'o'; key = '.'; }
      else if (hash(c * 3 + (right ? 77 : 0), y) < 0.07) { ch = '·'; key = '.'; }
      leaf.put(x, y, ch, key);
    }
    layers.push(layer(right ? 'leaf-right' : 'leaf-left', leaf, { opaque: true, slide: { by: 'doorOpen', dx: right ? half + 1 : -half, clip: [dx0, dy0 + 1, dw + 1, dy1 - dy0 - 1] } }));
  }
  base.hline(dx0 - 2, dx1 + 2, dy1, '▀', 'd');
  const cxR = dx1 + (port ? 5 : 4);
  base.vline(cxR, dy0, dy1 - 1, '║', 'H'); base.put(cxR, dy0 - 1, '╔', 'H');
  const conduit = []; for (let y = dy0; y < dy1; y++) conduit.push([cxR, y]);
  effects.push({ kind: 'pulse', id: 'conduit-slow', path: conduit, speed: 4, glyph: '•', colour: 'c', when: { whitelist: ['none', 'requested'] } });
  effects.push({ kind: 'pulse', id: 'conduit-fast', path: conduit, speed: 14, glyph: '•', colour: 'c', when: { whitelist: ['confirmed'] } });
  const rows = {
    idle: [['WHITELIST', 'NOT REQUESTED'], ['DISCORD', '--'], ['DOOR', 'HELD']],
    waiting: [['WHITELIST', 'REQUESTED'], ['DISCORD', 'WAITING'], ['DOOR', 'HELD']],
    open: [['WHITELIST', 'CONFIRMED'], ['DISCORD', 'APPLIED'], ['DOOR', 'OPEN']],
  };
  const PANEL_STATES = [['idle', ['none'], 'A'], ['waiting', ['requested'], 'a'], ['open', ['confirmed'], 'c']];
  // The station board: how many crew this station has and how many are on now (server counts, never anyone's details).
  const boardW = port ? 16 : 27, boardX = port ? 1 : 2, boardY = dy0 + 1, boardH = port ? 7 : 6;
  base.box(boardX, boardY, boardX + boardW - 1, boardY + boardH - 1, 'h'); base.text(boardX + 2, boardY, port ? ' STATION ' : ' STATION BOARD ', 'h');
  const count = (id, label, key, y) => {
    if (port) { base.text(boardX + 2, y, label, 'H'); effects.push({ kind: 'text', id, x: boardX + 2, y: y + 1, width: boardW - 4, template: `{${key}}`, colour: 'c', align: 'right' }); }
    else { base.text(boardX + 2, y, label, 'H'); effects.push({ kind: 'text', id, x: boardX + 14, y, width: boardW - 16, template: `{${key}}`, colour: 'c', align: 'right' }); }
  };
  count('board-crew', 'CREW ABOARD', 'crew', boardY + 1);
  count('board-online', port ? 'ONLINE NOW' : 'ONLINE NOW', 'online', port ? boardY + 3 : boardY + 2);
  if (!port) {
    base.text(boardX + 2, boardY + 4, 'DOCK 07 · ARRIVALS', 'A');
    effects.push({ kind: 'blink', id: 'board-live', region: [boardX + boardW - 4, boardY + 4, 1, 1], hz: 1, on: 'c', off: 'H' });
    base.put(boardX + boardW - 4, boardY + 4, '●', 'c');
    base.hline(boardX + boardW, dx0 - 3, boardY + 3, '─', 'H'); base.put(boardX + boardW - 1, boardY + 3, '╪', 'h');
    const px = dx1 + 6, pw = w - px - 1, py = dy0 + 1;
    base.box(px, py, px + pw, py + 6, 'h'); base.text(px + 2, py, ' ARRIVAL CONTROL ', 'h'); base.put(px, py + 3, '╪', 'h'); base.hline(dx1 + 3, px - 1, py + 3, '─', 'H');
    for (const [state, when, key] of PANEL_STATES) {
      const art = new Art(w, h);
      rows[state].forEach(([k, v], r) => { art.text(px + 2, py + 2 + r, k, 'h'); art.text(px + 12, py + 2 + r, '» ' + v, key); });
      layers.push(layer(`control-${state}`, art, { when: { whitelist: when } }));
    }
  } else {
    const px = dx1 + 7, pw = w - px - 1, py = dy0 + 1;
    base.box(px, py, px + pw, py + 4, 'h');
    const short = { idle: ['--', 'HELD'], waiting: ['WAIT', 'HELD'], open: ['OK', 'OPEN'] };
    for (const [state, when, key] of PANEL_STATES) {
      const art = new Art(w, h), [wl, dr] = short[state];
      art.text(px + 1, py + 1, 'WL', 'h'); art.text(px + 4, py + 1, wl, key); art.text(px + 1, py + 2, 'DOOR', 'h'); art.text(px + 6, py + 2, dr, key);
      layers.push(layer(`control-${state}`, art, { when: { whitelist: when } }));
    }
  }
  // Two crew either side of the door wave arrivals in.
  const greetY = dy1 - 2, greetL = port ? dx0 - 6 : dx0 - 7, greetR = port ? dx1 + 9 : dx1 + 8;
  const greeters = GREETER.map(([lines, keys]) => { const art = new Art(w, h); prop(art, greetL, greetY, lines, keys); prop(art, greetR, greetY, lines, keys); return art; });
  layers.push(framesLayer('greeters', greeters, 2));

  // The arrivals deck: one fixture for each part of Disembarking, on clean rows.
  const deck = [];
  const floorY = dy1 + 1;
  for (let y = floorY + 1; y < h; y++) for (let x = 0; x < w; x++) {
    if ((y - floorY) % 4 === 0) { if (x % 2 === 0) base.put(x, y, '_', 'd'); }
    else if (hash(x * 7 + 3, y * 5) < 0.015) base.put(x, y, '·', 'd');
  }
  for (let x = 0; x < w; x++) base.put(x, floorY, x % 4 < 2 ? '/' : ' ', x % 4 < 2 ? 'r' : ' ');
  const clearArea = (x, y, cols, rows) => base.fill(x, y, x + cols - 1, y + rows - 1, ' ', ' ');
  const beatLayer = (id, art, beats) => deck.push(layer(id, art, { when: { beat: beats } }));
  const rowA = port ? floorY + 3 : floorY + 2, rowB = port ? rowA + 8 : rowA + 8, rowC = rowB + 8;
  // Landscape: the checklist and the game monitor hang on the walls either side of the door; portrait: on the deck.
  const at = port
    ? { wet: [2, rowA], feedback: [26, rowA], safe: [w - 17, rowA], checklist: [2, rowB], game: [w - 25, rowB], carts: [2, rowC], vending: [w - 12, rowC] }
    : { wet: [2, rowA], feedback: [27, rowA], safe: [w - 34, rowA], checklist: [2, boardY + boardH + 2], game: [w - 26, dy0 + 10], carts: [2, rowB], vending: [w - 12, rowA] };
  {
    // Watch your step and do not run: the janitor mops, and puts the wet floor sign out.
    const [x, y] = at.wet; clearArea(x, y, 22, 6);
    deck.push(framesLayer('janitor', JANITOR.map(([lines, keys]) => { const art = new Art(w, h); prop(art, x, y + 1, lines, keys); return art; }), 1.5));
    prop(base, x + 8, y + 3, ['[___]'], 'a');
    const sign = new Art(w, h); prop(sign, x + 15, y + 1, ...WET_SIGN); sign.text(x + 12, y + 4, 'NO RUNNING', 'r');
    beatLayer('deck-wet', sign, ['watch-step']);
    effects.push({ kind: 'blink', id: 'deck-wet-blink', region: [x + 12, y + 4, 10, 1], hz: 1, on: 'r', off: 'A', when: { beat: ['watch-step'] } });
  }
  {
    // Feedback is a two-way street: a box, and a note going in.
    const [x, y] = at.feedback; clearArea(x, y, 16, 6);
    prop(base, x, y + 1, ['┌──────────────┐', '│  FEEDBACK    │', '│   [______]   │', '└──────────────┘'], ['oooooooooooooooo', 'oAAAAAAAAAAAAAAo', 'oddddddddddddddo', 'oooooooooooooooo']);
    const notes = [0, 1, 2, 3].map(f => { const art = new Art(w, h); if (f < 3) art.text(x + 6, y + f, f === 2 ? '[▒]' : '[=]', 'i'); return art; });
    deck.push({ ...framesLayer('deck-feedback-note', notes, 1.5), when: { beat: ['feedback'] } });
  }
  {
    // Be safe, Spacer: the emergency locker, internals and all.
    const [x, y] = at.safe; clearArea(x, y, 16, 6);
    prop(base, x, y, ['┌─ EMERGENCY ─┐', '│  ()   [O2]  │', '│  /\\   [O2]  │', '│             │', '└─────────────┘'], ['ooooooooooooooo', 'o  II   aaaa  o', 'o  II   aaaa  o', 'o             o', 'ooooooooooooooo']);
    const lit = new Art(w, h); lit.text(x + 2, y + 3, 'INTERNALS ON', 'c'); beatLayer('deck-internals', lit, ['be-safe']);
    effects.push({ kind: 'blink', id: 'deck-locker-blink', region: [x + 2, y + 3, 12, 1], hz: 1, on: 'c', off: 'H', when: { beat: ['be-safe'] } });
  }
  {
    // Ready to disembark? The checklist ticks itself off as Sophie reads it.
    const [x, y] = at.checklist, items = ['18+ & ADULT NOTICE', 'THE RULES APPLY', 'RESPECT BOUNDARIES', 'KNOW WHERE TO ASK'];
    clearArea(x, y, 28, 6);
    base.box(x, y, x + 27, y + 5, 'o'); base.text(x + 2, y, ' BOARDING CHECKLIST ', 'A');
    items.forEach((item, i) => base.text(x + 2, y + 1 + i, `[ ] ${item}`, 'I'));
    const ticks = [0, 1, 2, 3, 4].map(f => { const art = new Art(w, h); for (let i = 0; i < Math.min(f, 4); i++) art.put(x + 3, y + 1 + i, 'x', 'c'); if (f === 0) art.put(x + 3, y + 1, ' ', ' '); return art; });
    deck.push({ ...framesLayer('deck-checklist', ticks, 0.8), when: { beat: ['ready'] } });
    const done = new Art(w, h); items.forEach((_, i) => done.put(x + 3, y + 1 + i, 'x', 'c'));
    deck.push(layer('deck-checklist-done', done, { when: { beat: ['get-whitelisted'] } }));
  }
  {
    // The last step happens in the game: its [ Get Whitelisted ] button.
    const [x, y] = at.game; clearArea(x, y, 23, 6);
    prop(base, x, y, ['┌─────────────────────┐', '│ MERIDIAN RIFT       │', '│                     │', '│                     │', '└────────┬───┬────────┘', '        /_____\\'], ['ooooooooooooooooooooooo', 'oaaaaaaaaaaaaaa      o', 'o                     o', 'o                     o', 'ooooooooooooooooooooooo', '        ddddddd']);
    base.text(x + 2, y + 2, '[ Get Whitelisted ]', 'H');
    const lit = new Art(w, h); lit.text(x + 2, y + 2, '[ Get Whitelisted ]', 'c'); lit.text(x + 2, y + 3, '> link via Discord', 'I');
    beatLayer('deck-get-whitelisted', lit, ['get-whitelisted']);
    effects.push({ kind: 'blink', id: 'deck-button-blink', region: [x + 2, y + 2, 19, 1], hz: 1, on: 'c', off: 'h', when: { beat: ['get-whitelisted'] } });
  }
  {
    // Luggage carts waiting for their owners, a vending machine and plants.
    const [x, y] = at.carts;
    clearArea(x, y + 1, 19, 4);
    prop(base, x, y + 1, ['  .--. .__.  ,~~.', ' [====][▓▓▓](====)', '|_________________|', ' o               o'], ['  oooo oooo  IIII', ' AAAAAArrrrrhhhhhh', 'ddddddddddddddddddd', ' d               d']);
    const [vx, vy] = at.vending;
    clearArea(vx, vy, 9, 6); prop(base, vx, vy, ...VENDING);
    effects.push({ kind: 'flicker', id: 'cola-neon', region: [vx + 2, vy + 1, 5, 2], hz: 1.5, chance: 0.15, colour: 'd' });
    const plant = (px, py) => { clearArea(px, py, 5, 3); prop(base, px, py, ...PLANT); };
    plant(port ? vx - 7 : x + 22, port ? vy + 3 : y + 2);
    if (!port) { clearArea(w - 25, rowB + 2, 11, 2); prop(base, w - 25, rowB + 2, ['[═════════]', ' |       |'], ['ooooooooooo', ' d       d']); plant(w - 13, rowB + 1); }
  }
  // Access granted: an ID card, shown only once Discord has applied Whitelist.
  const card = new Art(w, h), cw = 22, ccx = Math.round(w / 2 - cw / 2), ccy = port ? rowC + 1 : rowB + 1;
  card.fill(ccx, ccy, ccx + cw - 1, ccy + 3, ' ', ' ');
  prop(card, ccx, ccy, ['┌────────────────────┐', '│ ID ▓▓  CREW        │', '│ ACCESS: WHITELIST  │', '└────────────────────┘'], ['hhhhhhhhhhhhhhhhhhhhhh', 'h iiAA  cccc        h', 'h IIIIIII ccccccccc  h', 'hhhhhhhhhhhhhhhhhhhhhh']);
  deck.push(layer('id-card', card, { opaque: true, when: { whitelist: ['confirmed'] } }));
  effects.push({ kind: 'sprite', id: 'cleanbot', frames: [spriteFrame(['[o_o]', ' o o'], ['hhhhh', ' d d']), spriteFrame(['[o_o]', 'o   o'], ['hhhhh', 'd   d'])],
    from: [-7, h - 3], to: [w + 2, h - 3], duration: port ? 12 : 18, every: 85, offset: 50, fps: 2 });
  // New arrivals walk off the shuttle and across the deck now and then.
  const [ah, ahk, ab] = LOOKS[3];
  effects.push({ kind: 'sprite', id: 'arrival', frames: walker(ah, ahk, ab), from: [w + 1, h - 6], to: [-4, h - 6], duration: port ? 10 : 14, every: 45, offset: 20, fps: 4 });

  // Order: frame and fittings, the laboratory behind the door, the sliding leaves, then lamp and control text.
  const byId = Object.fromEntries(layers.map(l => [l.id, l]));
  return { layers: [layer('base', base), byId.laboratory, byId['leaf-left'], byId['leaf-right'], byId['lamp-idle'], byId['lamp-waiting'], byId['lamp-confirmed'],
    byId['control-idle'], byId['control-waiting'], byId['control-open'], byId.greeters, ...deck], effects };
}

function strip(base, effects, x, y, width) {
  base.box(x, y, x + width - 1, y + 2, 'h');
  effects.push({ kind: 'text', id: 'strip', x: x + 2, y: y + 1, width: width - 4, template: '» {stopTitle} · {section}/{sections}', colour: 'c', align: 'center' });
}
function tubes(base, w) { for (let x = 6; x < w - 8; x += 24) { base.put(x - 1, 1, '[', 'd'); base.put(x + 10, 1, ']', 'd'); base.text(x, 1, '══════════', 'I'); } }

// ---------- scene: baggage hall ----------
const BAGGAGE_BEATS = ['migrating', 'past', 'looc'];
const CLOWN = [
  spriteFrame(['HONK!', ' \\o/', '  |', ' / \\'], ['aaaaa', ' rpr', '  r', ' r r']),
  spriteFrame(['', ' \\o/', '  |', '  |\\'], ['', ' rpr', '  r', '  rr']),
];
// Luggage: ten kinds, each riding the belt as its own item so it keeps its shape and tag from one end to the other.
const BAGS = [
  [[' .--. ', '[====]'], ['oooooo', 'AAAAAA']],
  [['  __  ', '[▒▒▒▒]'], ['  oo  ', 'rrrrrr']],
  [[' .__. ', '[▓▓▓▓]'], ['oooooo', 'AAAAAA']],
  [['  ,~~. ', '(=====)'], ['  IIII ', 'hhhhhhh']],
  [[' __     ', '(__)===>'], ['ooo     ', 'rrrrAAAA']],
  [['.----.', '|FRGL|'], ['AAAAAA', 'ArrrrA']],
  [[' ,-. ', '[▄▄▄]'], [' ddd ', 'rrrrr']],
  [['.----.', '|=^.^|'], ['oooooo', 'oiiiio']],
  [['.____.', '[_▀▀_]'], ['IIIIII', 'IhhhhI']],
  [[' (") ', '(_=_)'], [' 444 ', '44444']],
];
// Where migrating players' luggage comes from (owner direction, 22 October 2026): SS 13 servers go on to Meridian Rift,
// SS 14 servers to Wolfgate. Two bags in each run are refused at the scanner and go down the disposal chute, labelled
// for the section being read.
const ORIGINS = [['BUBBER', 13], ['MONOLITH', 14], ['SPLURT', 13], ['HARDLIGHT', 14], ['NOVA', 13], ['AFTERLIGHT', 14], ['OCULIS', 13],
  ['FRONTIER', 14], ['RATWOOD', 13], ['WAYFARER', 14], ['MARINES', 13]];
const DENIED = { '*': ['CONTRABAND', 'TOXICITY'], migrating: ['BIGOTRY', 'BLASTWAVE'], past: ['GRUDGES', 'OLD DRAMA'], looc: ['METAGAME', 'ASSUMPTION'] };
const PASSENGER = [
  spriteFrame([' o ', '/|\\', '/ \\'], ['iii', 'hhh', 'III']),
  spriteFrame([' o ', '/|\\', ' | '], ['iii', 'hhh', ' I ']),
];
const PASSENGER_B = [
  spriteFrame([' @ ', '/|\\', '/ \\'], ['rrr', 'aaa', 'III']),
  spriteFrame([' @ ', '/|\\', ' | '], ['rrr', 'aaa', ' I ']),
];
/** The BLASTWAVE bag lies open and burning; a firebot foams it out and it lights itself again (one loop, 1 frame a second). */
function blastwave(w, h, x, y) {
  const bag = (art, flames) => {
    prop(art, x + 2, y + 1, [' _________ ', '/         \\', '[BLASTWAVE]', "'---------'"], [' AAAAAAAAA ', 'A         A', 'ArrrrrrrrrA', 'AAAAAAAAAAA']);
    if (flames) prop(art, x + 3, y, [flames], flames.replace(/[^ ]/g, ch => '()'.includes(ch) ? 'r' : ch === '^' ? 'a' : 'p'));
  };
  const BOT = ['  .--.', ' [o_o]', ' /|=|\\', "  ' '"], BOT_KEYS = ['  hhhh', ' hpppph', ' hcccch', '  d d'];
  const frames = [['( ^ )(^)', 'p'], [')(^)( ^ ', 'p'], ['(^ )( ^)', 'p'], [' (^)( ) ', 'p'], ['', 'foam'], ['', 'smoke'], ['', 'out'], ['   ^    ', 'spark']].map(([flames, phase]) => {
    const art = new Art(w, h);
    bag(art, flames);
    prop(art, x + 16, y + 1, BOT, BOT_KEYS);
    if (phase === 'foam') prop(art, x + 9, y, ['░▒░▒░▒░'], 'c');
    if (phase === 'smoke') prop(art, x + 4, y - 1, ["  . ' .", "'  .  '"], 'I');
    if (phase === 'out') prop(art, x + 22, y, ['!'], 'a');
    if (phase === 'foam') prop(art, x + 14, y + 1, ['<'], 'c');
    return art;
  });
  return framesLayer('blastwave', frames, 1);
}
function baggage(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [], reserved = [];
  const reserve = (x0, y0, x1, y1) => reserved.push([x0, y0, x1, y1]);
  tubes(base, w);
  effects.push({ kind: 'flicker', id: 'tube-flicker', region: [30, 1, 10, 1], hz: 2, chance: 0.25, colour: 'd' });
  // Two rows of old lockers; one stands open with something nobody came back for.
  const lockW = 8, lockH = 4, top = 3, rows = 2, x0 = 2, count = Math.floor(((port ? w : w - 34) - 4) / lockW);
  let n = 1, lost = null;
  for (let r = 0; r < rows; r++) for (let i = 0; i < count; i++, n++) {
    const x = x0 + i * lockW, y = top + r * lockH;
    base.text(x, y, '+' + '-'.repeat(lockW - 1), 'o'); base.put(x, y + 1, '|', 'o'); base.put(x, y + 2, '|', 'o'); base.put(x, y + 3, '|', 'o');
    const open = hash(i, r + 41) < 0.14, tagged = !open && hash(i, r + 80) < 0.2;
    if (open && r === 1 && !lost) { base.fill(x + 1, y + 1, x + lockW - 1, y + 3, '▓', 'd'); lost = [x, y]; continue; }
    if (open) { base.fill(x + 1, y + 1, x + lockW - 1, y + 3, '▓', 'd'); continue; }
    base.text(x + 3, y + 1, String(n).padStart(2, '0'), hash(x, y) < 0.3 ? 'A' : 'r');
    base.text(x + 3, y + 2, '==', 'I');
    if (tagged) { base.put(x + 6, y + 1, '◆', 'h'); effects.push({ kind: 'blink', id: `tag-${i}-${r}`, region: [x + 6, y + 1, 1, 1], hz: 0.4 + hash(i, r) * 0.6, on: 'h', off: 'H' }); }
  }
  const lockRight = x0 + count * lockW, lockBottom = top + rows * lockH;
  base.text(lockRight, top, '+', 'o'); for (let y = top + 1; y < lockBottom; y++) base.put(lockRight, y, '|', 'o');
  base.hline(x0, lockRight, lockBottom, '-', 'o');
  reserve(x0, top, lockRight, lockBottom);
  if (!lost) lost = [x0 + 2 * lockW, top + lockH];
  {
    // Leave the past in the past: an old hero's cape, unclaimed.
    const [lx, ly] = lost, cape = new Art(w, h);
    cape.fill(lx + 1, ly + 1, lx + lockW - 1, ly + 3, ' ', ' ');
    prop(cape, lx + 1, ly + 1, ['UNCLAIM', ' \\~~~/', '  \\_/'], ['AAAAAAA', ' ppppp', '  ppp']);
    layers.push({ ...layer('lost-cape', cape, { opaque: true }), when: { beat: ['past'] } });
  }
  // The claim sign and the stop strip: beside the lockers in landscape, under them in portrait.
  const sx = port ? 4 : lockRight + 4, sy = port ? lockBottom + 2 : top + 1, sw = port ? w - 8 : w - lockRight - 6;
  base.text(sx, sy, 'BAGGAGE CLAIM', 'r'); base.text(sx, sy + 1, '-------------', 'A'); reserve(sx, sy, sx + 12, sy + 1);
  strip(base, effects, sx, sy + 2, sw); reserve(sx, sy + 2, sx + sw - 1, sy + 4);
  if (!port) { base.text(sx, sy + 6, 'ARRIVALS  ─────»  CLAIM', 'A'); base.text(sx, sy + 7, 'ALL BAGS ARE SCANNED', 'I'); reserve(sx, sy + 6, sx + 23, sy + 7); }
  // The claim terminal, up on the wall to the left of the belt: house rules, or the preferences import.
  const tx = 2, ty = port ? sy + 6 : lockBottom + 2, tw = port ? w - 6 : 46;
  base.fill(tx, ty, tx + tw, ty + 4, ' ', ' '); reserve(tx, ty, tx + tw, ty + 4);
  base.box(tx, ty, tx + tw, ty + 4, 'o'); base.text(tx + 2, ty, ' CLAIM TERMINAL ', 'A');
  const notices = new Art(w, h);
  notices.text(tx + 2, ty + 1, 'NO MONKEY CUBES NEAR WATER', 'a'); notices.text(tx + 2, ty + 2, 'TOOLBOXES ARE NOT WEAPONS (USUALLY)', 'A');
  notices.text(tx + 2, ty + 3, 'REFUSED BAGS GO TO DISPOSALS', 'I');
  layers.push(layer('terminal-house', notices, { when: { beat: ['none', 'past', 'looc'] } }));
  const prefs = new Art(w, h);
  prefs.text(tx + 2, ty + 1, '> Export-Preferences', 'c'); prefs.text(tx + tw - 9, ty + 1, 'OLD: OK', 'h');
  prefs.text(tx + 2, ty + 2, port ? '> Import-Character-Prefs' : '> Import-Character-Preferences', 'c'); prefs.text(tx + tw - 9, ty + 2, 'NEW: ..', 'a');
  prefs.text(tx + 2, ty + 3, 'Settings move. The setting stays.', 'I');
  layers.push(layer('terminal-prefs', prefs, { when: { beat: ['migrating'] } }));
  effects.push({ kind: 'blink', id: 'prefs-wait', region: [tx + tw - 4, ty + 2, 2, 1], hz: 1.5, on: 'a', off: 'A', when: { beat: ['migrating'] } });

  // The belt: rollers and rails turn the same way, and at the same speed, as the bags.
  const beltY = ty + (port ? 13 : 10), speed = 4, spacing = 12, ax = Math.round(w * (port ? 0.52 : 0.56)), start = -10, end = w + 2;
  base.hline(0, w - 1, beltY + 3, '▀', 'd');
  const belt = [];
  for (let f = 0; f < 12; f++) {
    const art = new Art(w, h);
    for (let x = 0; x < w; x++) {
      const rail = ((x - f) % 4 + 4) % 4 === 0, roller = ((x - f) % 3 + 3) % 3 === 0;
      art.put(x, beltY + 1, rail ? '╪' : '═', rail ? 'o' : 'I'); art.put(x, beltY + 2, roller ? 'o' : ' ', 'd');
    }
    belt.push(art);
  }
  layers.push(framesLayer('belt', belt, speed));
  // The scanner arch and scale: bags pass out of sight inside it, and the scale reads each one as it goes in.
  base.text(ax - 1, beltY - 3, '╔══════╗', 'h'); for (let y = beltY - 2; y <= beltY; y++) { base.put(ax - 1, y, '║', 'h'); base.put(ax + 6, y, '║', 'h'); }
  effects.push({ kind: 'scan', id: 'scanner', region: [ax, beltY - 2, 6, 3], speed: 4, glyph: '─', colour: 'H' });
  base.box(ax - 3, beltY - 7, ax + 8, beltY - 4, 'o'); base.text(ax - 1, beltY - 7, ' SCALE ', 'A'); base.text(ax - 1, beltY - 5, 'WEIGH', 'I');
  reserve(ax - 3, beltY - 7, ax + 8, beltY);
  // Disposals: refused bags drop off the belt into the chute (drawn over the floor, below).
  const dx = ax + 10, dy = beltY + 4;
  const DISPOSAL = [['\\           /', ' \\_________/', '  |DISPOSAL|', '  |___v___|'], ['ooooooooooooo', ' ooooooooooo', '  opppppppo', '  ooooHoooo']];
  const items = [], before = {}, after = {};
  const deniedAt = [4, 10];
  for (let j = 0, origin = 0; j < 13; j++) {
    const [lines, keys] = BAGS[j % BAGS.length], divert = deniedAt.includes(j);
    items.push({ art: spriteFrame(lines, keys), weight: `${(6 + hash(j, 7) * 26).toFixed(1).padStart(4)} KG`, divert });
    if (!divert) origin++;
  }
  for (const beat of ['*', ...BAGGAGE_BEATS]) {
    let origin = 0;
    before[beat] = items.map((item, j) => item.divert ? (DENIED[beat] ?? DENIED['*'])[deniedAt.indexOf(j)] : beat === 'migrating' ? ORIGINS[origin++][0] : '');
    origin = 0;
    after[beat] = items.map(item => item.divert ? '' : beat === 'migrating' ? (ORIGINS[origin++][1] === 13 ? 'MERIDIAN' : 'WOLFGATE') : 'OK');
  }
  const tags = Object.fromEntries(Object.keys(before).map(beat => [beat, { before: before[beat], after: after[beat], beforeColour: beat === 'migrating' ? 'I' : 'p', afterColour: beat === 'migrating' ? 'c' : '4' }]));
  effects.push({ kind: 'conveyor', id: 'luggage', y: beltY - 2, from: start, to: end, gate: ax, gateWidth: 6, speed, spacing, items, tags,
    chute: [dx + 6, dy + 1], readout: { x: ax - 1, y: beltY - 6, width: 8, colour: 'a', deniedColour: 'p' } });
  wallPanels(base, 0, lockBottom + 1, w - 1, beltY - 4, 7, 12, reserved);

  // Floor: claim-hall tiles, a luggage cart, the burning BLASTWAVE bag and its firebot, and a monkey.
  const floorTop = beltY + 4;
  for (let y = floorTop; y < h; y++) for (let x = 0; x < w; x++) {
    if (base.get(x, y) !== ' ') continue;
    if ((y - floorTop) % 3 === 2) { if (x % 2 === 0) base.put(x, y, '_', 'd'); continue; }
    if (x % 10 === 0) base.put(x, y, '|', 'd');
    else if (hash(x * 3 + 5, y * 17) < 0.02) base.put(x, y, '·', 'd');
  }
  const clear = (x, y, lines) => lines.forEach((line, r) => { for (let c = 0; c < [...line].length; c++) base.put(x + c, y + r, ' ', ' '); });
  const placeOnFloor = (x, y, lines, keys) => { clear(x, y, lines); prop(base, x, y, lines, keys); };
  // The chute's mouth stays clear of floor tiles.
  clear(dx, dy, ['             ', '            ', '  ++++++++++', '  ++++++++++']); prop(base, dx, dy, ...DISPOSAL);
  const fy = port ? floorTop + 6 : floorTop + 4;
  placeOnFloor(2, fy, ['  .--.  .__.', ' [====][▓▓▓▓]', '|============|', ' o          o'], ['  oooo  oooo', ' AAAAAArrrrrr', 'oooooooooooooo', ' d          d']);
  const bx = port ? 4 : 18, by = port ? fy + 6 : fy;
  clear(bx, by - 1, Array(6).fill(' '.repeat(24)));
  layers.push(blastwave(w, h, bx, by));
  placeOnFloor(port ? 52 : 44, fy + 2, ["   .__.", "  [▒▒▒▒]", "@('_')@"], ['   oooo', '  AAAAAA', 'rrrrrrr']);
  // LOOC: two returning players meet and check in out of character.
  const meet = port ? [[47, h - 2], [64, h - 2]] : [[73, h - 3], [86, h - 3]];
  // They stand on clear floor, so no tile seam shows between their feet.
  for (const [mx, my] of meet) clear(mx - 1, my - 2, ["   ", "   ", "   "]);
  effects.push({ kind: 'sprite', id: 'looc-a', frames: PASSENGER, from: [-4, meet[0][1] - 2], to: [meet[0][0] - 1, meet[0][1] - 2], duration: 3, hold: 600 - 3, every: 600, fps: 3, clock: 'beat', when: { beat: ['looc'] } });
  effects.push({ kind: 'sprite', id: 'looc-b', frames: PASSENGER_B, from: [w + 1, meet[1][1] - 2], to: [meet[1][0] - 1, meet[1][1] - 2], duration: 3, hold: 600 - 3, every: 600, fps: 3, clock: 'beat', when: { beat: ['looc'] } });
  effects.push({ kind: 'dialogue', id: 'looc-talk', speakers: [[meet[0][0], meet[0][1] - 2], [meet[1][0], meet[1][1] - 2]], width: port ? 30 : 26, style: 'looc',
    exchanges: [[[0, 'Do our characters know each other here?'], [1, 'Only if we both want it. Fresh start?'], [0, "Fresh start. I'll introduce myself IC."],
      [1, 'And old server feuds stay on the old server.'], [0, 'Deal. See you in the bar.']]], line: 3.5, pause: 4, colours: 'ih', clock: 'beat', when: { beat: ['looc'] } });
  effects.push({ kind: 'sprite', id: 'clown', frames: CLOWN, from: [w + 4, h - 5], to: [-10, h - 5], duration: port ? 7 : 11, every: 95, offset: 55, fps: 3 });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scenes: Board the Shuttle, one per section ----------
// You are not travelling alone (landing-bay), A shared seat (boarding-cabin), sea-lions (cabin-turbulence).
const BAY_BEATS = ['together'];
const CABIN_BEATS = ['seat'];
const STRIKE_BEATS = ['sealion'];
/** Walkers in a few looks; the last frame of a seated walker is how they sit. */
const walker = (head, headKey, body) => [
  spriteFrame([` ${head} `, '/|\\', '/ \\'], [` ${headKey} `, body.repeat(3), 'III']),
  spriteFrame([` ${head} `, '/|\\', ' | '], [` ${headKey} `, body.repeat(3), ' I ']),
];
const seated = (head, headKey, body) => [...walker(head, headKey, body), spriteFrame([` ${head}`, ' |'], [` ${headKey}`, ` ${body}`])];
const LOOKS = [['o', 'i', 'I'], ['@', 'r', 'a'], ['o', 'i', 'h'], ['Q', '4', '4'], ['o', 'r', 'p'], ['0', 'c', 'H'], ['@', 'a', 'o']];
const SHUTTLE_SIDE = [
  '              ______________________________          ',
  '     ________/  □   □   □   □   □   □   □   \\_____    ',
  '  __/  ARRIVALS SHUTTLE · APHELION   ┌───┐        \\__ ',
  ' <_____________________________________│   │__________>',
  '     \\__/                \\__/        └───┘           ',
];
const SHUTTLE_KEYS = [
  '              IIIIIIIIIIIIIIIIIIIIIIIIIIIIII          ',
  '     IIIIIIIIIIIIaIIIaIIIhIIIaIIIaIIIhIIIaIIIIIIIIII    ',
  '  IIIIIrrrrrrrrrrrrrrrrrpppppppppIIIhhhhhIIIIIIIIIIIII ',
  ' oooooooooooooooooooooooooooooooooooooohhhhhoooooooooooo',
  '     dddd                dddd        hhhhh           ',
];

function landingBay(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  tubes(base, w);
  // The bay door stands open on space behind a shimmering field; hazard stripes on its frame.
  const oy0 = 3, oy1 = port ? 18 : 12, ox0 = 2, ox1 = w - 3;
  for (let x = ox0; x <= ox1; x++) { base.put(x, oy0, (x % 4 < 2) ? '/' : ' ', 'r'); base.put(x, oy1, '▀', 'o'); }
  for (let y = oy0 + 1; y < oy1; y++) { base.put(ox0, y, '▓', 'o'); base.put(ox0 + 1, y, '▒', 'd'); base.put(ox1 - 1, y, '▒', 'd'); base.put(ox1, y, '▓', 'o'); }
  effects.push({ kind: 'drift', id: 'bay-stars', region: [ox0 + 2, oy0 + 1, ox1 - ox0 - 3, oy1 - oy0 - 1], seed: 61, density: 0.04, speed: 0.6, glyphs: ".·'+", colours: '..Ih' });
  effects.push({ kind: 'drift', id: 'bay-field', region: [ox0 + 2, oy1 - 2, ox1 - ox0 - 3, 1], seed: 62, density: 0.18, speed: 3, glyphs: '-~', colours: 'HH' });
  sun(base, ox1 - 14, oy0 + 4, 2.4);
  effects.push({ kind: 'sprite', id: 'carp-bay', frames: CARP_LEFT, from: [ox1 - 2, oy0 + 3], to: [ox0 - 6, oy0 + 6], duration: 14, every: 70, offset: 25, fps: 2,
    clip: [ox0 + 2, oy0 + 1, ox1 - ox0 - 3, oy1 - oy0 - 1] });
  const sw = port ? w - 8 : 50;
  strip(base, effects, Math.floor(w / 2 - sw / 2), oy1 + 1, sw);
  // The shuttle on its pad, door open and ramp down.
  const shW = [...SHUTTLE_SIDE[0]].length, shX = w - shW - 1, shY = oy1 + 5;
  SHUTTLE_SIDE.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ' ') base.put(shX + c, shY + r, ch, SHUTTLE_KEYS[r][c] === ' ' ? 'I' : SHUTTLE_KEYS[r][c]); }));
  // The ramp runs down from the door's lower corner to the floor.
  const doorX = shX + 38, doorY = shY + 3, floorY = shY + 8, sill = shY + 4;
  for (let k = 1; k < floorY - sill; k++) base.put(doorX - k, sill + k, '╱', 'o');
  base.hline(0, w - 1, floorY, '_', 'd');
  for (let y = floorY + 1; y < h; y++) for (let x = 0; x < w; x++) if ((y - floorY) % 4 === 0 && x % 2 === 0) base.put(x, y, '_', 'd'); else if (hash(x * 5 + 1, y * 9) < 0.015) base.put(x, y, '·', 'd');
  base.text(shX + 4, floorY + 2, '/////  KEEP  CLEAR  /////', 'r');
  // The gate board: all passengers, boarding. Portrait has no room beside the shuttle, so it stands on the floor.
  const gx = 2, gy = port ? floorY + 3 : oy1 + 5;
  base.fill(gx, gy, gx + 26, gy + 4, ' ', ' ');
  base.box(gx, gy, gx + 26, gy + 4, 'h'); base.text(gx + 2, gy, ' GATE 03 · ARRIVALS ', 'h');
  effects.push({ kind: 'flap', id: 'gate-board', x: gx + 2, y: gy + 2, width: 23, texts: ['ALL PASSENGERS', 'BOARDING NOW', 'MIND THE RAMP'], period: 4, flip: 0.4, colour: 'a', align: 'left' });
  // Ground crew with light wands at the foot of the ramp.
  const footX = doorX - (floorY - sill - 1), crewX = footX - 7;
  prop(base, crewX, floorY - 3, ['\\ o /', ' \\|/ ', ' / \\ '], ['a i a', ' oho ', ' I I ']);
  effects.push({ kind: 'blink', id: 'wands', region: [crewX, floorY - 3, 5, 1], hz: 1.2, on: 'a', off: 'r' });
  // Passengers walk to the ramp and up into the shuttle, in small groups.
  const walkY = floorY - 3, speed = 6, every = 18;
  const groups = [0, 1.4, 2.6, 7, 8.3, 12.5, 13.6];
  groups.forEach((start, i) => {
    const [head, headKey, body] = LOOKS[i % LOOKS.length], frames = walker(head, headKey, body);
    const walkTo = footX - 2, walk = (walkTo + 4) / speed, ramp = Math.max(1.5, (doorX - walkTo) / 3);
    effects.push({ kind: 'sprite', id: `boarder-${i}-walk`, frames, from: [-4, walkY], to: [walkTo, walkY], duration: walk, every, offset: (every - start) % every, fps: 4 });
    effects.push({ kind: 'sprite', id: `boarder-${i}-ramp`, frames, from: [walkTo, walkY], to: [doorX - 1, doorY - 2], duration: ramp, every,
      offset: ((every - start - walk) % every + every) % every, fps: 4 });
  });
  // Luggage left by the ramp, and a fuel line along the floor.
  const [lx, ly, fy] = port ? [34, floorY + 4, floorY + 10] : [4, floorY + 3, floorY + 5];
  base.fill(lx, ly, lx + 12, ly + 1, ' ', ' '); prop(base, lx, ly, ['  .--.  .__.', ' [====][▓▓▓▓]'], ['  oooo  oooo', ' AAAAAArrrrrr']);
  base.hline(port ? 4 : 18, port ? w - 12 : footX - 10, fy, '═', 'H'); base.put(port ? 3 : 17, fy, '[', 'o');
  // A baggage tug pulls the hold luggage across the bay now and then.
  const TUG = [spriteFrame([' ___  .--. .__.', '[TUG]=[==]=[▓▓]', ' o o   oo   oo'], [' aaa  oooo oooo', 'aaaaaoAAAAoArrA', ' d d   dd   dd']),
    spriteFrame([' ___  .--. .__.', '[TUG]=[==]=[▓▓]', '  o o  oo   oo'], [' aaa  oooo oooo', 'aaaaaoAAAAoArrA', '  d d  dd   dd'])];
  effects.push({ kind: 'sprite', id: 'tug', frames: TUG, from: [w + 1, h - 4], to: [-16, h - 4], duration: port ? 14 : 18, every: 45, offset: 30, fps: 2 });
  return { layers: [layer('base', base), ...layers], effects };
}

function cabin(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const sw = port ? w - 8 : 50, sx = Math.floor(w / 2 - sw / 2);
  for (let x = 1; x + 9 <= w - 1; x += 9) { if (x + 8 < sx || x > sx + sw) base.text(x, 1, '[_______]', 'o'); }
  strip(base, effects, sx, 0, sw);
  base.hline(0, w - 1, 4, '─', 'd');
  const signX = port ? 3 : w - 22;
  base.text(signX, 3, '[ FASTEN STRAPS ]', 'a');
  effects.push({ kind: 'blink', id: 'fasten', region: [signX + 2, 3, 13, 1], hz: 0.5, on: 'a', off: 'A' });
  const placard = new Art(w, h), pText = '[ ONE PASSENGER PER SEAT ]';
  placard.text(port ? w - pText.length - 2 : 3, port ? 5 : 3, pText, 'p');
  layers.push(layer('placard', placard, { when: { beat: ['seat'] } }));
  const portY = port ? 7 : 6, gap = port ? 12 : 14;
  for (let x = 3; x + 7 < w; x += gap) {
    base.text(x, portY, " .---. ", 'o'); base.text(x, portY + 1, '/     \\', 'o'); base.text(x, portY + 2, '|     |', 'o'); base.text(x, portY + 3, '\\     /', 'o'); base.text(x, portY + 4, " '---' ", 'o');
    effects.push({ kind: 'drift', id: `port-${x}`, region: [x + 1, portY + 1, 5, 3], seed: 20 + x, density: 0.2, speed: 1.5, glyphs: ".·'", colours: '..I' });
  }
  // The back row: passengers file in and take the free seats.
  const seatY = portY + 7, seats = [];
  for (let x = 2, i = 0; x + 8 < w; x += 10, i++) {
    base.text(x, seatY, ' _  ', 'o'); base.text(x, seatY + 1, '|▒| ', 'o'); base.text(x, seatY + 2, '|▒|__', 'o'); base.text(x, seatY + 3, '|▒▒▒▒|', 'o'); base.text(x, seatY + 4, ' |  |', 'd');
    base.put(x + 1, seatY + 1, '▒', 'A'); base.put(x + 1, seatY + 2, '▒', 'A'); base.text(x + 1, seatY + 3, '▒▒▒▒', 'A');
    base.text(x + 4, seatY - 1, String.fromCharCode(65 + (i % 6)) + String(1 + Math.floor(i / 6)), 'h');
    seats.push(x);
  }
  // Two passengers were already aboard: a sleeping assistant in grey and a lizard.
  const settled = new Art(w, h);
  settled.text(seats[1] + 3, seatY, 'o', 'I'); settled.text(seats[1] + 3, seatY + 1, '|', 'I'); settled.text(seats[1] + 5, seatY - 2, 'zZ', 'I');
  settled.text(seats[3] + 3, seatY, '>', '4'); settled.text(seats[3] + 4, seatY, 'o', '4'); settled.text(seats[3] + 3, seatY + 1, '|', '4');
  layers.push(layer('settled', settled));
  const filling = [0, 2, 4, 5, 7].filter(index => seats[index] !== undefined);
  filling.forEach((index, i) => {
    const [head, headKey, body] = LOOKS[(i + 2) % LOOKS.length], to = seats[index] + 2, duration = Math.max(2, (to + 4) / 7), start = 1 + i * 2.2;
    effects.push({ kind: 'sprite', id: `taking-seat-${i}`, frames: seated(head, headKey, body), from: [-4, seatY], to: [to, seatY], duration, hold: 600 - start - duration - 1,
      every: 600, offset: 600 - start, fps: 4, rest: true, clock: 'beat' });
  });
  const floor = seatY + 6;
  base.hline(0, w - 1, floor, '_', 'd');
  const lights = []; for (let x = 0; x < w; x += 3) { base.put(x, floor + 1, '·', 'H'); lights.push([x, floor + 1]); }
  effects.push({ kind: 'pulse', id: 'aisle-lights', path: lights, speed: 10, glyph: '•', colour: 'h', trail: 3, trailGlyph: '·', trailColour: 'h' });
  // The front row, closer: big seats, and a passenger asking before they sit.
  const fy = floor + (port ? 9 : 6), big = port ? 13 : 16;
  const BIG = [' __    ', '|▓▓|   ', '|▓▓|   ', '|▓▓|___', '|▓▓▓▓▓▓|', '|______|', ' |    |'];
  const BIG_KEYS = [' oo    ', 'oAAo   ', 'oAAo   ', 'oAAoooo', 'oAAAAAAo', 'oooooooo', ' d    d'];
  const fronts = [];
  for (let x = 3; x + 8 < w; x += big) { prop(base, x, fy, BIG, BIG_KEYS); fronts.push(x); }
  const front = new Art(w, h);
  const sitAt = (x, head, key, body) => { front.text(x + 5, fy + 1, head, key); front.text(x + 4, fy + 2, '/|', body); front.text(x + 5, fy + 3, '|', body); };
  sitAt(fronts[1], 'O', 'r', 'a'); if (fronts[3] !== undefined) sitAt(fronts[3], 'O', 'i', 'h');
  layers.push(layer('front-row', front));
  base.hline(0, w - 1, fy + 8, '▀', 'd');
  // The aisle: a drinks trolley parked by the galley, and a carpet runner under the front row.
  prop(base, w - 18, floor + 3, ['  ___ ', ' [▒▒▒]', '  o o'], ['  ooo ', ' oAAAo', '  d d']);
  base.text(w - 30, floor + 4, 'GALLEY', 'A');
  for (let y = fy + 10; y < h; y += 3) for (let x = 0; x < w; x += 4) base.put(x + (y % 2), y, '·', 'd');
  prop(base, 20, fy + 10, [' .--. ', '[====]'], ['oooooo', 'AAAAAA']);
  // The asker stops in the gap beside the seated passenger, not over a seat.
  const askerTo = fronts[1] + 10, askY = fy;
  const ASKER = [spriteFrame([' O ', '/|\\', '/ \\', '/ \\'], [' c ', 'HHH', 'III', 'III']), spriteFrame([' O ', '/|\\', '/ \\', ' | '], [' c ', 'HHH', 'III', ' I '])];
  effects.push({ kind: 'sprite', id: 'asker', frames: ASKER, from: [w + 2, askY], to: [askerTo, askY], duration: 3, hold: 600 - 3, every: 600, fps: 4, clock: 'beat', when: { beat: ['seat'] } });
  effects.push({ kind: 'dialogue', id: 'seat-talk', speakers: [[askerTo + 1, askY], [fronts[1] + 5, fy + 1]], width: port ? 28 : 30, style: 'say', delay: 3,
    exchanges: [[[0, 'Is this seat free?'], [1, 'It is, go ahead.']],
      [[0, 'Mind if I sit right next to you?'], [1, "I'd rather have the space, sorry."], [0, "No problem. I'll take the window."]]],
    line: 3, pause: 3, colours: 'ci', clock: 'beat', when: { beat: ['seat'] } });
  return { layers: [layer('base', base), ...layers], effects };
}

/** The cabin through landing: the forward window shows the pad coming up, a sea lion on it, the bump, and the cabin shakes. */
function cabinStrike(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const wx0 = port ? 3 : 10, wx1 = w - 1 - wx0, wy0 = 1, wy1 = port ? 24 : 18;
  for (let y = wy0; y <= wy1; y++) { base.put(wx0, y, '▓', 'o'); base.put(wx0 + 1, y, '▒', 'd'); base.put(wx1 - 1, y, '▒', 'd'); base.put(wx1, y, '▓', 'o'); }
  base.hline(wx0, wx1, wy0, '▓', 'o'); base.hline(wx0, wx1, wy1, '▓', 'o');
  base.text(wx0 + 3, wy0, ' FORWARD VIEW · FINAL APPROACH ', 'A');
  const iw = wx1 - wx0 - 3, ix0 = wx0 + 2, cx = Math.floor((wx0 + wx1) / 2);
  effects.push({ kind: 'drift', id: 'approach-stars', region: [ix0, wy0 + 1, iw, 4], seed: 71, density: 0.05, speed: 2.5, glyphs: ".·'", colours: '..I' });
  // Sixteen frames, two a second: the pad grows, the sea lion looks up, the bump, then a dazed (unhurt) sea lion.
  const approach = [];
  for (let f = 0; f < 16; f++) {
    const art = new Art(w, h), near = Math.min(1, f / 9), padW = Math.round(14 + near * (iw - 22)), padY = Math.round(wy0 + 8 + near * (wy1 - wy0 - 11));
    const px = cx - Math.floor(padW / 2);
    // Approach lights run in from the horizon to the pad's corners and chase towards the window.
    const hy = wy0 + 6;
    for (let y = hy; y < padY - 1; y++) {
      const t = (y - hy) / Math.max(1, padY - hy), spread = 2 + t * (padW / 2 - 2);
      for (const x of [Math.round(cx - spread), Math.round(cx + spread)]) if (art.get(x, y) === ' ') art.put(x, y, '.', (y + f) % 3 === 0 ? 'a' : 'A');
    }
    art.text(px, padY, '['.padEnd(padW - 1, '=') + ']', 'o');
    const stripe = padW > 26 ? '/////  KEEP  CLEAR  /////' : 'KEEP CLEAR';
    art.text(cx - Math.floor(stripe.length / 2), padY - 1, stripe, 'r');
    if (f < 10) {
      const lion = near > 0.5 ? ['   ,-.', ' _/ o \\', '(     _>'] : [' ,o.', '(  _>'];
      prop(art, cx - 4, padY - 1 - lion.length, lion, 'I');
      if (f >= 6) art.text(cx + 6, padY - 4, '?!', 'a');
      for (let dx = -Math.round(near * 12); dx <= Math.round(near * 12); dx++) if (art.get(cx + dx, padY - 5) === ' ') art.put(cx + dx, padY - 5, '░', 'd');
    } else if (f < 12) {
      art.text(cx - 3, padY - 3, 'THUMP', 'a'); art.text(cx - 6, padY - 2, '~~~~~~~~~~~~~', 'I');
    } else {
      // Nudged off the marking, dazed and unhurt.
      prop(art, cx + Math.floor(stripe.length / 2) + 3, padY - 2, ['  * · *', '(__o__>'], ['  a a a', 'IIIIIII']);
    }
    approach.push(art);
  }
  layers.push({ ...framesLayer('approach', approach, 2), when: { beat: ['sealion'] } });
  // The cabin below the window: seat backs and heads, and overhead bins that jump on the bump.
  const cy0 = wy1 + 2, signX = cx - 8;
  base.text(signX, cy0, '[ FASTEN STRAPS ]', 'a');
  effects.push({ kind: 'blink', id: 'fasten', region: [signX + 2, cy0, 13, 1], hz: 1, on: 'a', off: 'r' });
  // Overhead bins either side of the sign, clear of it even when they jump.
  const bins = []; for (let x = 2; x + 10 < w; x += 22) if (x + 7 < signX - 1 || x > signX + 18) bins.push(x);
  const rowsY = port ? [cy0 + 4, cy0 + 12, cy0 + 20] : [cy0 + 4, cy0 + 10];
  for (const [r, y] of rowsY.entries()) for (let x = 4 + r * 5; x + 9 < w; x += 12) {
    prop(base, x, y, ['.-------.', '|▓▓▓▓▓▓▓|', '|▓▓▓▓▓▓▓|', "'-------'"], ['ooooooooo', 'oAAAAAAAo', 'oAAAAAAAo', 'ooooooooo']);
  }
  const shake = [];
  for (let f = 0; f < 16; f++) {
    const art = new Art(w, h), jolt = f >= 10 && f < 13 ? [1, -1, 1][f - 10] : 0;
    for (const [r, y] of rowsY.entries()) for (let x = 4 + r * 5, i = 0; x + 9 < w; x += 12, i++) {
      art.text(x + 4 + jolt, y - 1, hash(i, r) < 0.25 ? '@' : 'o', hash(i, r + 5) < 0.3 ? 'r' : 'i');
      if (jolt && hash(i, r + 9) < 0.5) art.text(x + 6 + jolt, y - 2, '!', 'a');
    }
    for (const x of bins) art.text(x + (jolt ? 1 : 0), cy0 + 1 - (jolt ? 1 : 0), jolt ? '[_##_]' : '[____]', 'o');
    // A bag and a cup in the aisle hop on the bump.
    prop(art, 6 + jolt, h - 4 - (jolt ? 1 : 0), [' .--. ', '[====]'], ['oooooo', 'AAAAAA']);
    art.text(w - 14 + jolt, h - 3 - (jolt ? 1 : 0), jolt ? 'c[_]~' : 'c[_]', jolt ? 'IIIIc' : 'IIII');
    shake.push(art);
  }
  layers.push({ ...framesLayer('turbulence', shake, 2), when: { beat: ['sealion'] } });
  // Aisle carpet under the last row.
  for (let y = rowsY.at(-1) + 5; y < h - 2; y += 2) for (let x = 2 + (y % 4); x < w - 2; x += 6) base.put(x, y, '·', 'd');
  base.hline(0, w - 1, h - 2, '▀', 'd');
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: viewport (Admire the Lights) ----------
const VIEWPORT_BEATS = ['enjoy', 'valuable', 'photos', 'lucky'];
// Station folklore: an assistant in grey, adrift with a toolbox, waving now and then.
const GREYTIDE = [
  spriteFrame(['  o  _', ' /|\\[▄]', ' / \\'], ['  i  r', ' III rrr', ' I I']),
  spriteFrame([' \\o/ _', '  | [▄]', ' / \\'], [' IiI r', '  I rrr', ' I I']),
];
const CARGO = [
  spriteFrame(['    ____', '-=[CARGO]>'], ['    oooo', 'aooAAAAAoo']),
  spriteFrame(['    ____', '~=[CARGO]>'], ['    oooo', 'rooAAAAAoo']),
];
const COMET = [spriteFrame(['*=~~-· ·'], ['cchhHH H']), spriteFrame(['*=~-~··'], ['cchHhHH'])];
/**
 * A ringed gas giant lit from the upper right, in amber and rust bands. The ring's far half is hidden behind the planet;
 * its near half crosses in front. Only cells inside the glass are drawn.
 */
function gasGiant(a, cx, cy, R, inside) {
  const rx = Math.ceil(R / ADV) + 1, BANDS = 'arAarAa';
  for (let dy = -R; dy <= R; dy++) for (let dx = -rx; dx <= rx; dx++) {
    const nx = dx * ADV / R, ny = dy / R;
    if (Math.hypot(nx, ny) > 1 || !inside(cx + dx, cy + dy)) continue;
    const lit = 0.5 + 0.5 * (nx * 0.75 - ny * 0.55);
    a.put(cx + dx, cy + dy, lit > 0.72 ? '▓' : lit > 0.42 ? '▒' : '░', BANDS[Math.min(6, Math.floor((ny + 1) * 3.5))]);
  }
  const ringX = R * 1.9 / ADV, ringY = R * 0.38;
  for (let th = 0; th < Math.PI * 2; th += 0.004) {
    const x = Math.round(cx + Math.cos(th) * ringX), y = Math.round(cy + Math.sin(th) * ringY), front = Math.sin(th) > 0;
    if (!inside(x, y) || (!front && Math.hypot((x - cx) * ADV / R, (y - cy) / R) <= 1)) continue;
    const slope = (Math.cos(th) * ringY) / (-Math.sin(th) * ringX || 1e-9);
    a.put(x, y, Math.abs(slope) < 0.45 ? (front ? '═' : '─') : slope > 0 ? '\\' : '/', front ? 'o' : 'I');
  }
}
/** An information panel: a frame with its title set into the top edge. Text sits on the three rows inside. */
function panel(a, x, y, width, title) {
  a.box(x, y, x + width - 1, y + 4, 'H');
  a.text(x + 2, y, ` ${title} `, 'h');
}
/** key ···· value, filling the width. */
const lead = (key, value, width) => `${key} ${'·'.repeat(Math.max(1, width - key.length - value.length - 2))} ${value}`;
function viewport(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const fx0 = 1, fx1 = w - 2, fy0 = 1, fy1 = port ? 24 : 20;
  for (let y = fy0; y <= fy1; y++) { base.put(fx0, y, '▓', 'd'); base.put(fx0 + 1, y, '▒', '.'); base.put(fx1 - 1, y, '▒', '.'); base.put(fx1, y, '▓', 'd'); }
  base.hline(fx0, fx1, fy0, '▓', 'd'); base.hline(fx0, fx1, fy1, '▓', 'd');
  for (let x = fx0 + 6; x < fx1 - 4; x += 12) { base.put(x, fy0, 'o', 'o'); base.put(x, fy1, 'o', 'o'); }
  const ix0 = fx0 + 2, iy0 = fy0 + 1, iw = fx1 - fx0 - 3, ih = fy1 - fy0 - 1, glass = [ix0, iy0, iw, ih];
  const inGlass = (x, y) => x >= ix0 && x < ix0 + iw && y >= iy0 && y < iy0 + ih;
  // A nebula wisp in magenta and teal, high on the right.
  const [nx, ny, nrx, nry] = port ? [ix0 + 46, iy0 + 4, 20, 4] : [ix0 + 66, iy0 + 3, 24, 3];
  for (let y = ny - nry; y <= ny + nry; y++) for (let x = nx - nrx; x <= nx + nrx; x++) {
    const d = Math.hypot((x - nx) / nrx, (y - ny + (x - nx) * 0.08) / nry);
    if (d < 1 && inGlass(x, y) && hash(x * 3 + 5, y * 11) < (1 - d) * 0.7) base.put(x, y, d < 0.5 ? ':' : '·', hash(x, y * 3) < 0.5 ? 'p' : 'H');
  }
  // The ringed giant on the left.
  const [gx, gy, gr] = port ? [ix0 + 16, iy0 + 6, 4] : [ix0 + 19, iy0 + 7, 5];
  gasGiant(base, gx, gy, gr, inGlass);
  // The station outside: a ring segment with spokes, in old dim metal.
  const rcx = port ? w * 0.55 : w * 0.62, rcy = port ? fy1 + 10 : fy1 + 14, rr = port ? 30 : 46;
  for (let th = Math.PI * 1.05; th < Math.PI * 1.95; th += 0.004) {
    for (const k of [0, 2]) { const x = Math.round(rcx + (rr - k) * Math.cos(th) / ADV * 0.6), y = Math.round(rcy + (rr - k) * Math.sin(th) * 0.5); if (inGlass(x, y) && base.get(x, y) === ' ') base.put(x, y, k ? '·' : '─', k ? '.' : 'I'); }
  }
  const lights = [];
  for (let i = 0; i < 14; i++) {
    const th = Math.PI * (1.12 + i * 0.054), x = Math.round(rcx + (rr - 1) * Math.cos(th) / ADV * 0.6), y = Math.round(rcy + (rr - 1) * Math.sin(th) * 0.5);
    if (inGlass(x, y)) { const key = i % 3 === 0 ? 'h' : 'a'; base.put(x, y, '•', key); lights.push([x, y, key]); }
  }
  lights.slice(0, 10).forEach(([x, y, key], i) => effects.push({ kind: 'blink', id: `light-${i + 1}`, region: [x, y, 1, 1], hz: 0.3 + (i % 5) * 0.2, on: key, off: key === 'h' ? 'H' : 'A' }));
  // A satellite with a slow beacon.
  const [sx, sy] = port ? [ix0 + 30, iy0 + 9] : [ix0 + 36, iy0 + 9];
  base.text(sx, sy, '[▒]-o-[▒]', 'h'); base.text(sx + 3, sy, '-o-', 'o');
  effects.push({ kind: 'blink', id: 'satellite', region: [sx + 4, sy, 1, 1], hz: 0.5, on: 'p', off: 'd' });
  // Fixed stars round the giant (drifting ones would cross its face), drifting stars everywhere else.
  for (let y = iy0; y < iy0 + ih; y++) for (let x = ix0; x < ix0 + iw; x++) {
    if (base.get(x, y) === ' ' && Math.abs(x - gx) < gr * 4 && Math.abs(y - gy) < gr + 3 && hash(x * 17, y * 23) < 0.03) base.put(x, y, hash(x, y) < 0.3 ? '+' : '·', hash(y, x) < 0.3 ? 'I' : '.');
  }
  const clearOfGiant = Math.round(gx + gr * 4);
  effects.push({ kind: 'drift', id: 'stars', region: [clearOfGiant, iy0, ix0 + iw - clearOfGiant, ih], seed: 32, density: 0.025, speed: 0.4, glyphs: ".·'+", colours: '..Ih' });
  effects.push({ kind: 'drift', id: 'stars-low', region: [ix0, gy + gr + 3, clearOfGiant - ix0, iy0 + ih - gy - gr - 3], seed: 33, density: 0.025, speed: 0.4, glyphs: ".·'", colours: '..I' });
  // The lights: a soft band drifting past high up; festive while Sophie says to enjoy yourselves.
  const bandRegion = [clearOfGiant, iy0, ix0 + iw - clearOfGiant, 3];
  effects.push({ kind: 'drift', id: 'lights-band', region: bandRegion, seed: 31, density: 0.05, speed: 0.6, glyphs: '~~-', colours: 'hHp', when: { beat: ['none', 'valuable', 'photos', 'lucky'] } });
  effects.push({ kind: 'drift', id: 'lights-festive', region: bandRegion, seed: 31, density: 0.08, speed: 0.6, glyphs: '~~-*~~-', colours: '1234567', when: { beat: ['enjoy'] } });
  // Traffic outside, all kept behind the glass: a comet, two meteors, a cargo hauler, a school of carp and the greytide.
  effects.push({ kind: 'sprite', id: 'comet', frames: COMET, from: [ix0 + iw - 12, iy0 + 3], to: [ix0 + iw - 44, iy0 + 5], duration: 50, every: 70, offset: 20, fps: 1, clip: glass });
  effects.push({ kind: 'sprite', id: 'meteor-1', frames: [spriteFrame(['*'], 'c')], from: [ix0 + 30, iy0 + 1], to: [ix0 + 52, iy0 + 6], duration: 1.2, every: 23, offset: 9, clip: glass });
  effects.push({ kind: 'sprite', id: 'meteor-2', frames: [spriteFrame(['·'], 'i')], from: [ix0 + iw - 20, iy0 + 2], to: [ix0 + iw - 6, iy0 + 7], duration: 1, every: 37, offset: 30, clip: glass });
  effects.push({ kind: 'sprite', id: 'cargo', frames: CARGO, from: [ix0 - 10, iy0 + (port ? 13 : 4)], to: [ix0 + iw, iy0 + (port ? 12 : 3)], duration: 28, every: 75, offset: 40, fps: 2, clip: glass });
  [0, 1, 2].forEach(i => effects.push({ kind: 'sprite', id: `carp-${i + 1}`, frames: CARP_LEFT, from: [ix0 + iw + i * 3, iy0 + (port ? 14 : 10) + i * 2 - (i === 2 ? 3 : 0)],
    to: [ix0 - 8 + i * 3, iy0 + (port ? 16 : 12) + i * 2 - (i === 2 ? 3 : 0)], duration: 16, every: 80, offset: 12 + i * 1.3, fps: 2, clip: glass }));
  effects.push({ kind: 'sprite', id: 'greytide', frames: GREYTIDE, from: [ix0 + iw - 30, iy0], to: [ix0 + 34, iy0 + 5], duration: 60, every: 140, offset: 75, fps: 0.5, clip: glass });

  const sw = port ? w - 10 : 50;
  strip(base, effects, Math.floor(w / 2 - sw / 2), fy1 + 1, sw);
  // The information row: what this deck is, the weather outside and the photo booth, on one baseline.
  const pw = port ? 34 : 30, py = fy1 + 5;
  const [deckX, deckY] = [2, py], [wxX, wxY] = port ? [w - 2 - pw, py] : [Math.floor(w / 2 - pw / 2), py], [boothX, boothY] = port ? [2, py + 6] : [w - 2 - pw, py];
  const inner = pw - 4;
  panel(base, deckX, deckY, pw, 'OBSERVATION DECK');
  const deckText = (id, rows, beats) => { const art = new Art(w, h); rows.forEach(([text, key], r) => art.text(deckX + 2, deckY + 1 + r, text, key)); layers.push(layer(id, art, { when: { beat: beats } })); };
  deckText('deck-sign', [['PLEASE ENJOY THE VIEW', 'h'], ['NO TAPPING ON THE GLASS', 'H']], ['none', 'enjoy', 'photos']);
  // Every life is valuable: nobody arrives knowing everything.
  deckText('deck-patient', [['EVERYONE WAS NEW ONCE', 'h'], ['ASK · LEARN · TRY AGAIN', 'c']], ['valuable']);
  // The lucky ten thousand, on the page that links xkcd's "Ten Thousand": someone learns this for the first time today.
  deckText('deck-counter', [['TODAY:  10,000', 'c'], ['PEOPLE LEARN SOMETHING', 'h'], ['FOR THE FIRST TIME', 'h']], ['lucky']);
  effects.push({ kind: 'blink', id: 'deck-counter-blink', region: [deckX + 10, deckY + 1, 6, 1], hz: 0.8, on: 'c', off: 'h', when: { beat: ['lucky'] } });
  panel(base, wxX, wxY, pw, 'SPACE WEATHER');
  effects.push({ kind: 'flap', id: 'weather', x: wxX + 2, y: wxY + 1, width: inner, period: 4, flip: 0.4, colour: 'a', align: 'left',
    texts: [['SOLAR WIND', 'CALM'], ['CARP', 'SCATTERED'], ['METEORS', 'LIGHT'], ['GREYTIDE', '1 ADRIFT'], ['COMET', 'VISIBLE'], ['VISIBILITY', 'LOVELY']].map(([k, v]) => lead(k, v, inner)) });
  base.text(wxX + 2, wxY + 3, lead('SHIELDS', 'NOMINAL', inner), 'H');
  const dimmed = new Art(w, h); dimmed.text(wxX + 2, wxY + 2, lead('DECK LIGHTS', 'DIMMED', inner), 'H');
  layers.push(layer('weather-lights', dimmed, { when: { beat: ['none', 'valuable', 'photos', 'lucky'] } }));
  const festive = new Art(w, h); festive.text(wxX + 2, wxY + 2, lead('DECK LIGHTS', 'FESTIVE', inner), 'p');
  layers.push(layer('weather-festive', festive, { when: { beat: ['enjoy'] } }));
  panel(base, boothX, boothY, pw, 'PHOTO BOOTH');
  base.text(boothX + 2, boothY + 1, '[==slot==]', 'd'); base.text(boothX + 2, boothY + 3, '4 PRINTS · NO CHARGE', 'A');
  const smile = new Art(w, h); smile.text(boothX + 14, boothY + 1, 'SMILE!', 'a'); layers.push(layer('booth-smile', smile, { when: { beat: ['photos'] } }));
  effects.push({ kind: 'blink', id: 'booth-smile-blink', region: [boothX + 14, boothY + 1, 6, 1], hz: 1, on: 'a', off: 'A', when: { beat: ['photos'] } });
  const prints = [];
  for (let f = 0; f < 6; f++) {
    const art = new Art(w, h);
    for (let i = 0; i <= Math.min(f, 3); i++) art.text(boothX + 2 + i * 4, boothY + 2, '[▒]', i === Math.min(f, 3) && f < 4 ? 'a' : 'I');
    prints.push(art);
  }
  layers.push({ ...framesLayer('photo-prints', prints, 1), when: { beat: ['photos', 'lucky'] } });

  // The deck: people on a bench looking out, a telescope, the old camera, a vending machine and plants.
  // The middle stays open: two crew meet there for the lucky ten thousand.
  const backY = port ? boothY + 12 : deckY + 10, walkY = port ? h - 6 : h - 4, floorY = h - 1;
  prop(base, port ? 2 : 1, backY - 2, ...PLANT);
  const benchX = port ? 8 : 7;
  prop(base, benchX, backY - 3, [' o    o    @', '/▒\\  /▒\\  /▒\\', '[═══════════]', ' |         |'], [' I    I    r', 'ddd  ddd  ddd', 'ooooooooooooo', ' d         d']);
  const telX = port ? w - 9 : 25;
  prop(base, telX, backY - 5, ['    o', '   //', '  //', ' [=]', ' /|\\', '/ | \\'], ['    c', '   oo', '  oo', ' HHH', ' ddd', 'd d d']);
  const mapX = port ? 28 : 41;
  prop(base, mapX, backY - 3, [' .----------.', '( · * ·  o · )', " '----------'", '   |      |'], [' oooooooooooo', 'ohhhhhhhhahhho', ' oooooooooooo', '   d      d']);
  effects.push({ kind: 'blink', id: 'map-here', region: [mapX + 9, backY - 2, 1, 1], hz: 1, on: 'a', off: 'A' });
  const camX = port ? 40 : 64, camY = port ? boothY : backY - 4;
  prop(base, camX, camY, [' .--.', '[(o) ]', '  /|\\', ' / | \\', '/  |  \\'], ['ooooo', 'ooaooo', '  ddd', ' d d d', 'd  d  d']);
  // Take photos: the old camera flashes now and then.
  effects.push({ kind: 'blink', id: 'camera-flash', region: [camX + 2, camY + 1, 1, 1], hz: 0.5, on: 'c', off: 'a', when: { beat: ['photos', 'lucky'] } });
  const vendX = port ? 52 : 74, vendY = port ? boothY - 1 : backY - 5;
  prop(base, vendX, vendY, ...VENDING);
  effects.push({ kind: 'flicker', id: 'cola-neon', region: [vendX + 2, vendY + 1, 5, 2], hz: 1.5, chance: 0.15, colour: 'd' });
  if (!port) {
    prop(base, 84, backY - 2, ...PLANT);
    prop(base, 90, backY - 2, [' c[_]', '[____]', ' |  |'], [' IIII', 'oooooo', ' d  d']);
  } else prop(base, 64, vendY + 3, ...PLANT);
  for (let x = 0; x < w; x++) { if (hash(x * 9, walkY + 3) < 0.1) base.put(x, walkY + 3 < floorY ? walkY + 3 : walkY + 2, '·', 'd'); }
  base.hline(0, w - 1, floorY, '▀', 'd');
  // Enjoy yourselves: a little confetti over the deck.
  effects.push({ kind: 'drift', id: 'confetti', region: [1, backY - 6, w - 2, 6], seed: 34, density: 0.03, speed: 1.2, glyphs: '*·*·', colours: '1357', when: { beat: ['enjoy'] } });
  // Someone strolls past now and then, except while the lucky ten thousand is playing out.
  const [sh, shk, sb] = LOOKS[4];
  effects.push({ kind: 'sprite', id: 'stroller', frames: walker(sh, shk, sb), from: [-4, walkY], to: [w + 1, walkY], duration: port ? 12 : 16, every: 40, offset: 10, fps: 4,
    when: { beat: ['none', 'enjoy', 'valuable', 'photos'] } });
  // The lucky ten thousand, played out: one crew member can't believe the other has never seen it, and takes them along.
  const [ax, bx] = port ? [30, 38] : [44, 50];
  const [ah, ahk, ab] = LOOKS[2], [bh, bhk, bb] = LOOKS[1];
  effects.push({ kind: 'sprite', id: 'lucky-a', frames: walker(ah, ahk, ab), from: [-4, walkY], to: [ax, walkY], duration: 4, hold: 600 - 4, every: 600, fps: 4, clock: 'beat', when: { beat: ['lucky'] } });
  effects.push({ kind: 'sprite', id: 'lucky-b', frames: walker(bh, bhk, bb), from: [w + 1, walkY], to: [bx, walkY], duration: 4, hold: 600 - 4, every: 600, fps: 4, clock: 'beat', when: { beat: ['lucky'] } });
  effects.push({ kind: 'dialogue', id: 'lucky-talk', speakers: [[ax + 1, walkY], [bx + 1, walkY]], width: 26, style: 'say', delay: 4, line: 3.5, pause: 3, colours: 'ca', clock: 'beat',
    exchanges: [
      [[0, 'Did you know what happens if you inject water into a banana?'], [1, 'Haha, no? Why?'], [0, "Oh boy, we've got something to do this shift..."]],
      [[0, "You've never added water to a monkey cube?"], [1, 'A monkey what?'], [0, 'Grab a glass. Not in the kitchen, though.']],
      [[0, 'Ever seen a welder meet a fuel tank?'], [1, 'No, why?'], [0, "Good. Let's go watch Engineering find out. From over here."]],
      [[0, "You haven't met Ian yet?"], [1, "Who's Ian?"], [0, "The HoP's corgi. Come on, his rounds start in five."]],
    ], when: { beat: ['lucky'] } });
  return { layers: [layer('base', base), ...layers], effects };
}

const SCENES = [
  { id: 'hangar-viewport', title: 'Hangar viewport', draw: hangar, alt: [{ text: 'A small, distant sun and a long dotted orbit. At its far end the station sits with a blinking light, labelled Aphelion · waking, and a shuttle moves along the orbit towards it. In front, an old painted console with amber screens and switches; a cyan panel is bolted on top with a new cable, and a cyan seam fills a crack in the metal.' }] },
  { id: 'departure-lounge', title: 'Departure lounge', draw: lounge, beats: LOUNGE_BEATS, alt: [{ text: 'A departure lounge. An old split-flap board in amber shows the current stop boarding. A new cyan strip hangs under it on fresh brackets and shows the current section. On the right a new cyan sign hangs over a faded gate sign. A window on the left shows drifting stars, above rows of worn seats.' }] },
  { id: 'baggage-hall', title: 'Baggage hall', draw: baggage, beats: BAGGAGE_BEATS, alt: [{ text: 'A baggage hall. A wall of old numbered lockers, a few hanging open, some with new cyan tags bolted on. Suitcases ride a conveyor belt through a new cyan scanner arch, and a cyan strip shows the current stop and section.' }] },
  { id: 'boarding-cabin', title: 'Boarding cabin', draw: cabin, beats: CABIN_BEATS, alt: [{ text: 'Inside the shuttle cabin. Overhead lockers and round portholes with stars drifting past, above a row of worn amber seats. Passengers file in and take the free seats; in the front row a passenger asks before sitting down. A fasten-straps sign glows.' }] },
  { id: 'landing-bay', title: 'Landing bay', draw: landingBay, beats: BAY_BEATS, alt: [{ text: 'A landing bay open to space behind a shimmering field. The Arrivals Shuttle waits on its pad with its door open and the ramp down. Passengers walk across the bay in small groups and up the ramp, past a crew member waving light wands, under a gate board that reads All passengers.' }] },
  { id: 'cabin-turbulence', title: 'Cabin, final approach', draw: cabinStrike, beats: STRIKE_BEATS, alt: [{ text: 'The cabin on final approach. Through the forward window the landing pad marked Keep clear comes up fast with a sea lion sitting on it. There is a thump and a jolt of turbulence; the overhead bins jump and the passengers start. Afterwards the sea lion sits dazed, unhurt, as the fasten-straps sign blinks.' }] },
  { id: 'viewport', title: 'Viewport', draw: viewport, beats: VIEWPORT_BEATS, alt: [
    { when: { beat: ['lucky'] }, text: 'The observation deck. Two crew members meet in front of the window. One cannot believe the other has never heard of it, and takes them along to see: water in a banana, a monkey cube, a welder and a fuel tank, Ian the corgi. A sign counts ten thousand people learning something today.' },
    { text: 'A wide observation window in a heavy riveted frame. Outside, a ringed gas giant, a nebula, a comet, the curve of the station dotted with lights, a passing cargo hauler, carp and a drifting assistant with a toolbox. On the deck, panels for the deck, the space weather and a photo booth, people on a bench looking out, a telescope, an old camera and a vending machine.' },
  ] },
  { id: 'pressure-door', title: 'Pressure door and new laboratory', draw: door, beats: DOOR_BEATS, alt: [
    { when: { whitelist: ['confirmed'] }, text: 'The pressure door has slid open. Cold white light floods out of a clean new laboratory with a crisp cyan workbench and terminal. The lamp above the door is cyan and the control panel reads: Whitelist confirmed, Discord applied, door open.' },
    { when: { whitelist: ['requested'] }, text: 'A battered pressure door with hazard stripes and a stencilled number. New cyan conduits are bolted to its frame. An amber lamp above it blinks, and a cyan control panel reads: Whitelist requested, Discord waiting, door held.' },
    { text: 'A battered pressure door with hazard stripes and a stencilled number. New cyan conduits are bolted to its frame. The lamp above it is dim, and a cyan control panel reads: Whitelist not requested, door held.' },
  ] },
];

await mkdir(outputDir, { recursive: true });
for (const def of SCENES) {
  const scene = { schema: 1, id: def.id, title: def.title, ...(def.beats ? { beats: def.beats } : {}), alt: def.alt, provenance: PROVENANCE,
    layouts: Object.fromEntries(Object.keys(SCENE_LAYOUTS).map(name => [name, def.draw(name)])) };
  validateScene(scene);
  const json = `${JSON.stringify(scene)}\n`;
  await writeFile(new URL(`${def.id}.json`, outputDir), json);
  console.log(def.id, json.length, 'bytes');
}
