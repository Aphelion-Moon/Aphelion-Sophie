import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { composeScene, sceneCues, validateScene } from '../modules/onboarding/scenes.js';
import { createScenePlayer } from '../apps/activity/scene-player.js';

const dir = new URL('../content/shuttle-activity/scenes/', import.meta.url);
const scenes = Object.fromEntries(await Promise.all((await readdir(dir)).filter(name => name.endsWith('.json'))
  .map(async name => [name.slice(0, -5), JSON.parse(await readFile(new URL(name, dir), 'utf8'))])));
const STATE = { stopTitle: 'Synthetic stop', stopNumber: 2, stopCount: 5, section: 1, sections: 3, whitelist: 'none' };
const one = (text, key = 'a') => ({ text: [text], colours: [key.repeat([...text].length)] });
function synthetic(effects, layers = [], beats = ['a', 'b', 'c']) {
  const blank = { layers: [{ id: 'base', x: 0, y: 0, frames: [one('.')] }], effects: [] };
  return validateScene({ schema: 1, id: 'synthetic', title: 'Synthetic', beats, alt: [{ text: 'A synthetic test scene.' }], provenance: scenes['viewport'].provenance,
    layouts: { landscape: { layers: [...blank.layers, ...layers], effects }, portrait: blank } });
}
const text = (scene, input) => composeScene(scene, 'landscape', { ...input, state: { ...STATE, ...input.state } }).glyphs.join('\n');
const rejects = (effects, layers = []) => assert.throws(() => synthetic(effects, layers), error => /INVALID_SCENE/.test(error.code));

test('P45 results stay: after shows a thing from its section on, until clears it when a later section is reached', () => {
  const scene = synthetic([], [{ id: 'banner', x: 5, y: 5, frames: [one('BANNER')], when: { after: ['b'] } }, { id: 'sign', x: 5, y: 7, frames: [one('WET')], when: { after: ['a'], until: ['c'] } }]);
  const at = (beat, reached) => text(scene, { state: { beat, reached } });
  assert.doesNotMatch(at('a', ['a']), /BANNER/); assert.match(at('a', ['a']), /WET/);
  assert.match(at('b', ['a', 'b']), /BANNER/); assert.match(at('none', ['a', 'b']), /BANNER/, 'stays when the section has passed');
  assert.doesNotMatch(at('c', ['a', 'b', 'c']), /WET/, 'cleared once its section is over');
  assert.doesNotMatch(at('a', ['a']).split('\n')[5], /BANNER/, 'going Back un-reaches it');
  rejects([], [{ id: 'bad', x: 0, y: 1, frames: [one('x')], when: { after: ['none'] } }]);
});

test('P45 a once-only animation plays on the section clock and holds its last frame; motion off shows the result', () => {
  const frames = [one('ONE'), one('TWO'), one('END')];
  const scene = synthetic([], [{ id: 'strike', x: 5, y: 5, frames, fps: 1, clock: 'beat', once: true }]);
  assert.match(text(scene, { time: 99, beatTime: 0.5 }), /ONE/); assert.match(text(scene, { time: 99, beatTime: 1.5 }), /TWO/);
  assert.match(text(scene, { time: 0, beatTime: 30 }), /END/, 'holds');
  assert.match(composeScene(scene, 'landscape', { time: 5, state: STATE, motion: false }).glyphs.join('\n'), /END/);
  rejects([], [{ id: 'bad', x: 5, y: 5, frames, fps: 1, once: true }]);
});

