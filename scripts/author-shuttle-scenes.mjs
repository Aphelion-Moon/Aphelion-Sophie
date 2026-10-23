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
// The wet floor sign with NO RUNNING built in (picked design): a two-line board on a stand, both lines centred on it.
const WET_SIGN = [['┌──────────┐', '│WET  FLOOR│', '│NO RUNNING│', '└─┬──────┬─┘', '  /      \\'],
  ['aaaaaaaaaaaa', 'arrrrrrrrrra', 'arrrrrrrrrra', 'aaaaaaaaaaaa', '  a      a']];
// The lounge has no janitor, so its sign warns of mothroaches crossing instead (picked design).
const LOUNGE_SIGN = [['   .---.', '  /{oo}\\', ' /CROSS-\\', '/  ING   \\'], ['   aaaa', '  aiccia', ' aaaaaaaa', 'aaaaaaaaaa']];
// Picked designs (design picker, owner, 22 October 2026); original ASCII by the coding agent.
// Ian: big ears, tail up, trotting.
const CORGI = [
  spriteFrame(['      /\\/\\', '~(____/ o>', '  /\\   /\\'], ['      rrrr', 'rrrrrrr ci', '  rr   rr']),
  spriteFrame(['      /\\/\\', '~(____/ o>', '   /\\ /\\'], ['      rrrr', 'rrrrrrr ci', '   rr rr']),
];
// The finned carp, drawn facing left (the way they cross the windows); CARP faces right.
const CARP_DRAWN = [
  spriteFrame(['   _,/\\', ' <o))))><', "   '\\/'"], ['   hHHH', ' cihhhhhc', '   HHHH']),
  spriteFrame(['   _,/\\', ' <o))))><', "    '\\/'"], ['   hHHH', ' cihhhhhc', '    HHHH']),
];
/** A sprite frame facing the other way: rows reversed and paired brackets swapped, so a fish swims head first. */
function mirrorFrame(frame) {
  const swap = { '(': ')', ')': '(', '<': '>', '>': '<', '{': '}', '}': '{', '[': ']', ']': '[', '/': '\\', '\\': '/' };
  const width = Math.max(...frame.text.map(row => [...row].length));
  const flip = (row, fill) => [...row.padEnd(width, fill)].reverse().map(ch => swap[ch] ?? ch).join('').replace(/\s+$/, '');
  const text = frame.text.map(row => flip(row, ' '));
  return { text, colours: frame.colours.map((row, r) => [...row.padEnd(width, ' ')].reverse().join('').slice(0, [...text[r]].length)) };
}
// Carp swim right to left across every window, so they face left; mirrored, they face right.
const CARP_LEFT = CARP_DRAWN.map(frame => ({ text: frame.text.map(row => row.replace(/^ /, '')), colours: frame.colours.map(row => row.replace(/^ /, '')) }));
const CARP = CARP_LEFT.map(mirrorFrame);
// The mothroach in side view (picked design), walking left; MOTHROACH_RIGHT walks the other way. SS13 culture only.
const MOTHROACH = [
  spriteFrame([' ,=,', '(@)=}~', " ''''"], [' AiA', 'IcIiiA', ' AAAA']),
  spriteFrame([' ,=,', '(@)=}', " ' ' '"], [' AiA', 'IcIii', ' A A A']),
];
const MOTHROACH_RIGHT = MOTHROACH.map(mirrorFrame);

// ---------- scene: hangar viewport (title screen) ----------
/**
 * Aphelion station, in more detail (owner's note on the title pick): a beacon on a mast with a dish and two modules, a
 * ring with lit windows round a hub, solar arrays on trusses either side, and a docking module below. Worn pale metal,
 * amber windows, cyan new work, a magenta beacon. Drawn from its left half and mirrored, so it is exactly symmetric;
 * every line piece meets its neighbour at the cell edge.
 */
const STATION_LEFT = [
  ['                   ', '●'],
  ['                   ', '│'],
  ['              ╲___ ', '│'],
  ['               ╲___', '┴'],
  ['                   ', '│'],
  ['                 [▒', '│'],
  ['                 [▒', '│'],
  ['                   ', '│'],
  ['           ╭───────', '┼'],
  ['       ╭───╯ □ ▒ □ ', '│'],
  ['     ╭─╯ □ ▒       ', '│'],
  ['┌┬┬┬┐│ ▒      ╭────', '┴'],
  ['├┼┼┼┼┼──────═┤  ▒▒ ', '●'],
  ['└┴┴┴┘│ ▒      ╰────', '┬'],
  ['     ╰─╮ □ ▒       ', '│'],
  ['       ╰───╮ □ ▒ □ ', '│'],
  ['           ╰───────', '┼'],
  ['                ╭──', '┴'],
  ['                │▓▓', '▓'],
  ['                ╰──', '┬'],
  ['               ════', '╪'],
];
const MIRROR = { '╭': '╮', '╮': '╭', '╰': '╯', '╯': '╰', '┤': '├', '├': '┤', '╱': '╲', '╲': '╱', '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[',
  '┌': '┐', '┐': '┌', '└': '┘', '┘': '└' };
const STATION = STATION_LEFT.map(([left, mid]) => left + mid + [...left].reverse().map(ch => MIRROR[ch] ?? ch).join(''));
/** Rows of the station's parts, for colour: the solar arrays, the hub and the docking module. */
const STATION_PARTS = Object.freeze({ mid: 19, arrays: [11, 13], hub: 12, dock: [17, 19], windows: [[13, 9], [25, 15], [9, 14], [29, 10]] });
function station(a, effects, x0, y0) {
  const { mid, arrays, hub, dock, windows } = STATION_PARTS;
  STATION.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ' ') return;
    const array = r >= arrays[0] && r <= arrays[1] && (c <= 4 || c >= 2 * mid - 4);
    const key = ch === '●' ? (r === 0 ? 'p' : 'c') : ch === '□' ? (hash(c, r) < 0.35 ? 'h' : 'a') : ch === '▓' ? 'A' : ch === '▒' ? 'A' : array ? 'H'
      // The hub and its spoke joints are new cyan work; the trusses and the dock's clamps are old olive metal.
      : r >= arrays[0] && r <= arrays[1] && Math.abs(c - mid) <= 6 ? 'h' : r === hub || '═╪'.includes(ch) ? 'o' : r >= dock[0] && r <= dock[1] ? 'o' : 'I';
    a.put(x0 + c, y0 + r, ch, key);
  }));
  effects.push({ kind: 'blink', id: 'station-beacon', region: [x0 + mid, y0, 1, 1], hz: 0.8, on: 'p', off: 'd' });
  effects.push({ kind: 'blink', id: 'station-core', region: [x0 + mid, y0 + hub, 1, 1], hz: 0.4, on: 'c', off: 'h' });
  windows.forEach(([c, r], i) => effects.push({ kind: 'blink', id: `station-window-${i + 1}`, region: [x0 + c, y0 + r, 1, 1], hz: 0.3 + i * 0.12, on: 'a', off: 'A' }));
  // The docking module's light: a slow amber pulse across the hatch.
  effects.push({ kind: 'pulse', id: 'dock-light', path: [-2, -1, 0, 1, 2].map(dx => [x0 + mid + dx, y0 + dock[0] + 1]), speed: 2, glyph: '▓', colour: 'a' });
  return { width: [...STATION[0]].length, height: STATION.length, mast: x0 + mid, hub: y0 + hub };
}
/**
 * The main page fills the window (picked design: the menu as a terminal window). The rainbow stripes and the logo sit
 * top left, the station top right with the shuttle's orbit running to it, and below them the console: a terminal window
 * whose inside is the menu slot, where the page puts its real menu, beside the Shuttle Link panel and the old dials.
 */
function hangar(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const lx = 3, ly = 1;
  stripes(base, lx, ly, 5); logo(base, lx + 19, ly); base.text(lx + 19, ly + 7, 'T H E   S H U T T L E', 'i');
  const stationWidth = [...STATION[0]].length, sx0 = port ? w - stationWidth - 2 : w - stationWidth - 1, sy0 = port ? ly + 10 : 0;
  const { hub } = station(base, effects, sx0, sy0);
  // No name plate across the mast (owner, 24 October 2026: the 'Aphelion station · waking' line is gone).
  const conTop = port ? sy0 + STATION.length + 1 : STATION.length;
  // The orbit: a dotted ellipse under the logo whose right end meets the station's solar array at the hub's height. The
  // shuttle runs along its upper half, clear of the subtitle.
  const ra = port ? Math.round((sx0 - 4) / 2) : 22, rb = 3, cx = sx0 - 1 - ra, cy = hub;
  for (let th = 0; th < Math.PI * 2; th += 0.01) {
    const x = Math.round(cx + ra * Math.cos(th)), y = Math.round(cy - rb * Math.sin(th));
    if (base.get(x, y) === ' ' && ((x + y) & 1)) base.put(x, y, '·', 'H');
  }
  sun(base, Math.round(cx - ra * 0.55), cy, port ? 3 : 3.4);
  const path = [];
  for (let k = 0; k <= 80; k++) {
    const th = Math.PI * (1 - k / 80), p = [Math.round(cx + ra * Math.cos(th)), Math.round(cy - rb * Math.sin(th))];
    if (!path.length || path.at(-1)[0] !== p[0] || path.at(-1)[1] !== p[1]) path.push(p);
  }
  effects.push({ kind: 'pulse', id: 'shuttle', path, speed: path.length / 14, glyph: '>', colour: 'c', trail: 6, trailGlyph: '·', trailColour: 'h' });
  // A carp swims out from behind the station and away across space, above the console.
  effects.push({ kind: 'sprite', id: 'carp-hangar', frames: CARP_LEFT, from: [sx0 + 2, cy + 3], to: [-10, cy + 5], duration: port ? 10 : 16, every: 60, offset: 18, fps: 2,
    clip: [0, 0, sx0, conTop] });
  // Stars drift only in open space: above the logo, and between the subtitle and the console left of the station.
  const starRegions = [[0, 0, sx0 - 1, ly], [0, ly + 8, sx0 - 1, conTop - ly - 8]];
  starRegions.forEach((region, i) => effects.push({ kind: 'drift', id: `stars-${i + 1}`, region, seed: 11 + i, density: 0.028, speed: 1.2, glyphs: ".·'+", colours: '..Ih' }));

  // Console: old painted metal, panel seams and scuffs, with a cyan seam filling a crack.
  base.fill(0, conTop + 1, w - 1, h - 1, ' ', ' ');
  for (let y = conTop + 1; y < h; y++) for (let x = 0; x < w; x++) { const r = hash(x * 7 + 1, y * 13 + 5); if (r < 0.05) base.put(x, y, r < 0.025 ? '.' : "'", 'd'); }
  base.hline(0, w - 1, conTop, '_', 'o');
  for (let x = 9; x < w; x += 19) { base.vline(x, conTop + 1, h - 1, '|', 'd'); base.put(x, conTop + 1, 'o', 'o'); }
  // The terminal window: its title bar names the session, and its inside is the menu slot (the page's real menu).
  const [tx0, ty0, tx1, ty1] = port ? [2, conTop + 1, w - 3, conTop + 16] : [2, conTop + 1, 50, h - 1];
  base.fill(tx0, ty0, tx1, ty1, ' ', ' '); base.box(tx0, ty0, tx1, ty1, 'h');
  // The window's title is the member's own name@aphelion, set by the page over the title slot on the top edge (it is
  // never in the scene data). The menu slot is the window's inside.
  const slot = [tx0 + 2, ty0 + 1, tx1 - tx0 - 3, ty1 - ty0 - 1], title = [tx0 + 2, ty0, tx1 - tx0 - 3, 1];
  // The cyan seam runs down the console beside the terminal: straight runs that step right, then back left, every third
  // row, drawn from line pieces that meet at the cell edges so it reads as one unbroken line.
  if (!port) for (let y = conTop + 1, x = tx1 + 2, step = 0; y < h; y++) {
    if ((y - conTop) % 3 === 0 && y < h - 1) {
      if (step++ % 2 === 0) { base.put(x, y, '└', 'h'); base.put(x + 1, y, '┐', 'h'); x++; } else { base.put(x, y, '┘', 'h'); base.put(x - 1, y, '┌', 'h'); x--; }
    } else base.put(x, y, '│', 'h');
  }
  // The Shuttle Link panel tells the truth about the member's Shuttle: what the server last said, never a guess.
  const pw = 26, [px, py] = port ? [2, ty1 + 1] : [tx1 + 5, conTop + 2], panelBottom = py + 6;
  base.fill(px, py, px + pw, panelBottom, ' ', ' ');
  base.box(px, py, px + pw, panelBottom, 'h'); base.put(px + 4, panelBottom, '╪', 'h'); base.put(px + pw - 4, panelBottom, '╪', 'h');
  base.text(px + 2, py + 1, 'SHUTTLE LINK', 'c'); base.text(px + pw - 7, py + 1, '• LIVE', 'h');
  effects.push({ kind: 'blink', id: 'link-live', region: [px + pw - 7, py + 1, 1, 1], hz: 0.6, on: 'h', off: 'H' });
  effects.push({ kind: 'text', id: 'link-stop', x: px + 2, y: py + 2, width: pw - 3, template: '» STOP {stopNumber:2} / {stopCount:2}', colour: 'c', when: { stop: ['some'], link: ['ready', 'none', 'offline'] } });
  for (const [state, label, key, stop] of [['ready', '» READY TO BOARD', 'c', ['none']], ['none', '» LINKING...', 'H', ['none']], ['offline', '» NO SIGNAL', 'p', ['none']],
    ['closed', '» NOT BOARDING YET', 'a', null], ['channel', '» FINISH IN CHANNEL', 'a', null], ['held', '» BOARDING HELD', 'a', null], ['arrived', '» ARRIVED', 'c', null]]) {
    const art = new Art(w, h); art.text(px + 2, py + 2, label, key);
    layers.push(layer(`link-${state}`, art, { when: { link: [state], ...(stop ? { stop } : {}) } }));
  }
  effects.push({ kind: 'scan', id: 'link-scan', region: [px + 2, py + 3, pw - 3, 1], speed: 1, glyph: '·', colour: 'H' });
  base.text(px + 2, py + 4, 'WHITELIST', 'h');
  for (const [state, label, key] of [['none', 'NOT REQUESTED', 'c'], ['requested', 'REQUESTED', 'a'], ['confirmed', 'CONFIRMED', 'c']]) {
    const art = new Art(w, h); art.text(px + pw - 1 - label.length, py + 4, label, key);
    layers.push(layer(`link-whitelist-${state}`, art, { when: { whitelist: [state] } }));
  }
  // The old status screen, its dials and switches.
  const [sx, sy] = port ? [px + pw + 3, py + 1] : [px, panelBottom + 2];
  base.fill(sx, sy, sx + 19, sy + 4, ' ', ' '); base.text(sx, sy, '+------------------+', 'o'); base.text(sx, sy + 4, '+------------------+', 'o');
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
  if (!port) {
    // Lamps over switches, and three knobs, beside the link panel.
    const x0 = px + pw + 4, sw = ['[|]', '[ ]', '[|]'];
    base.fill(x0 - 1, py - 1, w - 1, py + 4, ' ', ' ');
    for (let i = 0; i < 3; i++) {
      base.put(x0 + i * 4 + 1, py, '•', 'a'); base.text(x0 + i * 4, py + 1, sw[i], 'I');
      effects.push({ kind: 'blink', id: `lamp-${i + 1}`, region: [x0 + i * 4 + 1, py, 1, 1], hz: [0.6, 1.1, 0.8][i], on: 'a', off: 'A' });
    }
    base.text(x0, py + 3, '(o) (o) (o)', 'o');
    // A new cable from the link panel down to a socket in the old console, a pulse running along it.
    const cxl = px + pw - 6, by = panelBottom + 4;
    for (let y = panelBottom + 1; y < by; y++) base.put(cxl, y, '│', 'h');
    base.put(cxl, by, '╰', 'h'); base.text(cxl + 1, by, '──', 'h'); base.text(cxl + 3, by, '[≡]', 'o'); base.put(cxl + 4, by, '≡', 'h');
    const cable = []; for (let y = panelBottom + 1; y < by; y++) cable.push([cxl, y]); cable.push([cxl, by], [cxl + 1, by], [cxl + 2, by]);
    effects.push({ kind: 'pulse', id: 'cable-pulse', path: cable, speed: 4, glyph: '•', colour: 'c' });
  }
  return { layers: [layer('base', base), ...layers], effects, slots: { menu: slot, title } };
}

