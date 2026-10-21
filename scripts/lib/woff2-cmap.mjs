// Reads which characters a WOFF2 font maps to a glyph, using Node's built-in Brotli. Used to check that the pinned
// Shuttle Activity font covers every scene glyph; it parses only the character map and never runs font code.
import { brotliDecompressSync } from 'node:zlib';

const GLYF = 10, LOCA = 11;

function base128(buffer, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buffer[offset + i];
    if (i === 0 && byte === 0x80) throw new Error('WOFF2_INVALID_BASE128');
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return { value, next: offset + i + 1 };
  }
  throw new Error('WOFF2_INVALID_BASE128');
}

/** Returns the decompressed bytes of one table, or null when the font has no such table. */
function woff2Table(font, wanted) {
  if (font.toString('ascii', 0, 4) !== 'wOF2') throw new Error('WOFF2_SIGNATURE');
  if (font.toString('ascii', 4, 8) === 'ttcf') throw new Error('WOFF2_COLLECTION_UNSUPPORTED');
  const numTables = font.readUInt16BE(12), compressedSize = font.readUInt32BE(20);
  let offset = 48, dataOffset = 0, found = null;
  for (let i = 0; i < numTables; i++) {
    const flags = font[offset++], index = flags & 0x3f, version = flags >> 6;
    let tag = index;
    if (index === 63) { tag = font.toString('ascii', offset, offset + 4); offset += 4; }
    const orig = base128(font, offset); offset = orig.next;
    let length = orig.value;
    const transformed = index === GLYF || index === LOCA ? version === 0 : version !== 0;
    if (transformed) { const t = base128(font, offset); offset = t.next; length = t.value; }
    if (tag === wanted && !transformed) found = { start: dataOffset, length };
    dataOffset += length;
  }
  if (!found) return null;
  const data = brotliDecompressSync(font.subarray(offset, offset + compressedSize));
  if (found.start + found.length > data.length) throw new Error('WOFF2_TRUNCATED');
  return data.subarray(found.start, found.start + found.length);
}

/** The set of code points the font maps to a real glyph (not .notdef). */
export function woff2CodePoints(font) {
  const cmap = woff2Table(font, 0);
  if (!cmap) throw new Error('WOFF2_NO_CMAP');
  const covered = new Set();
  const records = cmap.readUInt16BE(2);
  const subtables = [];
  for (let i = 0; i < records; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8), encoding = cmap.readUInt16BE(6 + i * 8), at = cmap.readUInt32BE(8 + i * 8);
    if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) subtables.push(at);
  }
  for (const at of subtables) {
    const format = cmap.readUInt16BE(at);
    if (format === 12) {
      const groups = cmap.readUInt32BE(at + 12);
      for (let g = 0; g < groups; g++) {
        const p = at + 16 + g * 12, start = cmap.readUInt32BE(p), end = cmap.readUInt32BE(p + 4), glyph = cmap.readUInt32BE(p + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) covered.add(c);
      }
    } else if (format === 4) {
      const segX2 = cmap.readUInt16BE(at + 6), ends = at + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(ends + s * 2), start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2), rangeOffset = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = cmap.readUInt16BE(ranges + s * 2 + rangeOffset + (c - start) * 2);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) covered.add(c);
        }
      }
    }
  }
  return covered;
}
