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
  assert.match(waiting, /DOOR\s+» HELD/); assert.doesNotMatch(waiting, /CONCOURSE/, 'no view of the concourse before confirmation, even if doorOpen is set');
  assert.equal(waiting, text({ whitelist: 'requested', doorOpen: 0 }), 'the leaves stay shut before confirmation');
  const open = text({ whitelist: 'confirmed', doorOpen: 1 });
  assert.match(open, /DOOR\s+» OPEN/); assert.match(open, /CONCOURSE/);
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
    assert.match(empty, /LINKING/); assert.doesNotMatch(empty, /STOP 0|READY TO BOARD/);
    assert.match(composeScene(hangar, layout, { state: { link: 'ready' } }).glyphs.join('\n'), /READY TO BOARD/);
    const running = composeScene(hangar, layout, { state: { stopNumber: 3, stopCount: 5, link: 'ready' } }).glyphs.join('\n');
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
  mutate(s => { s.layouts.landscape.effects.push({ kind: 'flicker', id: 'wide', region: [0, 0, 96, 10], hz: 1, chance: 0.5, colour: 'd' }); }, 'SCENE_FLICKER_TOO_LARGE');
  mutate(s => { s.layouts.landscape.effects.push({ kind: 'text', id: 'leak', x: 0, y: 0, width: 10, template: '{memberId}', colour: 'a' }); }, 'INVALID_SCENE_TEMPLATE');
  mutate(s => { s.layouts.landscape.effects.push({ kind: 'shell', id: 'nope' }); }, 'INVALID_SCENE_EFFECT');
  mutate(s => { s.layouts.landscape.layers.push({ ...s.layouts.landscape.layers[0] }); }, 'INVALID_SCENE_ID');
  mutate(s => { s.layouts.landscape.layers[0].x = 95; }, 'INVALID_SCENE_SIZE');
  mutate(s => { s.alt = [{ text: 'Only a conditional entry.', when: { whitelist: ['confirmed'] } }]; }, 'INVALID_SCENE_ALT');
  mutate(s => { delete s.layouts.portrait; }, 'INVALID_SCENE_LAYOUTS');
});

test('P42 the title panel says what the server reported: never ready to board when closed, in a channel or held', () => {
  const hangar = scenes.find(([, s]) => s.id === 'hangar-viewport')[1];
  const panel = link => composeScene(hangar, 'landscape', { state: { link } }).glyphs.join('\n');
  for (const [link, words] of [['closed', /NOT BOARDING YET/], ['channel', /FINISH IN CHANNEL/], ['held', /BOARDING HELD/], ['arrived', /ARRIVED/], ['offline', /NO SIGNAL/]]) {
    assert.match(panel(link), words, link); assert.doesNotMatch(panel(link), /READY TO BOARD/, link);
  }
});