// ---------- scene: departure lounge ----------
const LOUNGE_BEATS = ['adult', 'beepsky', 'pride', 'voluntary', 'amenities', 'expectations', 'meridian', 'wolfgate'];
// Officer Beepsky, a securitron drone (owner direction, sixth pass): the siren turns red and blue, the thrusters flicker.
// Original art; the name is shared SS13 culture.
const BEEPSKY = ['r', 'h'].map((siren, f) => spriteFrame(['   ▄', ' [o_o]', '<[SEC]>', f ? "  ' '" : "   '"], [`   ${siren}`, ' IrIrI', 'IIaaaII', '  H H']));
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
  // Both servers are flagged in development (owner review of revision 3, 24 October 2026: Meridian too, not ONLINE).
  effects.push({ kind: 'flap', id: 'board-meridian', x: bx + bw - 12, y: by + 4, width: 10, texts: ['IN DEV'], period: 30, flip: 0.5, colour: 'h', when: { beat: servers } });
  effects.push({ kind: 'flap', id: 'board-wolfgate', x: bx + bw - 12, y: by + 5, width: 10, texts: ['IN DEV'], period: 30, flip: 0.5, colour: 'h', when: { beat: servers } });
  // The new strip, on fresh brackets.
  const sy = by + 10, sw = bw - 2, sx0 = bx + 1;
  base.put(bx + 6, by + 8, '╪', 'h'); base.put(bx + bw - 7, by + 8, '╪', 'h'); base.put(bx + 6, by + 9, '│', 'H'); base.put(bx + bw - 7, by + 9, '│', 'H');
  base.box(sx0, sy, sx0 + sw - 1, sy + 2, 'h');
  effects.push({ kind: 'text', id: 'strip', x: sx0 + 2, y: sy + 1, width: sw - 4, template: '» {stopTitle} · SECTION {section}/{sections}', colour: 'c', align: 'center' });
  // Pride: the strip's brackets string up a stripe banner, and it stays up ("it isn't Pride Month, it's just us").
  const pride = new Art(w, h);
  for (let x = bx + 7; x < bx + bw - 7; x++) pride.put(x, by + 9, '▄', String(1 + Math.floor((x - bx - 7) / ((bw - 14) / 7)) % 7));
  layers.push(layer('pride-banner', pride, { when: { after: ['pride'] } }));

  // Help desk (picked design: take a number). Its screen follows the section Sophie is reading.
  const desk = (x, y) => {
    // A standing object: Ian and passers-by go behind it, never across its screen.
    const screen = new Art(w, h), legs = new Art(w, h);
    reserve(x, y, x + 18, y + 6); base.fill(x, y, x + 18, y + 3, ' ', ' '); base.fill(x + 6, y + 4, x + 11, y + 6, ' ', ' ');
    screen.box(x, y, x + 18, y + 3, 'o'); screen.text(x + 4, y, ' HELP DESK ', 'A'); screen.fill(x + 1, y + 1, x + 17, y + 2, ' ', ' ');
    screen.put(x + 7, y + 3, '┬', 'o'); screen.put(x + 10, y + 3, '┬', 'o');
    layers.push(layer('desk', screen, { front: true, opaque: true }));
    // Two legs down to a foot plate, and the ticket dispenser on the left one.
    prop(legs, x + 6, y + 4, ['[#] │', ' │  │', '▀▀▀▀▀▀'], ['opo o', ' o  o', 'dddddd']);
    layers.push(layer('desk-legs', legs, { front: true }));
    const screens = [['none', 'NOW SERVING:', 'TAKE A NUMBER »'], ['adult', 'AGE CHECK', '18+ ONLY'], ['pride', 'ALL ABOARD', 'BE YOURSELF'],
      ['voluntary', 'BOARDING IS', 'VOLUNTARY'], ['amenities', 'NEED HELP?', '#open-a-ticket'], ['expectations', 'READ THE WIKI', 'RULES FIRST'],
      ['meridian', 'MERIDIAN RIFT', 'SS 13 SERVER'], ['wolfgate', 'WOLFGATE', 'SS 14 · SOON']];
    for (const [beat, top, bottom] of screens) {
      const art = new Art(w, h); art.text(x + 2, y + 1, top, beat === 'none' ? 'a' : 'c'); art.text(x + 2, y + 2, bottom, beat === 'none' ? 'c' : 'a');
      layers.push(layer(`desk-${beat}`, art, { front: true, when: { beat: [beat] } }));
    }
    // The queue moves: the number being served flips on now and then.
    effects.push({ kind: 'flap', id: 'desk-number', x: x + 15, y: y + 1, width: 2, texts: ['42', '43', '44', '45'], period: 9, flip: 0.4, colour: 'a', when: { beat: ['none'] } });
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
  // EXIT (picked design: boxed, with an arrow) is always lit, and points away from the shuttle (owner review, sixth
  // pass). When Sophie points it out, its arrows chase that way.
  const exitSign = (x, y) => {
    reserve(x, y, x + 11, y + 2);
    base.fill(x, y, x + 11, y + 2, ' ', ' '); base.box(x, y, x + 11, y + 2, '4'); base.text(x + 6, y + 1, 'EXIT', '4');
    const still = new Art(w, h); still.text(x + 2, y + 1, '««', '4');
    layers.push(layer('exit-arrows', still, { when: { beat: except(LOUNGE_BEATS, 'voluntary') } }));
    const chase = [' ««', '««'].map(arrows => { const art = new Art(w, h); art.text(x + 1, y + 1, arrows, 'c'); return art; });
    layers.push({ ...framesLayer('exit-chase', chase, 2), when: { beat: ['voluntary'] } });
    effects.push({ kind: 'blink', id: 'exit-blink', region: [x + 6, y + 1, 4, 1], hz: 1, on: 'c', off: '4', when: { beat: ['voluntary'] } });
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
    base.fill(nx, ny, nx + 16, ny + 2, ' ', ' '); base.box(nx, ny, nx + 16, ny + 2, 'h'); base.text(nx + 2, ny + 1, 'SHUTTLE', 'c'); base.text(nx + 11, ny + 1, '»»»', 'H');
    effects.push({ kind: 'pulse', id: 'sign-chase', path: [[nx + 11, ny + 1], [nx + 12, ny + 1], [nx + 13, ny + 1]], speed: 4, glyph: '»', colour: 'c' });
    // The help desk stands on the floor now that the whole room is in view; EXIT is under the window, left of the benches.
    poster(w - 14, 10); fittings(3, 15); exitSign(1, 19);
  } else {
    reserve(1, 3, 11, 13); reserve(w - 12, 3, w - 2, 13);
    reinforcedWindow(base, effects, 'window-left', 1, 3, 11, 13, 1, 5);
    reinforcedWindow(base, effects, 'window-right', w - 12, 3, w - 2, 13, 1, 9);
    exitSign(1, 14); fittings(w - 12, 14, true);
  }
  // Trim rail and the worn lower wall.
  const railY = port ? 17 : 18;
  for (let x = 0; x < w; x++) if (base.get(x, railY) === ' ') base.put(x, railY, '═', 'o');
  wallPanels(base, 0, 2, w - 1, railY - 1, 3, 12, reserved);

  // Seats: worn benches, one of them hiding a fluffy tail. They stand on the floor, so whatever crawls under them passes
  // behind their seats and legs.
  const seatY = port ? 19 : 20, sxs = port ? 4 : 14, ex = port ? w - 6 : w - 14, benches = new Art(w, h);
  for (let x = sxs; x <= ex - 4; x += 6) { benches.text(x, seatY, ' ___ ', 'o'); benches.text(x, seatY + 1, '|___|', '.'); benches.text(x, seatY + 2, ' | | ', 'd'); }
  layers.push(layer('benches', benches, { front: true }));
  // Now and then a mothroach crosses the floor in front of the benches, waits at its crossing sign (looking both ways),
  // then carries on off the left edge.
  const roachY = port ? 26 : 27;
  effects.push({ kind: 'sprite', id: 'mothroach', frames: MOTHROACH, from: [w + 2, roachY], to: [17, roachY], duration: port ? 14 : 18, hold: 3,
    exit: { to: [-8, roachY], duration: 6 }, every: 90, offset: 35, fps: 2 });
  const tail = new Art(w, h); prop(tail, sxs + 6 * 4 + 4, seatY - 1, ['~@'], ['rr']);
  layers.push(layer('pride-tail', tail, { when: { after: ['pride'] } }));
  // Rook and Pip wait for boarding on benches far apart. They have not met yet; they will at the baggage belt.
  const waiting = new Art(w, h);
  for (const [seat, [head, headKey, bodyKey, torso, torsoKeys]] of [[1, ROOK_LOOK], [7, PIP_LOOK]]) {
    const x = sxs + 6 * seat + 1;
    waiting.text(x + 1, seatY - 1, head, headKey); [...torso].forEach((ch, i) => waiting.put(x + i, seatY, ch, torsoKeys[i] ?? bodyKey));
  }
  layers.push(layer('companions-waiting', waiting));

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
    ? [[6, 23, ...LOUNGE_SIGN], [44, 40, ['_\\/_'], 'a'], [14, 48, [' ,-.', '[▄▄▄]'], [' ddd', 'rrrrr']], [56, 32, ['[u]'], 'r'], [30, 52, ["-'  -'"], 'I']]
    : [[6, 24, ...LOUNGE_SIGN], [54, 36, ['_\\/_'], 'a'], [60, 30, [' ,-.', '[▄▄▄]'], [' ddd', 'rrrrr']],
      [34, 31, ['[u]'], 'r'], [42, 37, ["-'  -'"], 'I'], [22, 37, ['[≡]'], 'H'], [12, 32, ['≡≡≡≡'], 'd']];
  for (const [x, y, lines, keys] of floorProps) {
    for (let r = 0; r < lines.length; r++) for (let c = 0; c < [...lines[r]].length; c++) base.put(x + c, y + r, ' ', ' ');
    prop(base, x, y, lines, keys);
  }
  if (port) desk(48, 41); else desk(w - 22, 26);
  // Officer Beepsky flies in for the 18+ sign and says the age check (the story's line), then leaves on the next page.
  {
    // He hovers in open wall space, his bubble clear of the departures board.
    const [hx, hy] = port ? [33, 25] : [75, 12], who = [hx + 3, hy];
    const beepsky = { clock: 'beat', once: true };
    effects.push({ kind: 'sprite', id: 'beepsky', frames: BEEPSKY, from: [w + 2, hy - 1], to: [hx, hy], duration: 2.5, hold: 590, every: 600, fps: 2, still: 1, ...beepsky,
      when: { beat: ['beepsky'] } });
    effects.push({ kind: 'sprite', id: 'beepsky-leaves', frames: BEEPSKY, from: [hx, hy], to: [hx, hy], duration: 1, hold: 0.5, exit: { to: [w + 2, hy - 2], duration: 2.5 },
      every: 600, fps: 2, ...beepsky, when: { beat: ['adult'], after: ['beepsky'] } });
    const halt = { kind: 'dialogue', id: 'beepsky-says', speakers: [who, who], width: 24, style: 'say', delay: 2.5, line: 4, pause: 3, colours: 'rr', clock: 'beat',
      exchanges: [[[0, 'HALT-- oh. You\'re ancient. Move along.']]], when: { beat: ['beepsky'] } };
    effects.push(halt, ...blips(halt));
  }
  // Dust in the light over the benches, kept out of the EXIT sign's box.
  effects.push({ kind: 'drift', id: 'dust', region: [14, seatY - 4, w - 28, 3], seed: 9, density: 0.02, speed: 0.3, glyphs: '·', colours: 'I' });
  // Ian makes his rounds: three of them while the lounge is on screen, one bark each (owner review of revision 3, 24
  // October 2026: at most three barks in the Brochure, each with a *BARK!* bubble, as Rook and Pip have).
  // He trots between tile seams, his feet on one, so no seam runs through his face.
  const ianY = port ? 44 : 33;
  const ian = { kind: 'sprite', id: 'ian', frames: CORGI, from: [-12, ianY], to: [w + 2, ianY], duration: port ? 10 : 14, every: 75, delay: 35,
    clock: 'scene', times: 3, fps: 4 };
  // The bark, halfway across; the bubble rides over his head for a moment and moves with him as far as it can.
  const barkAt = ian.delay + ian.duration * 0.5, barkFor = 1.5;
  const barkX = Math.round(ian.from[0] + (ian.to[0] - ian.from[0]) * (0.5 + barkFor / 2 / ian.duration)) + 8;
  effects.push(ian, { kind: 'cue', id: 'ian-sound', cue: 'SC-20', at: barkAt, every: ian.every, clock: 'scene', times: ian.times },
    { kind: 'dialogue', id: 'ian-barks', speakers: [[barkX, ianY], [barkX, ianY]], width: 14, style: 'emote', exchanges: [[[0, '*BARK!*']]],
      line: barkFor, pause: ian.every - barkFor, colours: 'aa', clock: 'scene', delay: barkAt, times: ian.times, still: false });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: pressure door and new laboratory ----------
const DOOR_BEATS = ['watch-step', 'feedback', 'be-safe', 'ready', 'get-whitelisted'];
// Picked designs: the vending machine with lit buttons, and a hydroponics tray for the plants.
const VENDING = [['┌────────┐', '│SPACE   │', '│  COLA  │', '│[o][o]::│', '│[o][o]::│', '│ [____] │', '└────────┘'],
  ['o', 'oppppp   o', 'o  pppp  o', 'orarrarcco', 'orarrarcco', 'o rddddr o', 'o']];
const PLANT = [[' \\|/ \\|/', '[▄▄▄▄▄▄▄]'], ['4', 'o']];
// The janitor mops; the mop head swings from one side to the other.
// The janitor in a cap, mop swinging (picked design).
const JANITOR = [
  [[' _o', ' /|\\_', ' / \\ \\', '     ~~'], [' pi', ' pppo', ' I I o', '     hh']],
  [[' _o', ' /|\\_', ' / \\ |', '    ~~~'], [' pi', ' pppo', ' I I o', '    hhh']],
];
// Two crew by the door wave arrivals in under a welcome sign that bobs as they wave (picked design).
const GREETER = [[['[WELCOME]', '  \\o/', '   |', '  / \\'], ['aaaaaaaaa', '  cic', '   c', '  I I']],
  [[' [WELCOME]', '  \\o/', '   |', '  / \\'], [' aaaaaaaaa', '  cic', '   c', '  I I']]];
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
  // Through the open door: the station concourse, its directory sign and people going about their shift.
  const signW = 20, signX = cx - signW / 2, signY = dy0 + 2;
  light.fill(signX, signY, signX + signW - 1, signY + 5, ' ', ' ');
  light.box(signX, signY, signX + signW - 1, signY + 5, 'h');
  [['CONCOURSE', 'c'], ['» MERIDIAN RIFT', 'a'], ['» WOLFGATE', 'a'], ['» #general', 'h']].forEach(([text, key], r) => light.text(signX + 2, signY + 1 + r, text, key));
  const floor = dy1 - 2;
  light.hline(dx0 + 1, dx1 - 1, floor + 1, '─', 'H');
  for (const [x, look] of [[dx0 + 4, LOOKS[0]], [dx0 + 9, LOOKS[3]], [dx1 - 9, LOOKS[5]], [dx1 - 4, LOOKS[1]]]) {
    light.put(x, floor - 1, look[0], look[1]); light.put(x, floor, '|', look[2]);
  }
  layers.push(layer('concourse', light, { when: { whitelist: ['confirmed'] } }));

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
  const greetY = dy1 - 2, greetR = port ? dx1 + 9 : dx1 + 8;
  // The sign sits a row above each greeter. On the left, sign and greeter stand clear of the door frame even as the
  // sign bobs; on the right, the greeter stands where they always have.
  const greeters = GREETER.map(([lines, keys]) => { const art = new Art(w, h); prop(art, dx0 - 12, greetY - 1, lines, keys); prop(art, greetR - 2, greetY - 1, lines, keys); return art; });
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
  // The first rows in front of the door stay clear: arrivals walk along them to the door queue.
  const rowA = port ? floorY + 5 : floorY + 4, rowB = rowA + 8, rowC = rowB + 8;
  // Landscape: the checklist and the game monitor hang on the walls either side of the door; portrait: on the deck.
  const at = port
    ? { wet: [2, rowA], feedback: [29, rowA], safe: [w - 17, rowA], checklist: [2, rowB], game: [w - 25, rowB], carts: [2, rowC], vending: [w - 12, rowC] }
    : { wet: [2, rowA], feedback: [29, rowA], safe: [w - 34, rowA], checklist: [2, boardY + boardH + 2], game: [w - 26, dy0 + 10], carts: [2, rowB], vending: [w - 12, rowA] };
  {
    // Watch your step and do not run: the janitor mops, and puts the wet floor sign out.
    // The floor stays tiled here: the janitor and the sign cover it only while they are out (owner review, sixth pass).
    const [x, y] = at.wet;
    deck.push({ ...framesLayer('janitor', JANITOR.map(([lines, keys]) => { const art = new Art(w, h); prop(art, x, y + 1, lines, keys); return art; }), 1.5), when: { beat: ['watch-step'] } });
    effects.push({ kind: 'cue', id: 'mop', cue: 'SC-19', at: 0.5, clock: 'beat', when: { beat: ['watch-step'] } });
    // Once the section is read, the janitor heads off along the deck, job done.
    effects.push({ kind: 'sprite', id: 'janitor-leaves', frames: JANITOR.map(([lines, keys]) => spriteFrame(lines, keys)), from: [x, y + 1], to: [x, y + 1], duration: 1, hold: 0.5,
      exit: { to: [-8, y + 1], duration: 4 }, every: 600, fps: 2, clock: 'beat', once: true, when: { beat: ['feedback'] } });
    // The bucket by the mop, and the sign (NO RUNNING built in), out from Watch your step until the floor dries.
    // The sign's board is opaque; its legs are not, so the floor shows between and beside them.
    const out = { when: { after: ['watch-step'], until: ['ready'] } }, sign = new Art(w, h), legs = new Art(w, h), bucket = new Art(w, h);
    prop(sign, x + 13, y, WET_SIGN[0].slice(0, 4), WET_SIGN[1].slice(0, 4)); prop(legs, x + 13, y + 4, WET_SIGN[0].slice(4), WET_SIGN[1].slice(4));
    prop(bucket, x + 7, y + 3, ['[___]'], 'a');
    deck.push(layer('deck-wet', sign, { front: true, opaque: true, ...out }), layer('deck-wet-legs', legs, { front: true, ...out }),
      layer('deck-bucket', bucket, { front: true, opaque: true, ...out }));
    // While Sophie reads Watch your step, the sign's NO RUNNING line blinks.
    effects.push({ kind: 'blink', id: 'deck-wet-blink', region: [x + 14, y + 2, 10, 1], hz: 1, on: 'r', off: 'A', when: { beat: ['watch-step'] } });
  }
  {
    // Feedback is a two-way street: a drop terminal (picked design, in the other designs' colours, owner's note), and a
    // note going in.
    // Props clear exactly the floor they stand on, so no tiles go missing around them.
    const [x, y] = at.feedback; clearArea(x, y + 1, 14, 4);
    prop(base, x, y + 1, ['┌─ FEEDBACK ─┐', '│ > tell us_ │', '│   [▒▒▒]    │', '└─────┬┬─────┘'], ['oooaaaaaaaaooo', 'o p cccccccc o', 'o   diiid    o', 'o']);
    effects.push({ kind: 'blink', id: 'feedback-cursor', region: [x + 11, y + 2, 1, 1], hz: 1, on: 'c', off: 'd', when: { beat: except(DOOR_BEATS, 'feedback') } });
    // The note drops in above the slot, then the screen says it arrived.
    const notes = [0, 1, 2].map(f => {
      const art = new Art(w, h);
      if (f === 0) art.text(x + 5, y, '[=]', 'i'); else { art.text(x + 2, y + 2, '> received', 'c'); art.text(x + 4, y + 3, '[▒▒▒]', 'a'); }
      return art;
    });
    deck.push({ ...framesLayer('deck-feedback-note', notes, 1.5), clock: 'beat', once: true, when: { beat: ['feedback'] } });
    effects.push({ kind: 'cue', id: 'note-in', cue: 'SC-16', at: 0.7, clock: 'beat', when: { beat: ['feedback'] } });
  }
  {
    // Be safe, Spacer: the emergency locker, internals and all.
    const [x, y] = at.safe; clearArea(x, y, 15, 5);
    // The red-cross locker (picked design), with a status row for its internals.
    prop(base, x, y, ['┌─ EMERGENCY ─┐', '│  (+)  [O2]  │', '│  /_\\  [O2]  │', '│             │', '└─────────────┘'], ['rrrrrrrrrrrrrrr', 'r  ipi  rccr  r', 'r  rrr  rccr  r', 'r             r', 'rrrrrrrrrrrrrrr']);
    const lit = new Art(w, h); lit.text(x + 2, y + 3, 'INTERNALS ON', 'c'); beatLayer('deck-internals', lit, ['be-safe']);
    effects.push({ kind: 'blink', id: 'deck-locker-blink', region: [x + 2, y + 3, 12, 1], hz: 1, on: 'c', off: 'H', when: { beat: ['be-safe'] } });
  }
  {
    // Ready to disembark? The checklist (picked design: a wall screen) ticks itself off as Sophie reads it.
    const [x, y] = at.checklist, items = ['18+ & ADULT', 'RULES APPLY', 'BOUNDARIES', 'WHERE TO ASK'];
    clearArea(x, y, 24, 6);
    base.box(x, y, x + 23, y + 5, 'h'); base.text(x + 2, y, ' BOARDING CHECK ', 'h');
    items.forEach((item, i) => { base.put(x + 2, y + 1 + i, '□', 'H'); base.text(x + 4, y + 1 + i, item, 'h'); });
    const ticks = [0, 1, 2, 3, 4].map(f => { const art = new Art(w, h); for (let i = 0; i < f; i++) art.put(x + 2, y + 1 + i, '■', 'c'); if (f === 0) art.put(x + 2, y + 1, '□', 'H'); return art; });
    deck.push({ ...framesLayer('deck-checklist', ticks, 0.8), clock: 'beat', once: true, when: { beat: ['ready'] } });
    effects.push({ kind: 'cue', id: 'checklist-stamp', cue: 'SC-15', at: 5, clock: 'beat', when: { beat: ['ready'] } });
    // Ticked stays ticked: on the next section, through clearance and on arrival.
    const done = new Art(w, h); items.forEach((_, i) => done.put(x + 2, y + 1 + i, '■', 'c'));
    deck.push(layer('deck-checklist-done', done, { when: { after: ['ready'], beat: ['get-whitelisted', 'none'] } }));
  }
  {
    // The last step happens in the game: its [ Get Whitelisted ] button.
    const [x, y] = at.game; clearArea(x, y, 23, 6);
    prop(base, x, y, ['┌─────────────────────┐', '│ MERIDIAN RIFT       │', '│                     │', '│                     │', '└────────┬───┬────────┘', '        /_____\\'], ['ooooooooooooooooooooooo', 'oaaaaaaaaaaaaaa      o', 'o                     o', 'o                     o', 'ooooooooooooooooooooooo', '        ddddddd']);
    base.text(x + 2, y + 2, '[ Get Whitelisted ]', 'H');
    const lit = new Art(w, h); lit.text(x + 2, y + 2, '[ Get Whitelisted ]', 'c'); lit.text(x + 2, y + 3, '> link via Discord', 'I');
    // Lit from its section on, and still lit while clearance runs and on arrival: it is the step still to do.
    deck.push(layer('deck-get-whitelisted', lit, { when: { after: ['get-whitelisted'] } }));
    effects.push({ kind: 'blink', id: 'deck-button-blink', region: [x + 2, y + 2, 19, 1], hz: 1, on: 'c', off: 'h', when: { beat: ['get-whitelisted'] } });
  }
  {
    // Luggage carts waiting for their owners, a vending machine, a bench and plants: standing objects that people walking
    // across the deck pass behind.
    // The bags checked in at the belt, on a cart under destination cards (picked design).
    const standing = new Art(w, h), [x, y] = at.carts;
    clearArea(x, y, 21, 4); clearArea(x + 2, y + 4, 18, 1);
    prop(standing, x, y, ['┌MERIDIAN┐ ┌WOLFGATE┐', '  .--.  .__.   ,~~.', ' [====][▓▓▓▓] (====)', ' |__________________|', '  o                o'],
      ['occcccccco ohhhhhhhho', '  oooo  oooo   IIII', ' AAAAAArrrrrr hhhhhh', ' dddddddddddddddddddd', '  d                d']);
    const [vx, vy] = at.vending;
    clearArea(vx, vy, 10, 7); prop(standing, vx, vy, ...VENDING);
    effects.push({ kind: 'flicker', id: 'cola-neon', region: [vx + 1, vy + 1, 6, 2], hz: 1.5, chance: 0.15, colour: 'd' });
    // Plants grow in hydroponics trays, standing on the deck with their feet level with what's beside them.
    const plant = (px, bottom) => { clearArea(px, bottom - 1, 9, 2); prop(standing, px, bottom - 1, ...PLANT); };
    plant(port ? vx - 10 : x + 23, port ? vy + 6 : y + 4);
    if (!port) { clearArea(w - 25, rowB + 2, 11, 2); prop(standing, w - 25, rowB + 2, ['[═════════]', ' |       |'], ['ooooooooooo', ' d       d']); plant(w - 13, rowB + 3); }
    deck.push(layer('deck-standing', standing, { front: true }));
  }
  // Rook and Pip step off the shuttle at a walk, wait in the door queue through the deck's sections and clearance, say
  // goodbye at the last step, and walk through the door ahead of you once it opens.
  {
    const qy = floorY + 1, queue = [['rook', ROOK, cx - 5], ['pip', PIP, cx + 3]], once = { every: 600, fps: 3, clock: 'beat', once: true };
    for (const [who, frames, qx] of queue) {
      effects.push({ kind: 'sprite', id: `${who}-steps-off`, frames, from: [w + 2, qy], to: [qx, qy], duration: who === 'rook' ? 8 : 9, hold: 590, ...once, still: 1, when: { beat: ['watch-step'] } });
      effects.push({ kind: 'sprite', id: `${who}-queues`, frames, from: [qx, qy], to: [qx, qy], duration: 1, hold: 590, ...once, still: 1,
        when: { beat: ['feedback', 'be-safe', 'ready', 'get-whitelisted', 'none'], whitelist: ['none', 'requested'] } });
      effects.push({ kind: 'sprite', id: `${who}-goes-in`, frames, from: [qx, qy], to: [cx - 1, dy1 - 3], duration: 3, hold: 0.5, exit: { to: [cx - 1, dy0 + 4], duration: 2 },
        ...once, delay: who === 'rook' ? 2 : 3, when: { whitelist: ['confirmed'] } });
    }
    const bye = { kind: 'dialogue', id: 'goodbye', speakers: [[cx + 4, qy], [cx - 4, qy]], width: 24, style: 'say', delay: 2, line: 3.5, pause: 1, colours: 'ca', clock: 'beat', once: true,
      exchanges: [[[0, 'see you on the station?'], [1, "Meridian's that way. Walk, don't run."]]], when: { beat: ['get-whitelisted'] } };
    effects.push(bye, ...blips(bye));
  }
  // Access granted: an ID card, shown only once Discord has applied Whitelist.
  // The swipe card (picked design): a magnetic stripe, then the access it grants.
  const card = new Art(w, h), cw = 23, ccx = Math.floor(w / 2 - cw / 2), ccy = port ? rowC : rowB;
  card.fill(ccx, ccy, ccx + cw - 1, ccy + 4, ' ', ' ');
  prop(card, ccx, ccy, ['┌─────────────────────┐', '│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│', '│ CREW · ACCESS:      │', '│ WHITELIST           │', '└─────────────────────┘'],
    ['c', `c${'o'.repeat(21)}c`, 'c cccc c ccccccc      c', 'c ccccccccc           c', 'c']);
  deck.push(layer('id-card', card, { opaque: true, front: true, when: { whitelist: ['confirmed'] } }));
  // New arrivals walk off the shuttle and across the deck. One of them drops some litter as they go; the cleanbot (picked
  // design: a puck) comes by and picks it up (owner review, sixth pass). One 90-second cycle keeps the three in step.
  {
    const CYCLE = 90, walk = port ? 10 : 14, roll = port ? 12 : 18, dropX = port ? 44 : 60, from = w + 1, to = -4, start = 20;
    const phase = second => ({ every: CYCLE, offset: (CYCLE - second % CYCLE) % CYCLE });
    effects.push({ kind: 'sprite', id: 'arrival', frames: walker(...LOOKS[3]), from: [from, h - 6], to: [to, h - 6], duration: walk, ...phase(start), fps: 4 });
    effects.push({ kind: 'sprite', id: 'arrival-2', frames: walker(...LOOKS[6]), from: [from, h - 6], to: [to, h - 6], duration: walk, ...phase(start + 45), fps: 4 });
    // The litter lands where the first arrival passed, and lies there until the cleanbot's front reaches it.
    const dropped = start + walk * (from - dropX) / (from - to), rolls = dropped + 6, bot = 8;
    const picked = rolls + roll * (dropX + 1 - (bot - 1) + 9) / (w + 2 + 9);
    effects.push({ kind: 'sprite', id: 'litter', frames: [spriteFrame(['%,'], ['rA'])], from: [dropX, h - 2], to: [dropX, h - 2], duration: Number((picked - dropped).toFixed(2)),
      ...phase(dropped) });
    effects.push({ kind: 'sprite', id: 'cleanbot', frames: [spriteFrame([' .----.', '(_o__o_)'], [' cccccc', 'cchcchcc']), spriteFrame([' .----.', '(o__o__)'], [' cccccc', 'chcchccc'])],
      from: [-9, h - 3], to: [w + 2, h - 3], duration: roll, ...phase(rolls), fps: 2 });
  }

  // Order: frame and fittings, the concourse behind the door, the sliding leaves, then lamp and control text.
  const byId = Object.fromEntries(layers.map(l => [l.id, l]));
  return { layers: [layer('base', base), byId.concourse, byId['leaf-left'], byId['leaf-right'], byId['lamp-idle'], byId['lamp-waiting'], byId['lamp-confirmed'],
    byId['control-idle'], byId['control-waiting'], byId['control-open'], byId.greeters, ...deck], effects };
}

