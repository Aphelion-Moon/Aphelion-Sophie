// Renders the rules post's art panels (modules/onboarding/activity-post.js) to PNG images for the Activity host, and records
// their provenance in content/shuttle-activity/rules-post-banner.json. Made by the coding agent at owner direction (decision
// of 21 October 2026; images, owner review of 24 October 2026): a hand-made 5x7 pixel font, block and box characters drawn
// as pixels, the lounge's palette and a faint scanline. No font file, model or image tool; Node's zlib writes the PNG.
//   node scripts/author-rules-post-art.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { POST_ART_COLUMNS, POST_IMAGES, plainArt } from '../modules/onboarding/activity-post.js';
import { SCENE_COLOURS } from '../modules/onboarding/scenes.js';
import { SCENE_BACKGROUND, SCENE_PALETTE } from '../apps/activity/client/palette.js';

/** One character cell is 6 by 12 pixels, drawn 4 times larger; the art keeps two cells of margin each side, one above and below. */
export const CELL = Object.freeze({ width: 6, height: 12, scale: 4, padColumns: 2, padRows: 1 });

// Letters and digits, 5 by 7, sitting on rows 3 to 9 of the cell.
const FONT = {
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'], B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '], D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'], F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ####'], H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: [' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '], J: ['  ###', '   # ', '   # ', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'], L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'], N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '], P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'], R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '], T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '], V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '# # #', ' # # '], X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '], Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  0: [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '], 1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  2: [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'], 3: ['#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '],
  4: ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '], 5: ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  6: ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '], 7: ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  8: [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '], 9: [' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '],
};
// Box lines run through column 2 and row 6 of the cell, so they meet at corners and tees.
const H = 6, V = 2;
const box = (up, down, left, right) => (x, y) => (y === H && ((left && x <= V) || (right && x >= V))) || (x === V && ((up && y <= H) || (down && y >= H)));
const SHAPES = {
  ' ': () => false, '█': () => true, '▀': (x, y) => y < 6, '▄': (x, y) => y >= 6,
  '░': (x, y) => x % 2 === 0 && y % 2 === 0, '▒': (x, y) => (x + y) % 2 === 0, '▓': (x, y) => !(x % 2 === 1 && y % 2 === 1),
  '─': box(false, false, true, true), '│': box(true, true, false, false), '┌': box(false, true, false, true), '┐': box(false, true, true, false),
  '└': box(true, false, false, true), '┘': box(true, false, true, false), '├': box(true, true, false, true), '┤': box(true, true, true, false),
};
/** Whether one pixel of a character's cell is lit. */
function lit(ch, x, y) {
  if (SHAPES[ch]) return SHAPES[ch](x, y);
  const glyph = FONT[ch];
  if (!glyph) throw new Error(`RULES_POST_GLYPH_MISSING ${JSON.stringify(ch)}`);
  return y >= 3 && y < 10 && x < 5 && glyph[y - 3][x] === '#';
}
const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));

/** The art as RGB pixels: { width, height, pixels } (row-major, 3 bytes a pixel). */
export function rasterise(art) {
  const columns = POST_ART_COLUMNS + 2 * CELL.padColumns, rows = art.length + 2 * CELL.padRows;
  const width = columns * CELL.width * CELL.scale, height = rows * CELL.height * CELL.scale, pixels = Buffer.alloc(width * height * 3);
  const background = rgb(SCENE_BACKGROUND);
  for (let i = 0; i < width * height; i++) pixels.set(background, i * 3);
  art.forEach((line, row) => {
    let column = 0;
    for (const [text, key] of line) {
      const colour = rgb(SCENE_PALETTE[SCENE_COLOURS[key]]);
      for (const ch of text) {
        const cx = (column + CELL.padColumns) * CELL.width, cy = (row + CELL.padRows) * CELL.height;
        for (let y = 0; y < CELL.height; y++) for (let x = 0; x < CELL.width; x++) {
          if (!lit(ch, x, y)) continue;
          for (let sy = 0; sy < CELL.scale; sy++) for (let sx = 0; sx < CELL.scale; sx++) {
            pixels.set(colour, (((cy + y) * CELL.scale + sy) * width + (cx + x) * CELL.scale + sx) * 3);
          }
        }
        column++;
      }
    }
  });
  // A faint scanline, as on the Activity's screens: every fourth pixel row a little darker.
  for (let y = 3; y < height; y += 4) for (let i = y * width * 3; i < (y + 1) * width * 3; i++) pixels[i] = Math.round(pixels[i] * 0.82);
  return { width, height, pixels };
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
/** An 8-bit RGB PNG, every row unfiltered. */
export function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..'), blocks = [];
  for (const [id, image] of Object.entries(POST_IMAGES)) {
    const raster = rasterise(image.art), png = encodePng(raster), target = join(root, image.path);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, png);
    blocks.push({ id, path: image.path, width: raster.width, height: raster.height, sha256: sha256(png), artSha256: sha256(plainArt(image.art).join('\n')), alt: image.alt });
    console.log(`${image.path} ${raster.width}x${raster.height} ${png.length} bytes`);
  }
  writeFileSync(join(root, 'content/shuttle-activity/rules-post-banner.json'), `${JSON.stringify({
    schemaVersion: 3, id: 'rules-post-banner', title: 'Shuttle Activity rules post art (station broadcast)',
    source: 'modules/onboarding/activity-post.js (POST_LOGO, POST_BOARD), rendered by scripts/author-rules-post-art.mjs',
    hashOf: 'sha256: the PNG bytes; artSha256: the art\'s plain characters, lines joined with a line feed',
    columns: POST_ART_COLUMNS, blocks,
    provenance: {
      author: 'Made by the coding agent (Claude) at owner direction',
      created: '2026-10-24',
      replaces: 'The 32-column departures sign of 22 October 2026 (sha256 cc99466b28b4eef9d2ae996bde3107b24841e2ee1a8a7855cfde13700ab3875b) and the ANSI-coloured code blocks of the first station broadcast',
      decision: 'docs/decisions/0001-owner-policy.md (The Shuttle becomes an Activity, D2 and D5; the station broadcast rules post and its art as images, 24 October 2026)',
      generator: 'Written by hand: the art in the module, a 5x7 pixel font and block and box shapes in the script; colours from the Activity scene palette. No font file, model or image tool.',
      rights: 'Machine-made art; it may not attract copyright in every jurisdiction. Published with the repository.',
    },
  }, null, 2)}\n`);
}
