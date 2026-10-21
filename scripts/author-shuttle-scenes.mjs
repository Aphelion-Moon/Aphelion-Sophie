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
  const logoRight = lx + 19 + 46, panelTop = conTop - 6, pwid = 26, pleft = port ? w - pwid - 3 : Math.min(w - pwid - 2, (port ? 4 : Math.round(w * 0.31)) + 25);
  const starRegions = [[0, 0, w, ly], [logoRight, ly, w - logoRight, 8], [0, ly + 8, w, panelTop - ly - 8], [0, panelTop, pleft, conTop - panelTop]];
  if (pleft + pwid + 1 < w) starRegions.push([pleft + pwid + 1, panelTop, w - pleft - pwid - 1, conTop - panelTop]);
  starRegions.forEach((region, i) => effects.push({ kind: 'drift', id: `stars-${i + 1}`, region, seed: 11 + i, density: 0.028, speed: 1.2, glyphs: ".·'+", colours: '..Ih' }));

  // Console: old painted metal with a new panel bolted on.
  base.fill(0, conTop + 1, w - 1, h - 1, ' ', ' ');
  for (let y = conTop + 1; y < h; y++) for (let x = 0; x < w; x++) { const r = hash(x * 7 + 1, y * 13 + 5); if (r < 0.05) base.put(x, y, r < 0.025 ? '.' : "'", 'd'); }
  base.hline(0, w - 1, conTop, '_', 'o');
  for (let x = 9; x < w; x += 19) { base.vline(x, conTop + 1, h - 1, '|', 'd'); base.put(x, conTop + 1, 'o', 'o'); }
  const sx = port ? 4 : Math.round(w * 0.31), sy = conTop + 2;
  base.text(sx, sy, '+------------------+', 'o'); base.text(sx, sy + 4, '+------------------+', 'o');
  for (let r = 1; r <= 3; r++) { base.put(sx, sy + r, '|', 'o'); base.put(sx + 19, sy + r, '|', 'o'); }
  base.text(sx + 2, sy + 1, 'SYS 07   NOMINAL', 'a');
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
  const pw = 26, px = port ? w - pw - 3 : Math.min(w - pw - 2, x0 + 2), py = conTop - 6;
  base.fill(px, py, px + pw, conTop, ' ', ' ');
  base.box(px, py, px + pw, conTop, 'h'); base.put(px + 4, conTop, '╪', 'h'); base.put(px + pw - 4, conTop, '╪', 'h');
  base.text(px + 2, py + 1, 'SHUTTLE LINK', 'c'); base.text(px + pw - 7, py + 1, '• LIVE', 'h');
  effects.push({ kind: 'blink', id: 'link-live', region: [px + pw - 7, py + 1, 1, 1], hz: 0.6, on: 'h', off: 'H' });
  effects.push({ kind: 'text', id: 'link-stop', x: px + 2, y: py + 2, width: pw - 3, template: '» STOP {stopNumber} / {stopCount}', colour: 'c' });
  effects.push({ kind: 'scan', id: 'link-scan', region: [px + 2, py + 3, pw - 3, 1], speed: 1, glyph: '·', colour: 'H' });
  base.text(px + 2, py + 4, 'WHITELIST', 'h');
  for (const [state, label, key] of [['none', 'NOT REQUESTED', 'c'], ['requested', 'REQUESTED', 'a'], ['confirmed', 'CONFIRMED', 'c']]) {
    const art = new Art(w, h); art.text(px + pw - 1 - label.length, py + 4, label, key);
    layers.push(layer(`link-whitelist-${state}`, art, { when: { whitelist: [state] } }));
  }
  const cxl = px + pw - 6, by = Math.min(h - 1, conTop + 5);
  for (let y = conTop + 1; y < by; y++) base.put(cxl, y, '│', 'h');
  base.put(cxl, by, '╰', 'h'); base.text(cxl + 1, by, '──', 'h'); base.text(cxl + 3, by, '[≡]', 'o'); base.put(cxl + 4, by, '≡', 'h');
  const cable = []; for (let y = conTop + 1; y < by; y++) cable.push([cxl, y]); cable.push([cxl, by], [cxl + 1, by], [cxl + 2, by]);
  effects.push({ kind: 'pulse', id: 'cable-pulse', path: cable, speed: 4, glyph: '•', colour: 'c' });
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: departure lounge ----------
function lounge(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [];
  for (let x = 6; x < w - 8; x += 24) { base.put(x - 1, 1, '[', 'd'); base.put(x + 10, 1, ']', 'd'); base.text(x, 1, '══════════', 'I'); }
  effects.push({ kind: 'flicker', id: 'tube-flicker', region: [54, 1, 10, 1], hz: 2.5, chance: 0.3, colour: 'd' });
  if (!port) {
    for (let y = 3; y <= 22; y++) { base.put(3, y, '▓', 'd'); base.put(4, y, '▒', '.'); base.put(19, y, '▒', '.'); base.put(20, y, '▓', 'd'); }
    base.hline(3, 20, 3, '▓', 'd'); base.hline(3, 20, 22, '▓', 'd'); base.hline(5, 18, 12, '═', 'o'); base.put(3, 12, 'o', 'o'); base.put(20, 12, 'o', 'o');
    effects.push({ kind: 'drift', id: 'window-stars', region: [5, 4, 14, 8], seed: 5, density: 0.09, speed: 0.8, glyphs: ".·'", colours: '..I' });
    effects.push({ kind: 'drift', id: 'window-stars-low', region: [5, 13, 14, 9], seed: 6, density: 0.09, speed: 0.8, glyphs: ".·'", colours: '..I' });
  }
  const bw = 46, bx = Math.floor(w / 2 - bw / 2), by = 3;
  base.box(bx, by, bx + bw - 1, by + 8, 'o', '╔╗╚╝═║');
  base.put(bx + 4, by - 1, '│', 'd'); base.put(bx + bw - 5, by - 1, '│', 'd'); base.put(bx - 1, by, 'o', 'o'); base.put(bx + bw, by, 'o', 'o');
  base.text(bx + 2, by + 1, 'DEPARTURES', 'a'); base.text(bx + bw - 15, by + 1, 'SHUTTLE LINE', 'A');
  base.hline(bx + 1, bx + bw - 2, by + 2, '─', 'd');
  effects.push({ kind: 'text', id: 'board-current', x: bx + 2, y: by + 3, width: bw - 14, template: '{stopNumber}  {stopTitle}', colour: 'a' });
  effects.push({ kind: 'flap', id: 'board-status', x: bx + bw - 12, y: by + 3, width: 10, texts: ['BOARDING'], period: 6, flip: 0.5, colour: 'a' });
  effects.push({ kind: 'blink', id: 'board-blink', region: [bx + bw - 12, by + 3, 10, 1], hz: 0.7, on: 'a', off: 'A' });
  for (let r = 1; r <= 4; r++) base.text(bx + 2, by + 3 + r, '--  ' + '-'.repeat(bw - 18) + '  ' + '-'.repeat(8), 'd');
  const sy = by + 10, sw = bw - 2, sx0 = bx + 1;
  base.put(bx + 6, by + 8, '╪', 'h'); base.put(bx + bw - 7, by + 8, '╪', 'h'); base.put(bx + 6, by + 9, '│', 'H'); base.put(bx + bw - 7, by + 9, '│', 'H');
  base.box(sx0, sy, sx0 + sw - 1, sy + 2, 'h');
  effects.push({ kind: 'text', id: 'strip', x: sx0 + 2, y: sy + 1, width: sw - 4, template: '» NOW BOARDING · {stopTitle} · {section}/{sections}', colour: 'c' });
  if (!port) {
    const gx = w - 27, nx = w - 23, ny = 6;
    for (let y = 2; y < ny; y++) { base.put(nx + 3, y, '│', 'H'); base.put(nx + 13, y, '│', 'H'); }
    // The old gate sign is drawn over the new sign's hanging wires, so its lettering stays whole.
    ['+-----------------+', '|    GATE   03    |', '+-----------------+'].forEach((line, r) => [...line].forEach((ch, j) => {
      if (ch === ' ') return;
      if ('-+|'.includes(ch) && hash(gx + j, 4 + r) < 0.18) return;
      base.put(gx + j, 4 + r, ch, /[A-Z0-9]/.test(ch) ? 'r' : 'A');
    }));
    base.fill(nx, ny, nx + 16, ny + 2, ' ', ' '); base.box(nx, ny, nx + 16, ny + 2, 'h'); base.text(nx + 2, ny + 1, 'SHUTTLE', 'c'); base.text(nx + 11, ny + 1, '»»»', 'H');
    effects.push({ kind: 'pulse', id: 'sign-chase', path: [[nx + 11, ny + 1], [nx + 12, ny + 1], [nx + 13, ny + 1]], speed: 4, glyph: '»', colour: 'c' });
  }
  const seatY = port ? 19 : 20, sxs = port ? 4 : 24, ex = port ? w - 6 : w - 30;
  for (let x = sxs; x <= ex - 4; x += 6) { base.text(x, seatY, ' ___ ', 'o'); base.text(x, seatY + 1, '|___|', '.'); base.text(x, seatY + 2, ' | | ', 'd'); }
  const vx = w / 2, vy = 12;
  for (let y = seatY + 3; y < h; y++) {
    for (let k = -7; k <= 7; k++) base.put(Math.round(vx + k * (y - vy) * 1.5), y, k < 0 ? '/' : k > 0 ? '\\' : '|', 'd');
    if ((y - seatY) % 3 === 0) for (let x = 0; x < w; x += 2) if (base.get(x, y) === ' ') base.put(x, y, '_', 'd');
  }
  effects.push({ kind: 'drift', id: 'dust', region: [port ? 4 : 24, seatY - 6, port ? w - 8 : w - 54, 5], seed: 9, density: 0.02, speed: 0.3, glyphs: '·', colours: 'I' });
  return { layers: [layer('base', base)], effects };
}