test('P43 beats stage the section being read and fall back to the plain scene', () => {
  const lounge = scenes.find(([, s]) => s.id === 'departure-lounge')[1];
  const at = beat => composeScene(lounge, 'landscape', { state: { ...STATE, beat }, motion: false }).glyphs.join('\n');
  assert.match(at('amenities'), /#open-a-ticket/); assert.doesNotMatch(at('none'), /#open-a-ticket/);
  assert.match(at('meridian'), /MERIDIAN RIFT/); assert.doesNotMatch(at('meridian'), /MINING SHUTTLE/);
  assert.equal(at('not-a-beat'), at('none'));
  for (const [, scene] of scenes) for (const beat of scene.beats ?? []) assert.match(beat, /^[a-z][a-z0-9-]*$/);
  const stray = { id: 'stray', x: 0, y: 0, frames: [{ text: ['x'], colours: ['a'] }], when: { beat: ['undeclared'] } };
  assert.throws(() => validateScene({ ...lounge, layouts: { ...lounge.layouts, landscape: { ...lounge.layouts.landscape,
    layers: [...lounge.layouts.landscape.layers, stray] } } }), error => error.code === 'INVALID_SCENE_CONDITION');
});

test('P43 sprites cross only in their window, never with motion off, and stay small', () => {
  const lounge = scenes.find(([, s]) => s.id === 'departure-lounge')[1];
  const ian = lounge.layouts.landscape.effects.find(fx => fx.id === 'ian');
  const start = ian.every - (ian.offset % ian.every);
  const frame = (time, motion) => composeScene(lounge, 'landscape', { time, state: STATE, motion }).glyphs.join('\n');
  assert.match(frame(start + ian.duration / 2, true), /~\(____\/ o>/);
  assert.doesNotMatch(frame(start + ian.duration + 5, true), /\(____\/.o>/);
  assert.doesNotMatch(frame(start + ian.duration / 2, false), /\(____\/.o>/);
  const { fps: _fps, ...still } = ian;
  const huge = { ...still, id: 'huge', frames: [{ text: Array(9).fill('x'), colours: Array(9).fill('a') }] };
  assert.throws(() => validateScene({ ...lounge, layouts: { ...lounge.layouts, landscape: { ...lounge.layouts.landscape,
    effects: [...lounge.layouts.landscape.effects, huge] } } }), error => error.code === 'INVALID_SCENE_SPRITE');
});

/** A synthetic scene: one blank layer and the given landscape effects, to test one effect at a time. */
function synthetic(effects, beats) {
  const blank = { layers: [{ id: 'base', x: 0, y: 0, frames: [{ text: ['.'], colours: ['d'] }] }], effects: [] };
  return validateScene({ schema: 1, id: 'synthetic', title: 'Synthetic', ...(beats ? { beats } : {}), alt: [{ text: 'A synthetic test scene.' }],
    provenance: scenes[0][1].provenance, layouts: { landscape: { ...blank, effects }, portrait: blank } });
}
const grid = (scene, input) => composeScene(scene, 'landscape', { ...input, state: { ...STATE, ...input.state } }).glyphs;
const cells = (row, from, to) => [...row].slice(from, to).join('');
const one = (text, key = 'a') => ({ text: [text], colours: [key.repeat([...text].length)] });
const rejects = (effect, code, beats) => assert.throws(() => synthetic([effect], beats), error => error.code === code, effect.id);

const BELT = { kind: 'conveyor', id: 'belt', y: 10, from: 0, to: 60, gate: 30, gateWidth: 4, speed: 10, spacing: 30,
  items: [{ art: one('[A]'), weight: '12.0 KG', divert: false }, { art: one('[B]'), weight: '9.5 KG', divert: true }],
  tags: { '*': { before: ['a1', 'b1'], after: ['a2', ''], beforeColour: 'p', afterColour: '4' },
    rush: { before: ['r1', 'r2'], after: ['r3', ''], beforeColour: 'p', afterColour: '4' } },
  chute: [40, 20], readout: { x: 30, y: 5, width: 8, colour: 'a', deniedColour: 'p' } };

test('P44 a conveyor carries each item at one speed through its gate, and a refused item leaves the belt for the chute', () => {
  const scene = synthetic([BELT], ['rush']), at = (time, beat = 'none') => grid(scene, { time, state: { beat } });
  // A rides the belt ten cells a second with its own tag; B was refused at the gate and is on its way to the chute.
  let g = at(0.5);
  assert.equal(cells(g[11], 5, 8), '[A]'); assert.equal(cells(g[10], 5, 7), 'a1');
  assert.equal(cells(g[12], 35, 38), '[B]', 'off the belt, heading down to the chute');
  g = at(1);
  assert.equal(cells(g[11], 10, 13), '[A]'); assert.equal(cells(g[16], 37, 40), '[B]');
  assert.doesNotMatch(g.join('\n'), /b1|b2/, 'a refused item loses its tag once it leaves the belt');
  g = at(1.5);
  assert.equal(cells(g[11], 15, 18), '[A]'); assert.doesNotMatch(g.join('\n'), /\[B\]/, 'gone down the chute');
  // Past the gate an item wears its after tag; the tags follow the section being read.
  g = at(3.5);
  assert.equal(cells(g[11], 35, 38), '[A]'); assert.equal(cells(g[10], 35, 37), 'a2'); assert.equal(cells(g[10], 5, 7), 'b1');
  g = at(3.5, 'rush');
  assert.equal(cells(g[10], 35, 37), 'r3'); assert.equal(cells(g[10], 5, 7), 'r2');
  // Inside the gate (and behind its pillars) an item is out of sight.
  assert.doesNotMatch(at(3).join('\n'), /\[A\]/);
});

test('P44 a tag changes column by column as its item comes out of the gate, not all at once when it is clear', () => {
  const wide = { ...BELT, items: [{ ...BELT.items[0], art: one('[AAAAAAAA]') }, BELT.items[1]],
    tags: { '*': { ...BELT.tags['*'], before: ['abcdefghij', 'b1'], after: ['ABCDEFGHIJ', ''] }, rush: BELT.tags.rush } };
  const g = grid(synthetic([wide], ['rush']), { time: 2.7, state: { beat: 'none' } });
  // The bag spans columns 27 to 36: the two still left of the gate read the before tag, the two already out the after tag.
  assert.equal(cells(g[11], 27, 29), '[A'); assert.equal(cells(g[11], 35, 37), 'A]');
  assert.equal(cells(g[10], 27, 29), 'ab'); assert.equal(cells(g[10], 35, 37), 'IJ');
});

test('P44 the conveyor readout shows the item inside the gate, exactly while it is inside', () => {
  const scene = synthetic([BELT], ['rush']), readout = time => cells(grid(scene, { time })[5], 30, 38);
  assert.equal(readout(0), 'DENIED  ', 'B is in the gate at the start');
  assert.equal(readout(2), '- - -   ', 'nothing in the gate');
  assert.equal(readout(3), '12.0 KG ', 'A is in the gate');
  assert.equal(readout(3.25), '12.0 KG '); assert.equal(readout(3.35), '- - -   ', 'A has left the gate (by its centre)');
  // With motion off items rest at their spacing, whatever the clock says.
  const still = time => composeScene(scene, 'landscape', { time, state: STATE, motion: false }).glyphs;
  assert.deepEqual(still(0), still(51.3)); assert.equal(cells(still(0)[11], 0, 3), '[A]'); assert.equal(cells(still(0)[5], 30, 36), 'DENIED');
});

test('P44 the conveyor is bounded: enough items to fill the belt, tags only for declared beats, a chute on the grid', () => {
  rejects({ ...BELT, spacing: 20 }, 'INVALID_SCENE_CONVEYOR', ['rush']);
  rejects({ ...BELT, tags: { ...BELT.tags, other: BELT.tags.rush } }, 'INVALID_SCENE_CONVEYOR', ['rush']);
  rejects({ ...BELT, tags: { rush: BELT.tags.rush } }, 'INVALID_SCENE_CONVEYOR', ['rush']);
  rejects({ ...BELT, items: [BELT.items[0], { ...BELT.items[1], art: one('[TOO-WIDE-BAG]') }] }, 'INVALID_SCENE_CONVEYOR', ['rush']);
  rejects({ ...BELT, chute: [200, 5] }, 'INVALID_SCENE_CONVEYOR', ['rush']);
  rejects({ ...BELT, tags: { '*': { ...BELT.tags['*'], before: ['a1'] } } }, 'INVALID_SCENE_CONVEYOR', ['rush']);
});

test('P44 the baggage belt: Meridian for SS 13 bags and Wolfgate for SS 14 while migrating; refused bags are labelled for the section and go to disposals', () => {
  const hall = scenes.find(([, s]) => s.id === 'baggage-hall')[1];
  const SS13 = ['BUBBER', 'SPLURT', 'NOVA', 'OCULIS', 'RATWOOD', 'MARINES'], SS14 = ['MONOLITH', 'HARDLIGHT', 'AFTERLIGHT', 'FRONTIER', 'WAYFARER'];
  for (const layout of ['landscape', 'portrait']) {
    const belt = hall.layouts[layout].effects.find(fx => fx.kind === 'conveyor');
    assert.equal(belt.items.filter(item => item.divert).length, 2, layout);
    const { before, after } = belt.tags.migrating;
    belt.items.forEach((item, i) => assert.equal(after[i], item.divert ? '' : SS13.includes(before[i]) ? 'MERIDIAN' : SS14.includes(before[i]) ? 'WOLFGATE' : '?', `${layout} ${before[i]}`));
    for (const origin of [...SS13, ...SS14]) assert.ok(before.includes(origin), `${layout} ${origin}`);
    const refused = beat => belt.items.flatMap((item, i) => item.divert ? [belt.tags[beat].before[i]] : []);
    assert.deepEqual(refused('*'), ['CONTRABAND', 'TOXICITY']); assert.deepEqual(refused('migrating'), ['BIGOTRY', 'BAN DODGE']);
    assert.deepEqual(refused('past'), ['GRUDGES', 'OLD DRAMA']); assert.deepEqual(refused('looc'), ['METAGAME', 'ASSUMPTION']);
    assert.ok(belt.tags['*'].after.every((tag, i) => tag === (belt.items[i].divert ? '' : 'OK')), layout);
    // The chute point is inside the disposal's mouth, and bags rest on the belt with motion off.
    const still = composeScene(hall, layout, { state: STATE, motion: false }).glyphs;
    assert.equal([...still[belt.chute[1]]][belt.chute[0]], '_', `${layout} chute`); assert.match(still.join('\n'), /DISPOSAL/);
    assert.match(still.join('\n'), /\[====\]|\[▒▒▒▒\]|\[▓▓▓▓\]/, layout);
    // Over a run the scale reads weights and refusals, and both destinations go past.
    const seen = Array.from({ length: 160 }, (_, i) => composeScene(hall, layout, { time: i / 4, state: { ...STATE, beat: 'migrating' } }).glyphs.join('\n')).join('\n');
    for (const word of ['DENIED', ' KG', 'MERIDIAN', 'WOLFGATE']) assert.ok(seen.includes(word), `${layout} ${word}`);
  }
  // The UPSTREAM bag (BLASTWAVE until 24 October 2026) stands on the floor; its fire, the firebot, foam, smoke and spark are timed sprites (see
  // T-SCENE-DEPTH-05), and nothing in the cycle flashes faster than a flicker.
  const fire = hall.layouts.landscape.layers.find(item => item.id === 'blastwave');
  assert.ok(fire.front && fire.frames.length === 1 && fire.frames[0].text.join('').includes('[UPSTREAM ]'));
  const cycle = hall.layouts.landscape.effects.filter(fx => fx.kind === 'sprite' && /^(blastwave-|firebot)/.test(fx.id));
  assert.deepEqual(cycle.map(fx => fx.id).sort(), ['blastwave-flames', 'blastwave-foam', 'blastwave-smoke', 'blastwave-spark', 'firebot']);
  assert.ok(cycle.every(fx => fx.every === 24 && (fx.fps ?? 0) <= 4));
});

const TALK = { kind: 'dialogue', id: 'talk', speakers: [[20, 20], [40, 20]], width: 16, style: 'say', line: 2, pause: 1, colours: 'ca',
  exchanges: [[[0, 'Is this seat free?'], [1, 'It is.']], [[0, 'Thanks!']]] };

test('P44 a dialogue shows one line at a time in a bubble over whoever is speaking, then pauses and moves on', () => {
  const scene = synthetic([TALK]), at = (time, extra = {}) => grid(scene, { time, ...extra });
  let g = at(0.5);
  assert.equal(cells(g[17], 15, 28), '"Is this seat'); assert.equal(cells(g[18], 15, 21), 'free?"'); assert.equal([...g[19]][20], '╲');
  g = at(2.5);
  assert.equal(cells(g[18], 37, 45), '"It is."'); assert.equal([...g[19]][40], '╱');
  assert.doesNotMatch(at(4.5).join('\n'), /"/, 'a pause between exchanges');
  assert.match(at(5.5).join('\n'), /"Thanks!"/); assert.match(at(8.5).join('\n'), /"Is this seat/, 'the exchanges repeat');
  // A delay lets people walk in first; the beat clock starts the talk when the section opens; motion off keeps the opening line.
  const later = synthetic([{ ...TALK, delay: 3 }]);
  assert.doesNotMatch(grid(later, { time: 1 }).join('\n'), /"/); assert.match(grid(later, { time: 3.5 }).join('\n'), /"Is this seat/);
  const onBeat = synthetic([{ ...TALK, clock: 'beat' }]);
  assert.match(grid(onBeat, { time: 100.5, beatTime: 0.5 }).join('\n'), /"Is this seat/);
  assert.doesNotMatch(grid(scene, { time: 100.5 }).join('\n'), /"Is this seat/);
  assert.match(composeScene(later, 'landscape', { time: 99, state: STATE, motion: false }).glyphs.join('\n'), /"Is this seat/);
  // LOOC talk is wrapped in double brackets.
  assert.match(grid(synthetic([{ ...TALK, style: 'looc', width: 30 }]), { time: 0.5 }).join('\n'), /\(\( Is this seat free\? \)\)/);
});

test('P44 dialogues are bounded: two speakers, short words, a few short lines, known styles', () => {
  rejects({ ...TALK, speakers: [[1, 1], [2, 2], [3, 3]] }, 'INVALID_SCENE_DIALOGUE');
  rejects({ ...TALK, style: 'shout' }, 'INVALID_SCENE_DIALOGUE');
  rejects({ ...TALK, exchanges: [[[0, 'Antidisestablishmentarianism']]] }, 'INVALID_SCENE_DIALOGUE');
  rejects({ ...TALK, exchanges: Array(7).fill([[0, 'Hi']]) }, 'INVALID_SCENE_DIALOGUE');
  rejects({ ...TALK, exchanges: [[[2, 'Who?']]] }, 'INVALID_SCENE_DIALOGUE');
  rejects({ ...TALK, exchanges: [[[0, 'x '.repeat(70)]]] }, 'INVALID_SCENE_DIALOGUE');
  rejects({ ...TALK, clock: 'wall' }, 'INVALID_SCENE_DIALOGUE');
});

const WALK = { kind: 'sprite', id: 'walker', frames: [one('A'), one('B'), one('S')], from: [0, 10], to: [10, 10], duration: 2, hold: 5, every: 10, fps: 2, rest: true };

test('P44 sprites can walk in, stop and stay (sitting down), keep the section clock and stay inside a window', () => {
  const at = (scene, time, extra = {}) => grid(scene, { time, ...extra })[10];
  const walker = synthetic([WALK]);
  assert.equal([...at(walker, 0.25)][1], 'A'); assert.equal([...at(walker, 0.75)][4], 'B');
  assert.equal([...at(walker, 3)][10], 'S', 'arrived, in its resting pose'); assert.equal([...at(walker, 6.9)][10], 'S');
  assert.doesNotMatch(at(walker, 7.5), /[ABS]/, 'gone once the hold is over');
  assert.equal([...composeScene(walker, 'landscape', { time: 0, state: STATE, motion: false }).glyphs[10]][10], 'S', 'motion off: already there');
  const onBeat = synthetic([{ ...WALK, clock: 'beat' }]);
  assert.equal([...at(onBeat, 3, { beatTime: 0.25 })][1], 'A');
  const windowed = synthetic([{ ...WALK, clip: [5, 0, 10, 20] }]);
  assert.doesNotMatch(at(windowed, 0.25), /A/, 'outside the window, behind the frame'); assert.equal([...at(windowed, 3)][10], 'S');
  rejects({ ...WALK, hold: undefined }, 'INVALID_SCENE_SPRITE');
  rejects({ ...WALK, every: 6 }, 'INVALID_SCENE_SPRITE');
  rejects({ ...WALK, clip: [90, 0, 10, 5] }, 'INVALID_SCENE_SPRITE');
  rejects({ ...WALK, hold: 700, every: 600 }, 'INVALID_SCENE_SPRITE');
});

test('P44 text can be centred or right-aligned, and the station counts are digits or dashes, never anything else', () => {
  const scene = synthetic([{ kind: 'text', id: 'crew', x: 10, y: 5, width: 10, template: '{crew}', colour: 'c', align: 'right' },
    { kind: 'text', id: 'online', x: 10, y: 6, width: 10, template: '{online}', colour: 'c', align: 'center' }]);
  const g = grid(scene, { state: { crew: 1234, online: 56 } });
  assert.equal(cells(g[5], 10, 20), '      1234'); assert.equal(cells(g[6], 10, 20), '    56    ');
  assert.equal(cells(grid(scene, { state: {} })[5], 18, 20), '--');
  for (const value of [-1, 1.5, '12', 1e9, null]) assert.equal(sceneState({ crew: value }).crew, '--', String(value));
  assert.equal(sceneState({ online: 0 }).online, '0');
  rejects({ kind: 'text', id: 'skew', x: 0, y: 0, width: 5, template: '{crew}', colour: 'c', align: 'justify' }, 'INVALID_SCENE_EFFECT');
});

test('P44 Board the Shuttle has a scene for each section: boarders walk to the ramp and up it, riders take seats, the sea lion gets bumped', () => {
  const scene = id => scenes.find(([, s]) => s.id === id)[1];
  for (const layout of ['landscape', 'portrait']) {
    // Each boarder's ramp climb starts where and when the walk across the bay ends.
    const sprites = scene('landing-bay').layouts[layout].effects.filter(fx => fx.kind === 'sprite' && fx.id.startsWith('boarder-'));
    assert.ok(sprites.length >= 10, layout);
    for (const walk of sprites.filter(fx => fx.id.endsWith('-walk'))) {
      const ramp = sprites.find(fx => fx.id === walk.id.replace('-walk', '-ramp'));
      assert.deepEqual(ramp.from, walk.to, walk.id); assert.equal(ramp.every, walk.every);
      const gap = ((walk.offset - ramp.offset - walk.duration) % walk.every + walk.every) % walk.every;
      assert.ok(gap < 1e-9 || walk.every - gap < 1e-9, walk.id);
    }
    // The shared seat: passengers sit down and stay, and someone asks before sitting; with motion off the question shows.
    const cabin = scene('boarding-cabin'), seated = composeScene(cabin, layout, { time: 0, state: { ...STATE, beat: 'seat' }, motion: false }).glyphs.join('\n');
    assert.match(seated, /ONE PASSENGER PER SEAT/); assert.match(seated, /"ooh, mind if I squeeze in/); assert.doesNotMatch(seated, /ROOK\. Is this one free/, 'one bubble in the still frame');
    assert.ok(cabin.layouts[layout].effects.filter(fx => fx.kind === 'sprite' && fx.rest && fx.clock === 'beat').length >= 4, layout);
    // Two beats (sixth pass): the sea lion is lined up and keeps asking while the reader reads; only the strike beat bumps it.
    const rail = scene('cabin-turbulence'), { layers, effects } = rail.layouts[layout];
    const approach = layers.find(item => item.id === 'approach'), strike = layers.find(item => item.id === 'strike'), shake = layers.find(item => item.id === 'turbulence');
    assert.deepEqual([approach.when.beat, strike.when.beat, shake.when.beat], [['sealion'], ['strike'], ['strike']]);
    assert.ok(approach.frames.every(frame => !frame.text.join('').includes('THUMP')), 'no bump while it asks');
    assert.ok(approach.frames.at(-1).text.join('').includes('_/ o \\'), 'lined up on the rail');
    const asks = effects.find(fx => fx.id === 'sea-lion-asks');
    assert.ok(asks.once === undefined && asks.exchanges[0].length === 3, 'it keeps asking, in a loop');
    for (const time of [8, 20, 40]) assert.match(composeScene(rail, layout, { time, beatTime: time, state: { ...STATE, beat: 'sealion' } }).glyphs.join('\n'), /"(EXPLAIN|JUST ASKING)/, `${layout} at ${time}s`);
    assert.ok(strike.frames[0].text.join('').includes('THUMP') && strike.frames.some(frame => frame.text.join('').includes('(__o__>')), 'the bump, then dazed, not hurt');
    assert.ok(shake.frames.slice(1, 4).every(frame => frame.text.join('').includes('!')) && !shake.frames[0].text.join('').includes('!'), layout);
    assert.ok(strike.once && shake.once && strike.clock === 'beat' && strike.fps === 1, 'the strike happens once, slowly enough to see, and holds');
  }
});

test('P44 Admire the Lights: two crew play out the lucky ten thousand, and the window traffic stays behind the glass', () => {
  const view = scenes.find(([, s]) => s.id === 'viewport')[1];
  for (const layout of ['landscape', 'portrait']) {
    const { effects } = view.layouts[layout];
    const talk = effects.find(fx => fx.id === 'lucky-talk');
    assert.deepEqual(talk.exchanges.map(exchange => exchange[0][1].split(' ').slice(0, 3).join(' ')),
      ['Did you know', "You've never added", 'Ever seen a', "You haven't met"]);
    assert.ok(talk.exchanges.every(exchange => exchange.map(([speaker]) => speaker).join('') === '010'), 'one knows, one learns');
    const lucky = composeScene(view, layout, { time: 0, state: { ...STATE, beat: 'lucky' }, motion: false }).glyphs.join('\n');
    assert.match(lucky, /TODAY: {2}10,000/); assert.match(lucky, /"Did you know/);
    assert.doesNotMatch(composeScene(view, layout, { time: 0, state: STATE, motion: false }).glyphs.join('\n'), /"Did you know|10,000/);
    for (const fx of effects.filter(item => item.kind === 'sprite' && ['comet', 'cargo', 'greytide', 'carp-1', 'meteor-1'].includes(item.id))) assert.ok(fx.clip, `${layout} ${fx.id}`);
  }
});

test('P44 Disembarking shows the station counts on its board, and nothing about any member', () => {
  const door = scenes.find(([, s]) => s.id === 'pressure-door')[1];
  const landscape = composeScene(door, 'landscape', { state: { ...STATE, crew: 1234, online: 56 }, motion: false }).glyphs.join('\n');
  assert.match(landscape, /CREW ABOARD\s+1234/); assert.match(landscape, /ONLINE NOW\s+56/); assert.doesNotMatch(landscape, /PUSH TO TALK/);
  assert.match(composeScene(door, 'landscape', { state: STATE, motion: false }).glyphs.join('\n'), /CREW ABOARD\s+--/);
  const portrait = composeScene(door, 'portrait', { state: { ...STATE, crew: 1234, online: 56 }, motion: false }).glyphs.join('\n');
  assert.match(portrait, /1234/); assert.match(portrait, /56/);
  const allowed = ['crew', 'online', 'stopTitle', 'stopNumber', 'stopCount', 'section', 'sections'];
  for (const layout of Object.values(door.layouts)) for (const fx of layout.effects.filter(item => item.kind === 'text')) {
    for (const [, key] of fx.template.matchAll(/\{(\w+)/g)) assert.ok(allowed.includes(key), key);
  }
});

test('P43 fish swim head first: every carp faces the way it travels', () => {
  let carp = 0;
  for (const [, scene] of scenes) for (const layout of Object.values(scene.layouts)) for (const fx of layout.effects) {
    if (fx.kind !== 'sprite' || !fx.id.startsWith('carp')) continue;
    carp++;
    const left = fx.to[0] < fx.from[0];
    for (const frame of fx.frames) assert.match(frame.text.join('\n'), left ? /<o\)/ : /\(o>/, `${scene.id} ${fx.id}`);
  }
  assert.ok(carp >= 6);
});