function strip(base, effects, x, y, width) {
  base.box(x, y, x + width - 1, y + 2, 'h');
  effects.push({ kind: 'text', id: 'strip', x: x + 2, y: y + 1, width: width - 4, template: '» {stopTitle} · {section}/{sections}', colour: 'c', align: 'center' });
}
function tubes(base, w) { for (let x = 6; x < w - 8; x += 24) { base.put(x - 1, 1, '[', 'd'); base.put(x + 10, 1, ']', 'd'); base.text(x, 1, '══════════', 'I'); } }

// ---------- scene: baggage hall ----------
const BAGGAGE_BEATS = ['migrating', 'past', 'looc'];
/** "Someone left a cape in locker 12." (the story, Leave the past in the past). */
const CAPE_LOCKER = 12;
// The clown with a horn (picked design), in big shoes (owner's note on the pick).
const CLOWN = [
  spriteFrame([' HONK!', '  \\o/', '  (|)>', '  / \\', '(__)(__)'], [' aaaaa', '  pip', '  rpra', '  p p', 'rrrrrrrr']),
  spriteFrame(['', '  \\o/', '  (|)>', '  |  \\', ' (__)(__)'], ['', '  pip', '  rpra', '  p  p', ' rrrrrrrr']),
];
// Luggage: sixteen kinds, each riding the belt as its own item so it keeps its shape and tag from one end to the other.
// The owner's pick uses every design offered: hard cases, duffels and packs, stickered cases, and the earlier bags.
const BAGS = [
  [[' .--. ', '[====]'], ['oooooo', 'AAAAAA']],
  [[' .__. ', '[▓▓▓▓]'], ['oooooo', 'AAAAAA']],
  [[' .--. ', '[*==#]'], ['oooooo', 'AaAAcA']],
  [['  ,~~. ', '(=====)'], ['  IIII ', 'hhhhhhh']],
  [[' __     ', '(__)===>'], ['ooo     ', 'rrrrAAAA']],
  [['.----.', '|FRGL|'], ['AAAAAA', 'ArrrrA']],
  [[' ._. ', '{###}'], [' ooo ', 'rrrrr']],
  [['.----.', '|=^.^|'], ['oooooo', 'oiiiio']],
  [[' .--. ', '[|__|]'], ['oooooo', 'iiiiii']],
  [[' (") ', '(_=_)'], [' 444 ', '44444']],
  [[' .__. ', '[▓:▓▓]'], ['oooooo', 'rrprrr']],
  [[' .-. ', '(o o)'], [' ooo ', 'hhchh']],
  [['.____.', '[_▀▀_]'], ['IIIIII', 'IhhhhI']],
  [[' ,~~. ', '(=•=•)'], [' hhhh ', 'hhahah']],
  [[' /__\\ ', ' |__| '], [' iiii ', ' iiii ']],
  [[' .--. ', '[#__*]'], ['oooooo', 'iciiai']],
];
// Where migrating players' luggage comes from (owner direction, 22 October 2026): SS 13 servers go on to Meridian Rift,
// SS 14 servers to Wolfgate. Two bags in each run are refused at the scanner and go down the disposal chute, labelled
// for the section being read.
const ORIGINS = [['BUBBER', 13], ['MONOLITH', 14], ['SPLURT', 13], ['HARDLIGHT', 14], ['NOVA', 13], ['AFTERLIGHT', 14], ['OCULIS', 13],
  ['FRONTIER', 14], ['RATWOOD', 13], ['WAYFARER', 14], ['MARINES', 13]];
