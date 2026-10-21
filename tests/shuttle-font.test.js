import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { woff2CodePoints } from '../scripts/lib/woff2-cmap.mjs';
import { SCENE_GLYPHS } from '../modules/onboarding/scenes.js';

const root = new URL('../', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = JSON.parse(await readFile(new URL('legal/DEPENDENCIES.json', root), 'utf8')).activityFont;

test('D4 the bundled Activity font is the pinned Cozette release with its MIT notice', async () => {
  assert.equal(pin.license, 'MIT'); assert.equal(pin.version, '1.30.0'); assert.equal(pin.automaticUpdates, false);
  const font = await readFile(new URL(pin.path, root));
  assert.equal(font.length, pin.bytes); assert.equal(sha256(font), pin.sha256);
  const notice = await readFile(new URL(pin.notice, root));
  assert.equal(sha256(notice), pin.noticeSha256); assert.match(notice.toString('utf8'), /^MIT License/);
});

test('D4 Cozette maps every glyph a scene may use, and every committed scene stays within that set', async () => {
  const covered = woff2CodePoints(await readFile(new URL(pin.path, root)));
  const missing = [...SCENE_GLYPHS].filter(ch => !covered.has(ch.codePointAt(0)));
  assert.deepEqual(missing, []);
  assert.equal(covered.has('한'.codePointAt(0)), false, 'the coverage check can report a missing glyph');
  const dir = new URL('content/shuttle-activity/scenes/', root);
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.json'))) {
    const scene = JSON.parse(await readFile(new URL(name, dir), 'utf8'));
    for (const layout of Object.values(scene.layouts)) for (const layer of layout.layers) for (const frame of layer.frames)
      for (const row of frame.text) for (const ch of row) assert.ok(covered.has(ch.codePointAt(0)), `${name}: ${ch}`);
  }
});
