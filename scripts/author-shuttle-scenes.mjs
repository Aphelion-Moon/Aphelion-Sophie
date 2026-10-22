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
const CORGI = [
  spriteFrame(['  __/\\/\\', '(______ o>', " ' '  ' '"], ['  rrrrrr', 'rrrrrrrrir', ' rr   rr']),
  spriteFrame(['  __/\\/\\', '(______ o>', "  ' '  ' "], ['  rrrrrr', 'rrrrrrrrir', '  rr   rr']),
];
const CARP = [
  spriteFrame(['  __', '}<(((o>', '  ~~'], ['  hh', 'hhhhhhi', '  HH']),
  spriteFrame(['  __', '}<(((o>', '   ~~'], ['  hh', 'hhhhhhi', '   HH']),
];

// ---------- scene: hangar viewport (title screen) ----------
function hangar(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const conTop = port ? Math.round(h * 0.82) : Math.round(h * 0.76);
  const cx = port ? w * 0.5 : w * 0.66, cy = port ? h * 0.34 : h * 0.46;
  const ra = port ? w * 0.40 : w * 0.27, rb = port ? h * 0.065 : h * 0.17;
  for (let th = 0; th < Math.PI * 2; th += 0.01) {
    const x = Math.round(cx + ra * Math.cos(th)), y = Math.round(cy - rb * Math.sin(th));
    if (base.get(x, y) === ' ' && ((x + y) & 1)) base.put(x, y, '·', 'H');
  }
  sun(base, Math.round(cx - ra * 0.55), Math.round(cy), port ? 3.2 : 4.4);
  const ax = Math.round(cx + ra), ay = Math.round(cy);
  base.text(ax - 1, ay - 1, '═╪═', 'I'); base.text(ax - 2, ay, '─[■]─', 'i'); base.put(ax, ay, '■', 'a'); base.text(ax - 1, ay + 1, '═╪═', 'I');
  effects.push({ kind: 'blink', id: 'station-beacon', region: [ax, ay, 1, 1], hz: 0.8, on: 'a', off: 'A' });
  const lab = 'APHELION · WAKING ─';
  base.text(ax - lab.length, ay - 3, lab, 'h'); base.put(ax, ay - 3, '┐', 'H'); base.put(ax, ay - 2, '│', 'H');
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
  const starRegions = [[0, 0, w, ly], [logoRight, ly, w - logoRight, 8], [0, ly + 8, w, panelTop - ly - 8], [0, panelTop, pleft, panelBottom - panelTop]];
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
  for (let y = conTop + 1; y < h; y++) { const x = sx + 20 + ((y - conTop) % 3 === 0 ? 1 : 0) + Math.floor((y - conTop) / 3); base.put(x, y, (y - conTop) % 3 === 0 ? '╲' : '│', 'h'); }
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
  effects.push({ kind: 'sprite', id: 'carp-hangar', frames: CARP, from: [w + 2, port ? 36 : 16], to: [-10, port ? 39 : 21], duration: port ? 10 : 16, every: 60, offset: 18, fps: 2 });
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
  const bw = 46, bx = Math.floor(w / 2 - bw / 2), by = 3;
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
  effects.push({ kind: 'text', id: 'strip', x: sx0 + 2, y: sy + 1, width: sw - 4, template: '» NOW BOARDING · {stopTitle} · {section}/{sections}', colour: 'c' });
  // Pride: the strip's brackets string up a stripe banner.
  const pride = new Art(w, h);
  for (let x = bx + 7; x < bx + bw - 7; x++) pride.put(x, by + 9, '▄', String(1 + Math.floor((x - bx - 7) / ((bw - 14) / 7)) % 7));
  layers.push(layer('pride-banner', pride, { when: { beat: ['pride'] } }));

  // Help desk terminal: its screen follows the section Sophie is reading.
  const desk = (x, y) => {
    reserve(x, y, x + 18, y + 6); base.fill(x, y, x + 18, y + 6, ' ', ' '); base.box(x, y, x + 18, y + 4, 'o'); base.text(x + 2, y, ' HELP DESK ', 'A'); base.text(x + 4, y + 5, '/      \\', 'd'); base.text(x + 3, y + 6, '/________\\', 'd');
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
    base.box(x, y, x + 11, y + 5, 'A'); base.text(x + 1, y + 1, ' DO NOT', 'r'); base.text(x + 1, y + 2, ' FEED THE', 'r'); base.text(x + 1, y + 3, ' CARP', 'r');
    prop(base, x + 6, y + 4, ['}<o>'], 'h');
  };

  if (!port) {
    // A wide reinforced window onto real space, a gas giant in the corner.
    reserve(2, 3, 33, 14);
    const win = reinforcedWindow(base, effects, 'window', 2, 3, 33, 14, 3, 5);
    prop(base, 25, 9 + 1, ['  .--.', ' (::::)', '(::::::'], ['  IIII', ' AAAAAA', 'AAAAAAA']);
    base.put(win.gx1, 11, ')', 'A');
    const gx = w - 27, nx = w - 23, ny = 6;
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
    desk(86, 10); exitSign(108, 10); poster(107, 12); fittings(3, 15);
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
  const seatY = port ? 19 : 20, sxs = port ? 4 : 24, ex = port ? w - 6 : w - 30;
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
    ? [[6, 24, ['  /\\', ' /! \\', '/WET_\\'], ['  aa', ' aaaa', 'aaaaaa']], [44, 40, ['_\\/_'], 'a'], [14, 48, [' ,-.', '[▄▄▄]'], [' ddd', 'rrrrr']], [56, 32, ['[u]'], 'r'], [30, 52, ["-'  -'"], 'I']]
    : [[8, 25, ['  /\\', ' /! \\', '/WET_\\'], ['  aa', ' aaaa', 'aaaaaa']], [70, 34, ['_\\/_'], 'a'], [95, 29, [' ,-.', '[▄▄▄]'], [' ddd', 'rrrrr']],
      [40, 31, ['[u]'], 'r'], [52, 36, ["-'  -'"], 'I'], [27, 37, ['[≡]'], 'H'], [14, 32, ['≡≡≡≡'], 'd']];
  for (const [x, y, lines, keys] of floorProps) {
    for (let r = 0; r < lines.length; r++) for (let c = 0; c < [...lines[r]].length; c++) base.put(x + c, y + r, ' ', ' ');
    prop(base, x, y, lines, keys);
  }
  if (port) desk(48, 41);
  effects.push({ kind: 'drift', id: 'dust', region: [port ? 4 : 24, seatY - 4, port ? w - 8 : w - 54, 3], seed: 9, density: 0.02, speed: 0.3, glyphs: '·', colours: 'I' });
  // Ian makes his rounds.
  effects.push({ kind: 'sprite', id: 'ian', frames: CORGI, from: [-12, port ? 44 : 30], to: [w + 2, port ? 44 : 30], duration: port ? 10 : 16, every: 75, offset: 40, fps: 4 });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: pressure door and new laboratory ----------
const DOOR_BEATS = ['watch-step', 'feedback', 'be-safe', 'ready', 'get-whitelisted'];
function door(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), light = new Art(w, h), effects = [], layers = [];
  const dw = port ? 30 : 34, cx = Math.round(w / 2), dx0 = cx - dw / 2, dx1 = cx + dw / 2;
  const dy0 = 4, dy1 = port ? Math.round(h * 0.47) : Math.round(h * 0.63), cyl = Math.round((dy0 + dy1) / 2);
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
    for (let y = dy0 + 1; y < dy1; y++) for (let c = 0; c < half; c++) {
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
  const cxR = dx1 + 5;
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
  if (!port) {
    base.hline(0, dx0 - 7, dy0 + 2, '═', 'H'); base.text(dx0 - 6, dy0 + 2, '[≡]', 'o'); base.put(dx0 - 5, dy0 + 2, '≡', 'h'); base.put(dx0 - 3, dy0 + 2, '═', 'H');
    const ix = 5, iy = dy0 + 5;
    ['+-------------------------+', '| ARRIVALS                |', '| ||||||||||||||||||||||| |', '| ||||||||||||||||||||||| |', '|                     (o) |', '| PUSH TO TALK         .  |', '+-------------------------+']
      .forEach((ln, r) => [...ln].forEach((ch, j) => { if (ch !== ' ') base.put(ix + j, iy + r, ch, /[A-Z]/.test(ch) ? 'r' : (ch === '|' && j > 1 && j < ln.length - 2) ? 'd' : 'o'); }));
    const px = dx1 + 8, pw = Math.min(31, w - px - 2), py = dy0 + 1;
    base.box(px, py, px + pw, py + 6, 'h'); base.text(px + 2, py, ' ARRIVAL CONTROL ', 'h'); base.put(px, py + 3, '╪', 'h'); base.hline(dx1 + 3, px - 1, py + 3, '─', 'H');
    for (const [state, when, key] of PANEL_STATES) {
      const art = new Art(w, h);
      rows[state].forEach(([k, v], r) => { art.text(px + 2, py + 2 + r, k, 'h'); art.text(px + 13, py + 2 + r, '» ' + v, key); });
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
  // The arrivals deck: one fixture for each part of Disembarking.
  const deck = [];
  const floorY = dy1 + 1;
  for (let y = floorY + 1; y < h; y++) for (let x = 0; x < w; x++) {
    if ((y - floorY) % 4 === 0) { if (x % 2 === 0) base.put(x, y, '_', 'd'); }
    else if (hash(x * 7 + 3, y * 5) < 0.015) base.put(x, y, '·', 'd');
  }
  for (let x = 0; x < w; x++) base.put(x, floorY, x % 4 < 2 ? '/' : ' ', x % 4 < 2 ? 'r' : ' ');
  const fy = port ? floorY + 4 : floorY + 3, rowGap = port ? 12 : 0;
  const slots = port ? [[2, fy], [24, fy], [47, fy], [2, fy + rowGap], [37, fy + rowGap]] : [[3, fy], [26, fy], [44, fy], [61, fy], [91, fy]];
  const clearArea = (x, y, cols, rows) => base.fill(x, y, x + cols - 1, y + rows - 1, ' ', ' ');
  const beatLayer = (id, art, beats) => deck.push(layer(id, art, { when: { beat: beats } }));
  {
    // Watch your step and do not run: a wet floor, a mop bucket and a sign nobody obeys.
    const [x, y] = slots[0]; clearArea(x, y, 21, 6);
    prop(base, x, y + 3, ['  .-.', ' [___]~'], ['  ddd', ' oooood']);
    const sign = new Art(w, h); prop(sign, x + 9, y, ['  /\\', ' /! \\', '/WET_\\', 'NO RUNNING'], ['  aa', ' aaaa', 'aaaaaa', 'rrrrrrrrrr']);
    beatLayer('deck-wet', sign, ['watch-step']);
    effects.push({ kind: 'blink', id: 'deck-wet-blink', region: [x + 9, y + 3, 10, 1], hz: 1, on: 'r', off: 'A', when: { beat: ['watch-step'] } });
  }
  {
    // Feedback is a two-way street: a box, and a note going in.
    const [x, y] = slots[1]; clearArea(x, y, 16, 6);
    prop(base, x, y + 1, ['┌──────────────┐', '│  FEEDBACK    │', '│   [______]   │', '└──────────────┘'], ['oooooooooooooooo', 'oAAAAAAAAAAAAAAo', 'oddddddddddddddo', 'oooooooooooooooo']);
    const notes = [0, 1, 2, 3].map(f => { const art = new Art(w, h); if (f < 3) art.text(x + 6, y + f, f === 2 ? '[▒]' : '[=]', 'i'); return art; });
    deck.push({ ...framesLayer('deck-feedback-note', notes, 1.5), when: { beat: ['feedback'] } });
  }
  {
    // Be safe, Spacer: the emergency locker, internals and all.
    const [x, y] = slots[2]; clearArea(x, y, 16, 6);
    prop(base, x, y, ['┌─ EMERGENCY ─┐', '│  ()   [O2]  │', '│  /\\   [O2]  │', '│             │', '└─────────────┘'], ['ooooooooooooooo', 'o  II   aaaa  o', 'o  II   aaaa  o', 'o             o', 'ooooooooooooooo']);
    const lit = new Art(w, h); lit.text(x + 2, y + 3, 'INTERNALS ON', 'c'); beatLayer('deck-internals', lit, ['be-safe']);
    effects.push({ kind: 'blink', id: 'deck-locker-blink', region: [x + 2, y + 3, 12, 1], hz: 1, on: 'c', off: 'H', when: { beat: ['be-safe'] } });
  }
  {
    // Ready to disembark? The checklist ticks itself off as Sophie reads it.
    const [x, y] = slots[3], items = ['18+ & ADULT NOTICE', 'THE RULES APPLY', 'RESPECT BOUNDARIES', 'KNOW WHERE TO ASK'];
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
    const [x, y] = slots[4]; clearArea(x, y, 25, 6);
    prop(base, x, y, ['┌─────────────────────┐', '│ MERIDIAN RIFT       │', '│                     │', '│                     │', '└────────┬───┬────────┘', '        /_____\\'], ['ooooooooooooooooooooooo', 'oaaaaaaaaaaaaaa      o', 'o                     o', 'o                     o', 'ooooooooooooooooooooooo', '        ddddddd']);
    base.text(x + 2, y + 2, '[ Get Whitelisted ]', 'H');
    const lit = new Art(w, h); lit.text(x + 2, y + 2, '[ Get Whitelisted ]', 'c'); lit.text(x + 2, y + 3, '> link via Discord', 'I');
    beatLayer('deck-get-whitelisted', lit, ['get-whitelisted']);
    effects.push({ kind: 'blink', id: 'deck-button-blink', region: [x + 2, y + 2, 19, 1], hz: 1, on: 'c', off: 'h', when: { beat: ['get-whitelisted'] } });
  }
  // Access granted: an ID card, shown only once Discord has applied Whitelist.
  const card = new Art(w, h), cw = 22, ccx = Math.round(w / 2 - cw / 2), ccy = port ? h - 7 : floorY + 1;
  card.fill(ccx, ccy, ccx + cw - 1, ccy + 3, ' ', ' ');
  prop(card, ccx, ccy, ['┌────────────────────┐', '│ ID ▓▓  CREW        │', '│ ACCESS: WHITELIST  │', '└────────────────────┘'], ['hhhhhhhhhhhhhhhhhhhhhh', 'h iiAA  cccc        h', 'h IIIIIII ccccccccc  h', 'hhhhhhhhhhhhhhhhhhhhhh']);
  deck.push(layer('id-card', card, { opaque: true, when: { whitelist: ['confirmed'] } }));
  effects.push({ kind: 'sprite', id: 'cleanbot', frames: [spriteFrame(['[o_o]', ' o o'], ['hhhhh', ' d d']), spriteFrame(['[o_o]', 'o   o'], ['hhhhh', 'd   d'])],
    from: [-7, h - 3], to: [w + 2, h - 3], duration: port ? 12 : 18, every: 85, offset: 50, fps: 2 });

  // Order: frame and fittings, the laboratory behind the door, the sliding leaves, then lamp and control text.
  const byId = Object.fromEntries(layers.map(l => [l.id, l]));
  return { layers: [layer('base', base), byId.laboratory, byId['leaf-left'], byId['leaf-right'], byId['lamp-idle'], byId['lamp-waiting'], byId['lamp-confirmed'],
    byId['control-idle'], byId['control-waiting'], byId['control-open'], ...deck], effects };
}

function strip(base, effects, x, y, width) {
  base.box(x, y, x + width - 1, y + 2, 'h');
  effects.push({ kind: 'text', id: 'strip', x: x + 2, y: y + 1, width: width - 4, template: '» {stopTitle} · {section}/{sections}', colour: 'c' });
}
function tubes(base, w) { for (let x = 6; x < w - 8; x += 24) { base.put(x - 1, 1, '[', 'd'); base.put(x + 10, 1, ']', 'd'); base.text(x, 1, '══════════', 'I'); } }

// ---------- scene: baggage hall ----------
const BAGGAGE_BEATS = ['migrating', 'past', 'looc'];
const CLOWN = [
  spriteFrame(['HONK!', ' \\o/', '  |', ' / \\'], ['aaaaa', ' rpr', '  r', ' r r']),
  spriteFrame(['', ' \\o/', '  |', '  |\\'], ['', ' rpr', '  r', '  rr']),
];
function baggage(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [], reserved = [];
  const reserve = (x0, y0, x1, y1) => reserved.push([x0, y0, x1, y1]);
  tubes(base, w);
  effects.push({ kind: 'flicker', id: 'tube-flicker', region: [30, 1, 10, 1], hz: 2, chance: 0.25, colour: 'd' });
  // A wall of old lockers; one stands open with something nobody came back for.
  const lockW = 8, lockH = 4, top = 3, rows = 3, x0 = 2, count = Math.floor((w - 4) / lockW);
  let n = 1, lost = null;
  for (let r = 0; r < rows; r++) for (let i = 0; i < count; i++, n++) {
    const x = x0 + i * lockW, y = top + r * lockH;
    base.text(x, y, '+' + '-'.repeat(lockW - 1), 'o'); base.put(x, y + 1, '|', 'o'); base.put(x, y + 2, '|', 'o'); base.put(x, y + 3, '|', 'o');
    const open = hash(i, r + 40) < 0.12, tagged = !open && hash(i, r + 80) < 0.18;
    if (open) { base.fill(x + 1, y + 1, x + lockW - 1, y + 3, '▓', 'd'); if (r === 1) lost = [x, y]; continue; }
    const label = String(n).padStart(2, '0');
    base.text(x + 3, y + 1, label, hash(x, y) < 0.3 ? 'A' : 'r');
    base.text(x + 3, y + 2, '==', 'I');
    if (tagged) { base.put(x + 6, y + 1, '◆', 'h'); effects.push({ kind: 'blink', id: `tag-${i}-${r}`, region: [x + 6, y + 1, 1, 1], hz: 0.4 + hash(i, r) * 0.6, on: 'h', off: 'H' }); }
  }
  base.text(x0 + count * lockW, top, '+', 'o'); for (let y = top + 1; y < top + rows * lockH; y++) base.put(x0 + count * lockW, y, '|', 'o');
  base.hline(x0, x0 + count * lockW, top + rows * lockH, '-', 'o');
  if (lost) {
    // Leave the past in the past: an old hero's cape, unclaimed.
    const [lx, ly] = lost, cape = new Art(w, h);
    cape.fill(lx + 1, ly + 1, lx + lockW - 1, ly + 3, ' ', ' ');
    prop(cape, lx + 1, ly + 1, ['UNCLAIM', ' \\~~~/', '  \\_/'], ['AAAAAAA', ' ppppp', '  ppp']);
    layers.push({ ...layer('lost-cape', cape, { opaque: true }), when: { beat: ['past'] } });
  }
  const sy = top + rows * lockH + 2, sw = port ? w - 8 : 54, sx = Math.floor(w / 2 - sw / 2);
  strip(base, effects, sx, sy, sw); reserve(sx, sy, sx + sw - 1, sy + 2);
  // The belt: luggage and track move the same way, right through the scanner arch.
  const beltY = sy + 8, period = 16, cases = [[' .--. ', '[====]'], ['  __  ', '[▒▒▒▒]'], [' .__. ', '[▓▓▓▓]']];
  const ax = port ? Math.round(w * 0.55) : Math.round(w * 0.62);
  const origins = ['BUBBER', 'SPLURT', 'NOVA'];
  base.hline(0, w - 1, beltY + 3, '▀', 'd');
  for (const tagged of [false, true]) {
    const belt = [];
    for (let f = 0; f < period; f++) {
      const art = new Art(w, h);
      for (let x = 0; x < w; x++) {
        const rail = ((x - f) % 4 + 4) % 4 === 0, roller = ((x - f) % 3 + 3) % 3 === 0;
        art.put(x, beltY + 1, rail ? '╪' : '═', rail ? 'o' : 'I'); art.put(x, beltY + 2, roller ? 'o' : ' ', 'd');
      }
      for (let k = -1; k * period < w + period; k++) {
        const cx = k * period + f + 2, kind = ((k % 3) + 3) % 3, c = cases[kind];
        art.text(cx, beltY - 1, c[0], 'o'); art.text(cx, beltY, c[1], kind === 1 ? 'r' : 'A');
        if (tagged) { const tag = cx + 3 < ax ? origins[kind] : 'MERIDIAN'; art.text(cx, beltY - 2, tag, cx + 3 < ax ? 'I' : 'c'); }
      }
      belt.push(art);
    }
    layers.push({ ...framesLayer(tagged ? 'belt-tagged' : 'belt', belt, 6), when: { beat: tagged ? ['migrating'] : ['none', 'past', 'looc'] } });
  }
  const arch = new Art(w, h);
  arch.text(ax, beltY - 4, '╔════╗', 'h'); for (let y = beltY - 3; y <= beltY + 1; y++) { arch.put(ax, y, '║', 'h'); arch.put(ax + 5, y, '║', 'h'); }
  arch.put(ax, beltY + 2, '╪', 'h'); arch.put(ax + 5, beltY + 2, '╪', 'h');
  layers.push(layer('scanner-arch', arch));
  effects.push({ kind: 'scan', id: 'scanner', region: [ax + 1, beltY - 3, 4, 2], speed: 4, glyph: '─', colour: 'H' });
  reserve(ax, beltY - 4, ax + 5, beltY + 2);
  if (!port) {
    const dx = w - 18, dy = sy;
    base.text(dx, dy, '.------------.', 'o'); base.text(dx, dy + 1, '|   .----.   |', 'o'); base.text(dx, dy + 2, "|  /  |   \\  |", 'o');
    base.text(dx, dy + 3, '|  | 00kg |  |', 'o'); base.text(dx, dy + 4, "'------------'", 'o');
    base.text(dx + 5, dy + 3, '00kg', 'a'); reserve(dx, dy, dx + 13, dy + 4);
    base.text(4, sy, 'BAGGAGE', 'r'); base.text(4, sy + 1, '-------', 'A'); reserve(4, sy, 10, sy + 1);
  }
  wallPanels(base, 0, top + rows * lockH + 1, w - 1, beltY - 5, 7, 12, reserved);
  // LOOC: out-of-character, in double brackets.
  const looc = new Art(w, h);
  const bubble = '(( do our characters know each other here? ))';
  looc.text(Math.floor(w / 2 - bubble.length / 2), beltY - 4 - (port ? 0 : 0), bubble, 'I');
  layers.push(layer('looc-bubble', looc, { when: { beat: ['looc'] } }));

  // Floor: claim-hall tiles, a luggage cart, and a monkey who should not be here.
  const floorTop = beltY + 4;
  for (let y = floorTop; y < h; y++) for (let x = 0; x < w; x++) {
    if ((y - floorTop) % 3 === 2) { if (x % 2 === 0) base.put(x, y, '_', 'd'); continue; }
    if (x % 10 === 0) base.put(x, y, '|', 'd');
    else if (hash(x * 3 + 5, y * 17) < 0.02) base.put(x, y, '·', 'd');
  }
  const clear = (x, y, lines) => lines.forEach((line, r) => { for (let c = 0; c < [...line].length; c++) base.put(x + c, y + r, ' ', ' '); });
  const placeOnFloor = (x, y, lines, keys) => { clear(x, y, lines); prop(base, x, y, lines, keys); };
  const cartX = port ? 4 : 6, cartY = floorTop + 1;
  placeOnFloor(cartX, cartY, ['  .--.  .__.', ' [====][▓▓▓▓]', '|============|', ' o          o'], ['  oooo  oooo', ' AAAAAArrrrrr', 'oooooooooooooo', ' d          d']);
  placeOnFloor(port ? 50 : 92, floorTop + 2, ["   .__.", "  [▒▒▒▒]", "@('_')@"], ['   oooo', '  AAAAAA', 'rrrrrrr']);
  // The terminal by the belt: house rules, or the preferences import when Sophie gets to it.
  const tx = port ? 4 : 30, ty = port ? floorTop + 7 : floorTop + 1, tw = port ? w - 9 : 56;
  clear(tx, ty, Array(5).fill(' '.repeat(tw + 1)));
  base.box(tx, ty, tx + tw, ty + 4, 'o'); base.text(tx + 2, ty, ' CLAIM TERMINAL ', 'A');
  const notices = new Art(w, h);
  notices.text(tx + 2, ty + 1, 'NO MONKEY CUBES NEAR WATER', 'a'); notices.text(tx + 2, ty + 2, 'TOOLBOXES ARE NOT WEAPONS (USUALLY)', 'A');
  layers.push(layer('terminal-house', notices, { when: { beat: ['none', 'past', 'looc'] } }));
  const prefs = new Art(w, h);
  prefs.text(tx + 2, ty + 1, '> Export-Preferences', 'c'); prefs.text(tx + tw - 9, ty + 1, 'OLD: OK', 'h');
  prefs.text(tx + 2, ty + 2, port ? '> Import-Character-Prefs' : '> Import-Character-Preferences', 'c'); prefs.text(tx + tw - 9, ty + 2, 'NEW: ..', 'a');
  prefs.text(tx + 2, ty + 3, port ? 'settings move, setting stays' : 'Preferences move settings, not the setting.', 'I');
  layers.push(layer('terminal-prefs', prefs, { when: { beat: ['migrating'] } }));
  effects.push({ kind: 'blink', id: 'prefs-wait', region: [tx + tw - 4, ty + 2, 2, 1], hz: 1.5, on: 'a', off: 'A', when: { beat: ['migrating'] } });
  effects.push({ kind: 'sprite', id: 'clown', frames: CLOWN, from: [w + 4, h - 6], to: [-10, h - 6], duration: port ? 7 : 11, every: 95, offset: 55, fps: 3 });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: boarding cabin ----------
const CABIN_BEATS = ['together', 'seat', 'sealion'];
function cabin(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  const sw = port ? w - 8 : 50, sx = Math.floor(w / 2 - sw / 2);
  for (let x = 1; x + 9 <= w - 1; x += 9) { if (x + 8 < sx || x > sx + sw) base.text(x, 1, '[_______]', 'o'); }
  strip(base, effects, sx, 0, sw);
  base.hline(0, w - 1, 4, '─', 'd');
  const portY = 6, gap = port ? 12 : 14;
  for (let x = 3; x + 7 < w; x += gap) {
    base.text(x, portY, " .---. ", 'o'); base.text(x, portY + 1, '/     \\', 'o'); base.text(x, portY + 2, '|     |', 'o'); base.text(x, portY + 3, '\\     /', 'o'); base.text(x, portY + 4, " '---' ", 'o');
    effects.push({ kind: 'drift', id: `port-${x}`, region: [x + 1, portY + 1, 5, 3], seed: 20 + x, density: 0.2, speed: 1.5, glyphs: ".·'", colours: '..I' });
  }
  // Seats, and the people sharing the trip with you.
  const seatY = portY + 7, seats = [];
  for (let x = 2, i = 0; x + 8 < w; x += 10, i++) {
    base.text(x, seatY, ' _  ', 'o'); base.text(x, seatY + 1, '|▒| ', 'o'); base.text(x, seatY + 2, '|▒|__', 'o'); base.text(x, seatY + 3, '|▒▒▒▒|', 'o'); base.text(x, seatY + 4, ' |  |', 'd');
    base.put(x + 1, seatY + 1, '▒', 'A'); base.put(x + 1, seatY + 2, '▒', 'A'); base.text(x + 1, seatY + 3, '▒▒▒▒', 'A');
    base.text(x + 4, seatY - 1, String.fromCharCode(65 + (i % 6)) + String(1 + Math.floor(i / 6)), 'h');
    seats.push(x);
  }
  const people = new Art(w, h);
  // A sleeping assistant in grey, a lizard and a cat-person; the rest of the seats stay free.
  const riders = [
    [1, [[3, 0, 'o', 'I'], [3, 1, '|', 'I'], [5, -2, 'zZ', 'I']]],
    [3, [[3, 0, '>', '4'], [4, 0, 'o', '4'], [3, 1, '|', '4']]],
    [4, [[2, 0, '=^.^=', 'r'], [3, 1, '|', 'r']]],
    [6, [[3, 0, 'o', 'h'], [3, 1, '|', 'h']]],
  ];
  for (const [index, marks] of riders) if (seats[index] !== undefined) for (const [dx, dy, text, key] of marks) people.text(seats[index] + dx, seatY + dy, text, key);
  layers.push(layer('passengers', people, { when: { beat: ['together', 'seat', 'sealion'] } }));
  const floor = seatY + 6;
  base.hline(0, w - 1, floor, '_', 'd');
  const lights = []; for (let x = 0; x < w; x += 3) { base.put(x, floor + 1, '·', 'H'); lights.push([x, floor + 1]); }
  effects.push({ kind: 'pulse', id: 'aisle-lights', path: lights, speed: 10, glyph: '•', colour: 'h', trail: 3, trailGlyph: '·', trailColour: 'h' });
  const signX = port ? 3 : w - 22;
  base.text(signX, 3, '[ FASTEN STRAPS ]', 'a');
  effects.push({ kind: 'blink', id: 'fasten', region: [signX + 2, 3, 13, 1], hz: 0.5, on: 'a', off: 'A' });
  // A shared seat is not an invitation: the placard says so.
  const placard = new Art(w, h); const pText = '[ ONE PASSENGER PER SEAT ]';
  placard.text(port ? w - pText.length - 2 : 3, port ? 5 : 3, pText, 'p');
  layers.push(layer('placard', placard, { when: { beat: ['seat'] } }));

  // The landing bay below, through the floor window: keep the pad clear.
  const by0 = floor + 3, by1 = h - 2, bx0 = 2, bx1 = w - 3;
  for (let y = by0; y <= by1; y++) { base.put(bx0, y, '▓', 'o'); base.put(bx0 + 1, y, '▒', 'd'); base.put(bx1 - 1, y, '▒', 'd'); base.put(bx1, y, '▓', 'o'); }
  base.hline(bx0, bx1, by0, '▓', 'o'); base.hline(bx0, bx1, by1, '▓', 'o');
  base.text(bx0 + 3, by0, ' LANDING BAY · VIEW ', 'A');
  const padY = by1 - 3, padX = Math.floor(w / 2) - 14;
  base.text(padX, padY, '/////  KEEP  CLEAR  /////', 'r'); base.text(padX - 2, padY + 1, '[' + '='.repeat(27) + ']', 'o');
  for (let x = bx0 + 3; x < bx1 - 2; x += 8) base.put(x, padY + 1, '•', 'a');
  effects.push({ kind: 'drift', id: 'bay-stars', region: [bx0 + 2, by0 + 1, bx1 - bx0 - 3, padY - by0 - 2], seed: 41, density: 0.03, speed: 0.5, glyphs: ".·'", colours: '..I' });
  effects.push({ kind: 'sprite', id: 'carp-bay', frames: CARP, from: [bx1 - 8, by0 + 2], to: [bx0 - 6, by0 + 4], duration: 12, every: 70, offset: 25, fps: 2 });
  // We crush sea-lions with shuttles: one is sunning itself on the pad as the shuttle's shadow grows.
  const lion = new Art(w, h);
  prop(lion, padX + 10, padY - 3, ['   ,-.', ' _/ o \\', '(     _>'], ['   III', ' IIIIII', 'IIIIIIII']);
  layers.push(layer('sealion', lion, { when: { beat: ['sealion'] } }));
  const shadow = [];
  for (let f = 0; f < 8; f++) {
    const art = new Art(w, h), r = 2 + f * 2;
    for (let dx = -r; dx <= r; dx++) art.put(padX + 13 + dx, padY - 4 - Math.floor(f / 3), '░', 'd');
    shadow.push(art);
  }
  layers.push({ ...framesLayer('shuttle-shadow', shadow, 2), when: { beat: ['sealion'] } });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: viewport ----------
const VIEWPORT_BEATS = ['enjoy', 'valuable', 'photos'];
function viewport(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [];
  const fx0 = 1, fx1 = w - 2, fy0 = 1, fy1 = port ? 26 : 23;
  for (let y = fy0; y <= fy1; y++) { base.put(fx0, y, '▓', 'd'); base.put(fx0 + 1, y, '▒', '.'); base.put(fx1 - 1, y, '▒', '.'); base.put(fx1, y, '▓', 'd'); }
  base.hline(fx0, fx1, fy0, '▓', 'd'); base.hline(fx0, fx1, fy1, '▓', 'd');
  for (let x = fx0 + 6; x < fx1 - 4; x += 12) { base.put(x, fy0, 'o', 'o'); base.put(x, fy1, 'o', 'o'); }
  const ix0 = fx0 + 2, iy0 = fy0 + 1, iw = fx1 - fx0 - 3, ih = fy1 - fy0 - 1;
  // The station outside: a ring segment with spokes, in old dim metal.
  const rcx = port ? w * 0.5 : w * 0.62, rcy = port ? fy1 + 10 : fy1 + 14, rr = port ? 30 : 46;
  for (let th = Math.PI * 1.05; th < Math.PI * 1.95; th += 0.004) {
    for (const k of [0, 2]) { const x = Math.round(rcx + (rr - k) * Math.cos(th) / ADV * 0.6), y = Math.round(rcy + (rr - k) * Math.sin(th) * 0.5); if (x > ix0 && x < ix0 + iw && y >= iy0 && y < iy0 + ih) base.put(x, y, k ? '·' : '─', k ? '.' : 'I'); }
  }
  const lights = [];
  for (let i = 0; i < 14; i++) {
    const th = Math.PI * (1.12 + i * 0.054), x = Math.round(rcx + (rr - 1) * Math.cos(th) / ADV * 0.6), y = Math.round(rcy + (rr - 1) * Math.sin(th) * 0.5);
    if (x > ix0 && x < ix0 + iw && y >= iy0 && y < iy0 + ih) { const key = i % 3 === 0 ? 'h' : 'a'; base.put(x, y, '•', key); lights.push([x, y, key]); }
  }
  lights.slice(0, 10).forEach(([x, y, key], i) => effects.push({ kind: 'blink', id: `light-${i + 1}`, region: [x, y, 1, 1], hz: 0.3 + (i % 5) * 0.2, on: key, off: key === 'h' ? 'H' : 'A' }));
  effects.push({ kind: 'drift', id: 'lights-band', region: [ix0, iy0 + 3, iw, 4], seed: 31, density: 0.05, speed: 0.6, glyphs: '~~-', colours: 'hHp' });
  effects.push({ kind: 'drift', id: 'stars', region: [ix0, iy0, iw, ih], seed: 32, density: 0.025, speed: 0.4, glyphs: ".·'+", colours: '..Ih' });
  const ry = fy1 - 2;
  base.hline(ix0, ix0 + iw - 1, ry, '═', 'I'); for (let x = ix0 + 4; x < ix0 + iw; x += 10) base.put(x, ry, '╪', 'h');
  const camX = port ? ix0 + 3 : ix0 + 6, camY = ry - 5;
  base.text(camX, camY, ' .--.  ', 'o'); base.text(camX, camY + 1, '[(o) ]', 'o'); base.put(camX + 2, camY + 1, 'o', 'a');
  base.text(camX, camY + 2, '  /|\\ ', 'd'); base.text(camX, camY + 3, ' / | \\', 'd'); base.text(camX, camY + 4, '/  |  \\', 'd');
  const sw = port ? w - 10 : 50;
  strip(base, effects, Math.floor(w / 2 - sw / 2), fy1 + 2, sw);
  const layers = [];
  // Enjoy yourselves: the light band outside turns festive.
  const band = effects.find(fx => fx.id === 'lights-band');
  band.when = { beat: ['none', 'valuable', 'photos'] };
  effects.push({ ...band, id: 'lights-festive', glyphs: '~~-*~~-', colours: '1234567', density: 0.08, when: { beat: ['enjoy'] } });
  effects.push({ kind: 'sprite', id: 'carp-outside', frames: CARP, from: [ix0 + iw, iy0 + 5], to: [ix0 - 8, iy0 + 8], duration: 14, every: 80, offset: 12, fps: 2 });
  effects.push({ kind: 'sprite', id: 'shooting-star', frames: [spriteFrame(['*'], 'c')], from: [ix0 + 8, iy0 + 1], to: [ix0 + 36, iy0 + 7], duration: 1.5, every: 33, offset: 9 });
  // The observation deck: a bench, a potted plant, the deck sign and a photo booth.
  const deckY = fy1 + 6, floorY = h - 3;
  base.hline(0, w - 1, floorY, '▀', 'd');
  for (let x = 0; x < w; x++) if (hash(x * 9, floorY + 1) < 0.08) base.put(x, floorY + 1, '·', 'd');
  prop(base, 3, floorY - 4, ['\\\\|//', ' \\|/', ' [_]'], ['44444', ' 444', ' ooo']);
  if (!port) prop(base, 10, floorY - 3, [' ________________', '|________________|', ' ||            ||'], [' oooooooooooooooo', 'oAAAAAAAAAAAAAAAAo', ' dd            dd']);
  const signX = port ? 12 : 44, signW = port ? 46 : 34, signY = deckY;
  base.box(signX, signY, signX + signW, signY + 4, 'H');
  const plain = new Art(w, h); plain.text(signX + 2, signY + 1, 'OBSERVATION DECK', 'h'); plain.text(signX + 2, signY + 2, 'PLEASE ENJOY THE VIEW', 'H');
  layers.push(layer('deck-sign', plain, { when: { beat: ['none', 'enjoy', 'photos'] } }));
  // Every life is valuable: somebody, somewhere, is learning this for the first time today.
  const count = new Art(w, h); count.text(signX + 2, signY + 1, 'TODAY:  10,000', 'c'); count.text(signX + 2, signY + 2, 'PEOPLE LEARN SOMETHING', 'h'); count.text(signX + 2, signY + 3, 'FOR THE FIRST TIME', 'h');
  layers.push(layer('deck-counter', count, { when: { beat: ['valuable'] } }));
  effects.push({ kind: 'blink', id: 'deck-counter-blink', region: [signX + 10, signY + 1, 6, 1], hz: 0.8, on: 'c', off: 'h', when: { beat: ['valuable'] } });
  const boothX = port ? w - 20 : 86, boothY = deckY;
  base.box(boothX, boothY, boothX + 16, boothY + 3, 'o'); base.text(boothX + 2, boothY + 1, 'PHOTO BOOTH', 'A'); base.text(boothX + 2, boothY + 2, '[==slot==]', 'd');
  const prints = [];
  for (let f = 0; f < 6; f++) {
    const art = new Art(w, h);
    for (let i = 0; i <= Math.min(f, 3); i++) art.text(boothX + 1 + i * 4, boothY + 5, '[▒]', i === Math.min(f, 3) && f < 4 ? 'a' : 'I');
    prints.push(art);
  }
  layers.push({ ...framesLayer('photo-prints', prints, 1), when: { beat: ['photos'] } });
  // Take photos: the old camera flashes now and then.
  effects.push({ kind: 'blink', id: 'camera-flash', region: [camX + 2, camY + 1, 1, 1], hz: 0.5, on: 'c', off: 'a', when: { beat: ['photos'] } });
  return { layers: [layer('base', base), ...layers], effects };
}

const SCENES = [
  { id: 'hangar-viewport', title: 'Hangar viewport', draw: hangar, alt: [{ text: 'A small, distant sun and a long dotted orbit. At its far end the station sits with a blinking light, labelled Aphelion · waking, and a shuttle moves along the orbit towards it. In front, an old painted console with amber screens and switches; a cyan panel is bolted on top with a new cable, and a cyan seam fills a crack in the metal.' }] },
  { id: 'departure-lounge', title: 'Departure lounge', draw: lounge, beats: LOUNGE_BEATS, alt: [{ text: 'A departure lounge. An old split-flap board in amber shows the current stop boarding. A new cyan strip hangs under it on fresh brackets and shows the current section. On the right a new cyan sign hangs over a faded gate sign. A window on the left shows drifting stars, above rows of worn seats.' }] },
  { id: 'baggage-hall', title: 'Baggage hall', draw: baggage, beats: BAGGAGE_BEATS, alt: [{ text: 'A baggage hall. A wall of old numbered lockers, a few hanging open, some with new cyan tags bolted on. Suitcases ride a conveyor belt through a new cyan scanner arch, and a cyan strip shows the current stop and section.' }] },
  { id: 'boarding-cabin', title: 'Boarding cabin', draw: cabin, beats: CABIN_BEATS, alt: [{ text: 'Inside the shuttle cabin. Old overhead lockers and a row of round portholes with stars drifting past, above worn amber seats with new cyan seat numbers. A fasten-straps sign glows, and running lights pulse along the aisle floor.' }] },
  { id: 'viewport', title: 'Viewport', draw: viewport, beats: VIEWPORT_BEATS, alt: [{ text: 'A wide observation window in a heavy riveted frame. Outside, the curve of the station is dotted with amber and cyan lights, and a soft band of light drifts past the stars. An old camera on a tripod stands at the railing.' }] },
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