// The bag burning on the floor is labelled UPSTREAM (owner, 24 October 2026; it said BLASTWAVE before), so the belt refuses
// other things while migrating is read.
const DENIED = { '*': ['CONTRABAND', 'TOXICITY'], migrating: ['BIGOTRY', 'BAN DODGE'], past: ['GRUDGES', 'OLD DRAMA'], looc: ['METAGAME', 'ASSUMPTION'] };
/** A sound at the middle of each crossing of a passer-by on the scene's clock (sprite with every and offset). */
const crossingCue = (fx, cue, fraction = 0.5) => ({ kind: 'cue', id: `${fx.id}-sound`, cue, every: fx.every, ...(fx.when ? { when: fx.when } : {}),
  at: Number((((fx.every - (fx.offset ?? 0) % fx.every) % fx.every) + fx.duration * fraction).toFixed(2)) });
const PASSENGER = [
  spriteFrame([' o ', '/|\\', '/ \\'], ['iii', 'hhh', 'III']),
  spriteFrame([' o ', '/|\\', ' | '], ['iii', 'hhh', ' I ']),
];
const PASSENGER_B = [
  spriteFrame([' @ ', '/|\\', '/ \\'], ['rrr', 'aaa', 'III']),
  spriteFrame([' @ ', '/|\\', ' | '], ['rrr', 'aaa', ' I ']),
];
// The UPSTREAM bag fire (picked design: glowing blocks), hottest at the base, four flicker frames.
const FIRE = [
  ['   ░  ▒  ░', '  ▒▓░▓▒▓░▒', ' ▓█▓▓█▓▓█▓'], ['  ▒  ░  ▒', '  ░▓▒▓░▓▒▓', ' ▓▓█▓▓█▓▓█'],
  ['    ░ ▒ ░', '  ▓▒░▒▓░▓▒', ' █▓▓█▓▓█▓▓'], ['   ▒ ░  ▒', '  ▒░▓▒▓▒░▓', ' ▓█▓█▓▓▓█▓'],
].map(lines => spriteFrame(lines, lines.map(line => [...line].map(ch => ({ '░': 'a', '▒': 'r', '▓': 'r', '█': 'p' })[ch] ?? ' ').join(''))));
// The firebot (picked design: wheelie), drawn facing left: two rolling frames, then foaming from its nozzle.
const FIREBOT = [
  spriteFrame(['      .-.', '     [o_o]', '    =|___|', '    (O)(O)'], ['      rrr', '     rcrcr', '    crrrrr', '    rorror']),
  spriteFrame(['      .-.', '     [o_o]', '    =|___|', '    (o)(o)'], ['      rrr', '     rcrcr', '    crrrrr', '    rorror']),
  spriteFrame(['      .-.', '     [o_o]', '▒░▒░=|___|', '    (O)(O)'], ['      rrr', '     rcrcr', 'cccccrrrrr', '    rorror']),
];
/** The UPSTREAM bag fire's cycle on the scene's clock, in seconds. */
const FIRE_CYCLE = Object.freeze({ every: 24, flames: 15, roll: 1, foam: 2, back: 1.5, smoke: 18, smokeFor: 2, spark: 23 });
/**
 * The UPSTREAM bag lies open on the floor. It burns for a while; the firebot rolls out of its dock, foams it out and
 * rolls back; it smokes, sits cold, sparks and lights itself again. One 24-second cycle on the wall clock.
 */
