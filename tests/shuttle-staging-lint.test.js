import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { composeScene, validateScene } from '../modules/onboarding/scenes.js';

// The staging lint (owner review, sixth pass): rules every scene keeps, checked on every layout, so the stage never
// breaks in the ways the owner reported (actors vanishing mid-screen or hiding behind props, flight paths crossing,
// holes left in the floor).
const dir = new URL('../content/shuttle-activity/scenes/', import.meta.url);
const scenes = await Promise.all((await readdir(dir)).filter(name => name.endsWith('.json')).sort()
  .map(async name => validateScene(JSON.parse(await readFile(new URL(name, dir), 'utf8')))));
const LAYOUTS = ['landscape', 'portrait'];
const STATE = { beat: 'none', whitelist: 'none', stop: 'some', doorOpen: 0, reached: [], stopTitle: 'Stop', stopNumber: 1, stopCount: 5, section: 1, sections: 3,
  link: 'ready', crew: '--', online: '--' };
const widthOf = fx => Math.max(...fx.frames.flatMap(frame => frame.text.map(row => [...row].length)));
const heightOf = fx => Math.max(...fx.frames.map(frame => frame.text.length));

/** Where a wall-clock sprite is at time t (the composer's own arithmetic), or null when it is not on stage. */
function placed(fx, t) {
  const hold = fx.hold ?? 0, leave = fx.exit?.duration ?? 0, phase = (t + (fx.offset ?? 0)) % fx.every;
  if (phase >= fx.duration + hold + leave) return null;
  const leaving = phase >= fx.duration + hold;
  const [a, b, progress] = leaving ? [fx.to, fx.exit.to, (phase - fx.duration - hold) / leave] : [fx.from, fx.to, Math.min(1, phase / fx.duration)];
  return [Math.round(a[0] + (b[0] - a[0]) * progress), Math.round(a[1] + (b[1] - a[1]) * progress)];
}

test('T-STAGE-01 actors that come and go enter and leave beyond the edge of what they cross, never mid-screen', () => {
  // Exempt by design: meteors and the fire's flames, foam, smoke and spark burn out where they are; boarders hand over
  // from the walk to the ramp and step into the shuttle's door; the hangar's Wing hands over from leg to leg (T-STAGE-05
  // checks that the whole flight comes and goes beyond the edge).
  const exempt = /^(meteor-|blastwave-|boarder-\d+-(walk|ramp)$|wing-(in|dock|undock|home)$)/;
  for (const scene of scenes) for (const layout of LAYOUTS) {
    const { cols, rows } = { landscape: { cols: 96, rows: 40 }, portrait: { cols: 72, rows: 57 } }[layout];
    const fronts = scene.layouts[layout].layers.filter(item => item.front && item.opaque).map(item => [item.x, item.y, item.x + Math.max(...item.frames[0].text.map(r => [...r].length)) - 1, item.y + item.frames[0].text.length - 1]);
    for (const fx of scene.layouts[layout].effects.filter(item => item.kind === 'sprite' && item.clock !== 'beat' && !exempt.test(item.id))) {
      if (fx.from[0] === fx.to[0] && fx.from[1] === fx.to[1] && !fx.exit) continue;
      const [ax, ay, aw, ah] = fx.clip ?? [0, 0, cols, rows], width = widthOf(fx), height = heightOf(fx);
      const outside = ([x, y]) => x + width <= ax || x >= ax + aw || y + height <= ay || y >= ay + ah;
      // An end inside the stage is allowed only if every cell of the figure there is behind an opaque standing prop.
      const hidden = ([x, y]) => fx.frames[0].text.every((row, r) => [...row].every((ch, c) => ch === ' ' || fronts.some(([l, t, rr, b]) => x + c >= l && x + c <= rr && y + r >= t && y + r <= b)));
      for (const [end, point] of [['enters', fx.from], ['leaves', fx.exit?.to ?? fx.to]]) {
        assert.ok(outside(point) || hidden(point), `${scene.id} ${layout}: ${fx.id} ${end} at ${point} inside the stage`);
      }
    }
  }
});

