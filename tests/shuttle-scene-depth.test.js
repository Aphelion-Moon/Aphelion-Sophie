import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { composeScene, validateScene } from '../modules/onboarding/scenes.js';
import { createScenePlayer } from '../apps/activity/scene-player.js';

const header = JSON.parse(await readFile(new URL('../content/shuttle-activity/scenes/hangar-viewport.json', import.meta.url), 'utf8'));
const frame = (text, key = 'i') => ({ text, colours: text.map(row => [...row].map(ch => ch === ' ' ? ' ' : key).join('')) });
const WALKER = [frame([' o ', '/|\\', '/ \\'], 'c')];
/** A synthetic scene: the committed hangar's header with small hand-made layouts. */
function scene(landscape = {}) {
  const plain = { layers: [{ id: 'floor', x: 0, y: 10, frames: [frame(['__________'], 'd')] }], effects: [] };
  return { ...structuredClone(header), id: 'synthetic-depth', layouts: { landscape: { ...plain, ...landscape }, portrait: structuredClone(plain) } };
}
const sign = (extra = {}) => ({ id: 'sign', x: 4, y: 5, frames: [frame(['[SIGN]'], 'a')], ...extra });
const walker = { kind: 'sprite', id: 'walker', frames: WALKER, from: [0, 4], to: [12, 4], duration: 12, every: 20 };
const rows = (s, time) => composeScene(validateScene(s), 'landscape', { time }).glyphs;

test('T-SCENE-DEPTH-01 people walk behind a standing object: its cells stay drawn, the rest of them shows around it', () => {
  const plain = rows(scene({ layers: [sign()], effects: [walker] }), 5), behind = rows(scene({ layers: [sign({ front: true })], effects: [walker] }), 5);
  assert.notEqual(plain[5].slice(4, 10), '[SIGN]', 'without front the walker paints over the sign');
  assert.equal(behind[5].slice(4, 10), '[SIGN]', 'a front sign hides the walker passing behind it');
  assert.equal(behind[4][6], 'o', 'the head above the sign still shows'); assert.equal(behind[6].slice(5, 8), '/ \\', 'and the feet below it');
  // Once the walker has passed, nothing of it remains on the sign.
  assert.equal(rows(scene({ layers: [sign({ front: true })], effects: [walker] }), 15)[5].slice(4, 10), '[SIGN]');
});

test('T-SCENE-DEPTH-02 speech bubbles still draw over standing objects', () => {
  const bubble = { kind: 'dialogue', id: 'talk', speakers: [[6, 6], [8, 6]], width: 20, style: 'say', exchanges: [[[0, 'hi there']]], line: 3, pause: 1, colours: 'ac' };
  const shown = rows(scene({ layers: [sign({ front: true, y: 4 })], effects: [bubble] }), 1);
  assert.match(shown[4], /"hi there"/, 'the bubble covers the sign');
});

test('T-SCENE-DEPTH-03 the validator takes front only as true, and slots only as named regions on the grid', () => {
  assert.throws(() => validateScene(scene({ layers: [sign({ front: 'yes' })] })), /INVALID_SCENE_FIELDS/);
  assert.equal(validateScene(scene({ slots: { menu: [10, 20, 30, 8] } })).layouts.landscape.slots.menu[2], 30);
  assert.throws(() => validateScene(scene({ slots: { menu: [90, 20, 30, 8] } })), /INVALID_SCENE_SLOTS/, 'off the grid');
  assert.throws(() => validateScene(scene({ slots: { sidebar: [0, 0, 4, 4] } })), /INVALID_SCENE_SLOTS/, 'unknown slot');
  assert.throws(() => validateScene(scene({ slots: [0, 0, 4, 4] })), /INVALID_SCENE_SLOTS/, 'not a map');
});

