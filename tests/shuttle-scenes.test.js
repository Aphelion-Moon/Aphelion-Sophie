import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { SCENE_COLOURS, SCENE_GLYPHS, SCENE_LAYOUTS, composeScene, sceneAlt, sceneState, validateScene } from '../modules/onboarding/scenes.js';

const dir = new URL('../content/shuttle-activity/scenes/', import.meta.url);
const scenes = await Promise.all((await readdir(dir)).filter(name => name.endsWith('.json')).sort()
  .map(async name => [name, JSON.parse(await readFile(new URL(name, dir), 'utf8'))]));
const STATE = { stopTitle: 'Synthetic stop', stopNumber: 2, stopCount: 5, section: 1, sections: 3, whitelist: 'none' };

test('P42 every committed scene validates, has both layouts, provenance and alt text', () => {
  assert.ok(scenes.length >= 3);
  for (const [name, scene] of scenes) {
    assert.equal(validateScene(scene), scene, name);
    assert.equal(`${scene.id}.json`, name);
    assert.deepEqual(Object.keys(scene.layouts).sort(), Object.keys(SCENE_LAYOUTS).sort());
    assert.match(scene.provenance.decision, /0001-owner-policy/);
    assert.ok(sceneAlt(scene, STATE).length > 20);
  }
});

test('P42 composed frames are exact grids of allowed glyphs and colours, and deterministic', () => {
  for (const [, scene] of scenes) for (const [layout, grid] of Object.entries(SCENE_LAYOUTS)) {
    for (const whitelist of ['none', 'requested', 'confirmed']) {
      const input = { time: 7.25, state: { ...STATE, whitelist, doorOpen: 0.5 } };
      const frame = composeScene(scene, layout, input);
      assert.equal(frame.glyphs.length, grid.rows); assert.equal(frame.colours.length, grid.rows);
      for (let y = 0; y < grid.rows; y++) {
        assert.equal([...frame.glyphs[y]].length, grid.cols); assert.equal([...frame.colours[y]].length, grid.cols);
        for (const ch of frame.glyphs[y]) assert.ok(SCENE_GLYPHS.has(ch), `${scene.id} glyph ${ch}`);
        for (const key of frame.colours[y]) assert.ok(Object.hasOwn(SCENE_COLOURS, key), `${scene.id} colour ${key}`);
      }
      assert.deepEqual(composeScene(scene, layout, input), frame);
    }
  }
});

test('P42 motion off gives one still frame whatever the clock says', () => {
  for (const [, scene] of scenes) {
    const a = composeScene(scene, 'landscape', { time: 0, state: STATE, motion: false });
    const b = composeScene(scene, 'landscape', { time: 93.7, state: STATE, motion: false });
    assert.deepEqual(a, b, scene.id);
  }
});

test('P42 the pressure door stays shut and says so until Whitelist is confirmed', () => {
  const scene = scenes.find(([, s]) => s.id === 'pressure-door')[1];
  const text = state => composeScene(scene, 'landscape', { time: 1, state: { ...STATE, ...state } }).glyphs.join('\n');
  const waiting = text({ whitelist: 'requested', doorOpen: 1 });
  assert.match(waiting, /DOOR\s+» HELD/); assert.doesNotMatch(waiting, /@/, 'no laboratory light before confirmation, even if doorOpen is set');
  assert.equal(waiting, text({ whitelist: 'requested', doorOpen: 0 }), 'the leaves stay shut before confirmation');
  const open = text({ whitelist: 'confirmed', doorOpen: 1 });
  assert.match(open, /DOOR\s+» OPEN/); assert.match(open, /@/);
  assert.match(sceneAlt(scene, { whitelist: 'requested' }), /door held/); assert.match(sceneAlt(scene, { whitelist: 'confirmed' }), /slid open/);
});

test('P42 before any request the door reports exactly that, and the title panel never shows an empty run', () => {
  const door = scenes.find(([, s]) => s.id === 'pressure-door')[1];
  const idle = composeScene(door, 'landscape', { state: { whitelist: 'none' } }).glyphs.join('\n');
  assert.match(idle, /WHITELIST\s+» NOT REQUESTED/); assert.doesNotMatch(idle, /» REQUESTED|WAITING/);
  assert.match(idle, /PRESSURE DOOR 07 · KEEP CLEAR/, 'worn stencil letters fade but stay readable');
  assert.match(sceneAlt(door, { whitelist: 'none' }), /not requested/);
  const portrait = composeScene(door, 'portrait', { state: { whitelist: 'none' } }).glyphs.join('\n');
  assert.doesNotMatch(portrait, /WAIT/);
  const hangar = scenes.find(([, s]) => s.id === 'hangar-viewport')[1];
  for (const layout of ['landscape', 'portrait']) {
    const empty = composeScene(hangar, layout, { state: {} }).glyphs.join('\n');
    assert.match(empty, /READY TO BOARD/); assert.doesNotMatch(empty, /STOP 0/);
    const running = composeScene(hangar, layout, { state: { stopNumber: 3, stopCount: 5 } }).glyphs.join('\n');
    assert.match(running, /» STOP 03 \/ 05/); assert.doesNotMatch(running, /READY TO BOARD/);
  }
  const lounge = scenes.find(([, s]) => s.id === 'departure-lounge')[1];
  assert.match(composeScene(lounge, 'landscape', { state: { ...STATE, stopNumber: 1 }, motion: false }).glyphs.join('\n'), /║ 01  Synthetic stop/);
});