// ---------- scene: pressure door and new laboratory ----------
function door(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), light = new Art(w, h), effects = [], layers = [];
  const dw = port ? 30 : 34, cx = Math.round(w / 2), dx0 = cx - dw / 2, dx1 = cx + dw / 2;
  const dy0 = 4, dy1 = port ? Math.round(h * 0.47) : Math.round(h * 0.63), cyl = Math.round((dy0 + dy1) / 2);
  for (let y = dy0 - 1; y <= dy1; y++) for (const x of [dx0 - 2, dx0 - 1, dx1 + 1, dx1 + 2]) base.put(x, y, x === dx0 - 1 || x === dx1 + 1 ? '▒' : '▓', x === dx0 - 1 || x === dx1 + 1 ? '.' : 'o');
  base.hline(dx0 - 2, dx1 + 2, dy0 - 1, '▓', 'o'); base.hline(dx0 - 2, dx1 + 2, dy0, '▒', '.');
  const sten = port ? ' DOOR 07 · KEEP CLEAR ' : ' PRESSURE DOOR 07 · KEEP CLEAR ';
  const s0 = cx - Math.floor(sten.length / 2);
  [...sten].forEach((ch, j) => { if (!(ch !== ' ' && hash(s0 + j, 9) < 0.12)) base.put(s0 + j, dy0 - 1, ch, 'r'); });
  base.text(cx - 1, dy0 - 3, '( )', 'o');
  const lampWait = new Art(w, h); lampWait.put(cx, dy0 - 3, '●', 'a');
  layers.push(layer('lamp-waiting', lampWait, { when: { whitelist: ['none', 'requested'] } }));
  effects.push({ kind: 'blink', id: 'lamp-blink', region: [cx, dy0 - 3, 1, 1], hz: 1, on: 'a', off: 'A', when: { whitelist: ['none', 'requested'] } });
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
  const rows = { waiting: [['WHITELIST', 'REQUESTED'], ['DISCORD', 'WAITING'], ['DOOR', 'HELD']], open: [['WHITELIST', 'CONFIRMED'], ['DISCORD', 'APPLIED'], ['DOOR', 'OPEN']] };
  if (!port) {
    base.hline(0, dx0 - 7, dy0 + 2, '═', 'H'); base.text(dx0 - 6, dy0 + 2, '[≡]', 'o'); base.put(dx0 - 5, dy0 + 2, '≡', 'h'); base.put(dx0 - 3, dy0 + 2, '═', 'H');
    const ix = 5, iy = dy0 + 5;
    ['+-------------------------+', '| ARRIVALS                |', '| ||||||||||||||||||||||| |', '| ||||||||||||||||||||||| |', '|                     (o) |', '| PUSH TO TALK         .  |', '+-------------------------+']
      .forEach((ln, r) => [...ln].forEach((ch, j) => { if (ch !== ' ') base.put(ix + j, iy + r, ch, /[A-Z]/.test(ch) ? 'r' : (ch === '|' && j > 1 && j < ln.length - 2) ? 'd' : 'o'); }));
    const px = dx1 + 8, pw = Math.min(31, w - px - 2), py = dy0 + 1;
    base.box(px, py, px + pw, py + 6, 'h'); base.text(px + 2, py, ' ARRIVAL CONTROL ', 'h'); base.put(px, py + 3, '╪', 'h'); base.hline(dx1 + 3, px - 1, py + 3, '─', 'H');
    for (const [state, list, key] of [['waiting', rows.waiting, 'a'], ['open', rows.open, 'c']]) {
      const art = new Art(w, h);
      list.forEach(([k, v], r) => { art.text(px + 2, py + 2 + r, k, 'h'); art.text(px + 13, py + 2 + r, '» ' + v, key); });
      layers.push(layer(`control-${state}`, art, { when: { whitelist: state === 'open' ? ['confirmed'] : ['none', 'requested'] } }));
    }
  } else {
    const px = dx1 + 7, pw = w - px - 1, py = dy0 + 1;
    base.box(px, py, px + pw, py + 4, 'h');
    for (const [state, wl, dr, key] of [['waiting', 'WAIT', 'HELD', 'a'], ['open', 'OK', 'OPEN', 'c']]) {
      const art = new Art(w, h);
      art.text(px + 1, py + 1, 'WL', 'h'); art.text(px + 4, py + 1, wl, key); art.text(px + 1, py + 2, 'DOOR', 'h'); art.text(px + 6, py + 2, dr, key);
      layers.push(layer(`control-${state}`, art, { when: { whitelist: state === 'open' ? ['confirmed'] : ['none', 'requested'] } }));
    }
  }
  // Order: frame and fittings, the laboratory behind the door, the sliding leaves, then lamp and control text.
  const byId = Object.fromEntries(layers.map(l => [l.id, l]));
  return { layers: [layer('base', base), byId.laboratory, byId['leaf-left'], byId['leaf-right'], byId['lamp-waiting'], byId['lamp-confirmed'], byId['control-waiting'], byId['control-open']], effects };
}

