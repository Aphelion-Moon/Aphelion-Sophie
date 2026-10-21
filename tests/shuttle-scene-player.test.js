import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createScenePlayer } from '../apps/activity/scene-player.js';

const sceneFile = name => readFile(new URL(`../content/shuttle-activity/scenes/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
const PALETTE = { dim: '#555', ivory: '#eee', ivoryDim: '#aaa', olive: '#880', orange: '#d80', amber: '#fb4', amberDim: '#753', cold: '#eff',
  holo: '#7ef', holoDim: '#277', rose: '#f5a', dark: '#333', stripe1: '#c65', stripe2: '#d95', stripe3: '#ec6', stripe4: '#9b7', stripe5: '#6ab', stripe6: '#78b', stripe7: '#a7b' };

function harness() {
  const calls = { text: [], rect: 0 };
  const ctx = { fillStyle: '', globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    fillRect() { calls.rect++; }, fillText(ch, x, y) { calls.text.push({ ch, x, y, colour: this.fillStyle }); } };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx };
  let now = 0, queue = [], sizeCallback = null;
  const altElement = { textContent: '' };
  const player = createScenePlayer({
    host: {}, canvas, altElement, palette: PALETTE, background: '#000',
    clock: () => now,
    scheduler: { request(fn) { queue.push(fn); return queue.length; }, cancel() { queue = []; } },
    observeSize(_, cb) { sizeCallback = cb; return () => { sizeCallback = null; }; },
  });
  return {
    player, calls, altElement, canvas,
    resize: (w, h) => sizeCallback(w, h),
    /** Runs scheduled frames, advancing the clock; returns how many ran. */
    run(seconds, step = 1 / 12) {
      let ran = 0;
      for (let t = 0; t < seconds && queue.length; t += step) { now += step; const fns = queue; queue = []; fns.forEach(fn => fn()); ran += fns.length; }
      return ran;
    },
    pending: () => queue.length,
  };
}

test('P42 the player picks the grid from the host shape and shows the alt text', async () => {
  const h = harness(), scene = await sceneFile('departure-lounge');
  h.resize(1200, 400); h.player.setScene(scene); h.player.setState({ stopTitle: 'Synthetic stop', section: 1, sections: 2 });
  assert.equal(h.player.layout, 'landscape'); assert.equal(h.canvas.width, 120 * 10);
  h.resize(400, 640);
  assert.equal(h.player.layout, 'portrait'); assert.equal(h.canvas.width, 72 * 5);
  assert.match(h.altElement.textContent, /departure lounge/);
  h.player.destroy();
});

test('P42 with motion off the player draws one still frame and stops scheduling', async () => {
  const h = harness();
  h.resize(1200, 400); h.player.setMotion(false); h.player.setScene(await sceneFile('hangar-viewport'));
  h.run(1);
  assert.equal(h.pending(), 0);
  const drawn = h.calls.text.length; assert.ok(drawn > 0);
  h.run(5); assert.equal(h.calls.text.length, drawn);
  h.player.setMotion(true); h.run(0.5); assert.ok(h.pending() > 0, 'animation resumes with motion on');
  h.player.setPaused('hidden', true); h.run(1); assert.equal(h.pending(), 0, 'paused players stop scheduling');
  h.player.destroy();
});

test('P42 only redraws cells that changed between frames', async () => {
  const h = harness();
  h.resize(1200, 400); h.player.setScene(await sceneFile('boarding-cabin'));
  h.run(1 / 12); const first = h.calls.text.length;
  h.run(1 / 12); const second = h.calls.text.length - first;
  assert.ok(second > 0 && second < first / 4, `second frame redrew ${second} of ${first} glyphs`);
  h.player.destroy();
});

test('P42 the door animates open only after confirmation, then the player goes idle', async () => {
  const h = harness();
  h.resize(1200, 400); h.player.setMotion(false); h.player.setScene(await sceneFile('pressure-door'));
  h.player.setState({ whitelist: 'requested' }); h.run(1);
  assert.match(h.altElement.textContent, /door held/);
  h.player.setMotion(true); h.player.setPaused('pip', true);
  h.player.setState({ whitelist: 'confirmed' });
  assert.match(h.altElement.textContent, /slid open/);
  const ran = h.run(3); assert.ok(ran >= 12, 'the opening animates even while ambient motion is paused');
  assert.equal(h.pending(), 0, 'idle once the door is open and motion is paused');
  h.player.destroy();
});