test('T-SCENE-DEPTH-04 the player gives the menu slot in CSS pixels from the live cell size, and says when it moves', () => {
  const ctx = { fillRect() {}, fillText() {}, measureText: text => ({ width: 8 * text.length }), setTransform() {}, save() {}, restore() {}, rect() {}, clip() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  let resize = null, layouts = 0;
  const player = createScenePlayer({ host: {}, canvas, altElement: { textContent: '' }, palette: {}, background: '#000', clock: () => 0,
    scheduler: { request: () => 1, cancel() {} }, observeSize(_, cb) { resize = cb; return () => {}; }, pixelRatio: () => 2, onLayout: () => { layouts++; } });
  resize(960, 400);
  player.setScene(scene({ slots: { menu: [10, 20, 30, 8] } }));
  // 96 by 40 cells in 960 by 400 CSS pixels: 10 by 10 each, whatever the pixel ratio.
  assert.deepEqual(player.slotRect('menu'), { left: 100, top: 200, width: 300, height: 80, cellWidth: 10, cellHeight: 10 });
  resize(1920, 800);
  assert.deepEqual(player.slotRect('menu'), { left: 200, top: 400, width: 600, height: 160, cellWidth: 20, cellHeight: 20 });
  assert.equal(layouts, 3, 'told on both resizes and the scene change');
  player.setScene(scene());
  assert.equal(player.slotRect('menu'), null, 'a scene without the slot');
  player.destroy();
});

const shipped = async id => validateScene(JSON.parse(await readFile(new URL(`../content/shuttle-activity/scenes/${id}.json`, import.meta.url), 'utf8')));
const STATE = { beat: 'none', whitelist: 'none', stop: 'some', doorOpen: 0, reached: [], stopTitle: 'Synthetic stop', stopNumber: 1, stopCount: 5, section: 1, sections: 3,
  link: 'ready', crew: '--', online: '--' };
const at = (s, time, state = {}, layout = 'landscape') => composeScene(s, layout, { time, beatTime: time, state: { ...STATE, ...state } }).glyphs;

test('T-SCENE-DEPTH-05 the BLASTWAVE fire runs a 24-second cycle: flames, the firebot foams it out, smoke, cold, a spark', async () => {
  const hall = await shipped('baggage-hall');
  for (const layout of ['landscape', 'portrait']) {
    const bag = hall.layouts[layout].layers.find(item => item.id === 'blastwave');
    // The fire sits on the bag: the three rows above its top edge, as wide as the bag.
    const fire = time => at(hall, time, {}, layout).slice(bag.y - 3, bag.y).map(row => [...row].slice(bag.x, bag.x + 11).join('')).join('\n');
    const whole = time => at(hall, time, {}, layout).join('\n');
    for (const time of [5, 13, 24 + 5]) assert.match(fire(time), /█/, `${layout} burning at ${time}s`);
    assert.doesNotMatch(whole(13), /\[o_o\]/, `${layout} the firebot stays in its dock while it burns`);
    assert.match(whole(15.5), /▒░▒░=\|___\|/, `${layout} the firebot foams it at 15s`);
    assert.doesNotMatch(fire(15.5), /█/, `${layout} and the flames are out`);
    for (const time of [20, 22]) { assert.doesNotMatch(fire(time), /[█▓░*]/, `${layout} cold at ${time}s`); assert.doesNotMatch(whole(time), /\[o_o\]/, `${layout} the bot is home`); }
    assert.match(fire(23.1), /[*·]/, `${layout} a spark at 23s`);
    // The foam and the relight sound with it, every cycle.
    const cues = Object.fromEntries(hall.layouts[layout].effects.filter(fx => fx.kind === 'cue' && ['SC-12', 'SC-21'].includes(fx.cue)).map(fx => [fx.cue, fx]));
    assert.deepEqual([cues['SC-12'].at, cues['SC-12'].every], [15, 24]); assert.deepEqual([Math.floor(cues['SC-21'].at), cues['SC-21'].every], [23, 24]);
    // With motion off the bag is shown burning.
    assert.match(composeScene(hall, layout, { time: 20, state: STATE, motion: false }).glyphs.slice(bag.y - 3, bag.y).join('\n'), /█/);
  }
});

test('T-SCENE-DEPTH-06 the wet floor sign carries NO RUNNING built in, centred on it, for as long as the sign is out', async () => {
  const door = await shipped('pressure-door');
  for (const layout of ['landscape', 'portrait']) for (const beat of ['watch-step', 'feedback', 'be-safe']) {
    const grid = at(door, 3, { beat, reached: ['watch-step', 'feedback', 'be-safe'].slice(0, ['watch-step', 'feedback', 'be-safe'].indexOf(beat) + 1) }, layout);
    const y = grid.findIndex(row => row.includes('│NO RUNNING│')), x = [...grid[y]].join('').indexOf('│NO RUNNING│');
    assert.ok(y > 1, `${layout} ${beat}`);
    // The board's top edge and its other line share the same columns, so the words sit centred on it.
    assert.equal([...grid[y - 2]].slice(x, x + 12).join(''), '┌──────────┐', `${layout} ${beat}`);
    assert.equal([...grid[y - 1]].slice(x, x + 12).join(''), '│WET  FLOOR│', `${layout} ${beat}`);
    assert.equal([...grid[y + 1]].slice(x, x + 12).join(''), '└─┬──────┬─┘', `${layout} ${beat}`);
  }
});

test('T-SCENE-DEPTH-07 mothroaches: under the lounge benches, along the baggage lockers and on the deck lamp', async () => {
  // Its wings and tail, whichever way it walks (bench legs may hide some of its head).
  const roach = /\(@\)|=\}|\{=/;
  for (const [id, effect] of [['departure-lounge', 'mothroach'], ['baggage-hall', 'mothroach']]) {
    const s = await shipped(id);
    for (const layout of ['landscape', 'portrait']) {
      const fx = s.layouts[layout].effects.find(item => item.id === effect);
      assert.equal(fx?.kind, 'sprite', `${id} ${layout}`);
      const start = fx.every - (fx.offset % fx.every);
      assert.match(at(s, start + fx.duration / 2, {}, layout).join('\n'), roach, `${id} ${layout} crossing`);
    }
  }
  // Under the benches it passes behind their seats and legs: the benches are a standing object and stay whole.
  const lounge = await shipped('departure-lounge'), benches = lounge.layouts.landscape.layers.find(item => item.id === 'benches');
  assert.ok(benches.front);
  const fx = lounge.layouts.landscape.effects.find(item => item.id === 'mothroach'), start = fx.every - (fx.offset % fx.every);
  const without = structuredClone(lounge); without.layouts.landscape.effects = without.layouts.landscape.effects.filter(item => item.id !== 'mothroach');
  for (let t = 0; t < fx.duration; t += 0.5) {
    const grid = at(lounge, start + t), bare = at(without, start + t);
    benches.frames[0].text.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch !== ' ') assert.equal([...grid[benches.y + r]][benches.x + c], [...bare[benches.y + r]][benches.x + c], `bench cell at ${t}s`);
    }));
  }
  const deck = await shipped('viewport');
  for (const layout of ['landscape', 'portrait']) assert.match(at(deck, 1, {}, layout).join('\n'), /\(@\)[\s\S]*\(___\)/, `the deck lamp's mothroach, ${layout}`);
});