test('T-STAGE-02 named actors never pass behind a standing prop', () => {
  const named = /^(looc-|rook-|pip-|board-|beepsky|popper)/;
  for (const scene of scenes) for (const layout of LAYOUTS) {
    const { layers, effects } = scene.layouts[layout];
    for (const fx of effects.filter(item => item.kind === 'sprite' && named.test(item.id))) {
      const state = { ...STATE, beat: fx.when?.beat?.[0] ?? 'none', whitelist: fx.when?.whitelist?.[0] ?? 'none', reached: scene.beats ?? [] };
      if (state.whitelist === 'confirmed') state.doorOpen = 1;
      const only = { ...scene, layouts: { ...scene.layouts, [layout]: { ...scene.layouts[layout], effects: [fx] } } };
      const flat = { ...only, layouts: { ...only.layouts, [layout]: { ...only.layouts[layout], layers: layers.map(item => ({ ...item, front: undefined })) } } };
      // Boarders' last leg is up the ramp and through the shuttle's door: going inside is meant to hide them.
      const span = (fx.delay ?? 0) + fx.duration + Math.min(fx.hold ?? 0, 4) + (fx.id.startsWith('board-') ? 0 : fx.exit?.duration ?? 0);
      for (let t = 0; t <= span; t += 0.25) {
        const input = { time: t, beatTime: t, state };
        const a = composeScene(only, layout, input).glyphs, b = composeScene(flat, layout, input).glyphs;
        for (let y = 0; y < a.length; y++) if (a[y] !== b[y]) {
          // The figure drew here when nothing stood in front; with the props standing, something hid it.
          assert.fail(`${scene.id} ${layout}: ${fx.id} passes behind a standing prop at ${t}s, row ${y}`);
        }
      }
    }
  }
});

test('T-STAGE-03 flyers behind the deck glass keep their own lanes and slots: no two ever overlap', () => {
  const deck = scenes.find(scene => scene.id === 'viewport');
  for (const layout of LAYOUTS) {
    const flyers = deck.layouts[layout].effects.filter(fx => fx.kind === 'sprite' && fx.clip && fx.clock !== 'beat');
    const cycle = Math.max(...flyers.map(fx => fx.every));
    assert.ok(flyers.every(fx => cycle % fx.every === 0), `${layout}: one shared cycle`);
    const group = fx => fx.id.startsWith('carp-') ? 'carp' : fx.id;
    for (let t = 0; t < cycle; t += 0.25) {
      const boxes = flyers.map(fx => ({ id: group(fx), at: placed(fx, t), w: widthOf(fx), h: heightOf(fx) })).filter(box => box.at);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]];
        if (p.id === q.id) continue;
        const apart = p.at[0] + p.w <= q.at[0] || q.at[0] + q.w <= p.at[0] || p.at[1] + p.h <= q.at[1] || q.at[1] + q.h <= p.at[1];
        assert.ok(apart, `${layout}: ${p.id} and ${q.id} overlap at ${t}s`);
      }
    }
    // While Rook points out the greytide, the lanes it drifts through are clear.
    const pointed = deck.layouts[layout].effects.find(fx => fx.id === 'greytide-pointed');
    const rowsOf = fx => [Math.min(fx.from[1], fx.to[1], fx.exit?.to[1] ?? Infinity), Math.max(fx.from[1], fx.to[1], fx.exit?.to[1] ?? -Infinity) + heightOf(fx) - 1];
    const [top, bottom] = rowsOf(pointed);
    for (const fx of flyers.filter(item => !item.when || item.when.beat?.includes('valuable'))) {
      const [a, b] = rowsOf(fx);
      assert.ok(b < top || a > bottom, `${layout}: ${fx.id} shares the greytide's lane while Rook points at it`);
    }
  }
});