test('P45 people walk in, do their part and leave for good: delay, hold, exit and once', () => {
  const WALK = { kind: 'sprite', id: 'walker', frames: [one('A'), one('B')], from: [0, 10], to: [10, 10], duration: 2, hold: 3, exit: { to: [20, 10], duration: 2 },
    every: 600, fps: 2, clock: 'beat', once: true, delay: 1 };
  const scene = synthetic([WALK]), row = beatTime => composeScene(scene, 'landscape', { time: 0, beatTime, state: STATE }).glyphs[10];
  assert.doesNotMatch(row(0.5), /[AB]/, 'not yet');
  assert.match([...row(2)][5], /[AB]/); assert.match([...row(4)][10], /[AB]/, 'holding');
  assert.match([...row(7)][15], /[AB]/, 'leaving'); assert.doesNotMatch(row(9), /[AB]/, 'gone');
  assert.doesNotMatch(row(605), /[AB]/, 'never comes round again');
  assert.doesNotMatch(composeScene(scene, 'landscape', { state: STATE, motion: false }).glyphs[10], /[AB]/, 'someone who leaves is not in the still frame');
  assert.match([...composeScene(synthetic([{ ...WALK, still: 1 }]), 'landscape', { state: STATE, motion: false }).glyphs[10]][10], /A/, 'unless they name a still position');
  rejects([{ ...WALK, hold: undefined }]); rejects([{ ...WALK, clock: undefined }]); rejects([{ ...WALK, once: undefined }]);
  rejects([{ ...WALK, every: 6 }]);
});