function strip(base, effects, x, y, width) {
  base.box(x, y, x + width - 1, y + 2, 'h');
  effects.push({ kind: 'text', id: 'strip', x: x + 2, y: y + 1, width: width - 4, template: '» {stopTitle} · {section}/{sections}', colour: 'c' });
}
function tubes(base, w) { for (let x = 6; x < w - 8; x += 24) { base.put(x - 1, 1, '[', 'd'); base.put(x + 10, 1, ']', 'd'); base.text(x, 1, '══════════', 'I'); } }

// ---------- scene: baggage hall ----------
function baggage(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [], layers = [];
  tubes(base, w);
  effects.push({ kind: 'flicker', id: 'tube-flicker', region: [30, 1, 10, 1], hz: 2, chance: 0.25, colour: 'd' });
  const lockW = 8, lockH = 4, top = 3, rows = 3, x0 = 2, count = Math.floor((w - 4) / lockW);
  let n = 1;
  for (let r = 0; r < rows; r++) for (let i = 0; i < count; i++, n++) {
    const x = x0 + i * lockW, y = top + r * lockH;
    base.text(x, y, '+' + '-'.repeat(lockW - 1), 'o'); base.put(x, y + 1, '|', 'o'); base.put(x, y + 2, '|', 'o'); base.put(x, y + 3, '|', 'o');
    const open = hash(i, r + 40) < 0.12, tagged = !open && hash(i, r + 80) < 0.18;
    if (open) { base.fill(x + 1, y + 1, x + lockW - 1, y + 3, '▓', 'd'); continue; }
    const label = String(n).padStart(2, '0');
    base.text(x + 3, y + 1, label, hash(x, y) < 0.3 ? 'A' : 'r');
    base.text(x + 3, y + 2, '==', 'I');
    if (tagged) { base.put(x + 6, y + 1, '◆', 'h'); effects.push({ kind: 'blink', id: `tag-${i}-${r}`, region: [x + 6, y + 1, 1, 1], hz: 0.4 + hash(i, r) * 0.6, on: 'h', off: 'H' }); }
  }
  base.text(x0 + count * lockW, top, '+', 'o'); for (let y = top + 1; y < top + rows * lockH; y++) base.put(x0 + count * lockW, y, '|', 'o');
  base.hline(x0, x0 + count * lockW, top + rows * lockH, '-', 'o');
  const sy = top + rows * lockH + 2, sw = port ? w - 8 : 54;
  strip(base, effects, Math.floor(w / 2 - sw / 2), sy, sw);
  const beltY = sy + 8, period = 16, cases = [[' .--. ', '[====]'], ['  __  ', '[▒▒▒▒]'], [' .__. ', '[▓▓▓▓]']];
  base.hline(0, w - 1, beltY + 3, '▀', 'd');
  const belt = [];
  for (let f = 0; f < period; f++) {
    const art = new Art(w, h);
    for (let x = 0; x < w; x++) { art.put(x, beltY + 1, (x + f) % 4 === 0 ? '╪' : '═', (x + f) % 4 === 0 ? 'o' : 'I'); art.put(x, beltY + 2, (x + f) % 3 === 0 ? 'o' : ' ', 'd'); }
    for (let k = -1; k * period < w + period; k++) {
      const cx = k * period + f + 2, c = cases[((k % 3) + 3) % 3];
      art.text(cx, beltY - 1, c[0], 'o'); art.text(cx, beltY, c[1], ((k % 3) + 3) % 3 === 1 ? 'r' : 'A');
    }
    belt.push(art);
  }
  layers.push(framesLayer('belt', belt, 6));
  const ax = port ? Math.round(w * 0.55) : Math.round(w * 0.62), arch = new Art(w, h);
  arch.text(ax, beltY - 4, '╔════╗', 'h'); for (let y = beltY - 3; y <= beltY + 1; y++) { arch.put(ax, y, '║', 'h'); arch.put(ax + 5, y, '║', 'h'); }
  arch.put(ax, beltY + 2, '╪', 'h'); arch.put(ax + 5, beltY + 2, '╪', 'h');
  layers.push(layer('scanner-arch', arch));
  effects.push({ kind: 'scan', id: 'scanner', region: [ax + 1, beltY - 3, 4, 2], speed: 4, glyph: '─', colour: 'H' });
  if (!port) {
    const dx = w - 18, dy = sy;
    base.text(dx, dy, '.------------.', 'o'); base.text(dx, dy + 1, '|   .----.   |', 'o'); base.text(dx, dy + 2, "|  /  |   \\  |", 'o');
    base.text(dx, dy + 3, '|  | 00kg |  |', 'o'); base.text(dx, dy + 4, "'------------'", 'o');
    base.text(dx + 5, dy + 3, '00kg', 'a');
    base.text(4, sy, 'BAGGAGE', 'r'); base.text(4, sy + 1, '-------', 'A');
  }
  return { layers: [layer('base', base), ...layers], effects };
}