test('T-STAGE-04 tiled floors have no holes: a run of bare floor beside tiles is always covered by something', () => {
  const tiled = ['departure-lounge', 'baggage-hall', 'pressure-door', 'landing-bay'];
  const floor = new Set(['_', ' ', '·', '.', "'", '|']);
  for (const scene of scenes.filter(item => tiled.includes(item.id))) for (const layout of LAYOUTS) {
    const bare = { ...scene, layouts: { ...scene.layouts, [layout]: { ...scene.layouts[layout], effects: [] } } };
    // Each beat as the reader meets it (the beats before it reached, the ones after not yet), plus before and after them all,
    // so layers that come and go with the story (a sign put out, then taken away) are seen in every state.
    const beats = scene.beats ?? [];
    const states = [['none', []], ...beats.map((beat, i) => [beat, beats.slice(0, i + 1)]), ['none', beats]];
    for (const [beat, reached] of states) for (const whitelist of ['none', 'confirmed']) {
      const grid = composeScene(bare, layout, { time: 0, state: { ...STATE, beat, whitelist, reached } }).glyphs.map(row => [...row]);
      grid.forEach((row, y) => {
        // A tile seam row: the "_ _ _" pattern across much of the row (a solid rule, like a hull's roof, is not floor).
        if (row.filter((ch, x) => ch === '_' && row[x + 1] === ' ' && row[x + 2] === '_').length < row.length * 0.15) return;
        for (let x = 0; x < row.length;) {
          if (row[x] !== ' ') { x++; continue; }
          let end = x; while (end < row.length && row[end] === ' ') end++;
          // Runs inside an object (between any two of its glyphs) are the object's own space; a run next to bare tiles is a hole.
          const left = row[x - 1], right = row[end];
          const nextToTiles = (left === undefined || left === '_') || (right === undefined || right === '_');
          if (end - x >= 3 && nextToTiles && !(left !== undefined && right !== undefined && !floor.has(left) && !floor.has(right))) {
            assert.fail(`${scene.id} ${layout} (${beat}/${whitelist}): a hole in the floor at row ${y}, columns ${x}-${end - 1}`);
          }
          x = end;
        }
      });
    }
  }
});

test('T-STAGE-05 the hangar Wing flies in and home beyond the edge, its legs meeting exactly, docked in the still frame', () => {
  const hangar = scenes.find(scene => scene.id === 'hangar-viewport');
  for (const layout of LAYOUTS) {
    const legs = ['wing-in', 'wing-dock', 'wing-undock', 'wing-home'].map(id => hangar.layouts[layout].effects.find(fx => fx.id === id));
    assert.ok(legs.every(Boolean), layout);
    const width = widthOf(legs[0]);
    assert.ok(legs[0].from[0] + width <= 0 && legs[3].to[0] + width <= 0, `${layout}: comes and goes beyond the left edge`);
    for (let i = 1; i < 4; i++) assert.deepEqual(legs[i].from, legs[i - 1].to, `${layout}: ${legs[i].id} starts where ${legs[i - 1].id} ends`);
    assert.ok(legs.every(fx => fx.every === legs[0].every), layout);
    // Each leg starts as the one before it ends, and the cycle has room for all of them.
    const start = fx => (fx.every - (fx.offset ?? 0)) % fx.every;
    for (let i = 1; i < 4; i++) assert.ok(Math.abs(start(legs[i]) - (start(legs[i - 1]) + legs[i - 1].duration + (legs[i - 1].hold ?? 0))) < 1e-6, `${layout}: ${legs[i].id} timing`);
    assert.ok(start(legs[3]) + legs[3].duration <= legs[0].every, layout);
    // With motion off the craft is docked: the dock leg holds there.
    const still = composeScene(hangar, layout, { state: STATE, motion: false }).glyphs.join('\n');
    assert.match(still, /═\[□□□\]>/, `${layout}: docked in the still frame`);
  }
});