test('T-SCENE-DEPTH-08 standing props are front layers, so everyone who walks past goes behind them', async () => {
  const expected = {
    'departure-lounge': ['benches', 'desk', 'desk-legs'], 'baggage-hall': ['standing', 'blastwave', 'firebot-dock'], 'boarding-cabin': ['back-row', 'sleeper', 'settled'],
    'landing-bay': ['hull'], viewport: ['deck-standing'], 'pressure-door': ['deck-wet', 'deck-standing', 'id-card'],
  };
  for (const [id, fronts] of Object.entries(expected)) {
    const s = await shipped(id);
    for (const layout of ['landscape', 'portrait']) {
      const found = s.layouts[layout].layers.filter(item => item.front).map(item => item.id);
      for (const name of fronts) assert.ok(found.includes(name), `${id} ${layout} ${name}`);
    }
  }
});

test('T-SCENE-DEPTH-09 the title screen: the menu slot is the inside of the terminal window, clear of any art', async () => {
  const hangar = await shipped('hangar-viewport');
  for (const layout of ['landscape', 'portrait']) {
    const [x, y, w, h] = hangar.layouts[layout].slots.menu, grid = at(hangar, 4, {}, layout).map(row => [...row]);
    // The window's top edge is a plain rule: its title (the member's own name@aphelion) is page text over the title slot,
    // never scene data.
    assert.match(grid[y - 1].join(''), /┌─+┐/, layout); assert.doesNotMatch(JSON.stringify(hangar), /sophie@|@aphelion/, layout);
    assert.deepEqual(hangar.layouts[layout].slots.title, [x, y - 1, w, 1], `${layout}: the title slot is the window's top edge`);
    for (let r = y; r < y + h; r++) {
      // One clear column either side of the slot, then the window's edges.
      assert.equal(grid[r][x - 2], '│', `${layout} left edge row ${r}`); assert.equal(grid[r][x + w + 1], '│', `${layout} right edge row ${r}`);
      assert.equal(grid[r].slice(x - 1, x + w + 1).join('').trim(), '', `${layout} nothing drawn under the menu, row ${r}`);
    }
    assert.match(grid[y + h].join(''), /└─+┘/, layout);
    // The shuttle's orbit runs clear of the subtitle.
    const subtitle = grid.findIndex(row => row.join('').includes('T H E   S H U T T L E'));
    for (let t = 0; t < 14; t += 0.25) assert.ok(at(hangar, t, {}, layout)[subtitle].includes('T H E   S H U T T L E'), `${layout} at ${t}s`);
  }
});