// ---------- scene: boarding cabin ----------
function cabin(name) {
  const { cols: w, rows: h } = SCENE_LAYOUTS[name], port = name === 'portrait';
  const base = new Art(w, h), effects = [];
  const sw = port ? w - 8 : 50, sx = Math.floor(w / 2 - sw / 2);
  for (let x = 1; x + 9 <= w - 1; x += 9) { if (x + 8 < sx || x > sx + sw) base.text(x, 1, '[_______]', 'o'); }
  strip(base, effects, sx, 0, sw);
  base.hline(0, w - 1, 4, '─', 'd');
  const portY = 6, gap = port ? 12 : 14;
  for (let x = 3; x + 7 < w; x += gap) {
    base.text(x, portY, " .---. ", 'o'); base.text(x, portY + 1, '/     \\', 'o'); base.text(x, portY + 2, '|     |', 'o'); base.text(x, portY + 3, '\\     /', 'o'); base.text(x, portY + 4, " '---' ", 'o');
    effects.push({ kind: 'drift', id: `port-${x}`, region: [x + 1, portY + 1, 5, 3], seed: 20 + x, density: 0.2, speed: 1.5, glyphs: ".·'", colours: '..I' });
  }
  const seatY = portY + 7;
  for (let x = 2, i = 0; x + 8 < w; x += 10, i++) {
    base.text(x, seatY, ' _  ', 'o'); base.text(x, seatY + 1, '|▒| ', 'o'); base.text(x, seatY + 2, '|▒|__', 'o'); base.text(x, seatY + 3, '|▒▒▒▒|', 'o'); base.text(x, seatY + 4, ' |  |', 'd');
    base.put(x + 1, seatY + 1, '▒', 'A'); base.put(x + 1, seatY + 2, '▒', 'A'); base.text(x + 1, seatY + 3, '▒▒▒▒', 'A');
    base.text(x + 4, seatY - 1, String.fromCharCode(65 + (i % 6)) + String(1 + Math.floor(i / 6)), 'h');
  }
  const floor = seatY + 6;
  base.hline(0, w - 1, floor, '_', 'd');
  const lights = []; for (let x = 0; x < w; x += 3) { base.put(x, floor + 1, '·', 'H'); lights.push([x, floor + 1]); }
  effects.push({ kind: 'pulse', id: 'aisle-lights', path: lights, speed: 10, glyph: '•', colour: 'h', trail: 3, trailGlyph: '·', trailColour: 'h' });
  const signX = port ? 3 : w - 22;
  base.text(signX, 3, '[ FASTEN STRAPS ]', 'a');
  effects.push({ kind: 'blink', id: 'fasten', region: [signX + 2, 3, 13, 1], hz: 0.5, on: 'a', off: 'A' });
  return { layers: [layer('base', base)], effects };
}