test('P42 templates pad only numbers and conditions take only known states', () => {
  const base = structuredClone(scenes[0][1]);
  const add = (fx, code) => { const s = structuredClone(base); s.layouts.landscape.effects.push(fx); assert.throws(() => validateScene(s), new RegExp(code)); };
  add({ kind: 'text', id: 'pad-title', x: 0, y: 0, width: 10, template: '{stopTitle:2}', colour: 'a' }, 'INVALID_SCENE_TEMPLATE');
  add({ kind: 'text', id: 'raw-state', x: 0, y: 0, width: 10, template: '{whitelist}', colour: 'a' }, 'INVALID_SCENE_TEMPLATE');
  add({ kind: 'text', id: 'wide-pad', x: 0, y: 0, width: 10, template: '{section:4}', colour: 'a' }, 'INVALID_SCENE_TEMPLATE');
  add({ kind: 'blink', id: 'bad-stop', region: [0, 0, 1, 1], hz: 1, on: 'a', off: 'A', when: { stop: ['maybe'] } }, 'INVALID_SCENE_CONDITION');
  add({ kind: 'blink', id: 'empty-when', region: [0, 0, 1, 1], hz: 1, on: 'a', off: 'A', when: {} }, 'INVALID_SCENE_CONDITION');
  assert.equal(sceneState({ stopNumber: 2, stopCount: 0 }).stop, 'none');
  assert.equal(sceneState({ stopNumber: 2, stopCount: 5 }).stop, 'some');
});

test('P42 run state is normalised for drawing and never interpreted as markup', () => {
  const s = sceneState({ stopTitle: '“Pack” <b>Bags</b> 🚀', stopNumber: 999, whitelist: 'granted', doorOpen: 7, extra: 'ignored' });
  assert.equal(s.stopTitle, '"Pack" <b>Bags</b> ??');
  assert.equal(s.stopNumber, 0); assert.equal(s.whitelist, 'none'); assert.equal(s.doorOpen, 0);
  assert.equal(sceneState({ whitelist: 'confirmed', doorOpen: 7 }).doorOpen, 1);
  assert.equal(Object.hasOwn(s, 'extra'), false);
  const lounge = scenes.find(([, x]) => x.id === 'departure-lounge')[1];
  const frame = composeScene(lounge, 'landscape', { state: { ...STATE, stopTitle: '<script>' } });
  assert.match(frame.glyphs.join('\n'), /<script>/);
});

test('P42 the validator refuses code-like fields, unknown glyphs, fast flashes and oversized parts', () => {
  const base = structuredClone(scenes[0][1]);
  const mutate = (fn, code) => { const s = structuredClone(base); fn(s); assert.throws(() => validateScene(s), new RegExp(code)); };
  mutate(s => { s.script = 'alert(1)'; }, 'INVALID_SCENE_FIELDS');
  mutate(s => { s.schema = 2; }, 'UNSUPPORTED_SCENE_SCHEMA');
  mutate(s => { s.layouts.landscape.layers[0].frames[0].text[0] = '🚀'; s.layouts.landscape.layers[0].frames[0].colours[0] = '.'; }, 'INVALID_SCENE_GLYPH|INVALID_SCENE_SIZE');
  mutate(s => { s.layouts.landscape.effects.push({ kind: 'blink', id: 'fast', region: [0, 0, 1, 1], hz: 5, on: 'a', off: 'A' }); }, 'SCENE_FLASH_TOO_FAST');
  mutate(s => { s.layouts.landscape.effects.push({ kind: 'flicker', id: 'wide', region: [0, 0, 120, 10], hz: 1, chance: 0.5, colour: 'd' }); }, 'SCENE_FLICKER_TOO_LARGE');
  mutate(s => { s.layouts.landscape.effects.push({ kind: 'text', id: 'leak', x: 0, y: 0, width: 10, template: '{memberId}', colour: 'a' }); }, 'INVALID_SCENE_TEMPLATE');
  mutate(s => { s.layouts.landscape.effects.push({ kind: 'shell', id: 'nope' }); }, 'INVALID_SCENE_EFFECT');
  mutate(s => { s.layouts.landscape.layers.push({ ...s.layouts.landscape.layers[0] }); }, 'INVALID_SCENE_ID');
  mutate(s => { s.layouts.landscape.layers[0].x = 119; }, 'INVALID_SCENE_SIZE');
  mutate(s => { s.alt = [{ text: 'Only a conditional entry.', when: { whitelist: ['confirmed'] } }]; }, 'INVALID_SCENE_ALT');
  mutate(s => { delete s.layouts.portrait; }, 'INVALID_SCENE_LAYOUTS');
});