test('P45 a talk can play once and keep out of the still frame', () => {
  const TALK = { kind: 'dialogue', id: 'talk', speakers: [[20, 20], [40, 20]], width: 20, style: 'say', line: 2, pause: 1, colours: 'ca', clock: 'beat', once: true,
    exchanges: [[[0, 'Hello there.'], [1, 'Hi.']]] };
  const scene = synthetic([TALK]);
  assert.match(text(scene, { beatTime: 0.5 }), /"Hello there\."/); assert.doesNotMatch(text(scene, { beatTime: 5.5 }), /"Hello/, 'no repeat');
  assert.match(composeScene(scene, 'landscape', { state: STATE, motion: false }).glyphs.join('\n'), /"Hello there\."/);
  assert.doesNotMatch(composeScene(synthetic([{ ...TALK, still: false }]), 'landscape', { state: STATE, motion: false }).glyphs.join('\n'), /"/);
  rejects([{ ...TALK, clock: undefined }]); rejects([{ ...TALK, still: true }]);
});

test('P45 scene sounds fire as their clock passes them: once on the section clock, or in step with a loop', () => {
  const scene = synthetic([{ kind: 'cue', id: 'thump', cue: 'SC-08', at: 5, clock: 'beat', when: { beat: ['a'] } }, { kind: 'cue', id: 'honk', cue: 'SC-11', at: 3, every: 10 }]);
  const cues = input => sceneCues(scene, 'landscape', { state: { beat: 'a' }, ...input });
  assert.deepEqual(cues({ beatFrom: 4.9, beatTo: 5.1 }), ['SC-08']); assert.deepEqual(cues({ beatFrom: 5.1, beatTo: 6 }), []);
  assert.deepEqual(sceneCues(scene, 'landscape', { beatFrom: 4.9, beatTo: 5.1, state: { beat: 'b' } }), [], 'only in its section');
  assert.deepEqual(cues({ from: 2.9, to: 3.1 }), ['SC-11']); assert.deepEqual(cues({ from: 22.9, to: 23.1 }), ['SC-11']); assert.deepEqual(cues({ from: 23.1, to: 32 }), []);
  assert.deepEqual(cues({ beatFrom: 4.9, beatTo: 5.1, motion: false }), [], 'nothing with motion off');
  rejects([{ kind: 'cue', id: 'bad', cue: 'rm -rf', at: 1 }]); rejects([{ kind: 'cue', id: 'bad', cue: 'SC-08', at: 1, clock: 'wall' }]);
});

test('P45 the player plays a scene sound once as the section clock passes it', () => {
  let now = 0, queue = [], resize = null;
  const played = [];
  const ctx = { fillRect() {}, fillText() {}, measureText: () => ({ width: 5, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }), setTransform() {}, save() {}, restore() {}, rect() {},
    clip() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const player = createScenePlayer({ host: {}, canvas: { style: {}, getContext: () => ctx }, altElement: { textContent: '' }, palette: {}, background: '#000', clock: () => now,
    scheduler: { request(fn) { queue.push(fn); return queue.length; }, cancel() { queue = []; } }, observeSize(_, cb) { resize = cb; return () => {}; } });
  player.setCueHandler(cue => played.push([Math.round(now * 10) / 10, cue]));
  resize(960, 400); player.setScene(scenes['cabin-turbulence']); player.setState({ beat: 'sealion' });
  for (let t = 0; t < 8 && queue.length; t += 0.1) { now += 0.1; const fns = queue; queue = []; fns.forEach(fn => fn()); }
  const cues = played.map(([, cue]) => cue);
  assert.deepEqual(cues.filter(cue => cue === 'SC-08'), ['SC-08'], 'one THUMP'); assert.ok(cues.indexOf('SC-17') < cues.indexOf('SC-07'));
  assert.ok(Math.abs(played.find(([, cue]) => cue === 'SC-08')[0] - 5) <= 0.2);
  player.destroy();
});

test('P45 the shipped scenes introduce, use and clean up their people and props', () => {
  const at = (id, state, extra = {}) => composeScene(scenes[id], 'landscape', { time: 3, state: { ...STATE, ...state }, ...extra }).glyphs.join('\n');
  // The Brochure: the pride banner stays up once hung.
  assert.doesNotMatch(at('departure-lounge', { beat: 'adult', reached: ['adult'] }), /▄▄▄▄▄▄/);
  assert.match(at('departure-lounge', { beat: 'voluntary', reached: ['adult', 'pride', 'voluntary'] }), /▄▄▄▄▄▄/);
  // Pack Your Bags: the LOOC pair are gone once they have talked, and the cape stays in its locker.
  assert.match(at('baggage-hall', { beat: 'looc', reached: ['migrating', 'past', 'looc'] }, { beatTime: 4 }), /\(\( hey, do our/);
  assert.doesNotMatch(at('baggage-hall', { beat: 'looc', reached: ['migrating', 'past', 'looc'] }, { beatTime: 40 }), /\(\(|first time here/);
  assert.match(at('baggage-hall', { beat: 'looc', reached: ['migrating', 'past', 'looc'] }), /UNCLAIM/);
  // The cabin: Pip is in one place at a time, and ends up sitting.
  const pip = scenes['boarding-cabin'].layouts.landscape.effects.filter(fx => fx.id.startsWith('pip-'));
  const spans = pip.map(fx => [fx.delay ?? 0, (fx.delay ?? 0) + fx.duration + fx.hold + (fx.exit?.duration ?? 0)]).sort((a, b) => a[0] - b[0]);
  spans.slice(1).forEach(([start], i) => assert.ok(start >= spans[i][1] - 1e-9, `Pip overlaps at ${start}`));
  assert.ok(pip.find(fx => fx.id === 'pip-sits').rest);
  // Admire the Lights: after the lucky ten thousand the pair leave together; the prints stay pinned.
  assert.doesNotMatch(at('viewport', { beat: 'lucky', reached: ['enjoy', 'valuable', 'photos', 'lucky'] }, { beatTime: 70 }), /"/);
  assert.match(at('viewport', { beat: 'lucky', reached: ['enjoy', 'valuable', 'photos', 'lucky'] }), /\[▒\] \[▒\] \[▒\] \[▒\]/);
  // Disembarking: the janitor goes, the sign stays until the floor dries, the checklist stays ticked and the button lit.
  assert.match(at('pressure-door', { beat: 'watch-step', reached: ['watch-step'] }), /NO RUNNING/);
  assert.match(at('pressure-door', { beat: 'watch-step', reached: ['watch-step'] }), /\/\|\\_/, 'the janitor mops');
  assert.doesNotMatch(at('pressure-door', { beat: 'feedback', reached: ['watch-step', 'feedback'] }, { beatTime: 10 }), /\/\|\\_/, 'and has left');
  assert.match(at('pressure-door', { beat: 'be-safe', reached: ['watch-step', 'feedback', 'be-safe'] }), /\/WET\\/);
  assert.doesNotMatch(at('pressure-door', { beat: 'ready', reached: ['watch-step', 'feedback', 'be-safe', 'ready'] }), /\/WET\\/);
  const clearance = at('pressure-door', { beat: 'none', whitelist: 'requested', reached: ['watch-step', 'feedback', 'be-safe', 'ready', 'get-whitelisted'] });
  assert.equal(clearance.match(/\[x\]/g)?.length, 4, 'ticked stays ticked through clearance'); assert.match(clearance, /> link via Discord/);
  assert.match(at('pressure-door', { beat: 'none', whitelist: 'confirmed', doorOpen: 1, reached: ['ready', 'get-whitelisted'] }), /CONCOURSE/);
});