// ---------- scene: viewport ----------
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
  return { layers: [layer('base', base)], effects };
}

const SCENES = [
  { id: 'hangar-viewport', title: 'Hangar viewport', draw: hangar, alt: [{ text: 'A small, distant sun and a long dotted orbit. At its far end the station sits with a blinking light, labelled Aphelion · waking, and a shuttle moves along the orbit towards it. In front, an old painted console with amber screens and switches; a cyan panel is bolted on top with a new cable, and a cyan seam fills a crack in the metal.' }] },
  { id: 'departure-lounge', title: 'Departure lounge', draw: lounge, alt: [{ text: 'A departure lounge. An old split-flap board in amber shows the current stop boarding. A new cyan strip hangs under it on fresh brackets and shows the current section. On the right a new cyan sign hangs over a faded gate sign. A window on the left shows drifting stars, above rows of worn seats.' }] },
  { id: 'baggage-hall', title: 'Baggage hall', draw: baggage, alt: [{ text: 'A baggage hall. A wall of old numbered lockers, a few hanging open, some with new cyan tags bolted on. Suitcases ride a conveyor belt through a new cyan scanner arch, and a cyan strip shows the current stop and section.' }] },
  { id: 'boarding-cabin', title: 'Boarding cabin', draw: cabin, alt: [{ text: 'Inside the shuttle cabin. Old overhead lockers and a row of round portholes with stars drifting past, above worn amber seats with new cyan seat numbers. A fasten-straps sign glows, and running lights pulse along the aisle floor.' }] },
  { id: 'viewport', title: 'Viewport', draw: viewport, alt: [{ text: 'A wide observation window in a heavy riveted frame. Outside, the curve of the station is dotted with amber and cyan lights, and a soft band of light drifts past the stars. An old camera on a tripod stands at the railing.' }] },
  { id: 'pressure-door', title: 'Pressure door and new laboratory', draw: door, alt: [
    { when: { whitelist: ['confirmed'] }, text: 'The pressure door has slid open. Cold white light floods out of a clean new laboratory with a crisp cyan workbench and terminal. The lamp above the door is cyan and the control panel reads: Whitelist confirmed, Discord applied, door open.' },
    { text: 'A battered pressure door with hazard stripes and a stencilled number. New cyan conduits are bolted to its frame. An amber lamp above it blinks, and a cyan control panel reads: Whitelist requested, Discord waiting, door held.' },
  ] },
];

await mkdir(outputDir, { recursive: true });
for (const def of SCENES) {
  const scene = { schema: 1, id: def.id, title: def.title, alt: def.alt, provenance: PROVENANCE,
    layouts: Object.fromEntries(Object.keys(SCENE_LAYOUTS).map(name => [name, def.draw(name)])) };
  validateScene(scene);
  const json = `${JSON.stringify(scene)}\n`;
  await writeFile(new URL(`${def.id}.json`, outputDir), json);
  console.log(def.id, json.length, 'bytes');
}
