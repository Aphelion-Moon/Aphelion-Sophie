/**
 * Paints composed scene frames onto a canvas, one glyph per cell (P42). Only cells that changed since the last frame
 * are redrawn. Block and line characters are drawn as exact shapes that reach the cell edges, so borders join and
 * shading lines up whatever font is in use. Other glyphs are measured against the font and stretched to fill their
 * cell, so text keeps the grid's spacing. The canvas is decoration: callers mark it aria-hidden and show the scene's
 * alt text instead.
 */
const BLOCKS = Object.freeze({
  '█': [0, 0, 1, 1, 1], '▀': [0, 0, 1, 0.5, 1], '▄': [0, 0.5, 1, 0.5, 1], '▌': [0, 0, 0.5, 1, 1], '▐': [0.5, 0, 0.5, 1, 1],
  '▓': [0, 0, 1, 1, 0.75], '▒': [0, 0, 1, 1, 0.5], '░': [0, 0, 1, 1, 0.25],
});
/** Single-line characters as arms reaching north, east, south and west from the cell centre. */
const SINGLE = Object.freeze({
  '─': [0, 1, 0, 1], '│': [1, 0, 1, 0], '┌': [0, 1, 1, 0], '┐': [0, 0, 1, 1], '└': [1, 1, 0, 0], '┘': [1, 0, 0, 1],
  '├': [1, 1, 1, 0], '┤': [1, 0, 1, 1], '┬': [0, 1, 1, 1], '┴': [1, 1, 0, 1], '┼': [1, 1, 1, 1],
  '╭': [0, 1, 1, 0], '╮': [0, 0, 1, 1], '╰': [1, 1, 0, 0], '╯': [1, 0, 0, 1],
});
const DOUBLE = new Set(['═', '║', '╔', '╗', '╚', '╝', '╟', '╢', '╪']);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ palette: Record<string, string>, background: string, font?: string }} options
 *   palette maps colour names (see SCENE_COLOURS) to CSS colours.
 */