function blastwave(w, h, x, y) {
  const { every, flames, roll, foam, back, smoke, smokeFor, spark } = FIRE_CYCLE;
  const bag = new Art(w, h), dock = new Art(w, h);
  prop(bag, x + 2, y + 1, [' _________ ', '/         \\', '[UPSTREAM ]', "'---------'"], [' AAAAAAAAA ', 'A         A', 'ArrrrrrrrrA', 'AAAAAAAAAAA']);
  // The firebot's dock stands beside it; parked inside, the bot is out of sight.
  prop(dock, x + 24, y, ['┌FIREBOT─┐', `│${'▒'.repeat(8)}│`, `│${'▒'.repeat(8)}│`, `│${'▒'.repeat(8)}│`, '└────────┘'], ['oaaaaaaaoo', 'oddddddddo', 'oddddddddo', 'oddddddddo', 'o']);
  // A sprite whose phase starts at a given second of the cycle.
  const at = second => (every - second) % every;
  const effects = [
    // Flames from 0 s; with motion off the bag is shown burning.
    { kind: 'sprite', id: 'blastwave-flames', frames: FIRE, from: [x + 2, y - 2], to: [x + 2, y - 2], duration: flames, every, fps: 4, still: 0.5 },
    // The firebot rolls out as the flames peak, foams the bag and rolls back into its dock.
    { kind: 'sprite', id: 'firebot', frames: FIREBOT, from: [x + 22, y + 1], to: [x + 13, y + 1], duration: roll, hold: foam, exit: { to: [x + 22, y + 1], duration: back },
      every, offset: at(flames - roll), fps: 4, rest: true },
    { kind: 'sprite', id: 'blastwave-foam', frames: [spriteFrame([' ░▒░▒░▒░', '░▒░▒░▒░▒░'], ['c', 'i'])], from: [x + 3, y - 1], to: [x + 3, y - 1], duration: smoke - flames,
      every, offset: at(flames) },
    { kind: 'sprite', id: 'blastwave-smoke', frames: [spriteFrame(["  . ' .", "'  .  '"], 'I'), spriteFrame([" '  . '", " .  '  "], 'I')], from: [x + 4, y - 1], to: [x + 4, y - 3],
      duration: smokeFor, every, offset: at(smoke), fps: 2 },
    { kind: 'sprite', id: 'blastwave-spark', frames: [spriteFrame(['*'], 'a'), spriteFrame(['·'], 'r')], from: [x + 7, y], to: [x + 7, y], duration: every - spark, every, offset: at(spark), fps: 4 },
    // The foam hissing on, and the spark catching.
    { kind: 'cue', id: 'firebot-foam', cue: 'SC-12', at: flames, every },
    { kind: 'cue', id: 'bag-relights', cue: 'SC-21', at: spark + 0.2, every },
  ];
  // The bag covers the floor under it; the floor stays tiled under the firebot's lane and the fire (owner review, sixth pass).
  return { layers: [layer('blastwave', bag, { front: true, opaque: true }), layer('firebot-dock', dock, { front: true, opaque: true })], effects };
}
function baggage(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [], reserved = [];
  const reserve = (x0, y0, x1, y1) => reserved.push([x0, y0, x1, y1]);
  tubes(base, w);
  effects.push({ kind: 'flicker', id: 'tube-flicker', region: [30, 1, 10, 1], hz: 2, chance: 0.25, colour: 'd' });
  // Two rows of old lockers; locker 12 stands open with something nobody came back for (the story names it).
  const lockW = 8, lockH = 4, top = 3, rows = 2, x0 = 2, count = Math.floor(((port ? w : w - 34) - 4) / lockW);
  let n = 1, lost = null;
  for (let r = 0; r < rows; r++) for (let i = 0; i < count; i++, n++) {
    const x = x0 + i * lockW, y = top + r * lockH;
    base.text(x, y, '+' + '-'.repeat(lockW - 1), 'o'); base.put(x, y + 1, '|', 'o'); base.put(x, y + 2, '|', 'o'); base.put(x, y + 3, '|', 'o');
    const open = hash(i, r + 41) < 0.14, tagged = !open && hash(i, r + 80) < 0.2;
    if (n === CAPE_LOCKER) { base.fill(x + 1, y + 1, x + lockW - 1, y + 3, '▓', 'd'); lost = [x, y]; continue; }
    if (open) { base.fill(x + 1, y + 1, x + lockW - 1, y + 3, '▓', 'd'); continue; }
    base.text(x + 3, y + 1, String(n).padStart(2, '0'), hash(x, y) < 0.3 ? 'A' : 'r');
    base.text(x + 3, y + 2, '==', 'I');
    if (tagged) { base.put(x + 6, y + 1, '◆', 'h'); effects.push({ kind: 'blink', id: `tag-${i}-${r}`, region: [x + 6, y + 1, 1, 1], hz: 0.4 + hash(i, r) * 0.6, on: 'h', off: 'H' }); }
  }
  const lockRight = x0 + count * lockW, lockBottom = top + rows * lockH;
  base.text(lockRight, top, '+', 'o'); for (let y = top + 1; y < lockBottom; y++) base.put(lockRight, y, '|', 'o');
  // A mothroach walks the tops of the lockers, past the ceiling lights.
  // It comes in from beyond the right edge and leaves beyond the left, never appearing or vanishing mid-screen.
  effects.push({ kind: 'sprite', id: 'mothroach', frames: MOTHROACH, from: [w + 2, top - 3], to: [-8, top - 3], duration: port ? 26 : 30, every: 110, offset: 60, fps: 2 });
  base.hline(x0, lockRight, lockBottom, '-', 'o');
  reserve(x0, top, lockRight, lockBottom);
  {
    // Leave the past in the past: an old hero's cape, unclaimed.
    const [lx, ly] = lost, cape = new Art(w, h);
    cape.fill(lx + 1, ly + 1, lx + lockW - 1, ly + 3, ' ', ' ');
    prop(cape, lx + 1, ly + 1, ['UNCLAIM', ' \\~~~/', '  \\_/'], ['AAAAAAA', ' ppppp', '  ppp']);
    // Left behind for good: once the past is left in the past, the cape stays in its locker.
    layers.push({ ...layer('lost-cape', cape, { opaque: true }), when: { after: ['past'] } });
  }
  // The claim sign and the stop strip: beside the lockers in landscape, under them in portrait.
  const sx = port ? 4 : lockRight + 4, sy = port ? lockBottom + 2 : top + 1, sw = port ? w - 8 : w - lockRight - 6;
  // Bags are checked in here before boarding: this is a check-in hall, not baggage claim.
  base.text(sx, sy, 'BAGGAGE CHECK-IN', 'r'); base.text(sx, sy + 1, '----------------', 'A'); reserve(sx, sy, sx + 15, sy + 1);
  strip(base, effects, sx, sy + 2, sw); reserve(sx, sy + 2, sx + sw - 1, sy + 4);
  if (!port) { base.text(sx, sy + 6, 'CHECK-IN  ───»  GATE 03', 'A'); base.text(sx, sy + 7, 'ALL BAGS ARE SCANNED', 'I'); reserve(sx, sy + 6, sx + 23, sy + 7); }
  // The claim terminal, up on the wall to the left of the belt: house rules, or the preferences import.
  const tx = 2, ty = port ? sy + 6 : lockBottom + 2, tw = port ? w - 6 : 46;
  base.fill(tx, ty, tx + tw, ty + 4, ' ', ' '); reserve(tx, ty, tx + tw, ty + 4);
  base.box(tx, ty, tx + tw, ty + 4, 'o'); base.text(tx + 2, ty, ' CHECK-IN TERMINAL ', 'A');
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
  // The scanner arch (picked design, with the lamps from the gate design, owner's note): bags pass out of sight inside
  // it as its beam sweeps, two lamps on top blink, and the scale above reads each one as it goes in.
  base.text(ax - 1, beltY - 3, '╔╪════╪╗', 'h'); for (let y = beltY - 2; y <= beltY; y++) { base.put(ax - 1, y, '║', 'h'); base.put(ax + 6, y, '║', 'h'); }
  const beam = [0, 1].map(f => {
    const art = new Art(w, h);
    art.text(ax + 1, beltY - 2 + f, '░▒▓▒', 'c'); art.text(ax + 2, beltY - 1 - f, '··', 'H');
    art.put(ax, beltY - 4, f ? '·' : '•', f ? 'A' : 'a'); art.put(ax + 5, beltY - 4, '•', 'a');
    return art;
  });
  layers.push(framesLayer('scanner', beam, 2));
  base.box(ax - 3, beltY - 8, ax + 8, beltY - 5, 'o'); base.text(ax - 1, beltY - 8, ' SCALE ', 'A'); base.text(ax - 1, beltY - 6, 'WEIGH', 'I');
  reserve(ax - 3, beltY - 8, ax + 8, beltY);
  // Disposals: refused bags drop off the belt into the chute (drawn over the floor, below).
  const dx = ax + 10, dy = beltY + 4;
  const DISPOSAL = [['\\           /', ' \\_________/', '  |DISPOSAL|', '  |___vv___|'], ['ooooooooooooo', ' ooooooooooo', '  opppppppo', '  ooooHHoooo']];
  const items = [], before = {}, after = {};
  const deniedAt = [4, 12];
  BAGS.forEach(([lines, keys], j) => items.push({ art: spriteFrame(lines, keys), weight: `${(6 + hash(j, 7) * 26).toFixed(1).padStart(4)} KG`, divert: deniedAt.includes(j) }));
  // Fourteen bags pass the scanner and there are eleven origins, so three come round twice, each half the belt after
  // its first (the eighth to tenth bags past the scanner repeat the first three).
  const origins = [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 7, 8, 9, 10].map(k => ORIGINS[k]);
  for (const beat of ['*', ...BAGGAGE_BEATS]) {
    let origin = 0;
    before[beat] = items.map((item, j) => item.divert ? (DENIED[beat] ?? DENIED['*'])[deniedAt.indexOf(j)] : beat === 'migrating' ? origins[origin++][0] : '');
    origin = 0;
    after[beat] = items.map(item => item.divert ? '' : beat === 'migrating' ? (origins[origin++][1] === 13 ? 'MERIDIAN' : 'WOLFGATE') : 'OK');
  }
  const tags = Object.fromEntries(Object.keys(before).map(beat => [beat, { before: before[beat], after: after[beat], beforeColour: beat === 'migrating' ? 'I' : 'p', afterColour: beat === 'migrating' ? 'c' : '4' }]));
  const luggage = { kind: 'conveyor', id: 'luggage', y: beltY - 2, from: start, to: end, gate: ax, gateWidth: 6, speed, spacing, items, tags,
    chute: [dx + 6, dy + 1], readout: { x: ax - 1, y: beltY - 7, width: 8, colour: 'a', deniedColour: 'p' } };
  effects.push(luggage);
  // The scanner buzzes as a refused bag enters the gate, and the chute takes it as it leaves the belt; in step with the belt.
  const loop = items.length * spacing, period = loop / speed;
  for (const i of deniedAt) {
    const width = Math.max(...items[i].art.text.map(row => [...row].length)), when = x => Number(((((x - start - i * spacing) % loop) + loop) % loop / speed).toFixed(2));
    effects.push({ kind: 'cue', id: `refused-${i}`, cue: 'SC-14', every: period, at: when(ax - Math.floor(width / 2)) });
    effects.push({ kind: 'cue', id: `disposed-${i}`, cue: 'SC-13', every: period, at: when(ax + 6 + 1) });
  }
  wallPanels(base, 0, lockBottom + 1, w - 1, beltY - 4, 7, 12, reserved);

  // Floor: claim-hall tiles, a luggage cart, the burning UPSTREAM bag and its firebot, and a monkey.
  const floorTop = beltY + 4;
  for (let y = floorTop; y < h; y++) for (let x = 0; x < w; x++) {
    if (base.get(x, y) !== ' ') continue;
    if ((y - floorTop) % 3 === 2) { if (x % 2 === 0) base.put(x, y, '_', 'd'); continue; }
    if (x % 10 === 0) base.put(x, y, '|', 'd');
    else if (hash(x * 3 + 5, y * 17) < 0.02) base.put(x, y, '·', 'd');
  }
  const clear = (x, y, lines) => lines.forEach((line, r) => { for (let c = 0; c < [...line].length; c++) base.put(x + c, y + r, ' ', ' '); });
  // Things standing on the floor (the cart, the monkey, the disposal chute) hide whoever passes behind them.
  const standing = new Art(w, h);
  const placeOnFloor = (x, y, lines, keys) => { clear(x, y, lines); prop(standing, x, y, lines, keys); };
  // The chute's mouth stays clear of floor tiles.
  clear(dx, dy, ['             ', '            ']); clear(dx + 2, dy + 2, ['          ', '          ']); prop(standing, dx, dy, ...DISPOSAL);
  const fy = port ? floorTop + 6 : floorTop + 4;
  placeOnFloor(2, fy, ['  .--.  .__.', ' [====][▓▓▓▓]', '|============|', ' o          o'], ['  oooo  oooo', ' AAAAAArrrrrr', 'oooooooooooooo', ' d          d']);
  // The bag stands beside the cart on the same ground line, clear of the rows people walk along.
  const bx = 18, by = fy - 1;
  const fire = blastwave(w, h, bx, by);
  layers.push(...fire.layers); effects.push(...fire.effects);
  layers.push(layer('standing', standing, { front: true }));
  // The monkey (picked design), sitting by the belt under NO MONKEY CUBES NEAR WATER: it looks about, blinks and
  // scratches, and covers its ears just after the clown honks (the clown comes by every 95 s, the length of this loop).
  {
    const mx = port ? 60 : 54, my = fy + 2;
    clear(mx + 2, my, ['     ']); clear(mx + 1, my + 1, ['       ']); clear(mx + 2, my + 2, ['     ']);
    const POSES = { N: ['  .-"-.', ' @(o o)@', '  (_^_)'], B: ['  .-"-.', ' @(- -)@', '  (_^_)'], L: ['  .-"-.', ' @(oo )@', '  (_^_)'],
      R: ['  .-"-.', ' @( oo)@', '  (_^_)'], S: ['  .-"-./', ' @(o o)@', '  (_^_)'], D: ['  .-"-.', '\\@(>_<)@/', '  (_^_)'] };
    const key = ch => ({ '@': 'a', '(': 'A', ')': 'A', '.': 'A', '-': 'A', '"': 'A', '_': 'A', '^': 'a', '/': 'a', '\\': 'a' })[ch] ?? 'i';
    const fps = 24 / 95, honk = (95 - 55) + 0.3 * (port ? 7 : 11), duck = Math.ceil(honk * fps) % 24;
    const loop = [...'NNBNLNNRNSNNNNBNRNNLNSNN'];
    loop[duck] = 'D'; loop[(duck + 1) % 24] = 'L';
    const frames = loop.map(pose => {
      const art = new Art(w, h);
      POSES[pose].forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ' ') art.put(mx + c, my + r, ch, key(ch)); }));
      return art;
    });
    layers.push({ ...framesLayer('monkey', frames, fps), front: true });
  }
  // LOOC: two returning players meet and check in out of character.
  const meet = port ? [[47, h - 2], [64, h - 2]] : [[73, h - 2], [86, h - 2]];
  // Rook and Pip meet at the belt, check in out of character (the copy's own lines), then head off to the gate together.
  const looc = { when: { beat: ['looc'] } };
  const talk = { kind: 'dialogue', id: 'looc-talk', speakers: [[meet[0][0], meet[0][1] - 2], [meet[1][0], meet[1][1] - 2]], width: port ? 30 : 26, style: 'looc',
    exchanges: [[[0, 'hey, do our characters know each other here or are we starting fresh?'], [1, 'never met you lol. First time here'], [0, 'oh shit, sorry. Thought you were someone I knew!']]],
    line: 3.5, pause: 1, delay: 3, colours: 'ac', clock: 'beat', once: true, ...looc };
  const stay = talk.delay + talkLength(talk) - 3;
  effects.push({ kind: 'sprite', id: 'looc-rook', frames: ROOK, from: [-4, meet[0][1] - 2], to: [meet[0][0] - 1, meet[0][1] - 2], duration: 3, hold: stay,
    exit: { to: [w + 2, meet[0][1] - 2], duration: 6 }, every: 600, fps: 3, clock: 'beat', once: true, still: 1, ...looc });
  effects.push({ kind: 'sprite', id: 'looc-pip', frames: PIP, from: [w + 1, meet[1][1] - 2], to: [meet[1][0] - 1, meet[1][1] - 2], duration: 3, hold: stay,
    exit: { to: [w + 4, meet[1][1] - 2], duration: 3 }, every: 600, fps: 3, clock: 'beat', once: true, still: 1, ...looc });
  effects.push(talk, ...blips(talk));
  // The clown keeps out of the LOOC talk: Rook and Pip have the floor for that section.
  const clown = { kind: 'sprite', id: 'clown', frames: CLOWN, from: [w + 4, h - 5], to: [-10, h - 5], duration: port ? 7 : 11, every: 95, offset: 55, fps: 3,
    when: { beat: ['none', 'migrating', 'past'] } };
  effects.push(clown, crossingCue(clown, 'SC-11', 0.3));
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scenes: Board the Shuttle, one per section ----------
// You are not travelling alone (landing-bay), A shared seat (boarding-cabin), sea-lions (cabin-turbulence).
const BAY_BEATS = ['together'];
const CABIN_BEATS = ['seat'];
const STRIKE_BEATS = ['sealion', 'strike'];
/** Walkers in a few looks: a head, its colour, the body colour and a torso (with its own colours); the last frame of a
 * seated walker is how they sit. */
const walker = (head, headKey, body, torso = '/|\\', torsoKeys = body.repeat(3)) => [
  spriteFrame([` ${head} `, torso, '/ \\'], [` ${headKey} `, torsoKeys, 'III']),
  spriteFrame([` ${head} `, torso, ' | '], [` ${headKey} `, torsoKeys, ' I ']),
];
const seated = (head, headKey, body, torso, torsoKeys) => [...walker(head, headKey, body, torso, torsoKeys), spriteFrame([` ${head}`, ' |'], [` ${headKey}`, ` ${body}`])];
// The crowd mixes heads, body styles and department colours (owner's pick: "a mix of all these options"): plain, broad
// shoulders, jumpsuits and coats; command blue, engineering amber, medical white, security red, science violet, service
// green and cargo brown, as SS13 culture only.
const LOOKS = [['o', 'i', 'I'], ['@', 'r', 'a', '/█\\'], ['Q', '4', 'h', '[|]'], ['&', 'p', 'c', '/H\\'], ['0', 'c', 'r'], ['%', 'a', '7', '/█\\'],
  ['8', '4', '4', '[|]'], ['o', 'i', 'A', '/H\\'], ['@', 'a', 'o']];
