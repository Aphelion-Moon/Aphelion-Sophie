/**
 * Paints composed scene frames onto a canvas, one glyph per cell (P42). Only cells that changed since the last frame
 * are redrawn. Block characters are drawn as exact rectangles so the art lines up whatever font is in use. The
 * canvas is decoration: callers mark it aria-hidden and show the scene's alt text instead.
 */
const BLOCKS = Object.freeze({
  '█': [0, 0, 1, 1, 1], '▀': [0, 0, 1, 0.5, 1], '▄': [0, 0.5, 1, 0.5, 1], '▌': [0, 0, 0.5, 1, 1], '▐': [0.5, 0, 0.5, 1, 1],
  '▓': [0, 0, 1, 1, 0.75], '▒': [0, 0, 1, 1, 0.5], '░': [0, 0, 1, 1, 0.25],
});

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ palette: Record<string, string>, background: string, font?: string }} options
 *   palette maps colour names (see SCENE_COLOURS) to CSS colours.
 */
export function createSceneCanvas(canvas, { palette, background, font = 'Cozette, ui-monospace, Consolas, monospace' }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let geometry = null, previous = null;

  /** Sizes the canvas for a grid inside a CSS box; returns the cell size actually used. */
  function resize(cssWidth, cssHeight, cols, rows, pixelRatio = 1) {
    const cellW = Math.max(1, Math.floor((cssWidth / cols) * pixelRatio)), cellH = Math.max(1, Math.floor((cssHeight / rows) * pixelRatio));
    canvas.width = cellW * cols; canvas.height = cellH * rows;
    canvas.style.width = `${(cellW * cols) / pixelRatio}px`; canvas.style.height = `${(cellH * rows) / pixelRatio}px`;
    geometry = { cellW, cellH, cols, rows, size: Math.floor(Math.min(cellH, cellW / 0.6)) };
    previous = null;
    ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
    return geometry;
  }

  function cell(x, y, ch, colourName) {
    const { cellW, cellH, size } = geometry, px = x * cellW, py = y * cellH;
    ctx.fillStyle = background; ctx.fillRect(px, py, cellW, cellH);
    if (ch === ' ') return;
    const colour = palette[colourName] ?? palette.dim;
    const block = BLOCKS[ch];
    if (block) {
      ctx.globalAlpha = block[4]; ctx.fillStyle = colour;
      ctx.fillRect(px + Math.round(block[0] * cellW), py + Math.round(block[1] * cellH), Math.ceil(block[2] * cellW), Math.ceil(block[3] * cellH));
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = colour; ctx.font = `${size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, px + cellW / 2, py + cellH / 2 + 0.5);
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

  return { resize, draw, invalidate: () => { previous = null; } };
}