export function createSceneCanvas(canvas, { palette, background, font = 'Cozette, ui-monospace, Consolas, monospace' }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let geometry = null, previous = null;

  /** Measures the font so each glyph fills its cell: size from the font's height, stretch from its width. */
  function measure() {
    if (!geometry) return;
    ctx.font = `100px ${font}`;
    const m = ctx.measureText('M');
    const ascent = (m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 80) / 100;
    const descent = (m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 20) / 100;
    const advance = (m.width || 60) / 100;
    const size = Math.max(1, Math.floor(geometry.cellH / (ascent + descent)));
    geometry.size = size;
    geometry.stretch = Math.min(2.5, Math.max(0.5, geometry.cellW / (advance * size)));
    geometry.baseline = Math.round((geometry.cellH - (ascent + descent) * size) / 2 + ascent * size);
    geometry.stroke = Math.max(1, Math.round(geometry.cellH * 0.08));
    geometry.gapY = Math.max(geometry.stroke + 1, Math.round(geometry.cellH * 0.14));
    geometry.gapX = Math.max(geometry.stroke + 1, Math.round(geometry.cellW * 0.22));
  }

  /** Sizes the canvas for a grid inside a CSS box; returns the cell geometry actually used. */
  function resize(cssWidth, cssHeight, cols, rows, pixelRatio = 1) {
    const cellW = Math.max(1, Math.floor((cssWidth / cols) * pixelRatio)), cellH = Math.max(1, Math.floor((cssHeight / rows) * pixelRatio));
    canvas.width = cellW * cols; canvas.height = cellH * rows;
    canvas.style.width = `${(cellW * cols) / pixelRatio}px`; canvas.style.height = `${(cellH * rows) / pixelRatio}px`;
    geometry = { cellW, cellH, cols, rows };
    measure();
    previous = null;
    ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
    return geometry;
  }

  /** Draws line characters as strokes kept inside the cell, meeting their neighbours at the cell edge. */
  function lines(ch, px, py) {
    const { cellW, cellH, stroke: t, gapX, gapY } = geometry, half = Math.floor(t / 2);
    const cx = px + Math.floor(cellW / 2), cy = py + Math.floor(cellH / 2), L = px, R = px + cellW, T = py, B = py + cellH;
    const H = (y, x0, x1) => { const a = Math.max(L, Math.min(x0, x1) - half), b = Math.min(R, Math.max(x0, x1) + t - half); ctx.fillRect(a, y - half, b - a, t); };
    const V = (x, y0, y1) => { const a = Math.max(T, Math.min(y0, y1) - half), b = Math.min(B, Math.max(y0, y1) + t - half); ctx.fillRect(x - half, a, t, b - a); };
    const arms = SINGLE[ch];
    if (arms) {
      if (arms[0]) V(cx, T, cy);
      if (arms[1]) H(cy, cx, R);
      if (arms[2]) V(cx, cy, B);
      if (arms[3]) H(cy, L, cx);
      return;
    }
    const a = cy - gapY, b = cy + gapY, l = cx - gapX, r = cx + gapX;
    switch (ch) {
      case '═': H(a, L, R); H(b, L, R); break;
      case '║': V(l, T, B); V(r, T, B); break;
      case '╔': H(a, l, R); H(b, r, R); V(l, a, B); V(r, b, B); break;
      case '╗': H(a, L, r); H(b, L, l); V(r, a, B); V(l, b, B); break;
      case '╚': H(b, l, R); H(a, r, R); V(l, T, b); V(r, T, a); break;
      case '╝': H(b, L, r); H(a, L, l); V(r, T, b); V(l, T, a); break;
      case '╟': V(l, T, B); V(r, T, B); H(cy, r, R); break;
      case '╢': V(l, T, B); V(r, T, B); H(cy, L, l); break;
      case '╪': H(a, L, R); H(b, L, R); V(cx, T, B); break;
    }
  }

  function cell(x, y, ch, colourName) {
    const { cellW, cellH } = geometry, px = x * cellW, py = y * cellH;
    ctx.fillStyle = background; ctx.fillRect(px, py, cellW, cellH);
    if (ch === ' ') return;
    // Every glyph stays inside its own cell: an edge drawn past it would never be cleared, since unchanged neighbours
    // are not redrawn (it showed as thin coloured lines beside changing text).
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, cellW, cellH); ctx.clip();
    try { glyph(ch, colourName, px, py); } finally { ctx.restore(); }
  }
  function glyph(ch, colourName, px, py) {
    const { cellW, cellH } = geometry;
    const colour = palette[colourName] ?? palette.dim;
    ctx.fillStyle = colour;
    const block = BLOCKS[ch];
    if (block) {
      ctx.globalAlpha = block[4];
      ctx.fillRect(px + Math.round(block[0] * cellW), py + Math.round(block[1] * cellH), Math.ceil(block[2] * cellW), Math.ceil(block[3] * cellH));
      ctx.globalAlpha = 1;
      return;
    }
    if (SINGLE[ch] || DOUBLE.has(ch)) { lines(ch, px, py); return; }
    if (ch === '■' || ch === '□') {
      // A square centred in the cell (the font's own is wider than a cell and would be cut by the clip).
      const side = Math.max(3, Math.round(Math.min(cellW, cellH) * 0.6)), x0 = px + Math.floor((cellW - side) / 2), y0 = py + Math.floor((cellH - side) / 2);
      if (ch === '■') ctx.fillRect(x0, y0, side, side);
      else { const t = geometry.stroke; ctx.fillRect(x0, y0, side, t); ctx.fillRect(x0, y0 + side - t, side, t); ctx.fillRect(x0, y0, t, side); ctx.fillRect(x0 + side - t, y0, t, side); }
      return;
    }
    if (ch === '╱' || ch === '╲') {
      ctx.strokeStyle = colour; ctx.lineWidth = geometry.stroke;
      ctx.beginPath();
      if (ch === '╱') { ctx.moveTo(px, py + cellH); ctx.lineTo(px + cellW, py); } else { ctx.moveTo(px, py); ctx.lineTo(px + cellW, py + cellH); }
      ctx.stroke();
      return;
    }
    ctx.font = `${geometry.size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.setTransform(geometry.stretch, 0, 0, 1, px + cellW / 2, py + geometry.baseline);
    ctx.fillText(ch, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** @param {{ cols: number, rows: number, glyphs: string[], colours: string[] }} frame  @param {Record<string,string>} names */
  function draw(frame, names) {
    if (!geometry || geometry.cols !== frame.cols || geometry.rows !== frame.rows) return false;
    for (let y = 0; y < frame.rows; y++) {
      const glyphs = [...frame.glyphs[y]], keys = [...frame.colours[y]];
      const before = previous && [...previous.glyphs[y]], beforeKeys = previous && [...previous.colours[y]];
      for (let x = 0; x < frame.cols; x++) {
        if (before && before[x] === glyphs[x] && beforeKeys[x] === keys[x]) continue;
        cell(x, y, glyphs[x], names[keys[x]]);
      }
    }
    previous = frame;
    return true;
  }

  /** Call once the web font has loaded: re-measures and redraws every cell. */
  function fontChanged() { measure(); previous = null; }

  return { resize, draw, fontChanged, invalidate: () => { previous = null; } };
}