// The two companions who travel with the member (decision "The Shuttle as a story"): Rook, a returning player in an amber
// jacket, and Pip, a first-timer in cyan with a visitor badge. The same figures in every scene they appear in.
const ROOK_LOOK = ['@', 'a', 'o', '/#\\', 'oro'], PIP_LOOK = ['o', 'c', 'h', '/|*', 'hha'];
const ROOK = walker(...ROOK_LOOK), PIP = walker(...PIP_LOOK);
/** Blips (DLG-06) as each line of a dialogue appears, on the section's clock. */
const blips = fx => {
  const out = []; let at = fx.delay ?? 0;
  fx.exchanges.forEach((exchange, e) => {
    exchange.forEach((_, i) => out.push({ kind: 'cue', id: `${fx.id}-blip-${e}-${i}`, at: Number((at + i * fx.line).toFixed(2)), cue: 'DLG-06', clock: 'beat', ...(fx.when ? { when: fx.when } : {}) }));
    at += exchange.length * fx.line + fx.pause;
  });
  return out;
};
/** How long a dialogue runs from its start (delay excluded): every line and every pause. */
const talkLength = fx => fx.exchanges.reduce((sum, exchange) => sum + exchange.length * fx.line + fx.pause, 0);
// The Arrivals Shuttle with its engines glowing (picked design): two frames, the exhaust flickering at the tail.
const SHUTTLE_SIDE = [
  '           ___________________________',
  '  ________/ □  □  □  □  □  □  □  □  □ \\____',
  '≡≡  ARRIVALS SHUTTLE » APHELION  ┌──┐      \\__',
  '≡≡_______________________________│  │________>',
  '    \\_/             \\_/          └──┘',
];
const SHUTTLE_EXHAUST = ['≡≡', '~≡'];
const SHUTTLE_PAINT = { '□': 'a', '≡': 'r', '~': 'a', '»': 'h' };
/** The door's left edge, in columns from the hull's left. */
const SHUTTLE_DOOR = 33;

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
  effects.push({ kind: 'sprite', id: 'carp-bay', frames: CARP_LEFT, from: [ox1, oy0 + 3], to: [ox0 - 8, oy0 + 6], duration: 14, every: 70, offset: 25, fps: 2,
    clip: [ox0 + 2, oy0 + 1, ox1 - ox0 - 3, oy1 - oy0 - 1] });
  const sw = port ? w - 8 : 50;
  strip(base, effects, Math.floor(w / 2 - sw / 2), oy1 + 1, sw);
  // The shuttle on its pad, door open and ramp down.
  // The hull stands in front of the boarders: climbing the ramp they pass into the door, not across the frame.
  const shW = Math.max(...SHUTTLE_SIDE.map(row => [...row].length)), shX = w - shW - 1, shY = oy1 + 5;
  const hulls = SHUTTLE_EXHAUST.map(exhaust => {
    const art = new Art(w, h);
    SHUTTLE_SIDE.forEach((row, r) => [...(r === 2 || r === 3 ? exhaust + row.slice(2) : row)].forEach((ch, c) => {
      if (ch !== ' ') art.put(shX + c, shY + r, ch, SHUTTLE_PAINT[ch] ?? (/[A-Z]/.test(ch) ? 'c' : 'I'));
    }));
    return art;
  });
  // The ramp runs down from the door's lower corner to the floor.
  const doorX = shX + SHUTTLE_DOOR, doorY = shY + 3, floorY = shY + 8, sill = shY + 4;
  for (let k = 1; k < floorY - sill; k++) base.put(doorX - k, sill + k, '╱', 'o');
  base.hline(0, w - 1, floorY, '_', 'd');
  for (let y = floorY + 1; y < h; y++) for (let x = 0; x < w; x++) if ((y - floorY) % 4 === 0 && x % 2 === 0) base.put(x, y, '_', 'd'); else if (hash(x * 5 + 1, y * 9) < 0.015) base.put(x, y, '·', 'd');
  base.text(shX + 4, floorY + 2, '/////  KEEP  CLEAR  /////', 'r');
  // The gate board: all passengers, boarding. Portrait has no room beside the shuttle, so it stands on the floor.
  const gx = 2, gy = port ? floorY + 3 : oy1 + 5;
  base.fill(gx, gy, gx + 26, gy + 4, ' ', ' ');
  base.box(gx, gy, gx + 26, gy + 4, 'h'); base.text(gx + 2, gy, ' GATE 03 · DEPARTURES ', 'h');
  effects.push({ kind: 'flap', id: 'gate-board', x: gx + 2, y: gy + 2, width: 23, texts: ['ALL PASSENGERS', 'BOARDING NOW', 'MIND THE RAMP'], period: 4, flip: 0.4, colour: 'a', align: 'left' });
  // Ground crew with light wands at the foot of the ramp; boarders walk past in front of them, never hidden.
  // The ground crew (picked design) wave their wands up, then across, in step with the engine's flicker.
  const footX = doorX - (floorY - sill - 1), crewX = footX - 7;
  const crew = hulls.map((_, f) => { const art = new Art(w, h); prop(art, crewX, floorY - 3, [f ? '─ o ─' : '╲ o ╱', ' \\|/', ' / \\'], ['r i r', ' aaa', ' a a']); return art; });
  layers.push(framesLayer('ground-crew', crew, 2));
  // Passengers walk to the ramp and up into the shuttle, in small groups.
  const walkY = floorY - 3, speed = 6, every = 18;
  const groups = [0, 1.4, 2.6, 7, 8.3, 12.5, 13.6];
  groups.forEach((start, i) => {
    const look = LOOKS[i % LOOKS.length], frames = walker(...look);
    const walkTo = footX - 2, walk = (walkTo + 4) / speed, ramp = Math.max(1.5, (doorX - walkTo) / 3);
    effects.push({ kind: 'sprite', id: `boarder-${i}-walk`, frames, from: [-4, walkY], to: [walkTo, walkY], duration: walk, every, offset: (every - start) % every, fps: 4 });
    effects.push({ kind: 'sprite', id: `boarder-${i}-ramp`, frames, from: [walkTo, walkY], to: [doorX - 1, doorY - 2], duration: ramp, every,
      offset: ((every - start - walk) % every + every) % every, fps: 4 });
  });
  // Rook and Pip lead the first group up the ramp: once, as the section opens.
  {
    const walkTo = footX - 2, walk = (walkTo + 4) / speed, ramp = Math.max(1.5, (doorX - walkTo) / 3), when = { beat: ['together'] };
    for (const [id, frames, delay] of [['board-rook', ROOK, 0.5], ['board-pip', PIP, 1.7]]) {
      effects.push({ kind: 'sprite', id, frames, from: [-4, walkY], to: [walkTo, walkY], duration: walk, hold: 0.5, exit: { to: [doorX - 1, doorY - 2], duration: ramp },
        every: 600, fps: 4, clock: 'beat', once: true, delay, when });
    }
  }
  // Luggage left by the ramp, and a fuel line along the floor.
  const [lx, ly, fy] = port ? [34, floorY + 4, floorY + 10] : [4, floorY + 3, floorY + 5];
  base.fill(lx + 2, ly, lx + 11, ly, ' ', ' '); base.fill(lx + 1, ly + 1, lx + 12, ly + 1, ' ', ' '); prop(base, lx, ly, ['  .--.  .__.', ' [====][▓▓▓▓]'], ['  oooo  oooo', ' AAAAAArrrrrr']);
  base.hline(port ? 4 : 18, port ? w - 12 : footX - 10, fy, '═', 'H'); base.put(port ? 3 : 17, fy, '[', 'o');
  // A baggage tug pulls the hold luggage across the bay now and then.
  const TUG = [spriteFrame([' ___  .--. .__.', '[TUG]=[==]=[▓▓]', ' o o   oo   oo'], [' aaa  oooo oooo', 'aaaaaoAAAAoArrA', ' d d   dd   dd']),
    spriteFrame([' ___  .--. .__.', '[TUG]=[==]=[▓▓]', '  o o  oo   oo'], [' aaa  oooo oooo', 'aaaaaoAAAAoArrA', '  d d  dd   dd'])];
  effects.push({ kind: 'sprite', id: 'tug', frames: TUG, from: [w + 1, h - 4], to: [-16, h - 4], duration: port ? 14 : 18, every: 45, offset: 30, fps: 2 });
  return { layers: [layer('base', base), ...layers, { ...framesLayer('hull', hulls, 2), front: true }], effects };
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
  // The back row: passengers file in and take the free seats. The seats, and whoever already sits in them, stand in
  // front of the row: boarders file along it behind them.
  const seatY = portY + 7, seats = [], backRow = new Art(w, h);
  for (let x = 2, i = 0; x + 8 < w; x += 10, i++) {
    backRow.text(x, seatY, ' _  ', 'o'); backRow.text(x, seatY + 1, '|▒| ', 'o'); backRow.text(x, seatY + 2, '|▒|__', 'o'); backRow.text(x, seatY + 3, '|▒▒▒▒|', 'o'); backRow.text(x, seatY + 4, ' |  |', 'd');
    backRow.put(x + 1, seatY + 1, '▒', 'A'); backRow.put(x + 1, seatY + 2, '▒', 'A'); backRow.text(x + 1, seatY + 3, '▒▒▒▒', 'A');
    base.text(x + 4, seatY - 1, String.fromCharCode(65 + (i % 6)) + String(1 + Math.floor(i / 6)), 'h');
    seats.push(x);
  }
  layers.push(layer('back-row', backRow, { front: true }));
  // Two passengers were already aboard: an assistant asleep in a nightcap (picked design), snoring above the seat
  // label, and the lizard, horns and all (picked design).
  layers.push({ ...framesLayer('sleeper', ['Z', 'z'].map((snore, f) => {
    const art = new Art(w, h), x = seats[1] + 3;
    art.put(x - 1, seatY - 1, '*', 'i'); art.put(x - 1, seatY, '^', 'p'); art.put(x, seatY, 'o', 'i'); art.put(x, seatY + 1, '|', 'I');
    art.put(x + 2 - f, seatY - 2, snore, f ? 'H' : 'h');
    return art;
  }), 1), front: true });
  const settled = new Art(w, h);
  settled.text(seats[3] + 2, seatY, '^>o^', '4'); settled.text(seats[3] + 3, seatY + 1, '|', '4');
  layers.push(layer('settled', settled, { front: true }));
  const filling = [0, 2, 4, 5, 7].filter(index => seats[index] !== undefined);
  filling.forEach((index, i) => {
    const look = LOOKS[(i + 2) % LOOKS.length], to = seats[index] + 2, duration = Math.max(2, (to + 4) / 7), start = 1 + i * 2.2;
    effects.push({ kind: 'sprite', id: `taking-seat-${i}`, frames: seated(...look), from: [-4, seatY], to: [to, seatY], duration, hold: 600 - start - duration - 1,
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
  // Pip walks along the front row in front of the seats and the people in them (the aisle is nearer than the seats), so
  // they never vanish behind a seat back.
  const fronts = [], frontSeats = new Art(w, h);
  for (let x = 3; x + 8 < w; x += big) { prop(frontSeats, x, fy, BIG, BIG_KEYS); fronts.push(x); }
  layers.push(layer('front-seats', frontSeats));
  // The front row: a stranger already seated, and Rook a few seats along.
  const front = new Art(w, h);
  const sitAt = (x, head, key, body) => { front.text(x + 5, fy + 1, head, key); front.text(x + 4, fy + 2, '/|', body); front.text(x + 5, fy + 3, '|', body); };
  const stranger = fronts[1], rook = fronts[3] ?? fronts.at(-2), pipSeat = fronts[4] ?? fronts.at(-1);
  sitAt(stranger, 'O', 'r', 'a'); sitAt(rook, ROOK_LOOK[0], ROOK_LOOK[1], ROOK_LOOK[2]);
  layers.push(layer('front-row', front));
  base.hline(0, w - 1, fy + 8, '▀', 'd');
  // Phones show more of the cabin: another row of seats, some of them taken.
  let carpet = fy + 10;
  if (port) {
    const ry = fy + 11, rear = new Art(w, h);
    for (let x = 3, i = 0; x + 8 < w; x += big, i++) {
      prop(rear, x, ry, BIG, BIG_KEYS);
      if (hash(i, 31) < 0.6) { const [head, key, body] = LOOKS[(i + 4) % LOOKS.length]; rear.text(x + 5, ry + 1, head, key); rear.text(x + 4, ry + 2, '/|', body); rear.text(x + 5, ry + 3, '|', body); }
    }
    layers.push(layer('rear-seats', rear, { front: true }));
    base.hline(0, w - 1, ry + 8, '▀', 'd'); carpet = ry + 10;
  }
  // The aisle: a drinks trolley parked by the galley, and a carpet runner under the seats.
  prop(base, w - 18, floor + 3, ['  ___ ', ' [▒▒▒]', '  o o'], ['  ooo ', ' oAAAo', '  d d']);
  base.text(w - 30, floor + 4, 'GALLEY', 'A');
  for (let y = carpet; y < h; y += 3) for (let x = 0; x < w; x += 4) base.put(x + (y % 2), y, '·', 'd');
  prop(base, 20, carpet, [' .--. ', '[====]'], ['oooooo', 'AAAAAA']);
  // Pip asks the stranger, takes the no, then asks Rook and sits down beside them. Once, as the section opens.
  // Pip stands in the gap beside whoever they are asking, never over a seat.
  const seat = { when: { beat: ['seat'] } }, gapStranger = stranger + 10, gapRook = rook + 10, askY = fy;
  const ask = { kind: 'dialogue', id: 'seat-ask', speakers: [[gapStranger + 1, askY], [stranger + 5, fy + 1]], width: port ? 28 : 30, style: 'say', delay: 3,
    exchanges: [[[0, 'ooh, mind if I squeeze in next to you?'], [1, "I'd rather keep the space, sorry."], [0, 'all good!']]], line: 3, pause: 0.5, colours: 'ci', clock: 'beat', once: true, ...seat };
  const askEnd = ask.delay + talkLength(ask), move = 2.5;
  const rookAsk = { kind: 'dialogue', id: 'seat-rook', speakers: [[gapRook + 1, askY], [rook + 5, fy + 1]], width: port ? 28 : 30, style: 'say', delay: askEnd + move + 0.5,
    exchanges: [[[0, 'ROOK. Is this one free?'], [1, "all yours. It's the next row anyways. Just don't lean back, yeah?"]]], line: 4, pause: 0.5, colours: 'ca', clock: 'beat', once: true, still: false, ...seat };
  const rookEnd = rookAsk.delay + talkLength(rookAsk);
  const PIP_SITTING = spriteFrame([' o', '/|', ' |'], [' c', 'hh', ' h']);
  effects.push({ kind: 'sprite', id: 'pip-asks', frames: PIP, from: [w + 2, askY], to: [gapStranger, askY], duration: 3, hold: askEnd - 3,
    exit: { to: [gapRook, askY], duration: move }, every: 600, fps: 4, clock: 'beat', once: true, still: 1, ...seat });
  effects.push({ kind: 'sprite', id: 'pip-waits', frames: PIP, from: [gapRook, askY], to: [gapRook, askY], duration: 1, hold: rookEnd - askEnd - move - 1,
    exit: { to: [pipSeat + 4, askY], duration: 1.5 }, every: 600, fps: 4, clock: 'beat', once: true, delay: askEnd + move, ...seat });
  effects.push({ kind: 'sprite', id: 'pip-sits', frames: [...PIP, PIP_SITTING], from: [pipSeat + 4, fy + 1], to: [pipSeat + 4, fy + 1], duration: 1, hold: 590 - rookEnd,
    rest: true, every: 600, fps: 4, clock: 'beat', once: true, delay: rookEnd + 1.5, ...seat });
  effects.push(ask, ...blips(ask), rookAsk, ...blips(rookAsk));
    return { layers: [layer('base', base), ...layers], effects };
}

/**
 * The cabin at departure: the forward window shows the launch rail coming up, a sea lion on it demanding explanations,
 * the bump, the cabin shaking, then the rail dropping away into stars. It plays once as the section opens and holds.
 */
function cabinStrike(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const wx0 = port ? 3 : 10, wx1 = w - 1 - wx0, wy0 = 1, wy1 = port ? 24 : 18;
  for (let y = wy0; y <= wy1; y++) { base.put(wx0, y, '▓', 'o'); base.put(wx0 + 1, y, '▒', 'd'); base.put(wx1 - 1, y, '▒', 'd'); base.put(wx1, y, '▓', 'o'); }
  base.hline(wx0, wx1, wy0, '▓', 'o'); base.hline(wx0, wx1, wy1, '▓', 'o');
  base.text(wx0 + 3, wy0, ' FORWARD VIEW · LAUNCH RAIL ', 'A');
  const iw = wx1 - wx0 - 3, ix0 = wx0 + 2, cx = Math.floor((wx0 + wx1) / 2);
  effects.push({ kind: 'drift', id: 'approach-stars', region: [ix0, wy0 + 1, iw, 4], seed: 71, density: 0.05, speed: 2.5, glyphs: ".·'", colours: '..I' });
  // Two beats (owner review, sixth pass), two frames a second. sealion: the rail comes up and the sea lion sits lined up
  // on it, asking and asking, for as long as the reader takes (it held, once, on its last frame). strike: when the reader
  // reaches the punchline, the bump, a dazed (unhurt) sea lion, then the rail drops away below; the last frame holds.
  const frames = [];
  for (let f = 0; f < 18; f++) {
    const art = new Art(w, h), near = Math.min(1, f / 9), lift = Math.max(0, f - 13);
    const padW = Math.round(14 + near * (iw - 22)), padY = Math.round(wy0 + 8 + near * (wy1 - wy0 - 11)) + lift;
    // Lifting off: space fills the window as the rail drops away (the held last frame).
    if (lift) for (let y = wy0 + 1; y < wy1; y++) for (let x = ix0; x < ix0 + iw; x++) if (hash(x * 7, y * 13 + lift) < 0.012 * lift) art.put(x, y, hash(x, y) < 0.3 ? '+' : '·', hash(y, x) < 0.4 ? 'I' : '.');
    if (padY >= wy1) { frames.push(art); continue; }
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
      // The shuttle's shadow comes first, so the sea lion and its words sit on top of it.
      for (let dx = -Math.round(near * 12); dx <= Math.round(near * 12); dx++) if (art.get(cx + dx, padY - 5) === ' ') art.put(cx + dx, padY - 5, '░', 'd');
      const lion = near > 0.5 ? ['   ,-.', ' _/ o \\', '(     _>'] : [' ,o.', '(  _>'];
      prop(art, cx - 4, padY - 1 - lion.length, lion, 'I');
    } else if (f < 12) {
      art.text(cx - 3, padY - 3, 'THUMP', 'a'); art.text(cx - 6, padY - 2, '~~~~~~~~~~~~~', 'I');
    } else {
      // Nudged off the marking, dazed and unhurt.
      prop(art, cx + Math.floor(stripe.length / 2) + 3, padY - 2, ['  * · *', '(__o__>'], ['  a a a', 'IIIIIII']);
    }
    frames.push(art);
  }
  const sealion = { clock: 'beat', when: { beat: ['sealion'] } }, strike = { clock: 'beat', when: { beat: ['strike'] } };
  layers.push({ ...framesLayer('approach', frames.slice(0, 10), 2), clock: 'beat', once: true, ...sealion });
  // One frame a second, so the THUMP and the dazed sea lion are there long enough to see.
  layers.push({ ...framesLayer('strike', frames.slice(10), 1), clock: 'beat', once: true, ...strike });
  // Sealioning, literally: once it is lined up it asks, and asks again, in a loop, a yap with each line.
  const lionY = Math.round(wy0 + 8 + (wy1 - wy0 - 11)) - 4, yap = { delay: 5, line: 2.5, pause: 2 };
  const asks = [[0, 'EXPLAIN.'], [0, 'EXPLAIN AGAIN.'], [0, 'JUST ASKING QUESTIONS.']];
  effects.push({ kind: 'dialogue', id: 'sea-lion-asks', speakers: [[cx + 1, lionY], [cx + 1, lionY]], width: 24, style: 'say', exchanges: [asks], ...yap,
    colours: 'aa', ...sealion });
  // Sounds on the section's clock: straps, the roll-out, the sea lion each time it asks; the bump as the strike begins.
  effects.push({ kind: 'cue', id: 'straps', cue: 'SC-17', at: 0.3, ...sealion }, { kind: 'cue', id: 'launch', cue: 'SC-07', at: 0.8, ...sealion },
    ...asks.map((_, i) => ({ kind: 'cue', id: `sea-lion-${i + 1}`, cue: 'SC-09', at: yap.delay + i * yap.line, every: asks.length * yap.line + yap.pause, ...sealion })),
    { kind: 'cue', id: 'bump', cue: 'SC-08', at: 0, ...strike });
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
  // The cabin sits still while the sea lion asks, then jolts on the bump (the strike's first frames).
  const shake = [];
  for (let f = 0; f < 9; f++) {
    const art = new Art(w, h), jolt = f >= 1 && f < 4 ? [1, -1, 1][f - 1] : 0;
    for (const [r, y] of rowsY.entries()) for (let x = 4 + r * 5, i = 0; x + 9 < w; x += 12, i++) {
      // Rook and Pip sit together in the front row.
      const [head, key] = r === 0 && i === 2 ? [ROOK_LOOK[0], ROOK_LOOK[1]] : r === 0 && i === 3 ? [PIP_LOOK[0], PIP_LOOK[1]] : [hash(i, r) < 0.25 ? '@' : 'o', hash(i, r + 5) < 0.3 ? 'r' : 'i'];
      art.text(x + 4 + jolt, y - 1, head, key);
      if (jolt && hash(i, r + 9) < 0.5) art.text(x + 6 + jolt, y - 2, '!', 'a');
    }
    for (const x of bins) art.text(x + (jolt ? 1 : 0), cy0 + 1 - (jolt ? 1 : 0), jolt ? '[_##_]' : '[____]', 'o');
    // A bag and a cup in the aisle hop on the bump.
    prop(art, 6 + jolt, h - 4 - (jolt ? 1 : 0), [' .--. ', '[====]'], ['oooooo', 'AAAAAA']);
    art.text(w - 14 + jolt, h - 3 - (jolt ? 1 : 0), jolt ? 'c[_]~' : 'c[_]', jolt ? 'IIIIc' : 'IIII');
    shake.push(art);
  }
  layers.push(layer('cabin', shake[0], { when: sealion.when }), { ...framesLayer('turbulence', shake, 2), clock: 'beat', once: true, ...strike });
  // Aisle carpet under the last row.
  for (let y = rowsY.at(-1) + 5; y < h - 2; y += 2) for (let x = 2 + (y % 4); x < w - 2; x += 6) base.put(x, y, '·', 'd');
  base.hline(0, w - 1, h - 2, '▀', 'd');
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: viewport (Admire the Lights) ----------
const VIEWPORT_BEATS = ['enjoy', 'popper', 'valuable', 'photos', 'lucky'];
// Station folklore: an assistant in grey, adrift with a toolbox, waving now and then.
// The greytide adrift, swinging the toolbox (picked design).
const GREYTIDE = [
  spriteFrame([' \\o/', '  |=[▄]', ' / \\'], [' IiI', '  IIrrr', ' I I']),
  spriteFrame([' _o_', '  |\\[▄]', ' / >'], [' IiI', '  IIrrr', ' I I']),
];
const CARGO = [
  spriteFrame(['    ____', '-=[CARGO]>'], ['    oooo', 'aooAAAAAoo']),
  spriteFrame(['    ____', '~=[CARGO]>'], ['    oooo', 'rooAAAAAoo']),
];
// Space traffic (owner's pick: every design offered): the comet's tail flickers through each design's tail, and a
// container hauler, a tug and a ring freighter pass as well as the cargo hauler.
const COMET = [spriteFrame(['*=~~-· ·'], ['cchhHH H']), spriteFrame(['*=~-~··'], ['cchHhHH']), spriteFrame(['*~~~··'], ['chhhHH']), spriteFrame(['*. · .'], ['cH H H'])];
const HAULER = [spriteFrame(['<|=[■■■]=|>'], ['ooHoaaaoHoo'])];
const TUG = [spriteFrame([' ___', '<___[CARGO]=-'], [' III', 'IIIIIaaaaaIHI']), spriteFrame([' ___', '<___[CARGO]~-'], [' III', 'IIIIIaaaaaIhI'])];
const FREIGHTER = [spriteFrame(['(■)─(■)─(■)>'], ['oaoHoaoHoaoI'])];
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
  effects.push({ kind: 'drift', id: 'lights-festive', region: bandRegion, seed: 31, density: 0.08, speed: 0.6, glyphs: '~~-*~~-', colours: '1234567', when: { beat: ['enjoy', 'popper'] } });
  // Traffic outside, all kept behind the glass, on one shared schedule (owner review, sixth pass): each flyer has its own
  // lane and its own slot in a 120-second cycle, so no two paths ever cross on screen. Everything enters and leaves
  // beyond the glass. While Rook points out the greytide (valuable), the upper lanes stay clear for it.
  const SKY = 120, at = start => ({ every: SKY, offset: (SKY - start % SKY) % SKY }), upper = { when: { beat: ['none', 'enjoy', 'popper', 'photos', 'lucky'] } };
  const lowRow = port ? [18, 20] : [15, 17];
  effects.push({ kind: 'sprite', id: 'traffic-tug', frames: TUG, from: [ix0 + iw, iy0], to: [ix0 - 14, iy0], duration: 30, ...at(0), fps: 2, clip: glass, ...upper });
  effects.push({ kind: 'sprite', id: 'freighter', frames: FREIGHTER, from: [ix0 - 13, iy0 + lowRow[1]], to: [ix0 + iw, iy0 + lowRow[1]], duration: 40, ...at(20), clip: glass });
  effects.push({ kind: 'sprite', id: 'cargo', frames: CARGO, from: [ix0 - 10, iy0 + 7], to: [ix0 + iw, iy0 + 7], duration: 28, ...at(30), fps: 2, clip: glass, ...upper });
  effects.push({ kind: 'sprite', id: 'comet', frames: COMET, from: [ix0 + iw, iy0 + 3], to: [ix0 - 10, iy0 + 5], duration: 45, ...at(35), fps: 1, clip: glass, ...upper });
  effects.push({ kind: 'sprite', id: 'hauler', frames: HAULER, from: [ix0 - 12, iy0 + lowRow[0]], to: [ix0 + iw, iy0 + lowRow[0]], duration: 34, ...at(70), clip: glass });
  effects.push({ kind: 'sprite', id: 'meteor-1', frames: [spriteFrame(['*'], 'c')], from: [ix0 + 30, iy0 + 1], to: [ix0 + 52, iy0 + 6], duration: 1.2, ...at(90), clip: glass, ...upper });
  effects.push({ kind: 'sprite', id: 'meteor-2', frames: [spriteFrame(['·'], 'i')], from: [ix0 + iw - 20, iy0 + 2], to: [ix0 + iw - 6, iy0 + 7], duration: 1, ...at(108), clip: glass, ...upper });
  // Three more satellites, further off, each with its own slow beacon.
  for (const [i, [sx2, sy2, text, keys, beacon]] of (port
    ? [[ix0 + 50, iy0 + 9, '-[o]-', 'hocoh', 2], [ix0 + 8, iy0 + 15, '▐o▌', 'hch', 1], [ix0 + 40, iy0 + 3, '─╪─', 'HhH', 1]]
    : [[ix0 + 58, iy0 + 11, '-[o]-', 'hocoh', 2], [ix0 + 80, iy0 + 9, '▐o▌', 'hch', 1], [ix0 + 48, iy0 + 5, '─╪─', 'HhH', 1]]).entries()) {
    [...text].forEach((ch, c) => base.put(sx2 + c, sy2, ch, keys[c]));
    effects.push({ kind: 'blink', id: `satellite-${i + 2}`, region: [sx2 + beacon, sy2, 1, 1], hz: 0.25 + i * 0.15, on: 'c', off: 'd' });
  }
  // The carp school swims as one, in its own lane.
  [0, 1, 2].forEach(i => effects.push({ kind: 'sprite', id: `carp-${i + 1}`, frames: CARP_LEFT, from: [ix0 + iw + i * 3, iy0 + 11 + [0, 2, -1][i]],
    to: [ix0 - 16 + i * 3, iy0 + 12 + [0, 2, -1][i]], duration: 16, ...at(50 + i * 1.3), fps: 2, clip: glass }));
  effects.push({ kind: 'sprite', id: 'greytide', frames: GREYTIDE, from: [ix0 + iw, iy0 + 4], to: [ix0 - 8, iy0 + 7], duration: 60, ...at(84), fps: 0.5, clip: glass,
    when: { beat: ['none', 'enjoy', 'popper', 'photos', 'lucky'] } });
  // When Pip asks what a greytide is, one drifts in for Rook to point at, waits, and drifts on out of view.
  effects.push({ kind: 'sprite', id: 'greytide-pointed', frames: GREYTIDE, from: [ix0 + iw, iy0 + 2], to: [ix0 + 14, iy0 + 7], duration: 40, hold: 1,
    exit: { to: [ix0 - 8, iy0 + 7], duration: 14 }, every: 600, fps: 0.5, clip: glass, clock: 'beat', once: true, still: 0.3, when: { beat: ['valuable'] } });

  const sw = port ? w - 10 : 50;
  strip(base, effects, Math.floor(w / 2 - sw / 2), fy1 + 1, sw);
  // The information row: what this deck is, the weather outside and the photo booth, on one baseline.
  const pw = port ? 34 : 30, py = fy1 + 5;
  const [deckX, deckY] = [2, py], [wxX, wxY] = port ? [w - 2 - pw, py] : [Math.floor(w / 2 - pw / 2), py], [boothX, boothY] = port ? [2, py + 6] : [w - 2 - pw, py];
  const inner = pw - 4;
  panel(base, deckX, deckY, pw, 'OBSERVATION DECK');
  const deckText = (id, rows, beats) => { const art = new Art(w, h); rows.forEach(([text, key], r) => art.text(deckX + 2, deckY + 1 + r, text, key)); layers.push(layer(id, art, { when: { beat: beats } })); };
  deckText('deck-sign', [['PLEASE ENJOY THE VIEW', 'h'], ['NO TAPPING ON THE GLASS', 'H']], ['none', 'enjoy', 'popper', 'photos']);
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
  layers.push(layer('weather-festive', festive, { when: { beat: ['enjoy', 'popper'] } }));
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
  // The prints come out once when the photo is taken, and stay pinned to the booth for the rest of the deck.
  layers.push({ ...framesLayer('photo-prints', prints, 1), clock: 'beat', once: true, when: { beat: ['photos'] } });
  const pinned = new Art(w, h); for (let i = 0; i < 4; i++) pinned.text(boothX + 2 + i * 4, boothY + 2, '[▒]', 'I');
  layers.push(layer('photo-prints-pinned', pinned, { when: { beat: ['lucky'] } }));

  // The deck: people on a bench looking out, a telescope, the old camera, a vending machine and plants.
  // The middle stays open: two crew meet there for the lucky ten thousand.
  const backY = port ? boothY + 12 : deckY + 10, walkY = port ? h - 6 : h - 4, floorY = h - 1;
  prop(base, port ? 2 : 1, backY - 1, ...PLANT);
  const benchX = port ? 12 : 11;
  prop(base, benchX, backY - 3, [' o    o    @', '/▒\\  /▒\\  /▒\\', '[═══════════]', ' |         |'], [' I    I    r', 'ddd  ddd  ddd', 'ooooooooooooo', ' d         d']);
  const telX = port ? w - 9 : 25;
  prop(base, telX, backY - 5, ['    o', '   //', '  //', ' [=]', ' /|\\', '/ | \\'], ['    c', '   oo', '  oo', ' HHH', ' ddd', 'd d d']);
  // A deck lamp, and a mothroach that has found it, shuffling about on the shade.
  const lampX = port ? 46 : 34;
  prop(base, lampX, backY - 2, ['(___)', '  |', ' _|_'], ['aaaaa', '  d', ' ddd']);
  layers.push(framesLayer('mothroach', MOTHROACH_RIGHT.map(frame => { const art = new Art(w, h); prop(art, lampX - 1, backY - 5, frame.text, frame.colours); return art; }), 1));
  const mapX = port ? 28 : 41;
  prop(base, mapX, backY - 3, [' .----------.', '( · * ·  o · )', " '----------'", '   |      |'], [' oooooooooooo', 'ohhhhhhhhahhho', ' oooooooooooo', '   d      d']);
  effects.push({ kind: 'blink', id: 'map-here', region: [mapX + 9, backY - 2, 1, 1], hz: 1, on: 'a', off: 'A' });
  const camX = port ? 40 : 64, camY = port ? boothY : backY - 4;
  prop(base, camX, camY, [' .--.', '[(o) ]', '  /|\\', ' / | \\', '/  |  \\'], ['ooooo', 'ooaooo', '  ddd', ' d d d', 'd  d  d']);
  // Take photos: the old camera flashes now and then.
  effects.push({ kind: 'blink', id: 'camera-flash', region: [camX + 2, camY + 1, 1, 1], hz: 0.5, on: 'c', off: 'a', when: { beat: ['photos', 'lucky'] } });
  // The vending machine stands a step nearer than the rest of the deck, so anyone strolling past goes behind it.
  const vendX = port ? 52 : 72, vendY = port ? boothY - 1 : backY - 5, standing = new Art(w, h);
  prop(standing, vendX, vendY, ...VENDING);
  layers.push(layer('deck-standing', standing, { front: true }));
  effects.push({ kind: 'flicker', id: 'cola-neon', region: [vendX + 1, vendY + 1, 6, 2], hz: 1.5, chance: 0.15, colour: 'd' });
  if (!port) prop(base, 83, backY - 1, ...PLANT);
  else prop(base, 62, vendY + 5, ...PLANT);
  for (let x = 0; x < w; x++) { if (hash(x * 9, walkY + 3) < 0.1) base.put(x, walkY + 3 < floorY ? walkY + 3 : walkY + 2, '·', 'd'); }
  base.hline(0, w - 1, floorY, '▀', 'd');
  // After the first page (owner review, sixth pass), a crew member walks in with a confetti popper, pops it, and the
  // confetti bursts from the popper and falls; then they walk off. The popper's sound is the pop.
  {
    const px = port ? 48 : 60, popAt = 1 + 3 + 0.5, look = LOOKS[2];
    const cheer = spriteFrame([` \\${look[0]}/`, `  ${look[3]?.[1] ?? '|'}`, ' / \\'], [` ${look[2]}${look[1]}${look[2]}`, `  ${look[2]}`, ' III']);
    // They come and go on the left, past Rook and Pip, never behind the vending machine.
    effects.push({ kind: 'sprite', id: 'popper', frames: [...walker(...look), cheer], rest: true, from: [-4, walkY], to: [px, walkY], duration: 3, hold: 6,
      exit: { to: [-4, walkY], duration: 4 }, every: 600, fps: 4, clock: 'beat', once: true, delay: 1, when: { beat: ['popper'] } });
    const burst = [];
    for (let f = 0; f < 18; f++) {
      const art = new Art(w, h), k = f / 2 - popAt;
      if (k >= 0 && k < 4) for (let i = 0; i < 16; i++) {
        const vx = (hash(i, 7) - 0.5) * 7, vy = 2 + hash(i, 9) * 3, x = Math.round(px + 2 + vx * k), y = Math.round(walkY - 1 - vy * k + 1.6 * k * k);
        if (y >= backY - 9 && y < walkY + 3 && x >= 0 && x < w) art.put(x, y, i % 3 ? '·' : '*', String(1 + (i % 7)));
      }
      burst.push(art);
    }
    layers.push({ ...framesLayer('confetti', burst, 2), clock: 'beat', once: true, when: { beat: ['popper'] } });
    effects.push({ kind: 'cue', id: 'popper-pop', cue: 'SC-18', at: popAt, clock: 'beat', when: { beat: ['popper'] } });
  }
  effects.push({ kind: 'cue', id: 'shutter', cue: 'SC-10', at: 0.6, clock: 'beat', when: { beat: ['photos'] } });
  // Someone strolls past now and then, except while the popper and the lucky ten thousand are playing out.
  effects.push({ kind: 'sprite', id: 'stroller', frames: walker(...LOOKS[4]), from: [-4, walkY], to: [w + 1, walkY], duration: port ? 12 : 16, every: 40, offset: 10, fps: 4,
    when: { beat: ['none', 'enjoy', 'valuable', 'photos'] } });
  // Rook and Pip on the deck: they walk in as the straps come off, stay at the star map through the deck's sections
  // (learning, a photo), play out the lucky ten thousand, and leave together on its last line.
  const [ax, bx] = port ? [30, 38] : [44, 50];
  const once = { every: 600, fps: 4, clock: 'beat', once: true };
  effects.push({ kind: 'sprite', id: 'rook-arrives', frames: ROOK, from: [-4, walkY], to: [ax, walkY], duration: 4, hold: 590, ...once, still: 1, when: { beat: ['enjoy'] } });
  effects.push({ kind: 'sprite', id: 'pip-arrives', frames: PIP, from: [-6, walkY], to: [bx, walkY], duration: 5, hold: 590, ...once, delay: 1, when: { beat: ['enjoy'] } });
  for (const [who, frames, x] of [['rook', ROOK, ax], ['pip', PIP, bx]]) {
    effects.push({ kind: 'sprite', id: `${who}-stays`, frames, from: [x, walkY], to: [x, walkY], duration: 1, hold: 590, ...once, still: 1, when: { beat: ['popper', 'valuable', 'photos'] } });
  }
  const talk = (id, beat, exchanges, extra = {}) => ({ kind: 'dialogue', id, speakers: [[ax + 1, walkY], [bx + 1, walkY]], width: 26, style: 'say', delay: 1, line: 3.5, pause: 1,
    colours: 'ac', clock: 'beat', once: true, exchanges, when: { beat: [beat] }, ...extra });
  const learning = talk('greytide-talk', 'valuable', [[[1, "ok this is probably a dumb question but what's a greytide"], [0, 'not dumb. See that idiot floating past the window?'], [0, 'A really poor example of a greytider. Look at them wiggle that toolbox...']]], { line: 4.5 });
  const photo = talk('photo-talk', 'photos', [[[0, 'wait first, let me take a selfie. can I post this one?'], [1, 'sure, just crop my pants out, I forgot to wash them']]], { line: 4.5 });
  const lucky = talk('lucky-talk', 'lucky', [
    [[0, 'Did you know what happens if you inject water into a banana?'], [1, 'Haha, no? Why?'], [0, "Oh boy, we've got something to do this shift..."]],
    [[0, "You've never added water to a monkey cube?"], [1, 'A monkey what?'], [0, 'Grab a glass. Not in the kitchen, though.']],
    [[0, 'Ever seen a welder meet a fuel tank?'], [1, 'No, why?'], [0, "Good. Let's go watch Engineering find out. From over here."]],
    [[0, "You haven't met Ian yet?"], [1, "Who's Ian?"], [0, "The HoP's corgi. Come on, his rounds start in five."]],
  ], { pause: 2 });
  const together = lucky.delay + talkLength(lucky) - 1;
  for (const [who, frames, x, leave] of [['rook', ROOK, ax, 6], ['pip', PIP, bx, 5]]) {
    effects.push({ kind: 'sprite', id: `${who}-leaves`, frames, from: [x, walkY], to: [x, walkY], duration: 1, hold: together, exit: { to: [w + 2, walkY], duration: leave }, ...once, still: 1,
      when: { beat: ['lucky'] } });
  }
  for (const fx of [learning, photo, lucky]) effects.push(fx, ...blips(fx));
    return { layers: [layer('base', base), ...layers], effects };
}

const LOUNGE_ALT = 'A departure lounge. An old split-flap board in amber shows the current stop boarding. A new cyan strip hangs under it on fresh brackets and shows the current section. On the right a new cyan sign hangs over a faded gate sign. A window on the left shows drifting stars; under it, left of rows of worn benches where two passengers wait, a green EXIT sign points away from the gate. Now and then a mothroach walks along the floor in front of the benches, stops at a mothroach crossing sign, then walks on out of view. A help desk says now serving and take a number.';
const DECK_ALT = 'A wide observation window in a heavy riveted frame. Outside, a ringed gas giant, a nebula, a comet, the curve of the station dotted with lights, satellites, passing haulers, a tug and a ring freighter, carp and a drifting assistant with a toolbox. On the deck, panels for the deck, the space weather and a photo booth, people on a bench looking out, a telescope, a lamp with a mothroach on its shade, an old camera, a vending machine and hydroponics trays.';
const RAIL_ALT = 'The cabin on the launch rail. Through the forward window the rail comes up with a sea lion sitting on the Keep clear line';
const SCENES = [
  { id: 'hangar-viewport', title: 'Hangar viewport', draw: hangar, alt: [{ text: 'The title APHELION in amber beside rainbow stripes, and The Shuttle under it. A small sun and a dotted orbit; a shuttle moves along it towards Aphelion station: a beacon on a mast with a dish, a ring of lit windows round a cyan hub, solar arrays either side and a docking module below. Below, an old console: a cyan terminal window titled with your own Discord name at aphelion, which holds the menu, beside a cyan Shuttle Link panel, an amber status screen, lamps, switches and a new cable.' }] },
  { id: 'departure-lounge', title: 'Departure lounge', draw: lounge, beats: LOUNGE_BEATS, alt: [
    { when: { beat: ['beepsky'] }, text: 'A departure lounge: a split-flap board, benches under a window with an EXIT sign, and a help desk reading AGE CHECK, 18+ ONLY. Officer Beepsky, a little securitron drone with a red and blue light, hovers in over the benches and says: HALT! Age check. 18+ only. No, really. On the next page he flies off.' },
    { text: LOUNGE_ALT },
  ] },
  { id: 'baggage-hall', title: 'Baggage hall', draw: baggage, beats: BAGGAGE_BEATS, alt: [{ text: 'A baggage check-in hall. A wall of old numbered lockers, a few hanging open, some with new cyan tags bolted on; a mothroach walks along their tops. Suitcases ride a conveyor belt through a new cyan scanner arch with two lamps on top, and a cyan strip shows the current stop and section. On the floor a bag labelled UPSTREAM burns for a while until a little firebot rolls out of its dock and foams it out; it smokes, sits cold, sparks and catches again. A monkey sits by the belt, looking about, blinking and scratching, and covers its ears when the clown honks.' }] },
  { id: 'boarding-cabin', title: 'Boarding cabin', draw: cabin, beats: CABIN_BEATS, alt: [{ text: 'Inside the shuttle cabin. Overhead lockers and round portholes with stars drifting past, above a row of worn amber seats where an assistant sleeps in a nightcap beside a lizard. Passengers file in and take the free seats. In the front row Pip asks a passenger to share, takes no for an answer, then asks Rook and sits down beside them. A fasten-straps sign glows.' }] },
  { id: 'landing-bay', title: 'Departure bay', draw: landingBay, beats: BAY_BEATS, alt: [{ text: 'A departure bay open to space behind a shimmering field. The Arrivals Shuttle to Aphelion waits on its pad at gate 03 with its door open and the ramp down. Passengers walk across the bay in small groups and up the ramp, Rook and Pip in the first group, past a crew member waving light wands. The engines of the shuttle glow.' }] },
  { id: 'cabin-turbulence', title: 'Cabin, launch rail', draw: cabinStrike, beats: STRIKE_BEATS, alt: [
    { when: { beat: ['strike'] }, text: 'The cabin on the launch rail. Through the forward window the rail comes up with a sea lion sitting on the Keep clear line. There is a thump and a jolt; the overhead bins jump and the passengers start, Rook and Pip among them. The sea lion slides off, dazed and unhurt, and the rail drops away into stars.' },
    { text: 'The cabin on the launch rail. Through the forward window the rail comes up with a sea lion sitting on the Keep clear line, yapping: explain, explain again, just asking questions. The shuttle lines up on it. Rook and Pip sit strapped in among the passengers.' },
  ] },
  { id: 'viewport', title: 'Viewport', draw: viewport, beats: VIEWPORT_BEATS, alt: [
    { when: { beat: ['lucky'] }, text: 'The observation deck. Rook and Pip stand at the window. Rook cannot believe Pip has never heard of these, and takes them along to see: water in a banana, a monkey cube, a welder and a fuel tank, Ian the corgi. Then they leave together. A sign counts ten thousand people learning something today.' },
    { when: { beat: ['popper'] }, text: `${DECK_ALT} A crew member walks in, pops a confetti popper and cheers; confetti falls over the deck, and they head off again.` },
    { text: DECK_ALT },
  ] },
  { id: 'pressure-door', title: 'Pressure door and concourse', draw: door, beats: DOOR_BEATS, alt: [
    { when: { whitelist: ['confirmed'] }, text: 'The pressure door has slid open. Light floods in from the station concourse, where a directory sign points to Meridian Rift, Wolfgate and #general and people go about their shift. Rook and Pip walk through ahead. The lamp above the door is cyan and the control panel reads: Whitelist confirmed, Discord applied, door open.' },
    { when: { whitelist: ['requested'] }, text: 'A battered pressure door with hazard stripes and a stencilled number. New cyan conduits are bolted to its frame. An amber lamp above it blinks, and a cyan control panel reads: Whitelist requested, Discord waiting, door held.' },
    { text: 'A battered pressure door with hazard stripes and a stencilled number. New cyan conduits are bolted to its frame. The lamp above it is dim, and a cyan control panel reads: Whitelist not requested, door held. Two crew under welcome signs wave arrivals in, past a luggage cart, a feedback terminal, an emergency locker, a boarding checklist and a vending machine. Now and then a passer-by drops some litter, and a cleanbot trundles along and picks it up.' },
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
